/**
 * Quest engine migration, determinism, reward, and scale stress tests.
 * Run with: node scratch/quest_engine_stress_test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const start = app.indexOf("const QUEST_STATUSES = new Set(");
const end = app.indexOf('async function createNewWorldSession', start);
assert(start >= 0 && end > start, 'Quest engine source block not found');

const context = {
    console,
    showToast() {},
    __questModules: {
        stats: true, health: true, conditions: true, checks: true,
        inventory: true, commerce: true, quests: true, relationships: true,
        schedules: true, livingWorld: true
    },
    normalizeWorldGameRules() {
        return { modules: context.__questModules };
    },
    isPlainObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    },
    getLocationRef(world, query) {
        const key = String(query || '').trim().toLowerCase();
        return (world.locations || []).find(location =>
            String(location.id).toLowerCase() === key || String(location.name).toLowerCase() === key) || null;
    },
    resolveNpcId(world, query) {
        const key = String(query || '').trim().toLowerCase();
        return (world.entities || []).find(entity =>
            String(entity.id).toLowerCase() === key || String(entity.name).toLowerCase() === key)?.id || null;
    },
    applyPlayerStatChanges(world, session, changes, options = {}) {
        const result = { success: true, applied: [], rejected: [] };
        Object.entries(changes || {}).forEach(([key, change]) => {
            const definition = (world.hudConfig?.stats || []).find(stat => stat.id === key);
            const current = Number(session.playerStats?.[key]) || 0;
            let next = current + Number(change || 0);
            if (definition?.max > 0) next = Math.min(next, definition.max);
            next = Math.max(definition?.min ?? 0, next);
            if (!options.dryRun) session.playerStats[key] = next;
            result.applied.push({ statId: key, previous: current, value: next, change: next - current });
        });
        return result;
    }
};

vm.runInNewContext(`
${app.slice(start, end)}
this.questEngine = {
    normalizeQuestState,
    findSessionQuest,
    applyQuestUpdates,
    evaluateQuestProgress,
    getQuestPrompt,
    formatQuestRewardSummary,
    extractQuestUpdateDirective
};
`, context);

const engine = context.questEngine;
const world = {
    locations: [
        { id: 'square', name: 'Market Square' },
        { id: 'tower', name: 'Old Tower' }
    ],
    entities: [{ id: 'mara', name: 'Mara', type: 'npc' }],
    hudConfig: { stats: [{ id: 'gold', name: 'Gold', value: 0, max: 999 }, { id: 'hp', name: 'HP', value: 10, max: 20 }] }
};

function freshSession() {
    return {
        turnCount: 4,
        playerLocation: 'square',
        inventory: [],
        playerStats: { gold: 0, hp: 10 },
        entityStates: { mara: { status: 'alive' } },
        revealedSecrets: [],
        threads: [],
        factions: [{ id: 'guild', name: 'Guild', reputation: 0 }],
        quests: []
    };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('legacy title/status quests migrate without disappearing', () => {
    const session = freshSession();
    session.quests = [{ id: 'q_old', title: 'Legacy Rescue', status: 'active' }];
    engine.normalizeQuestState(world, session);
    assert.strictEqual(session.quests.length, 1);
    assert.strictEqual(session.quests[0].title, 'Legacy Rescue');
    assert.strictEqual(session.quests[0].status, 'active');
    assert(Array.isArray(session.quests[0].objectives));
    assert.strictEqual(session.quests[0].rewardsGranted, false);
});

test('disabled quest module preserves dormant quests without evaluating or mutating them', () => {
    const session = freshSession();
    session.quests = [{ id: 'q_dormant', title: 'Dormant Quest', status: 'active', objectives: [] }];
    engine.normalizeQuestState(world, session);
    const before = JSON.stringify(session.quests);
    context.__questModules.quests = false;
    const update = engine.applyQuestUpdates(world, session, [{ id: 'q_dormant', status: 'completed' }]);
    assert.strictEqual(update.disabled, true);
    assert.strictEqual(JSON.stringify(session.quests), before);
    assert.strictEqual(engine.getQuestPrompt(world, session), '');
    context.__questModules.quests = true;
});

test('large same-turn quest batches receive stable unique IDs', () => {
    const session = freshSession();
    const updates = Array.from({ length: 100 }, (_, index) => ({
        title: `Courier Route ${index + 1}`,
        description: 'Deliver the sealed message.',
        objectives: [{ text: `Reach checkpoint ${index + 1}`, type: 'manual' }]
    }));
    engine.applyQuestUpdates(world, session, updates);
    assert.strictEqual(session.quests.length, 100);
    assert.strictEqual(new Set(session.quests.map(quest => quest.id)).size, 100);
    assert(session.quests.every(quest => quest.id.startsWith('quest_')));
});

test('updates match existing quests and objectives case-insensitively', () => {
    const session = freshSession();
    engine.applyQuestUpdates(world, session, [{
        title: 'Rescue Mara',
        objectives: [{ id: 'find_mara', text: 'Find Mara', type: 'manual', required: 2 }]
    }]);
    const quest = session.quests[0];
    engine.applyQuestUpdates(world, session, [{
        id: quest.id.toUpperCase(),
        objectives: [{ id: 'FIND_MARA', progress_change: 1 }]
    }]);
    assert.strictEqual(session.quests.length, 1);
    assert.strictEqual(session.quests[0].objectives[0].current, 1);
});

test('authoritative state completes every deterministic objective type', () => {
    const session = freshSession();
    session.playerLocation = 'tower';
    session.inventory = ['Moon Herb', 'moon herb'];
    session.playerStats.gold = 10;
    session.revealedSecrets = ['secret_door'];
    session.entityStates.mara.status = 'dead';
    session.threads = [{ id: 'missing_bell', text: 'The missing bell', status: 'resolved' }];
    engine.applyQuestUpdates(world, session, [{
        title: 'The Tower Reckoning',
        objectives: [
            { text: 'Reach the tower', type: 'location', target: 'Old Tower' },
            { text: 'Gather herbs', type: 'inventory', target: 'Moon Herb', required: 2 },
            { text: 'Save ten gold', type: 'stat', target: 'gold', required: 10 },
            { text: 'Find the secret door', type: 'secret', target: 'secret_door' },
            { text: 'Defeat Mara', type: 'npc_status', target: 'Mara', expected: 'dead' },
            { text: 'Resolve the bell mystery', type: 'thread', target: 'missing_bell' }
        ],
        rewards: {
            items: ['Tower Key'],
            stat_changes: { hp: 5 },
            faction_reputation: [{ faction_id: 'Guild', change: 7 }]
        }
    }]);
    const quest = session.quests[0];
    assert.strictEqual(quest.status, 'completed');
    assert(quest.objectives.every(objective => objective.status === 'completed'));
    assert(session.inventory.includes('Tower Key'));
    assert.strictEqual(session.playerStats.hp, 15);
    assert.strictEqual(session.factions[0].reputation, 7);
    assert.strictEqual(quest.rewardsGranted, true);
});

test('completion rewards are idempotent across repeated evaluation and reload normalization', () => {
    const session = freshSession();
    engine.applyQuestUpdates(world, session, [{
        title: 'Paid in Full',
        status: 'completed',
        rewards: { items: ['Gold Seal'], stat_changes: { gold: 25 }, faction_reputation: [{ faction_id: 'guild', change: 4 }] }
    }]);
    const receipt = session.quests[0].rewardReceipt;
    engine.evaluateQuestProgress(world, session);
    engine.normalizeQuestState(world, session);
    engine.evaluateQuestProgress(world, session);
    assert.strictEqual(session.inventory.filter(item => item === 'Gold Seal').length, 1);
    assert.strictEqual(session.playerStats.gold, 25);
    assert.strictEqual(session.factions[0].reputation, 4);
    assert.strictEqual(session.quests[0].rewardReceipt, receipt);
});

test('manual progress completes incrementally while failed quests never pay', () => {
    const session = freshSession();
    engine.applyQuestUpdates(world, session, [{
        title: 'Three Witnesses',
        objectives: [{ id: 'witnesses', text: 'Interview witnesses', type: 'manual', required: 3 }],
        rewards: { stat_changes: { gold: 9 } }
    }]);
    const id = session.quests[0].id;
    engine.applyQuestUpdates(world, session, [{ id, objectives: [{ id: 'witnesses', progress_change: 2 }] }]);
    assert.strictEqual(session.quests[0].status, 'active');
    engine.applyQuestUpdates(world, session, [{ id, objectives: [{ id: 'witnesses', progress_change: 1 }] }]);
    assert.strictEqual(session.quests[0].status, 'completed');
    assert.strictEqual(session.playerStats.gold, 9);

    engine.applyQuestUpdates(world, session, [{
        title: 'Lost Cause',
        status: 'failed',
        rewards: { stat_changes: { gold: 100 } }
    }]);
    assert.strictEqual(session.playerStats.gold, 9);
});

test('tool-free fallback extracts quest JSON and removes it from player prose', () => {
    const parsed = engine.extractQuestUpdateDirective(
        'The courier nods.\n<quest_updates_json>[{"title":"Carry the Letter","status":"active"}]</quest_updates_json>'
    );
    assert.strictEqual(parsed.text, 'The courier nods.');
    assert.strictEqual(parsed.updates.length, 1);
    assert.strictEqual(parsed.updates[0].title, 'Carry the Letter');
    const malformed = engine.extractQuestUpdateDirective('Story<quest_updates_json>{bad}</quest_updates_json>');
    assert.strictEqual(malformed.updates.length, 0);
    assert.strictEqual(malformed.text, 'Story');
});

test('normalization enforces quest and objective caps under hostile backup input', () => {
    const session = freshSession();
    session.quests = Array.from({ length: 650 }, (_, questIndex) => ({
        title: `Quest ${questIndex}`,
        objectives: Array.from({ length: 130 }, (_, objectiveIndex) => ({ text: `Objective ${objectiveIndex}` }))
    }));
    engine.normalizeQuestState(world, session);
    assert.strictEqual(session.quests.length, 500);
    assert(session.quests.every(quest => quest.objectives.length === 100));
    assert.strictEqual(new Set(session.quests.map(quest => quest.id)).size, 500);
});

test('50,000 objective evaluations remain bounded and preserve quest count', () => {
    const session = freshSession();
    session.quests = Array.from({ length: 500 }, (_, questIndex) => ({
        id: `stress_${questIndex}`,
        title: `Stress Quest ${questIndex}`,
        status: 'active',
        objectives: Array.from({ length: 100 }, (_, objectiveIndex) => ({
            id: `o_${objectiveIndex}`,
            text: `Hold ${objectiveIndex}`,
            type: 'stat',
            target: 'gold',
            required: 999
        }))
    }));
    const started = Date.now();
    engine.evaluateQuestProgress(world, session);
    const elapsed = Date.now() - started;
    assert.strictEqual(session.quests.length, 500);
    assert(elapsed < 5000, `Evaluation took ${elapsed}ms`);
});

test('quest prompt is authoritative, bounded, and contains exact IDs', () => {
    const session = freshSession();
    engine.applyQuestUpdates(world, session, [{ title: 'Keep the Flame', objectives: [{ id: 'flame', text: 'Protect it', type: 'manual' }] }]);
    const prompt = engine.getQuestPrompt(world, session);
    assert(prompt.includes('[PLAYER QUEST LEDGER — AUTHORITATIVE]'));
    assert(prompt.includes(session.quests[0].id));
    assert(prompt.includes('[flame]'));
    assert(prompt.includes('grants declared rewards exactly once'));
});

let failures = 0;
for (const { name, fn } of tests) {
    try {
        fn();
        console.log(`✓ ${name}`);
    } catch (error) {
        failures++;
        console.error(`✗ ${name}\n  ${error.stack || error.message}`);
    }
}

if (failures) {
    console.error(`\n${failures} quest test(s) failed.`);
    process.exit(1);
}
console.log(`\n${tests.length} quest engine checks passed.`);
