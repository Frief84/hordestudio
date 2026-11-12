/**
 * Whole-system audit: does a world an ordinary user creates actually work?
 *
 * Driven by two reported failures — no quest ever appears, and spending money
 * does not spend money — plus a sweep for the conditions that make a subsystem
 * silently do nothing on a world that was never hand-tuned.
 *
 * Run with: node scratch/world_systems_audit.js
 */
const assert = require('node:assert/strict');
const vm = require('node:vm');

// The extractor follows the call graph itself — see app_source.js.
const { app, functionSource, buildContext } = require('./app_source.js');

const toasts = [];
const context = {
    console: { log() {}, warn() {}, error() {} },
    showToast: (m, t) => toasts.push({ m, t }),
    isPlainObject: v => !!v && typeof v === 'object' && !Array.isArray(v),
    cssColor: (v, fallback) => v || fallback,
    safeJsonClone: v => JSON.parse(JSON.stringify(v))
};

// What this suite is about: does a world an ordinary user makes actually work?
buildContext(vm, [
    'normalizeWorldGameRules', 'normalizePlayerRulesState', 'applyPlayerStatChanges',
    'normalizeLivingWorldState', 'executeCommerceTransactions',
    'normalizeQuestState', 'applyQuestUpdates', 'getQuestPrompt',
    'evaluateQuestProgress', 'evaluateQuestObjective', 'grantQuestRewards',
    'formatQuestRewardSummary', 'normalizeQuestObjective', 'normalizeQuestRewards',
    'makeQuestId', 'findSessionQuest',
    'stableWorldRoll', 'relationshipKey', 'isVisibleToSession', 'sessionNpcs',
    'isNpcActive', 'getWorldTimeData', 'isValidScheduleTime', 'getLocationRef',
    'questTextKey', 'livingClamp', 'livingId'
], context);

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// A world exactly as the "+ Create New World" flow leaves it: no gameRules,
// no profile, stats the author typed by hand.
function plainWorld(stats) {
    return {
        id: 'w_new', name: 'Smith House',
        hudConfig: { stats: stats || [
            { id: 'hp', name: 'HP', value: 100, min: 0, max: 100 },
            { id: 'cash', name: '$$$', value: 25, min: 0, max: 0 }
        ], enableSchedules: true },
        locations: [{ id: 'loc_house', name: 'Smith House', exits: [] }],
        entities: []
    };
}
function freshSession(world) {
    return { id: 's', turnCount: 1, playerLocation: world.locations[0].id,
        inventory: [], playerStats: {}, entityStates: {}, quests: [] };
}

// ---------------------------------------------------- money actually moves

test('a hand-made world gets every module on by default', () => {
    const rules = context.normalizeWorldGameRules(plainWorld());
    Object.entries(rules.modules).forEach(([key, on]) => {
        assert.equal(on, true, `a brand-new world has "${key}" disabled, so that system never fires`);
    });
});

test('a currency stat named "$$$" is recognised as currency', () => {
    const rules = context.normalizeWorldGameRules(plainWorld());
    assert.equal(rules.currencyStatId, 'cash',
        'the money stat was not detected — every purchase fails as currency_not_configured');
});

test('currency detection survives the names authors really use', () => {
    const shapes = [
        [{ id: 'money', name: 'Money' }, 'money'],
        [{ id: 's1', name: '$' }, 's1'],
        [{ id: 's2', name: 'Cash on hand' }, 's2'],
        [{ id: 'wallet', name: 'Wallet' }, 'wallet'],
        [{ id: 'gold_pieces', name: 'Gold Pieces' }, 'gold_pieces'],
        [{ id: 's3', name: 'Allowance' }, 's3'],
        [{ id: 's4', name: 'Credits' }, 's4'],
        [{ id: 'caps', name: 'Bottle Caps' }, 'caps'],
        [{ id: 's5', name: '£' }, 's5']
    ];
    shapes.forEach(([stat, expected]) => {
        const world = plainWorld([{ id: 'hp', name: 'HP', value: 10, min: 0, max: 10 },
            { ...stat, value: 50, min: 0, max: 0 }]);
        assert.equal(context.normalizeWorldGameRules(world).currencyStatId, expected,
            `"${stat.name}" was not recognised as currency`);
    });
});

test('something that is not money is not mistaken for it', () => {
    const world = plainWorld([
        { id: 'hp', name: 'HP', value: 10, min: 0, max: 10 },
        { id: 'karma', name: 'Karma', value: 3, min: 0, max: 10 },
        { id: 'stress', name: 'Stress', value: 3, min: 0, max: 10 }
    ]);
    assert.equal(context.normalizeWorldGameRules(world).currencyStatId, '',
        'a non-currency stat was adopted as the purse');
});

test('buying with a stated price moves the money, with no market defined', () => {
    const world = plainWorld();
    const sess = freshSession(world);
    context.normalizePlayerRulesState(world, sess);
    const [result] = context.executeCommerceTransactions(world, sess,
        [{ type: 'buy', item: 'coffee', quantity: 2, price: 3 }]);
    assert.equal(result.success, true, `purchase refused: ${result.reason}`);
    assert.equal(result.total, 6);
    assert.equal(sess.playerStats.cash, 19, 'the money did not actually leave the purse');
    assert.equal(sess.inventory.filter(i => i === 'coffee').length, 2, 'the goods were not delivered');
});

test('selling with a stated price credits the purse and removes the item', () => {
    const world = plainWorld();
    const sess = freshSession(world);
    sess.inventory = ['bike'];
    context.normalizePlayerRulesState(world, sess);
    const [result] = context.executeCommerceTransactions(world, sess,
        [{ type: 'sell', item: 'bike', price: 40 }]);
    assert.equal(result.success, true, `sale refused: ${result.reason}`);
    assert.equal(sess.playerStats.cash, 65);
    assert(!sess.inventory.includes('bike'), 'the item was sold but never left the inventory');
});

test('an open-market purchase still cannot be afforded out of thin air', () => {
    const world = plainWorld();
    const sess = freshSession(world);
    context.normalizePlayerRulesState(world, sess);
    const [result] = context.executeCommerceTransactions(world, sess,
        [{ type: 'buy', item: 'car', price: 9000 }]);
    assert.equal(result.success, false);
    assert.equal(result.reason, 'cannot_afford');
    assert.equal(sess.playerStats.cash ?? 25, 25, 'a failed purchase still moved money');
});

test('selling something the player does not own is refused', () => {
    const world = plainWorld();
    const sess = freshSession(world);
    context.normalizePlayerRulesState(world, sess);
    const [result] = context.executeCommerceTransactions(world, sess,
        [{ type: 'sell', item: 'ferrari', price: 100 }]);
    assert.equal(result.success, false);
    assert.equal(result.reason, 'item_not_owned');
});

test('a priceless transaction with no market is refused, not silently dropped', () => {
    const world = plainWorld();
    const sess = freshSession(world);
    context.normalizePlayerRulesState(world, sess);
    const [result] = context.executeCommerceTransactions(world, sess, [{ type: 'buy', item: 'coffee' }]);
    assert.equal(result.success, false);
    assert.equal(result.reason, 'no_market_and_no_price',
        'the engine gave no usable reason for refusing the trade');
});

test('a defined market still governs stock and price', () => {
    const world = plainWorld();
    const sess = freshSession(world);
    context.normalizePlayerRulesState(world, sess);
    context.normalizeLivingWorldState(world, sess);
    sess.economy = { currency: 'coin', markets: { loc_house: {
        rope: { item: 'rope', quantity: 1, price: 5, regenPerTurn: 0, maxQuantity: 3 } } } };
    // The market's price wins over a price the DM invents.
    const [ok] = context.executeCommerceTransactions(world, sess,
        [{ type: 'buy', item: 'rope', price: 999 }]);
    assert.equal(ok.success, true, `market purchase refused: ${ok.reason}`);
    assert.equal(ok.total, 5, 'the stated price overrode the market price');
    const [outOfStock] = context.executeCommerceTransactions(world, sess,
        [{ type: 'buy', item: 'rope', quantity: 5, price: 5 }]);
    assert.equal(outOfStock.reason, 'insufficient_stock', 'stock limits stopped being enforced');
});

test('the transaction schema demands a price and explains why', () => {
    const schema = app.slice(app.indexOf('transactions: {'), app.indexOf('transactions: {') + 1600);
    assert(/price: \{/.test(schema), 'the model has no way to state a price');
    assert(/required: \["type", "item", "price"\]/.test(schema), 'price is optional, so it will be omitted');
    assert(!/Never duplicate a transaction with inventory_add\/remove, stat_changes/.test(schema),
        'the schema still forbids the only fallback that used to work');
});

// ---------------------------------------------------------------- quests

test('the quest ledger tells the DM WHEN to open a quest', () => {
    const world = plainWorld();
    const sess = freshSession(world);
    const prompt = context.getQuestPrompt(world, sess);
    assert(prompt.includes('[PLAYER QUEST LEDGER'), 'the quest ledger is missing entirely');
    assert(/WHEN TO OPEN A QUEST/i.test(prompt),
        'nothing ever tells the DM to create a quest, so none are ever created');
    assert(/knowingly accepts a concrete objective|explicitly sets one/i.test(prompt),
        'quest creation requires a player-accepted objective');
    assert(/Keep proposals in dialogue until accepted/i.test(prompt),
        'unaccepted NPC proposals must not become player obligations');
});

test('a quest can be opened from a title alone and shows up', () => {
    const world = plainWorld();
    const sess = freshSession(world);
    const result = context.applyQuestUpdates(world, sess,
        [{ title: 'Pick Emily up at six' }]);
    assert.equal(result.disabled, undefined, 'the quests module was off on a plain world');
    assert.equal(sess.quests.length, 1, 'a quest with a title alone was not created');
    assert.equal(sess.quests[0].status, 'active');
    assert(context.getQuestPrompt(world, sess).includes('Pick Emily up at six'),
        'the new quest never reached the ledger the DM reads');
});

test('quest objectives complete and rewards land exactly once', () => {
    const world = plainWorld();
    const sess = freshSession(world);
    context.normalizePlayerRulesState(world, sess);
    context.applyQuestUpdates(world, sess, [{
        id: 'q1', title: 'Pay Greg back',
        objectives: [{ id: 'o1', text: 'Hand over the cash', type: 'manual', required: 1 }],
        rewards: { stat_changes: { cash: 10 } }
    }]);
    context.applyQuestUpdates(world, sess, [{ id: 'q1', objectives: [{ id: 'o1', status: 'completed' }] }]);
    const quest = sess.quests[0];
    assert.equal(quest.status, 'completed', `quest did not complete (status ${quest.status})`);
    const balanceAfterFirst = sess.playerStats.cash;
    context.applyQuestUpdates(world, sess, [{ id: 'q1', objectives: [{ id: 'o1', status: 'completed' }] }]);
    assert.equal(sess.playerStats.cash, balanceAfterFirst, 'rewards were granted twice');
});

// ------------------------------------------------- module gating is honest

test('every profile that claims a system actually enables it', () => {
    const profiles = context.WORLD_RULE_PROFILES || null;
    const source = app.slice(app.indexOf('const WORLD_RULE_PROFILES'), app.indexOf('function worldRuleProfileDescription'));
    ['slice_of_life', 'mystery', 'adventure', 'full_rpg'].forEach(id => {
        assert(source.includes(id), `profile ${id} vanished`);
    });
    // A profile promising money must enable the modules money depends on.
    const world = plainWorld();
    world.gameRules = { profileId: 'slice_of_life' };
    const rules = context.normalizeWorldGameRules(world);
    assert.equal(rules.modules.commerce, true, 'slice_of_life promises money but disables commerce');
    assert.equal(rules.modules.stats, true, 'commerce without stats cannot deduct anything');
    assert.equal(rules.modules.inventory, true, 'commerce without inventory cannot deliver goods');
});

test('disabling stats cascades so commerce cannot half-work', () => {
    const world = plainWorld();
    world.gameRules = { profileId: 'custom', modules: { stats: false, commerce: true, inventory: true } };
    const rules = context.normalizeWorldGameRules(world);
    assert.equal(rules.modules.commerce, false,
        'commerce stayed on with no stats — purchases would silently no-op');
});

let failures = 0;
for (const { name, fn } of tests) {
    try { fn(); console.log(`✓ ${name}`); }
    catch (error) { failures++; console.error(`✗ ${name}\n  ${error.message}`); }
}
if (failures) {
    console.error(`\n${failures} world-system check(s) failed.`);
    process.exit(1);
}
console.log(`\n${tests.length} world system checks passed.`);
