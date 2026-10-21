/**
 * Living World systems audit.
 *
 * Complements living_world_stress_test.js (which proves scale and module
 * gating) by probing semantics: event scheduling/repeat/catch-up, condition
 * expiry, NPC agenda progression, faction drift, market regeneration,
 * schedule arbitration, playstyle inference, referential integrity, and
 * reroll determinism.
 *
 * Run with: node scratch/living_world_audit.js
 */
const assert = require('node:assert');
const vm = require('node:vm');

// The extractor follows the call graph itself: name the functions this suite
// is actually about, and anything they reach comes along. See app_source.js.
const { app, functionSource, buildContext } = require('./app_source.js');

const context = {
    console: { log() {}, warn() {}, error() {} },
    __ruleModules: {},
    normalizeWorldGameRules() { return { modules: context.__ruleModules }; },
    isPlainObject: value => !!value && typeof value === 'object' && !Array.isArray(value),
    safeJsonClone: value => JSON.parse(JSON.stringify(value))
};

// What this suite is about. Everything else these reach is resolved for us.
buildContext(vm, [
    'normalizeLivingWorldState', 'runLivingWorldTick', 'getLivingWorldPrompt',
    'syncNPCSchedules', 'spreadWorldKnowledge', 'driftLocationStates',
    'shouldRunWorldAgent', 'buildWorldAgentDigest', 'sanitizeWorldAgentActions',
    'parseWorldAgentPayload', 'normalizeWorldAgentConfig',
    'resolveFactionVictory', 'driftFactionRelations', 'nextFactionAim',
    'adjustFactionRelation', 'factionStanding', 'factionRelationScore',
    'livingFactionById', 'updatePlaystyleProfile', 'stableWorldRoll',
    'relationshipKey', 'livingClamp', 'livingId', 'getLocationRef',
    'getWorldTimeData', 'isVisibleToSession', 'sessionNpcs', 'isNpcActive',
    'isNpcPinned', 'queueEngineEvent', 'addWorldNews', 'isValidScheduleTime',
    'witnessesAt', 'buildNpcLocationIndex', 'conditionPressure', 'locationPressure',
    'questTextKey'
], context);

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const ALL_ON = {
    stats: true, health: true, conditions: true, checks: true, inventory: true,
    commerce: true, quests: true, relationships: true, schedules: true, livingWorld: true
};
function setModules(overrides = {}) {
    context.__ruleModules = { ...ALL_ON, ...overrides };
}

function makeWorld(overrides = {}) {
    return {
        id: 'w_audit',
        name: 'Audit World',
        startLocationId: 'loc_a',
        hudConfig: { timeStep: 10, startTimeHours: 8, enableSchedules: true },
        locations: [
            { id: 'loc_a', name: 'Town Square', exits: ['to Tavern'] },
            { id: 'loc_b', name: 'Tavern', exits: ['to Town Square'] },
            { id: 'loc_c', name: 'Deep Wood', exits: [] }
        ],
        entities: [
            { id: 'npc_1', name: 'Ada', type: 'npc', startLocation: 'loc_a' },
            { id: 'npc_2', name: 'Bram', type: 'npc', startLocation: 'loc_b' }
        ],
        ...overrides
    };
}

function makeSession(world, overrides = {}) {
    return {
        id: 'sess_audit',
        turnCount: 1,
        playerLocation: world.startLocationId,
        bonusTimeMinutes: 0,
        entityStates: Object.fromEntries(world.entities.map(e => [e.id, { location: e.startLocation }])),
        engineEvents: [],
        ...overrides
    };
}

// Run the tick for a specific turn the way executeWorldTurn does.
function tickTurn(world, sess, turn) {
    sess.turnCount = turn;
    return context.runLivingWorldTick(world, sess);
}

// ---------------------------------------------------------------- events

test('a due event fires once, records news, and does not re-fire', () => {
    setModules();
    const world = makeWorld();
    const sess = makeSession(world, {
        scheduledEvents: [{ id: 'ev1', title: 'Riot', description: 'A riot begins.', dueTurn: 2 }]
    });
    context.normalizeLivingWorldState(world, sess);
    assert.equal(tickTurn(world, sess, 1).events, 0, 'fired before its due turn');
    assert.equal(tickTurn(world, sess, 2).events, 1, 'did not fire on its due turn');
    assert.equal(sess.scheduledEvents[0].status, 'triggered');
    assert.equal(tickTurn(world, sess, 3).events, 0, 'a triggered event fired again');
    assert.equal(sess.worldNews.filter(n => n.type === 'event').length, 1);
});

test('an overdue event still fires (catch-up after the module is re-enabled)', () => {
    setModules();
    const world = makeWorld();
    const sess = makeSession(world, {
        scheduledEvents: [{ id: 'ev1', title: 'Frost', description: 'Frost arrives.', dueTurn: 2 }]
    });
    context.normalizeLivingWorldState(world, sess);
    assert.equal(tickTurn(world, sess, 40).events, 1, 'overdue event never fired');
});

test('a turn-repeating event reschedules from the firing turn', () => {
    setModules();
    const world = makeWorld();
    const sess = makeSession(world, {
        scheduledEvents: [{ id: 'ev1', title: 'Patrol', description: 'Guards pass.', dueTurn: 2, repeatEveryTurns: 3 }]
    });
    context.normalizeLivingWorldState(world, sess);
    tickTurn(world, sess, 2);
    assert.equal(sess.scheduledEvents[0].status, 'scheduled', 'repeating event was consumed');
    assert.equal(sess.scheduledEvents[0].dueTurn, 5);
    assert.equal(tickTurn(world, sess, 4).events, 0);
    assert.equal(tickTurn(world, sess, 5).events, 1);
    assert.equal(sess.scheduledEvents[0].dueTurn, 8);
});

test('a minute-repeating event reschedules on the world clock', () => {
    setModules();
    const world = makeWorld();
    const sess = makeSession(world, {
        scheduledEvents: [{ id: 'ev1', title: 'Bell', description: 'A bell tolls.', dueMinute: 500, repeatEveryMinutes: 60 }]
    });
    context.normalizeLivingWorldState(world, sess);
    // start 08:00 = 480m, timeStep 10 → turn 3 is 500m
    assert.equal(tickTurn(world, sess, 2).events, 0);
    assert.equal(tickTurn(world, sess, 3).events, 1);
    assert.equal(sess.scheduledEvents[0].dueMinute, 560);
    assert.equal(sess.scheduledEvents[0].dueTurn, null, 'minute repeat left a stale turn trigger');
});

test('an event at the player location queues narration; a remote one does not', () => {
    setModules();
    const world = makeWorld();
    const sess = makeSession(world, {
        scheduledEvents: [
            { id: 'here', title: 'Here', description: 'Local.', dueTurn: 1, locationId: 'loc_a' },
            { id: 'away', title: 'Away', description: 'Remote.', dueTurn: 1, locationId: 'loc_c' }
        ]
    });
    context.normalizeLivingWorldState(world, sess);
    tickTurn(world, sess, 1);
    const queued = sess.engineEvents.join(' | ');
    assert(queued.includes('Here'), 'local event was not queued for narration');
    assert(!queued.includes('Remote.'), 'a remote event leaked into on-screen narration');
    assert.equal(sess.worldNews.length, 2, 'both events should still be recorded as news');
});

test('an event applies its location condition with the right expiry', () => {
    setModules();
    const world = makeWorld();
    const sess = makeSession(world, {
        scheduledEvents: [{
            id: 'ev1', title: 'Fire', description: 'Fire spreads.', dueTurn: 3,
            locationId: 'loc_b', conditionOnTrigger: 'Burning', conditionDurationTurns: 2
        }]
    });
    context.normalizeLivingWorldState(world, sess);
    tickTurn(world, sess, 3);
    const conditions = sess.locationStates.loc_b.conditions;
    assert.equal(conditions.length, 1);
    assert.equal(conditions[0].label, 'Burning');
    assert.equal(conditions[0].expiresTurn, 5);
    tickTurn(world, sess, 4);
    assert.equal(sess.locationStates.loc_b.conditions.length, 1, 'condition expired early');
    tickTurn(world, sess, 5);
    assert.equal(sess.locationStates.loc_b.conditions.length, 0, 'condition outlived its duration');
});

test('an event influence change is bounded and applies to its faction', () => {
    setModules();
    const world = makeWorld();
    const sess = makeSession(world, {
        factions: [{ id: 'f1', name: 'Guild', influence: 95 }],
        scheduledEvents: [{ id: 'ev1', title: 'Coup', description: 'Power shifts.', dueTurn: 1, factionId: 'f1', influenceChange: 40 }]
    });
    context.normalizeLivingWorldState(world, sess);
    assert.equal(sess.scheduledEvents[0].influenceChange, 20, 'influence delta was not clamped to ±20');
    tickTurn(world, sess, 1);
    assert.equal(sess.factions[0].influence, 100, 'influence exceeded its ceiling');
});

// ------------------------------------------------------------ npc agendas

test('an NPC agenda advances off-screen and completes at 100', () => {
    setModules();
    const world = makeWorld();
    world.entities[0].goal = 'forge the key';
    world.entities[0].goalAutonomy = 'high';
    const sess = makeSession(world);
    sess.entityStates.npc_1.location = 'loc_c';   // away from the player
    context.normalizeLivingWorldState(world, sess);
    assert.equal(sess.entityStates.npc_1.goal, 'forge the key', 'authored agenda was not adopted');
    let progressed = 0;
    for (let turn = 1; turn <= 200 && sess.entityStates.npc_1.goalStatus !== 'completed'; turn++) {
        progressed += tickTurn(world, sess, turn).goals;
    }
    assert(progressed > 0, 'agenda never advanced');
    assert.equal(sess.entityStates.npc_1.goalStatus, 'completed');
    assert.equal(sess.entityStates.npc_1.goalProgress, 100);
});

test('an advancing agenda reports the concrete beat it reached, not a progress bar', () => {
    setModules();
    const world = makeWorld();
    world.entities[0].goal = 'open the sealed vault';
    world.entities[0].goalAutonomy = 'high';
    world.entities[0].goalSteps = [
        'asked the mason about the old seal',
        'copied the seal onto wax',
        'bought a crowbar and told no one'
    ];
    const sess = makeSession(world);
    sess.entityStates.npc_1.location = 'loc_c';
    context.normalizeLivingWorldState(world, sess);
    assert.deepEqual(sess.entityStates.npc_1.goalSteps, world.entities[0].goalSteps,
        'authored beats were not adopted into timeline state');

    for (let turn = 1; turn <= 200 && sess.entityStates.npc_1.goalStatus !== 'completed'; turn++) {
        tickTurn(world, sess, turn);
    }
    const goalNews = sess.worldNews.filter(n => n.type === 'npc_goal').map(n => n.text);
    assert(goalNews.length >= 2, 'an agenda with beats produced almost no news');
    assert(!goalNews.some(t => t.includes('made significant off-screen progress')),
        'an agenda with authored beats still emitted the vague progress line');
    assert(goalNews.some(t => t.includes('asked the mason about the old seal')),
        'the first beat never surfaced as a concrete development');
    assert(goalNews.some(t => t.includes('bought a crowbar')),
        'the final beat never surfaced');
    assert(goalNews.every(t => t.includes('Ada')), 'beats did not name the NPC');
    // Beats are locatable, which is what later makes discovery possible.
    assert(sess.worldNews.filter(n => n.type === 'npc_goal').every(n => n.locationId === 'loc_c'),
        'beats were not tagged with where they happened');
});

test('each beat is reported once, in order', () => {
    setModules();
    const world = makeWorld();
    world.entities[0].goal = 'finish the map';
    world.entities[0].goalAutonomy = 'high';
    world.entities[0].goalSteps = ['surveyed the ridge', 'inked the north road', 'sealed the map tube'];
    const sess = makeSession(world);
    sess.entityStates.npc_1.location = 'loc_c';
    context.normalizeLivingWorldState(world, sess);
    for (let turn = 1; turn <= 200 && sess.entityStates.npc_1.goalStatus !== 'completed'; turn++) {
        tickTurn(world, sess, turn);
    }
    const texts = sess.worldNews.filter(n => n.type === 'npc_goal').map(n => n.text);
    const seen = world.entities[0].goalSteps.map(step => texts.findIndex(t => t.includes(step)));
    assert(seen.every(i => i >= 0), `not every beat surfaced: ${JSON.stringify(texts)}`);
    assert.deepEqual([...seen].sort((a, b) => a - b), seen, 'beats surfaced out of order');
    world.entities[0].goalSteps.forEach(step => {
        assert.equal(texts.filter(t => t.includes(step)).length, 1, `beat repeated: ${step}`);
    });
});

test('an agenda with no authored beats still reports milestones', () => {
    setModules();
    const world = makeWorld();
    world.entities[0].goal = 'brood in silence';
    world.entities[0].goalAutonomy = 'high';
    const sess = makeSession(world);
    sess.entityStates.npc_1.location = 'loc_c';
    context.normalizeLivingWorldState(world, sess);
    for (let turn = 1; turn <= 200 && sess.entityStates.npc_1.goalStatus !== 'completed'; turn++) {
        tickTurn(world, sess, turn);
    }
    assert(sess.worldNews.some(n => n.text.includes('made significant off-screen progress')),
        'a beatless agenda lost its fallback milestone reporting');
});

test('the shipped campaign gives its goal-bearing NPCs authored beats', () => {
    const campaign = app.slice(app.indexOf('const STARTER_WORLDS'), app.indexOf('\n];', app.indexOf('const STARTER_WORLDS')));
    const withGoals = [...campaign.matchAll(/id: '(ent_\w+)'[^\n]*?goal: '/g)].map(m => m[1]);
    assert(withGoals.length >= 6, `expected several NPCs with agendas, found ${withGoals.length}`);
    withGoals.forEach(id => {
        const line = campaign.slice(campaign.indexOf(`id: '${id}'`));
        const seg = line.slice(0, line.indexOf('\n'));
        assert(/goalSteps: \[/.test(seg), `${id} has an agenda but no authored beats`);
        const steps = seg.match(/goalSteps: \[([\s\S]*?)\], goalAutonomy/);
        assert(steps && steps[1].split("', '").length >= 3, `${id} has too few beats to pace an agenda`);
    });
});

test('an NPC sharing the scene with the player does not advance off-screen', () => {
    setModules();
    const world = makeWorld();
    world.entities[0].goal = 'rob the vault';
    const sess = makeSession(world);
    sess.entityStates.npc_1.location = sess.playerLocation;
    context.normalizeLivingWorldState(world, sess);
    let goals = 0;
    for (let turn = 1; turn <= 60; turn++) goals += tickTurn(world, sess, turn).goals;
    assert.equal(goals, 0, 'an on-screen NPC advanced their agenda invisibly');
    assert.equal(sess.entityStates.npc_1.goalProgress, 0);
});

test('a dead NPC keeps no agenda and no appointments', () => {
    setModules();
    const world = makeWorld();
    world.entities[0].goal = 'return home';
    world.entities[0].schedule = [{ time: '00:00', locationId: 'loc_c', activity: 'walking' }];
    const sess = makeSession(world);
    sess.entityStates.npc_1.location = 'loc_b';
    sess.entityStates.npc_1.status = 'dead';
    context.normalizeLivingWorldState(world, sess);
    let goals = 0;
    for (let turn = 1; turn <= 60; turn++) goals += tickTurn(world, sess, turn).goals;
    assert.equal(goals, 0, 'a dead NPC advanced an agenda');
    context.syncNPCSchedules(world, sess);
    assert.equal(sess.entityStates.npc_1.location, 'loc_b', 'a dead NPC was moved by their schedule');
});

test('a missed agenda deadline fails the goal exactly once', () => {
    setModules();
    const world = makeWorld();
    world.entities[0].goal = 'reach the pass';
    const sess = makeSession(world);
    sess.entityStates.npc_1.location = 'loc_c';
    context.normalizeLivingWorldState(world, sess);
    sess.entityStates.npc_1.goalDeadlineTurn = 3;
    assert.equal(tickTurn(world, sess, 4).goals, 1, 'deadline did not fail the goal');
    assert.equal(sess.entityStates.npc_1.goalStatus, 'failed');
    assert.equal(tickTurn(world, sess, 5).goals, 0, 'a failed goal kept reporting activity');
});

test('a paused agenda never advances', () => {
    setModules();
    const world = makeWorld();
    world.entities[0].goal = 'wait forever';
    world.entities[0].goalAutonomy = 'paused';
    const sess = makeSession(world);
    sess.entityStates.npc_1.location = 'loc_c';
    context.normalizeLivingWorldState(world, sess);
    let goals = 0;
    for (let turn = 1; turn <= 80; turn++) goals += tickTurn(world, sess, turn).goals;
    assert.equal(goals, 0, 'a paused agenda advanced');
});

// -------------------------------------------------------------- factions

test('faction goals progress and complete without exceeding bounds', () => {
    setModules();
    const world = makeWorld();
    const sess = makeSession(world, {
        factions: [{ id: 'f1', name: 'Guild', goal: 'corner the market', influence: 80 }]
    });
    context.normalizeLivingWorldState(world, sess);
    const aim = sess.factions[0].goal;
    // Achieving an aim now records it and frees the slot, rather than pinning
    // progress at 100 forever — otherwise the faction is inert for the rest of
    // the campaign. Run until the achievement lands.
    for (let turn = 1; turn <= 400 && !(sess.factions[0].achievements || []).length; turn++) {
        tickTurn(world, sess, turn);
    }
    assert.deepEqual(sess.factions[0].achievements, [aim], 'faction goal never completed');
    assert(sess.factions[0].goalProgress >= 0 && sess.factions[0].goalProgress <= 100);
    assert(sess.worldNews.some(n => n.type === 'faction'), 'faction completion produced no news');
    // With no goal left and nobody to contend with, nothing should keep churning.
    const before = JSON.stringify(sess.factions[0]);
    tickTurn(world, sess, 500);
    assert.equal(JSON.stringify(sess.factions[0]), before, 'an idle faction kept churning');
});

test('defeated factions are inert and hidden from the prompt', () => {
    setModules();
    const world = makeWorld();
    const sess = makeSession(world, {
        factions: [{ id: 'f1', name: 'Ashen Hand', goal: 'burn the docks', status: 'defeated', influence: 90 }]
    });
    context.normalizeLivingWorldState(world, sess);
    for (let turn = 1; turn <= 50; turn++) tickTurn(world, sess, turn);
    assert.equal(sess.factions[0].goalProgress, 0, 'a defeated faction still pursued its goal');
    assert(!context.getLivingWorldPrompt(world, sess).includes('Ashen Hand'),
        'a defeated faction leaked into the DM prompt');
});

// --------------------------------------------------------------- markets

test('market stock regenerates up to its ceiling, only with commerce enabled', () => {
    setModules();
    const world = makeWorld();
    const sess = makeSession(world, {
        economy: { currency: 'coin', markets: { loc_a: { rope: { item: 'rope', quantity: 0, price: 5, regenPerTurn: 4, maxQuantity: 10 } } } }
    });
    context.normalizeLivingWorldState(world, sess);
    tickTurn(world, sess, 1);
    assert.equal(sess.economy.markets.loc_a.rope.quantity, 4);
    tickTurn(world, sess, 2);
    tickTurn(world, sess, 3);
    assert.equal(sess.economy.markets.loc_a.rope.quantity, 10, 'stock did not reach its ceiling');
    assert.equal(tickTurn(world, sess, 4).markets, 0, 'full stock still reported regeneration');

    setModules({ commerce: false });
    sess.economy.markets.loc_a.rope.quantity = 0;
    tickTurn(world, sess, 5);
    assert.equal(sess.economy.markets.loc_a.rope.quantity, 0, 'markets regenerated with commerce disabled');
});

// ------------------------------------------------------------- schedules

test('a schedule before the first block of the day uses the previous block', () => {
    setModules();
    const world = makeWorld({ hudConfig: { timeStep: 10, startTimeHours: 3, enableSchedules: true } });
    world.entities[0].schedule = [
        { time: '08:00', locationId: 'loc_a', activity: 'working' },
        { time: '20:00', locationId: 'loc_b', activity: 'drinking' }
    ];
    const sess = makeSession(world);
    context.normalizeLivingWorldState(world, sess);
    context.syncNPCSchedules(world, sess);
    assert.equal(sess.entityStates.npc_1.location, 'loc_b',
        'pre-dawn schedule did not wrap to the previous evening block');
});

test('a narrative pin outranks the timetable until it expires', () => {
    setModules();
    const world = makeWorld();
    // This movement fixture has real routes; disconnected travel is tested separately.
    world.locations[0].exits.push('to Deep Wood');
    world.locations[2].exits.push('to Town Square');
    world.entities[0].schedule = [{ time: '00:00', locationId: 'loc_a', activity: 'working' }];
    const sess = makeSession(world);
    context.normalizeLivingWorldState(world, sess);
    sess.entityStates.npc_1.location = 'loc_c';
    sess.entityStates.npc_1.pinnedUntilTurn = 5;
    sess.turnCount = 3;
    context.syncNPCSchedules(world, sess);
    assert.equal(sess.entityStates.npc_1.location, 'loc_c', 'the timetable teleported a pinned NPC');
    sess.turnCount = 6;
    context.syncNPCSchedules(world, sess);
    assert.equal(sess.entityStates.npc_1.location, 'loc_a', 'the pin never expired');
});

test('schedule arrivals and departures across the player scene are narrated', () => {
    setModules();
    const world = makeWorld();
    // This movement fixture has real routes; disconnected travel is tested separately.
    world.locations[0].exits.push('to Deep Wood');
    world.locations[2].exits.push('to Town Square');
    world.entities[0].schedule = [{ time: '00:00', locationId: 'loc_a', activity: 'sweeping' }];
    const sess = makeSession(world);
    sess.entityStates.npc_1.location = 'loc_c';
    context.normalizeLivingWorldState(world, sess);
    context.syncNPCSchedules(world, sess);
    assert(sess.engineEvents.some(e => e.includes('Ada') && e.includes('arrived')),
        'an NPC walking into the scene was not narrated');

    sess.engineEvents = [];
    world.entities[0].schedule = [{ time: '00:00', locationId: 'loc_c', activity: 'foraging' }];
    context.syncNPCSchedules(world, sess);
    assert(sess.engineEvents.some(e => e.includes('Ada') && e.includes('leaving')),
        'an NPC leaving the scene was not narrated');
});

test('turns freeze scheduled presence before simulation and never resync after prose', () => {
    const turnSource = functionSource('executeWorldTurn');
    const freezeIndex = turnSource.indexOf('syncNPCSchedules(world, sess);',
        turnSource.indexOf('// Freeze scheduled presence'));
    const tickIndex = turnSource.indexOf('runLivingWorldTick(world, sess);');
    assert(freezeIndex >= 0 && freezeIndex < tickIndex,
        'living-world witnesses were computed before the scheduled cast was frozen');
    const postNarrative = turnSource.slice(turnSource.indexOf('// Successful turn: Increment'),
        turnSource.indexOf('// Save the DM\'s narrative response'));
    assert(!postNarrative.includes('syncNPCSchedules'),
        'the scheduler still mutates cast after the narrative has already been generated');
});

test('message observations prefer an explicit committed witness set', () => {
    const source = functionSource('addWorldMessage');
    assert(source.includes('Array.isArray(metadata.witnesses)'));
    assert(source.includes('explicitWitnesses.has(ent.id)'));
    assert(source.includes('sessionNpcs(world, sess)'));
});

test('a timeline schedule override wins over the world template', () => {
    setModules();
    const world = makeWorld({ hudConfig: { timeStep: 10, startTimeHours: 8, enableSchedules: false } });
    // This movement fixture has real routes; disconnected travel is tested separately.
    world.locations[0].exits.push('to Deep Wood');
    world.locations[2].exits.push('to Town Square');
    world.entities[0].schedule = [{ time: '00:00', locationId: 'loc_a', activity: 'template' }];
    const sess = makeSession(world, {
        npcScheduleOverrides: { npc_1: [{ time: '00:00', locationId: 'loc_c', activity: 'timeline' }] }
    });
    context.normalizeLivingWorldState(world, sess);
    context.syncNPCSchedules(world, sess);
    assert.equal(sess.entityStates.npc_1.location, 'loc_c',
        'the timeline override did not take precedence');
});

test('schedules disabled means no movement at all', () => {
    setModules({ schedules: false });
    const world = makeWorld();
    world.entities[0].schedule = [{ time: '00:00', locationId: 'loc_c', activity: 'roaming' }];
    const sess = makeSession(world);
    const result = context.syncNPCSchedules(world, sess);
    assert.deepEqual(result, { moves: 0, active: 0 });
    assert.equal(sess.entityStates.npc_1.location, 'loc_a');
});

// -------------------------------------------------------------- playstyle

test('playstyle inference ranks dominant signals and stays advisory', () => {
    setModules();
    const sess = { playstyle: {} };
    context.updatePlaystyleProfile(sess, 'I sneak past the guard and hide in the shadows');
    context.updatePlaystyleProfile(sess, 'I quietly pickpocket the merchant');
    context.updatePlaystyleProfile(sess, 'I talk to the innkeeper');
    assert.equal(sess.playstyle.turnsObserved, 3);
    assert.equal(sess.playstyle.dominant[0], 'stealth');
    assert(sess.playstyle.summary.includes('soft signal'), 'playstyle summary lost its advisory framing');
});

test('playstyle ignores empty input but records every substantive turn', () => {
    setModules();
    const sess = { playstyle: {} };
    context.updatePlaystyleProfile(sess, '   ');
    assert.equal(sess.playstyle.turnsObserved || 0, 0);
    context.updatePlaystyleProfile(sess, 'I wander around thinking');
    assert.equal(sess.playstyle.turnsObserved, 1);
});

// ------------------------------------------------- integrity + normalization

test('normalization drops state for deleted locations and NPCs', () => {
    setModules();
    const world = makeWorld();
    const sess = makeSession(world, {
        locationStates: { loc_a: { conditions: [] }, ghost_loc: { conditions: [] } },
        npcScheduleOverrides: { npc_1: [{ time: '08:00', locationId: 'loc_a' }], ghost_npc: [] },
        economy: { currency: 'coin', markets: { ghost_loc: { rope: {} } } }
    });
    context.normalizeLivingWorldState(world, sess);
    assert(!('ghost_loc' in sess.locationStates), 'state for a deleted location survived');
    assert(!('ghost_npc' in sess.npcScheduleOverrides), 'schedule for a deleted NPC survived');
    assert(!('ghost_loc' in sess.economy.markets), 'market for a deleted location survived');
});

test('normalization repairs hostile and malformed state', () => {
    setModules();
    const world = makeWorld();
    const sess = makeSession(world, {
        scheduledEvents: 'not-an-array',
        factions: [{ name: 'X', reputation: 9999, influence: -50, goalProgress: 'abc', status: 'bogus' }],
        locationStates: { loc_a: { conditions: ['plain string'], danger: 500, prosperity: -20 } },
        npcRelationships: { 'a|b': { score: 1e9 } },
        playstyle: 'nope',
        worldNews: null
    });
    context.normalizeLivingWorldState(world, sess);
    assert(Array.isArray(sess.scheduledEvents));
    assert.equal(sess.factions[0].reputation, 100);
    assert.equal(sess.factions[0].influence, 0);
    assert.equal(sess.factions[0].goalProgress, 0);
    assert.equal(sess.factions[0].status, 'active');
    assert.equal(sess.locationStates.loc_a.danger, 100);
    assert.equal(sess.locationStates.loc_a.prosperity, 0);
    assert.equal(sess.locationStates.loc_a.conditions[0].label, 'plain string');
    assert.equal(sess.npcRelationships['a|b'].score, 100);
    assert(Array.isArray(sess.worldNews));
    assert.equal(typeof sess.playstyle, 'object');
});

test('normalization rejects malformed schedule blocks', () => {
    setModules();
    const world = makeWorld();
    const sess = makeSession(world, {
        npcScheduleOverrides: {
            npc_1: [
                { time: '25:99', locationId: 'loc_a' },
                { time: 'noon', locationId: 'loc_a' },
                { time: '09:00', locationId: 'ghost' },
                { time: '07:00', locationId: 'loc_b', activity: 'ok' }
            ]
        }
    });
    context.normalizeLivingWorldState(world, sess);
    assert.deepEqual(sess.npcScheduleOverrides.npc_1, [{ time: '07:00', locationId: 'loc_b', activity: 'ok' }]);
});

test('world news is capped and deduplicated within a turn', () => {
    setModules();
    const world = makeWorld();
    const sess = makeSession(world, { worldNews: [] });
    context.normalizeLivingWorldState(world, sess);
    sess.turnCount = 7;
    context.addWorldNews(sess, 'The bridge fell.');
    context.addWorldNews(sess, 'The bridge fell.');
    assert.equal(sess.worldNews.length, 1, 'duplicate news within a turn was not suppressed');
    for (let i = 0; i < 200; i++) context.addWorldNews(sess, `event ${i}`);
    assert.equal(sess.worldNews.length, 80, 'world news exceeded its retention cap');
});

test('no dangling faction reference survives normalization', () => {
    setModules();
    const world = makeWorld();
    const sess = makeSession(world, {
        factions: [{ id: 'f1', name: 'Guild', relations: [{ factionId: 'f_deleted', score: 40 }] }],
        locationStates: { loc_a: { conditions: [], controlFactionId: 'f_deleted' } }
    });
    context.normalizeLivingWorldState(world, sess);
    const ids = new Set(sess.factions.map(f => f.id));
    assert(!sess.factions[0].relations.some(r => !ids.has(r.factionId)),
        'a faction relation points at a faction that no longer exists');
    const control = sess.locationStates.loc_a.controlFactionId;
    assert(!control || ids.has(control),
        'a location is controlled by a faction that no longer exists');
});

// ---------------------------------------------------- determinism + gating

test('the tick advances at most once per turn', () => {
    setModules();
    const world = makeWorld();
    const sess = makeSession(world, {
        scheduledEvents: [{ id: 'ev1', title: 'Storm', description: 'It rains.', dueTurn: 1 }]
    });
    context.normalizeLivingWorldState(world, sess);
    assert.equal(tickTurn(world, sess, 1).advanced, true);
    const repeat = tickTurn(world, sess, 1);
    assert.equal(repeat.advanced, false, 'the simulation double-advanced within one turn');
    assert.equal(sess.worldNews.length, 1);
});

test('replaying a turn from a restored snapshot reproduces it exactly', () => {
    setModules();
    const build = () => {
        const world = makeWorld();
        world.entities[0].goal = 'map the wood';
        world.entities[0].goalAutonomy = 'high';
        const sess = makeSession(world, {
            factions: [{ id: 'f1', name: 'Guild', goal: 'expand', influence: 70 }]
        });
        sess.entityStates.npc_1.location = 'loc_c';
        sess.entityStates.npc_2.location = 'loc_c';   // co-located: drift is exercised too
        context.normalizeLivingWorldState(world, sess);
        return { world, sess };
    };
    const a = build();
    const b = build();
    for (let turn = 1; turn <= 25; turn++) tickTurn(a.world, a.sess, turn);
    for (let turn = 1; turn <= 25; turn++) tickTurn(b.world, b.sess, turn);
    assert.equal(JSON.stringify(a.sess.entityStates), JSON.stringify(b.sess.entityStates),
        'NPC agendas diverged between identical replays');
    assert.equal(JSON.stringify(a.sess.factions), JSON.stringify(b.sess.factions),
        'faction drift diverged between identical replays');
    assert.equal(JSON.stringify(a.sess.worldNews), JSON.stringify(b.sess.worldNews),
        'world news diverged between identical replays');
    assert.equal(JSON.stringify(a.sess.npcRelationships), JSON.stringify(b.sess.npcRelationships),
        'relationship drift diverged between identical replays');
});

test('scene population is deterministic enough to survive a reroll', () => {
    // Reroll restores the pre-turn snapshot and replays the turn; every other
    // simulation subsystem is seeded so the replay matches. Scene population
    // must not be a coin flip, or rerolling silently rewrites who is present.
    const source = functionSource('rollForScenePopulation');
    assert(!/Math\.random\(\)/.test(source),
        'rollForScenePopulation uses Math.random(), so a reroll changes who is in the room');
    assert(!/sort\(\(\)\s*=>/.test(source),
        'rollForScenePopulation still uses an inconsistent shuffle comparator');
});

test('a mid-turn clock jump fires clock-due events without re-advancing the turn', () => {
    setModules();
    const world = makeWorld();
    world.entities[0].goal = 'tend the fire';
    const sess = makeSession(world, {
        scheduledEvents: [
            { id: 'dawn', title: 'Dawn raid', description: 'Riders arrive.', dueMinute: 900 },
            { id: 'later', title: 'Later', description: 'Much later.', dueTurn: 50 }
        ],
        factions: [{ id: 'f1', name: 'Guild', goal: 'expand', influence: 90 }]
    });
    sess.entityStates.npc_1.location = 'loc_c';
    context.normalizeLivingWorldState(world, sess);

    // Turn 1 at 08:00 (480m): nothing is due yet.
    assert.equal(tickTurn(world, sess, 1).events, 0);
    const goalsAfterTurn = sess.entityStates.npc_1.goalProgress;
    const factionAfterTurn = sess.factions[0].goalProgress;

    // The DM narrates an 8-hour sleep mid-turn; the clock crosses 900m.
    sess.bonusTimeMinutes += 480;
    const catchUp = context.runLivingWorldTick(world, sess);
    assert.equal(catchUp.advanced, true, 'the clock jump produced no catch-up pass');
    assert.equal(catchUp.clockCatchUpOnly, true, 'the catch-up re-advanced the turn simulation');
    assert.equal(catchUp.events, 1, 'the event inside the skipped window did not fire');
    assert.equal(sess.scheduledEvents.find(e => e.id === 'dawn').status, 'triggered');
    assert.equal(sess.scheduledEvents.find(e => e.id === 'later').status, 'scheduled',
        'a far-future turn event fired during a clock catch-up');
    assert.equal(sess.entityStates.npc_1.goalProgress, goalsAfterTurn,
        'NPC agendas advanced twice in one turn');
    assert.equal(sess.factions[0].goalProgress, factionAfterTurn,
        'faction drift advanced twice in one turn');

    // Still exactly one turn of simulation: a further no-clock call is inert.
    assert.equal(context.runLivingWorldTick(world, sess).advanced, false);
});

test('background clock steps match explicit clock steps and preserve turn-only work', () => {
    setModules();
    const worldTime = require('../worlds/world-time.js');
    require('../worlds/background-sim.js');
    const sim = globalThis.HordeBackgroundSim;
    const world = makeWorld({ settings: { timeAdvancesWhenAway: true },
        hudConfig: { timeStep: 5, startTimeHours: 8, enableSchedules: true } });
    world.entities[0].goal = 'tend the fire';
    const sess = makeSession(world, {
        settings: { timeAdvancesWhenAway: true }, lastBackgroundSeenAt: 1000000,
        scheduledEvents: [
            { id: 'once', title: 'Arrival', description: 'A courier arrives.', dueMinute: 600 },
            { id: 'hourly', title: 'Bell', description: 'A bell rings.', dueMinute: 540,
                repeatEveryMinutes: 60, factionId: 'f1', influenceChange: 1 },
            { id: 'turn_only', title: 'Patrol', description: 'Patrol passes.', dueTurn: 2,
                repeatEveryTurns: 2 }
        ],
        factions: [{ id: 'f1', name: 'Guild', influence: 50 }]
    });
    sess.entityStates.npc_1.location = 'loc_c';
    context.normalizeLivingWorldState(world, sess);
    context.runLivingWorldTick(world, sess);
    const base = JSON.parse(JSON.stringify(sess));
    const explicit = JSON.parse(JSON.stringify(base));
    const factionBefore = base.factions[0].influence;
    const goalBefore = base.entityStates.npc_1.goalProgress;
    for (let step = 0; step < 3; step++) {
        worldTime.advanceMinutes(world, explicit, 60);
        context.runLivingWorldTick(world, explicit, { clockOnly: true });
        context.syncNPCSchedules(world, explicit);
    }
    const background = sim.catchUp(world, base, 2800000, false, (w, s) => {
        context.runLivingWorldTick(w, s, { clockOnly: true });
        context.syncNPCSchedules(w, s);
        return [];
    });
    assert.equal(background.ticks, 3);
    const project = s => ({
        minute: context.getWorldTimeData(world, s).currentTotalMinutes,
        turn: s.turnCount, lastTick: s.lastLivingWorldTick,
        goal: s.entityStates.npc_1.goalProgress,
        influence: s.factions[0].influence,
        events: s.scheduledEvents.map(event => ({ id: event.id, status: event.status,
            dueTurn: event.dueTurn, dueMinute: event.dueMinute, lastTriggeredTurn: event.lastTriggeredTurn })),
        news: s.worldNews.map(item => item.id), queued: s.engineEvents,
        activityEvents: s.livingWorldActivity.events
    });
    assert.deepEqual(project(background.session), project(explicit));
    assert.equal(background.session.turnCount, 1);
    assert.equal(background.session.lastLivingWorldTick, 1);
    assert.equal(background.session.entityStates.npc_1.goalProgress, goalBefore);
    assert.equal(background.session.factions[0].influence, factionBefore + 3);
    assert.equal(background.session.scheduledEvents.find(event => event.id === 'hourly').dueMinute, 720);
    assert.equal(background.session.scheduledEvents.find(event => event.id === 'once').status, 'triggered');
    assert.equal(background.session.scheduledEvents.find(event => event.id === 'turn_only').status, 'scheduled');
    assert.equal(context.runLivingWorldTick(world, background.session, { clockOnly: true }).advanced, false);
    assert.deepEqual(project(background.session), project(explicit));
    for (const next of [background.session, explicit]) {
        next.turnCount++;
        assert.equal(context.runLivingWorldTick(world, next).events, 1);
    }
    assert.deepEqual(project(background.session), project(explicit));
    assert.equal(background.session.scheduledEvents.find(event => event.id === 'turn_only').dueTurn, 4);
});

test('one large explicit skip keeps the existing repeat-from-observation rule', () => {
    setModules();
    const world = makeWorld();
    const sess = makeSession(world, { scheduledEvents: [{ id: 'bell', title: 'Bell',
        description: 'The bell rings.', dueMinute: 540, repeatEveryMinutes: 60 }] });
    context.normalizeLivingWorldState(world, sess);
    context.runLivingWorldTick(world, sess);
    sess.bonusTimeMinutes += 180;
    const skipped = context.runLivingWorldTick(world, sess);
    assert.equal(skipped.events, 1);
    assert.equal(skipped.clockCatchUpOnly, true);
    assert.equal(sess.scheduledEvents[0].dueMinute, 720);
    assert.equal(context.runLivingWorldTick(world, sess).advanced, false);
});

test('a clock-due route closure blocks the same NPC schedule in a turn and background', () => {
    setModules();
    const worldTime = require('../worlds/world-time.js');
    const world = makeWorld({ hudConfig: { timeStep: 60, startTimeHours: 8, enableSchedules: true } });
    world.entities[0].schedule = [{ time: '09:00', locationId: 'loc_b', activity: 'working' }];
    const start = makeSession(world, { scheduledEvents: [{ id: 'close', title: 'Closure',
        description: 'The entrance closes.', dueMinute: 540,
        locationId: 'loc_b', conditionOnTrigger: 'impassable' }] });
    context.normalizeLivingWorldState(world, start);
    context.getWorldTimeData(world, start);
    start.lastLivingWorldMinute = 480;
    start.lastLivingWorldTick = 1;
    const turn = JSON.parse(JSON.stringify(start));
    turn.turnCount = 2;
    context.syncNPCSchedules(world, turn);
    context.runLivingWorldTick(world, turn);
    const background = JSON.parse(JSON.stringify(start));
    worldTime.advanceMinutes(world, background, 60);
    context.runLivingWorldTick(world, background, { clockOnly: true });
    context.syncNPCSchedules(world, background);
    assert.equal(turn.scheduledEvents[0].status, 'triggered');
    assert.equal(background.scheduledEvents[0].status, 'triggered');
    assert.equal(turn.entityStates.npc_1.location, background.entityStates.npc_1.location);
    assert.equal(turn.entityStates.npc_1.journey || null, null);
});

test('a paused clock waits for an explicit advance before triggering minute-due events', () => {
    setModules();
    const world = makeWorld({ hudConfig: { timeStep: 0, startTimeHours: 8, enableSchedules: true } });
    const sess = makeSession(world, {
        scheduledEvents: [{ id: 'paused_due', title: 'Signal',
            description: 'A bell sounds.', dueMinute: 510 }]
    });
    context.normalizeLivingWorldState(world, sess);
    assert.equal(tickTurn(world, sess, 1).events, 0);
    assert.equal(tickTurn(world, sess, 2).events, 0);
    assert.equal(context.getWorldTimeData(world, sess).currentTotalMinutes, 480);
    assert.equal(sess.scheduledEvents[0].status, 'scheduled');
    sess.bonusTimeMinutes += 30;
    const jumped = context.runLivingWorldTick(world, sess);
    assert.equal(jumped.events, 1);
    assert.equal(jumped.clockCatchUpOnly, true);
    assert.equal(sess.scheduledEvents[0].status, 'triggered');
    assert.equal(context.getWorldTimeData(world, sess).currentTotalMinutes, 510);
});

test('out-of-range times are rejected from world templates, not just overrides', () => {
    setModules();
    const world = makeWorld({ hudConfig: { timeStep: 10, startTimeHours: 3, enableSchedules: true } });
    // A template block that can never compare <= "23:59" must not become the
    // pre-dawn fallback and hijack the NPC's real routine.
    world.entities[0].schedule = [
        { time: '07:00', locationId: 'loc_b', activity: 'opening up' },
        { time: '25:99', locationId: 'loc_c', activity: 'impossible' }
    ];
    const sess = makeSession(world);
    context.normalizeLivingWorldState(world, sess);
    context.syncNPCSchedules(world, sess);
    assert.equal(sess.entityStates.npc_1.location, 'loc_b',
        'a malformed template time hijacked the schedule');
});

test('the living world module gate silences every subsystem', () => {
    setModules({ livingWorld: false });
    const world = makeWorld();
    const sess = makeSession(world, {
        scheduledEvents: [{ id: 'ev1', title: 'Quiet', description: 'Nothing.', dueTurn: 1, status: 'scheduled' }],
        factions: [{ id: 'f1', name: 'Guild', goal: 'grow' }]
    });
    const result = tickTurn(world, sess, 1);
    assert.equal(result.disabled, true);
    assert.equal(sess.scheduledEvents[0].status, 'scheduled', 'an event fired with the module disabled');
    assert.equal(context.getLivingWorldPrompt(world, sess), '', 'the prompt leaked with the module disabled');
});

test('the DM prompt exposes state without leaking it as public knowledge', () => {
    setModules();
    const world = makeWorld();
    const sess = makeSession(world, {
        factions: [{ id: 'f1', name: 'Guild', goal: 'expand', influence: 60 }],
        locationStates: { loc_a: { conditions: [{ id: 'c1', label: 'Curfew' }], danger: 30, prosperity: 40, resources: {} } },
        // Known only to someone who is elsewhere — genuinely out of reach.
        worldNews: [{ id: 'n1', text: 'A distant tower fell.', turn: 1, knownBy: ['npc_2'] }]
    });
    context.normalizeLivingWorldState(world, sess);
    const prompt = context.getLivingWorldPrompt(world, sess);
    assert(prompt.includes('DM-only knowledge'), 'the prompt lost its knowledge-boundary framing');
    assert(prompt.includes('Curfew') && prompt.includes('Guild'));
    // Disclosure is now enforced by the reachability split rather than by a
    // single blanket instruction: with nobody present, remote news is withheld.
    assert(prompt.includes('no character may mention, hint at, or act on them'),
        'off-screen news lost its disclosure guard');
    assert(prompt.includes('A distant tower fell.'), 'the DM lost the background entirely');
});

// -------------------------------------------------- discovery / information

// Build a world where npc_1 acts alone far away and npc_2 can act as a courier.
function makeDiscoveryWorld() {
    const world = makeWorld();
    world.entities[0].goal = 'dig where nobody watches';
    world.entities[0].goalAutonomy = 'high';
    world.entities[0].goalSteps = ['broke the old seal open', 'carried something heavy uphill'];
    return world;
}

test('a beat performed alone is known only to its actor', () => {
    setModules();
    const world = makeDiscoveryWorld();
    const sess = makeSession(world);
    sess.playerLocation = 'loc_a';
    sess.entityStates.npc_1.location = 'loc_c';   // alone in the wood
    sess.entityStates.npc_2.location = 'loc_b';
    context.normalizeLivingWorldState(world, sess);
    for (let turn = 1; turn <= 40 && !sess.worldNews.some(n => n.type === 'npc_goal'); turn++) {
        tickTurn(world, sess, turn);
    }
    const beat = sess.worldNews.find(n => n.type === 'npc_goal');
    assert(beat, 'no beat was produced');
    assert.deepEqual(beat.knownBy, ['npc_1'], 'a solitary act was known to someone else');
    assert.equal(beat.playerWitnessed, false);
});

test('a remote fact stays out of reach while nobody who knows it is present', () => {
    setModules();
    const world = makeDiscoveryWorld();
    const sess = makeSession(world);
    sess.playerLocation = 'loc_a';
    sess.entityStates.npc_1.location = 'loc_c';
    sess.entityStates.npc_2.location = 'loc_b';
    context.normalizeLivingWorldState(world, sess);
    for (let turn = 1; turn <= 40 && !sess.worldNews.some(n => n.type === 'npc_goal'); turn++) {
        tickTurn(world, sess, turn);
    }
    const beatText = sess.worldNews.find(n => n.type === 'npc_goal').text;
    // Nobody is with the player, so nothing can be told.
    const prompt = context.getLivingWorldPrompt(world, sess, []);
    assert(prompt.includes('NOT yet reachable'), 'the prompt did not mark unreachable news');
    assert(!prompt.includes('reachable in this scene'), 'unreachable news was offered as tellable');
    const darkLine = prompt.split('\n').find(l => l.startsWith('Developments NOT yet reachable'));
    assert(darkLine.includes(beatText.slice(0, 40)), 'the remote beat was not held back');
});

test('the fact becomes tellable once the character who knows it shares the scene', () => {
    setModules();
    const world = makeDiscoveryWorld();
    const sess = makeSession(world);
    sess.playerLocation = 'loc_a';
    sess.entityStates.npc_1.location = 'loc_c';
    sess.entityStates.npc_2.location = 'loc_b';
    context.normalizeLivingWorldState(world, sess);
    for (let turn = 1; turn <= 40 && !sess.worldNews.some(n => n.type === 'npc_goal'); turn++) {
        tickTurn(world, sess, turn);
    }
    // Ada walks in on the player. She is the one who did it.
    const present = [world.entities[0]];
    const prompt = context.getLivingWorldPrompt(world, sess, present);
    assert(prompt.includes('reachable in this scene'), 'a present witness did not make the fact tellable');
    const line = prompt.split('\n').find(l => l.startsWith('Developments reachable'));
    assert(line.includes('known here by Ada'), 'the prompt did not attribute the fact to its carrier');
    assert(line.includes('need not volunteer it'), 'lost the guidance that revealing must be earned');
});

test('rumour travels between characters who share a room', () => {
    setModules();
    const world = makeWorld();
    const sess = makeSession(world);
    context.normalizeLivingWorldState(world, sess);
    sess.turnCount = 3;
    const item = context.addWorldNews(sess, 'The mine gate stands open.', { knownBy: ['npc_1'] });
    // Apart: nothing spreads, however long they wait.
    sess.entityStates.npc_1.location = 'loc_a';
    sess.entityStates.npc_2.location = 'loc_c';
    for (let turn = 3; turn <= 30; turn++) {
        context.spreadWorldKnowledge(context.buildNpcLocationIndex(world, sess), sess, turn);
    }
    assert.deepEqual(item.knownBy, ['npc_1'], 'a fact travelled with nobody to carry it');
    // Together: word gets around.
    sess.entityStates.npc_2.location = 'loc_a';
    let spread = 0;
    for (let turn = 31; turn <= 60 && !item.knownBy.includes('npc_2'); turn++) {
        spread += context.spreadWorldKnowledge(context.buildNpcLocationIndex(world, sess), sess, turn);
    }
    assert(item.knownBy.includes('npc_2'), 'sharing a room never passed the fact along');
    assert(spread > 0);
});

test('a public event is witnessed by the whole room, and by the player if present', () => {
    setModules();
    const world = makeWorld();
    const sess = makeSession(world, {
        scheduledEvents: [
            { id: 'here', title: 'Collapse', description: 'A roof falls in.', dueTurn: 1, locationId: 'loc_a' },
            { id: 'away', title: 'Signal', description: 'A horn sounds.', dueTurn: 1, locationId: 'loc_b' }
        ]
    });
    sess.playerLocation = 'loc_a';
    sess.entityStates.npc_1.location = 'loc_a';
    sess.entityStates.npc_2.location = 'loc_b';
    context.normalizeLivingWorldState(world, sess);
    tickTurn(world, sess, 1);
    const here = sess.worldNews.find(n => n.text.includes('Collapse'));
    const away = sess.worldNews.find(n => n.text.includes('Signal'));
    assert.equal(here.playerWitnessed, true, 'an event in the player\'s own location was hidden from them');
    assert(here.knownBy.includes('npc_1'), 'someone standing there missed a public event');
    assert.equal(away.playerWitnessed, false);
    assert(away.knownBy.includes('npc_2') && !away.knownBy.includes('npc_1'),
        'a remote event was known by someone who was not there');
});

test('knowledge tracking survives a save/load round trip', () => {
    setModules();
    const world = makeWorld();
    const sess = makeSession(world);
    context.normalizeLivingWorldState(world, sess);
    context.addWorldNews(sess, 'Something happened.', { knownBy: ['npc_1', 'npc_1', ''] });
    const revived = JSON.parse(JSON.stringify(sess));
    context.normalizeLivingWorldState(world, revived);
    assert.deepEqual(revived.worldNews[0].knownBy, ['npc_1'], 'knownBy was mangled by normalization');
});

test('news predating knowledge tracking is treated as common talk, not sealed away', () => {
    setModules();
    const world = makeWorld();
    const sess = makeSession(world, {
        worldNews: [{ id: 'legacy', text: 'An old rumour from a previous save.', turn: 1 }]
    });
    context.normalizeLivingWorldState(world, sess);
    assert.equal(sess.worldNews[0].knownBy, null, 'legacy news was given a false knowledge record');
    const prompt = context.getLivingWorldPrompt(world, sess, []);
    assert(prompt.includes('common talk'), 'legacy news was retroactively hidden from the DM');
    assert(!prompt.includes('NOT yet reachable'), 'legacy news was misfiled as a secret');
});

test('the discovery split does not leak dark facts into the tellable line', () => {
    setModules();
    const world = makeWorld();
    const sess = makeSession(world);
    context.normalizeLivingWorldState(world, sess);
    sess.turnCount = 2;
    context.addWorldNews(sess, 'SECRET: the vault is open.', { knownBy: ['npc_2'] });
    context.addWorldNews(sess, 'PUBLIC: the bell was rung.', { knownBy: ['npc_1'] });
    const prompt = context.getLivingWorldPrompt(world, sess, [world.entities[0]]);   // only npc_1 present
    const tellLine = prompt.split('\n').find(l => l.startsWith('Developments reachable')) || '';
    const darkLine = prompt.split('\n').find(l => l.startsWith('Developments NOT yet reachable')) || '';
    assert(tellLine.includes('PUBLIC'), 'a fact its carrier could share was withheld');
    assert(!tellLine.includes('SECRET'), 'a fact nobody present knows leaked into the tellable list');
    assert(darkLine.includes('SECRET'), 'the unreachable fact was dropped entirely');
});

// ------------------------------------------- relationship drift + regeneration

test('co-located NPCs drift; separated NPCs never do', () => {
    setModules();
    const world = makeWorld();
    const sess = makeSession(world);
    sess.playerLocation = 'loc_a';
    sess.entityStates.npc_1.location = 'loc_b';
    sess.entityStates.npc_2.location = 'loc_b';
    context.normalizeLivingWorldState(world, sess);
    for (let turn = 1; turn <= 120; turn++) tickTurn(world, sess, turn);
    const key = context.relationshipKey('npc_1', 'npc_2');
    const rel = sess.npcRelationships[key];
    assert(rel, 'a shared room never produced a relationship');
    assert(rel.score !== 0, 'the relationship never moved off zero');
    assert.equal(rel.autoManaged, true);
    assert(rel.label, 'drift left its own relationship unlabeled');
    assert(rel.reason.includes('Tavern'), 'the reason does not say where the bond formed');

    const frozen = JSON.stringify(rel);
    sess.entityStates.npc_2.location = 'loc_c';
    for (let turn = 121; turn <= 180; turn++) tickTurn(world, sess, turn);
    assert.equal(JSON.stringify(sess.npcRelationships[key]), frozen,
        'a relationship kept drifting after the pair separated');
});

test('drift never rewrites an authored relationship label or reason', () => {
    setModules();
    const world = makeWorld();
    const sess = makeSession(world);
    sess.playerLocation = 'loc_a';
    sess.entityStates.npc_1.location = 'loc_b';
    sess.entityStates.npc_2.location = 'loc_b';
    const key = context.relationshipKey('npc_1', 'npc_2');
    const authored = { score: 5, label: 'sworn rivals', reason: 'the duel at the mill', lastChangedTurn: 1 };
    context.normalizeLivingWorldState(world, sess);
    sess.npcRelationships[key] = { ...authored };
    for (let turn = 1; turn <= 120; turn++) tickTurn(world, sess, turn);
    const rel = sess.npcRelationships[key];
    assert(rel.score !== authored.score, 'even the score refused to move');
    assert.equal(rel.label, 'sworn rivals', 'drift overwrote an authored label');
    assert.equal(rel.reason, 'the duel at the mill', 'drift overwrote an authored reason');
});

test('drift skips the player\'s own room and the relationships module gate', () => {
    setModules();
    const world = makeWorld();
    const sess = makeSession(world);
    sess.playerLocation = 'loc_b';
    sess.entityStates.npc_1.location = 'loc_b';
    sess.entityStates.npc_2.location = 'loc_b';
    context.normalizeLivingWorldState(world, sess);
    for (let turn = 1; turn <= 80; turn++) tickTurn(world, sess, turn);
    assert.equal(Object.keys(sess.npcRelationships).length, 0,
        'on-screen NPCs were simulated instead of played');

    setModules({ relationships: false });
    sess.playerLocation = 'loc_a';
    for (let turn = 81; turn <= 160; turn++) tickTurn(world, sess, turn);
    assert.equal(Object.keys(sess.npcRelationships).length, 0,
        'drift ran with the relationships module disabled');
});

test('a resolved agenda regenerates from the pool after a rest, exactly once each', () => {
    setModules();
    const world = makeWorld();
    world.entities[0].goal = 'first errand';
    world.entities[0].goalAutonomy = 'high';
    world.entities[0].goalSteps = ['did the first thing'];
    world.entities[0].goalPool = [
        { goal: 'second errand', steps: ['began the second thing', 'finished the second thing'] }
    ];
    const sess = makeSession(world);
    sess.entityStates.npc_1.location = 'loc_c';
    context.normalizeLivingWorldState(world, sess);

    let turn = 1;
    for (; turn <= 200 && sess.entityStates.npc_1.goalStatus !== 'completed'; turn++) tickTurn(world, sess, turn);
    assert.equal(sess.entityStates.npc_1.goal, 'first errand');
    const resolvedTurn = sess.entityStates.npc_1.goalResolvedTurn;
    assert(resolvedTurn >= 1, 'completion did not record when it happened');

    // The rest: no new goal inside the cooldown window.
    for (; turn < resolvedTurn + 8; turn++) tickTurn(world, sess, turn);
    assert.equal(sess.entityStates.npc_1.goal, 'first errand', 'regeneration skipped the rest period');

    for (; turn <= resolvedTurn + 220 && sess.entityStates.npc_1.goal === 'first errand'; turn++) {
        tickTurn(world, sess, turn);
    }
    const es = sess.entityStates.npc_1;
    assert.equal(es.goal, 'second errand', 'the pool goal was never adopted');
    assert.equal(es.goalStatus, 'active');
    assert.equal(es.goalProgress, 0);
    assert.deepEqual(es.goalSteps, ['began the second thing', 'finished the second thing']);
    assert.equal(es.goalStepReported, -1, 'beat reporting was not reset for the new agenda');
    assert(es.goalHistory.includes('first errand'), 'the finished goal was not remembered');
    assert(sess.worldNews.some(n => n.text.includes('set their mind to something new: second errand')),
        'adopting a new agenda left no trace');

    // Run the second agenda to completion; the pool is now exhausted.
    for (; turn <= 600 && es.goalStatus !== 'completed'; turn++) tickTurn(world, sess, turn);
    assert.equal(es.goalStatus, 'completed', 'the regenerated agenda never completed');
    for (let extra = turn; extra <= turn + 60; extra++) tickTurn(world, sess, extra);
    assert.equal(es.goal, 'second errand', 'an exhausted pool kept regenerating');
});

test('an NPC with no pool stays resolved instead of thrashing', () => {
    setModules();
    const world = makeWorld();
    world.entities[0].goal = 'one and done';
    world.entities[0].goalAutonomy = 'high';
    const sess = makeSession(world);
    sess.entityStates.npc_1.location = 'loc_c';
    context.normalizeLivingWorldState(world, sess);
    let turn = 1;
    for (; turn <= 200 && sess.entityStates.npc_1.goalStatus !== 'completed'; turn++) tickTurn(world, sess, turn);
    for (let extra = turn; extra <= turn + 40; extra++) tickTurn(world, sess, extra);
    assert.equal(sess.entityStates.npc_1.goal, 'one and done');
    assert.equal(sess.entityStates.npc_1.goalStatus, 'completed');
});

test('the shipped campaign gives every goal-bearing NPC a follow-up agenda', () => {
    const campaign = app.slice(app.indexOf('const STARTER_WORLDS'), app.indexOf('\n];', app.indexOf('const STARTER_WORLDS')));
    const withGoals = [...campaign.matchAll(/id: '(ent_\w+)'[^\n]*?goal: '/g)].map(m => m[1]);
    withGoals.forEach(id => {
        const line = campaign.slice(campaign.indexOf(`id: '${id}'`));
        const seg = line.slice(0, line.indexOf('\n'));
        assert(/goalPool: \[/.test(seg), `${id} has no follow-up agenda; their life ends with goal one`);
    });
});

// ------------------------------------------------- faction causation

function factionWorld() {
    const world = makeWorld();
    world.locations.push({ id: 'loc_d', name: 'Docks', exits: [] });
    return world;
}
function twoPowers(overrides = {}) {
    return [
        { id: 'f_a', name: 'Red Ledger', influence: 70, status: 'active',
          goal: 'own the valley', goalProgress: 0, territory: ['loc_a'], relations: [] },
        { id: 'f_b', name: 'Crown', influence: 60, status: 'active',
          goal: 'hold the valley', goalProgress: 0, territory: ['loc_a', 'loc_d'], relations: [] },
        ...(overrides.extra || [])
    ];
}

test('relations are symmetric — a one-sided grudge is impossible', () => {
    setModules();
    const world = factionWorld();
    const sess = makeSession(world, { factions: twoPowers() });
    context.normalizeLivingWorldState(world, sess);
    context.adjustFactionRelation(sess, sess.factions[0], sess.factions[1], -40);
    assert.equal(context.factionRelationScore(sess.factions[0], 'f_b'), -40);
    assert.equal(context.factionRelationScore(sess.factions[1], 'f_a'), -40,
        'the other side did not feel it');
});

test('standing reads allies, enemies and contested ground', () => {
    setModules();
    const world = factionWorld();
    const sess = makeSession(world, { factions: twoPowers() });
    context.normalizeLivingWorldState(world, sess);
    context.adjustFactionRelation(sess, sess.factions[0], sess.factions[1], -50);
    const standing = context.factionStanding(sess, sess.factions[0]);
    assert.equal(standing.enemies.length, 1, 'a hostile power was not counted');
    assert.equal(standing.contested, 1, 'shared ground with an enemy was not counted');
    assert(standing.momentum < 0, 'opposition did not slow them down');
});

test('an unopposed faction outpaces one fighting for its ground', () => {
    setModules();
    const build = hostile => {
        const world = factionWorld();
        const sess = makeSession(world, { factions: twoPowers() });
        context.normalizeLivingWorldState(world, sess);
        if (hostile) context.adjustFactionRelation(sess, sess.factions[0], sess.factions[1], -60);
        for (let turn = 1; turn <= 40; turn++) tickTurn(world, sess, turn);
        return sess.factions[0].goalProgress + (sess.factions[0].achievements || []).length * 100;
    };
    assert(build(false) > build(true),
        'opposition made no difference to how fast a faction advances');
});

test('a victory takes ground, weakens the rival, and provokes an answer', () => {
    setModules();
    const world = factionWorld();
    const sess = makeSession(world, { factions: twoPowers() });
    context.normalizeLivingWorldState(world, sess);
    context.adjustFactionRelation(sess, sess.factions[0], sess.factions[1], -60);
    const winner = sess.factions[0];
    const rival = sess.factions[1];
    const rivalInfluenceBefore = rival.influence;
    winner.goalProgress = 99;
    const changes = context.resolveFactionVictory(world, sess, winner, 12);

    assert(changes > 0);
    assert(winner.territory.includes('loc_a'), 'the winner holds nothing new');
    assert(!rival.territory.includes('loc_a'), 'the rival kept the contested ground');
    assert(rival.influence < rivalInfluenceBefore, 'losing cost the rival nothing');
    assert.equal(sess.locationStates.loc_a?.controlFactionId, 'f_a',
        'control of the seized place did not change hands');
    assert(context.factionRelationScore(winner, 'f_b') < -60, 'the defeat did not sour relations further');
    const answer = sess.scheduledEvents.find(event => event.factionId === 'f_b');
    assert(answer, 'the loser never answers — the consequence does not cascade');
    assert(answer.dueTurn > 12, 'the answer is not scheduled in the future');
    assert(sess.worldNews.some(n => /has taken Town Square from Crown/.test(n.text)),
        'the seizure was never reported');
});

test('an achieved aim is remembered and replaced, never leaving the power idle', () => {
    setModules();
    const world = factionWorld();
    const sess = makeSession(world, { factions: twoPowers() });
    context.normalizeLivingWorldState(world, sess);
    const winner = sess.factions[0];
    const aim = winner.goal;
    context.resolveFactionVictory(world, sess, winner, 5);
    assert(winner.achievements.includes(aim), 'what it accomplished was not remembered');
    assert(winner.goal && winner.goal !== aim,
        'the faction was left with no aim at all — politics stops dead');
    assert.equal(winner.goalProgress, 0);
});

test('an authored follow-up aim is preferred over a derived stance', () => {
    setModules();
    const world = factionWorld();
    const sess = makeSession(world, { factions: twoPowers() });
    sess.factions[0].goalPool = ['buy the mine outright'];
    context.normalizeLivingWorldState(world, sess);
    context.resolveFactionVictory(world, sess, sess.factions[0], 5);
    assert.equal(sess.factions[0].goal, 'buy the mine outright');
});

test('politics keeps moving across a long campaign', () => {
    setModules();
    const world = factionWorld();
    const sess = makeSession(world, { factions: twoPowers() });
    context.normalizeLivingWorldState(world, sess);
    for (let turn = 1; turn <= 400; turn++) tickTurn(world, sess, turn);
    assert(sess.factions.every(f => f.goal), 'a power ended the campaign with nothing to pursue');
    assert(sess.factions.some(f => (f.achievements || []).length >= 2),
        'no power managed more than a single achievement in 400 turns');
});

test('coexistence alone cannot cause open war', () => {
    setModules();
    const world = factionWorld();
    const sess = makeSession(world, { factions: twoPowers() });
    context.normalizeLivingWorldState(world, sess);
    // Only ambient friction from a shared border, for a very long time.
    for (let turn = 1; turn <= 2000; turn++) context.driftFactionRelations(world, sess, turn);
    const score = context.factionRelationScore(sess.factions[0], 'f_b');
    assert(score <= -30, `a shared border produced no hostility at all (${score})`);
    assert(score > context.FACTION_WAR_AT,
        `merely coexisting drifted all the way to open war (${score}) — war should need an event`);
});

test('a shared border sours relations; a common enemy warms them', () => {
    setModules();
    const world = factionWorld();
    const sess = makeSession(world, { factions: twoPowers() });
    context.normalizeLivingWorldState(world, sess);
    for (let turn = 1; turn <= 200; turn++) context.driftFactionRelations(world, sess, turn);
    assert(context.factionRelationScore(sess.factions[0], 'f_b') < 0,
        'two powers sharing ground never fell out');

    const world2 = factionWorld();
    const sess2 = makeSession(world2, { factions: [
        { id:'f_a', name:'A', influence:50, status:'active', goal:'x', territory:['loc_a'], relations:[] },
        { id:'f_b', name:'B', influence:50, status:'active', goal:'y', territory:['loc_b'], relations:[] },
        { id:'f_c', name:'C', influence:50, status:'active', goal:'z', territory:['loc_c'], relations:[] }
    ] });
    context.normalizeLivingWorldState(world2, sess2);
    context.adjustFactionRelation(sess2, sess2.factions[0], sess2.factions[2], -80);
    context.adjustFactionRelation(sess2, sess2.factions[1], sess2.factions[2], -80);
    for (let turn = 1; turn <= 200; turn++) context.driftFactionRelations(world2, sess2, turn);
    assert(context.factionRelationScore(sess2.factions[0], 'f_b') > 0,
        'two powers with a common enemy never found common cause');
});

test('an event — not mere coexistence — tips two powers into open war', () => {
    setModules();
    const world = factionWorld();
    const sess = makeSession(world, { factions: twoPowers() });
    context.normalizeLivingWorldState(world, sess);
    // Ambient friction has already carried them to the floor.
    context.adjustFactionRelation(sess, sess.factions[0], sess.factions[1], -60);
    assert(context.factionRelationScore(sess.factions[0], 'f_b') > context.FACTION_WAR_AT);
    // A seizure is an event, and events can push past the floor.
    sess.factions[0].goalProgress = 99;
    context.resolveFactionVictory(world, sess, sess.factions[0], 20);
    assert(context.factionRelationScore(sess.factions[0], 'f_b') <= context.FACTION_WAR_AT,
        'losing ground to a rival did not tip them into open war');
});

test('a crossing into open hostility is announced once, not every point', () => {
    setModules();
    const world = factionWorld();
    const sess = makeSession(world, { factions: twoPowers() });
    context.normalizeLivingWorldState(world, sess);
    // Sit just above the war line with a shared enemy pulling them back up, so
    // drift oscillates across the threshold rather than settling.
    context.adjustFactionRelation(sess, sess.factions[0], sess.factions[1], -69);
    for (let turn = 1; turn <= 400; turn++) context.driftFactionRelations(world, sess, turn);
    const warNews = sess.worldNews.filter(n => /openly hostile|pulled back from open hostility/.test(n.text));
    assert(warNews.length <= 3, `the war line was announced ${warNews.length} times — it should be rare`);
});

test('faction causation is deterministic and skipped on a clock catch-up', () => {
    setModules();
    const build = () => {
        const world = factionWorld();
        const sess = makeSession(world, { factions: twoPowers() });
        context.normalizeLivingWorldState(world, sess);
        context.adjustFactionRelation(sess, sess.factions[0], sess.factions[1], -40);
        return { world, sess };
    };
    const a = build(); const b = build();
    for (let turn = 1; turn <= 60; turn++) tickTurn(a.world, a.sess, turn);
    for (let turn = 1; turn <= 60; turn++) tickTurn(b.world, b.sess, turn);
    assert.equal(JSON.stringify(a.sess.factions), JSON.stringify(b.sess.factions),
        'faction causation diverged between identical replays');

    const frozen = JSON.stringify(a.sess.factions);
    a.sess.bonusTimeMinutes += 600;
    assert.equal(context.runLivingWorldTick(a.world, a.sess).clockCatchUpOnly, true);
    assert.equal(JSON.stringify(a.sess.factions), frozen,
        'a clock jump advanced faction politics a second time');
});

test('the DM prompt states who stands with whom', () => {
    setModules();
    const world = factionWorld();
    const sess = makeSession(world, { factions: twoPowers() });
    context.normalizeLivingWorldState(world, sess);
    context.adjustFactionRelation(sess, sess.factions[0], sess.factions[1], -80);
    const prompt = context.getLivingWorldPrompt(world, sess);
    assert(/openly hostile to Crown/.test(prompt),
        'the prompt does not tell the DM that these two are at war');
    assert(/contested holding/.test(prompt), 'contested ground is invisible to the DM');
});

// ------------------------------------------------------- places that evolve

function placeSession(world, locState = {}) {
    const sess = makeSession(world, {
        locationStates: {
            loc_a: { conditions: [], controlFactionId: '', danger: 0, prosperity: 50, resources: {}, ...locState }
        }
    });
    return sess;
}

test('a harmful condition makes a place dangerous and poorer over time', () => {
    setModules();
    const world = makeWorld();
    const sess = placeSession(world, { conditions: [{ id: 'c1', label: 'Plague' }] });
    context.normalizeLivingWorldState(world, sess);
    for (let turn = 1; turn <= 150; turn++) tickTurn(world, sess, turn);
    const place = sess.locationStates.loc_a;
    assert(place.danger > 10, `plague did not raise danger (got ${place.danger})`);
    assert(place.prosperity < 50, `plague did not depress prosperity (got ${place.prosperity})`);
});

test('a calming condition is not treated as trouble', () => {
    setModules();
    const world = makeWorld();
    const sess = placeSession(world, { conditions: [{ id: 'c1', label: 'Harvest festival' }] });
    context.normalizeLivingWorldState(world, sess);
    for (let turn = 1; turn <= 150; turn++) tickTurn(world, sess, turn);
    const place = sess.locationStates.loc_a;
    assert.equal(place.danger, 0, 'a festival made the town dangerous');
    assert(place.prosperity > 50, `a festival did not improve prosperity (got ${place.prosperity})`);
});

test('danger eases back to calm once the cause is gone — the world does not only ratchet', () => {
    setModules();
    const world = makeWorld();
    const sess = placeSession(world, { danger: 90, prosperity: 10 });
    context.normalizeLivingWorldState(world, sess);
    for (let turn = 1; turn <= 400; turn++) tickTurn(world, sess, turn);
    const place = sess.locationStates.loc_a;
    assert(place.danger < 10, `danger never receded (stuck at ${place.danger})`);
    assert(place.prosperity > 40, `prosperity never recovered (stuck at ${place.prosperity})`);
});

test('contested ground is dangerous ground', () => {
    setModules();
    const world = makeWorld();
    const sess = placeSession(world);
    sess.factions = [
        { id: 'f1', name: 'Crown', territory: ['loc_a'], influence: 50 },
        { id: 'f2', name: 'Ledger', territory: ['loc_a'], influence: 50 }
    ];
    context.normalizeLivingWorldState(world, sess);
    for (let turn = 1; turn <= 150; turn++) tickTurn(world, sess, turn);
    assert(sess.locationStates.loc_a.danger > 5,
        `two factions claiming the same ground left it calm (${sess.locationStates.loc_a.danger})`);
});

test('firm single control settles a place; a collapsing holder does not', () => {
    setModules();
    const world = makeWorld();
    const strong = placeSession(world, { danger: 40, controlFactionId: 'f1' });
    strong.factions = [{ id: 'f1', name: 'Crown', territory: ['loc_a'], influence: 90, status: 'active' }];
    context.normalizeLivingWorldState(world, strong);
    for (let turn = 1; turn <= 200; turn++) tickTurn(world, strong, turn);

    const weak = placeSession(world, { danger: 40, controlFactionId: 'f1' });
    weak.factions = [{ id: 'f1', name: 'Crown', territory: ['loc_a'], influence: 20, status: 'weakened' }];
    context.normalizeLivingWorldState(world, weak);
    for (let turn = 1; turn <= 200; turn++) tickTurn(world, weak, turn);

    assert(strong.locationStates.loc_a.danger < weak.locationStates.loc_a.danger,
        `firm control (${strong.locationStates.loc_a.danger}) should be safer than a weakened holder (${weak.locationStates.loc_a.danger})`);
});

test('a turning tide is announced, and only to those who can see it', () => {
    setModules();
    const world = makeWorld();
    const sess = placeSession(world, { conditions: [{ id: 'c1', label: 'Siege' }] });
    sess.playerLocation = 'loc_c';
    sess.entityStates.npc_1.location = 'loc_a';   // present to witness it
    sess.entityStates.npc_2.location = 'loc_b';
    context.normalizeLivingWorldState(world, sess);
    for (let turn = 1; turn <= 200; turn++) tickTurn(world, sess, turn);
    const notices = sess.worldNews.filter(n => n.text.includes('Town Square'));
    assert(notices.length > 0, 'a place changed character with no word of it');
    assert(notices.some(n => n.text.includes('dangerous')), 'the siege never registered as danger');
    assert(notices.every(n => (n.knownBy || []).includes('npc_1')),
        'the person standing there did not notice');
    assert(notices.every(n => !(n.knownBy || []).includes('npc_2')),
        'someone elsewhere somehow knew');
});

test('prices rise with danger and scarcity, and stay anchored to their base', () => {
    setModules();
    const world = makeWorld();
    const sess = placeSession(world, { danger: 90, prosperity: 5, conditions: [{ id: 'c1', label: 'Siege' }] });
    sess.economy = { currency: 'coin', markets: {
        loc_a: { bread: { item: 'bread', quantity: 0, price: 10, regenPerTurn: 0, maxQuantity: 20 } }
    } };
    context.normalizeLivingWorldState(world, sess);
    assert.equal(sess.economy.markets.loc_a.bread.basePrice, 10, 'the base rate was not captured');
    for (let turn = 1; turn <= 300; turn++) tickTurn(world, sess, turn);
    const bread = sess.economy.markets.loc_a.bread;
    assert(bread.price > 10, `bread did not get dearer under siege (${bread.price})`);
    assert(bread.price <= 20, `price drift escaped its ceiling (${bread.price})`);
    assert.equal(bread.basePrice, 10, 'the anchor drifted with the price');
});

test('a thriving town undercuts a failing one for the same good', () => {
    setModules();
    const world = makeWorld();
    const build = state => {
        const sess = placeSession(world, state);
        sess.economy = { currency: 'coin', markets: {
            loc_a: { rope: { item: 'rope', quantity: 5, price: 20, regenPerTurn: 0, maxQuantity: 10 } }
        } };
        context.normalizeLivingWorldState(world, sess);
        for (let turn = 1; turn <= 300; turn++) tickTurn(world, sess, turn);
        return sess.economy.markets.loc_a.rope.price;
    };
    const rich = build({ danger: 0, prosperity: 95 });
    const ruined = build({ danger: 85, prosperity: 5, conditions: [{ id: 'c1', label: 'Famine' }] });
    assert(rich < ruined, `a thriving town (${rich}) should not be dearer than a ruined one (${ruined})`);
});

test('place drift is deterministic and skipped on a clock catch-up', () => {
    setModules();
    const build = () => {
        const world = makeWorld();
        const sess = placeSession(world, { conditions: [{ id: 'c1', label: 'Riot' }] });
        context.normalizeLivingWorldState(world, sess);
        return { world, sess };
    };
    const a = build(); const b = build();
    for (let turn = 1; turn <= 60; turn++) tickTurn(a.world, a.sess, turn);
    for (let turn = 1; turn <= 60; turn++) tickTurn(b.world, b.sess, turn);
    assert.equal(JSON.stringify(a.sess.locationStates), JSON.stringify(b.sess.locationStates),
        'place drift diverged between identical replays');

    const frozen = JSON.stringify(a.sess.locationStates);
    a.sess.bonusTimeMinutes += 600;
    const catchUp = context.runLivingWorldTick(a.world, a.sess);
    assert.equal(catchUp.clockCatchUpOnly, true);
    assert.equal(JSON.stringify(a.sess.locationStates), frozen,
        'a clock jump advanced place drift a second time');
});

// ------------------------------------------------------------- world agent

test('the world agent is off unless deliberately enabled, and bounded when on', () => {
    assert.deepEqual(context.normalizeWorldAgentConfig({}), { enabled: false, intervalTurns: 24, model: '' });
    assert.deepEqual(context.normalizeWorldAgentConfig({ worldAgent: 'nonsense' }),
        { enabled: false, intervalTurns: 24, model: '' });
    assert.equal(context.normalizeWorldAgentConfig({ worldAgent: { enabled: true, intervalTurns: 1 } }).intervalTurns, 8,
        'an absurdly small interval was not floored');
    assert.equal(context.normalizeWorldAgentConfig({ worldAgent: { enabled: true, intervalTurns: 99999 } }).intervalTurns, 200,
        'an absurdly large interval was not capped');
    assert.equal(context.normalizeWorldAgentConfig({ worldAgent: { enabled: 'yes' } }).enabled, false,
        'a truthy non-boolean silently enabled paid API calls');
});

test('the world agent fires on its interval, never on a reroll', () => {
    setModules();
    const world = makeWorld();
    world.worldAgent = { enabled: true, intervalTurns: 10 };
    const sess = makeSession(world);
    context.normalizeLivingWorldState(world, sess);

    sess.turnCount = 9;
    assert.equal(context.shouldRunWorldAgent(world, sess), false, 'fired before its first interval');
    sess.turnCount = 10;
    assert.equal(context.shouldRunWorldAgent(world, sess), true, 'never fired at all');
    assert.equal(context.shouldRunWorldAgent(world, sess, { isReroll: true }), false,
        'a reroll would have paid for a second, different roll of the dice');

    sess.lastWorldAgentTurn = 10;
    sess.turnCount = 19;
    assert.equal(context.shouldRunWorldAgent(world, sess), false, 'fired again inside its interval');
    sess.turnCount = 20;
    assert.equal(context.shouldRunWorldAgent(world, sess), true, 'did not fire on the next interval');

    world.worldAgent.enabled = false;
    assert.equal(context.shouldRunWorldAgent(world, sess), false, 'ran while disabled');
    world.worldAgent.enabled = true;
    setModules({ livingWorld: false });
    assert.equal(context.shouldRunWorldAgent(world, sess), false, 'ran with the living world module off');
});

test('the world agent can never reach the player, whatever it returns', () => {
    // Everything a hostile or confused model might send back.
    const hostile = {
        world_events: [{ id: 'e1', title: 'Raid' }],
        npc_goal_updates: [{ npc_id: 'npc_1' }],
        faction_updates: [{ id: 'f1' }],
        location_state_updates: [{ location_id: 'loc_a' }],
        npc_relationship_updates: [{ source_npc_id: 'npc_1', target_npc_id: 'npc_2', change: 5 }],
        npc_moves: [{ npc_id: 'npc_1', location_id: 'loc_b' }],
        economy_updates: [{ location_id: 'loc_a' }],
        schedule_updates: [{ npc_id: 'npc_1', blocks: [] }],
        // --- none of the following may survive ---
        location_id: 'loc_c',
        stat_changes: [{ id: 'hp', change: -999 }],
        inventory_add: ['cursed blade'],
        inventory_remove: ['the shard'],
        checks: [{ id: 'c1', stat: 'hp' }],
        transactions: [{ item: 'sword', price: 9999 }],
        player_condition_updates: [{ add: 'doomed' }],
        time_skip_minutes: 4000,
        quests_update: [{ id: 'q1', status: 'failed' }],
        outfit_update: 'rags',
        ledger_update: 'rewriting history',
        threads_update: [{ id: 't1' }],
        npc_status_changes: [{ npc_id: 'npc_2', status: 'dead' }],
        npc_introduced: [{ name: 'Interloper' }],
        location_introduced: [{ name: 'Nowhere' }]
    };
    const { actions, dropped } = context.sanitizeWorldAgentActions(hostile);
    const forbidden = ['location_id', 'stat_changes', 'inventory_add', 'inventory_remove', 'checks',
        'transactions', 'player_condition_updates', 'time_skip_minutes', 'quests_update',
        'outfit_update', 'ledger_update', 'threads_update', 'npc_status_changes',
        'npc_introduced', 'location_introduced'];
    forbidden.forEach(field => {
        assert(!(field in actions), `the world agent was allowed to send "${field}" at the player`);
    });
    assert.equal(dropped, forbidden.length, 'the count of rejected fields does not match');
    assert.equal(Object.keys(actions).length, 8, 'a legitimate world-shaping field was lost');
    assert(actions.world_events && actions.npc_moves);
});

test('sanitizing tolerates junk and drops empties', () => {
    assert.deepEqual(context.sanitizeWorldAgentActions(null).actions, {});
    assert.deepEqual(context.sanitizeWorldAgentActions('nope').actions, {});
    assert.deepEqual(context.sanitizeWorldAgentActions([1, 2]).actions, {});
    const { actions, applied } = context.sanitizeWorldAgentActions({ world_events: [], faction_updates: null });
    assert.deepEqual(actions, {}, 'empty arrays were treated as real work');
    assert.equal(applied, false);
});

test('the agent payload parser survives fences, prose, and reasoning preambles', () => {
    const target = { world_events: [{ id: 'e1' }] };
    assert.deepEqual(context.parseWorldAgentPayload(JSON.stringify(target)), target);
    assert.deepEqual(context.parseWorldAgentPayload('```json\n' + JSON.stringify(target) + '\n```'), target);
    assert.deepEqual(context.parseWorldAgentPayload('Sure! Here you go:\n' + JSON.stringify(target) + '\nHope that helps.'), target);
    assert.equal(context.parseWorldAgentPayload('I was unable to comply.'), null);
    assert.equal(context.parseWorldAgentPayload(''), null);
    assert.equal(context.parseWorldAgentPayload('[1,2,3]'), null, 'a bare array was accepted as a payload');
});

test('the digest carries what is in motion, and warns off the player', () => {
    setModules();
    const world = makeWorld();
    world.entities[0].goal = 'open the vault';
    world.entities[0].goalSteps = ['found the key'];
    const sess = makeSession(world, {
        factions: [{ id: 'f1', name: 'Red Ledger', goal: 'own the valley', influence: 70 }],
        scheduledEvents: [{ id: 'ev1', title: 'Market day', dueTurn: 30 }],
        history: [{ role: 'user', text: 'I search the cellar for the map.' }]
    });
    sess.entityStates.npc_1.location = 'loc_c';
    context.normalizeLivingWorldState(world, sess);
    const digest = context.buildWorldAgentDigest(world, sess);
    assert(digest.includes('Ada') && digest.includes('open the vault'), 'agendas missing from the digest');
    assert(digest.includes('Red Ledger'), 'factions missing from the digest');
    assert(digest.includes('Market day'), 'pending events missing — the agent could duplicate them');
    assert(digest.includes('I search the cellar'), 'the player\'s recent actions are missing');
    assert(digest.includes('do not move, harm, reward, or otherwise touch the player'),
        'the digest does not state the player boundary');
    assert(digest.includes('[npc_1]') && digest.includes('[loc_a]'),
        'ids are missing, so the agent cannot address anything precisely');
    assert(digest.length < 6000, `digest is too fat to be cheap (${digest.length} chars)`);
});

test('a faction named in a tool call is built ready to simulate', () => {
    // Starting a campaign with no factions and letting them form through
    // narration is a supported way to play, so the record the handler creates
    // has to carry everything the tick reads.
    const handler = functionSource('processStructuredActions');
    const created = handler.match(/sess\.factions\.push\(\{[\s\S]*?\}\);/g) || [];
    assert(created.length, 'the DM cannot bring a new faction into being at all');
    ['id', 'name', 'reputation', 'influence', 'resources', 'goal', 'goalProgress',
     'status', 'territory', 'relations'].forEach(field => {
        assert(created.some(block => new RegExp(`\\b${field}\\b`).test(block)),
            `a DM-created faction has no ${field}, so the simulation reads undefined`);
    });
    assert(/description: "Create and evolve organizations/.test(app),
        'the tool never tells the DM it may create a faction, so it will not');
});

test('a standing the DM declares is mutual, as it is everywhere else', () => {
    // It was not: only the speaking faction's side was written, so the other
    // one showed no enemy, took no contested-ground penalty, and read as calm
    // in the prompt while supposedly at war. The editor and the tick both set
    // both sides; the tool call was the odd one out.
    const handler = functionSource('processStructuredActions');
    const block = handler.slice(handler.indexOf('Array.isArray(update.relations)'));
    assert(/adjustFactionRelation\(sess, faction, target/.test(block),
        'a declared standing is still written to only one side');

    // And the helper it now uses really is symmetric.
    const sess = { factions: [] };
    const a = { id: 'f_a', name: 'A', relations: [] };
    const b = { id: 'f_b', name: 'B', relations: [] };
    context.adjustFactionRelation(sess, a, b, -70);
    assert.equal(context.factionRelationScore(a, 'f_b'), -70);
    assert.equal(context.factionRelationScore(b, 'f_a'), -70,
        'the faction that was declared war on does not know about it');
});

test('the tick alone never conjures a faction from nothing', () => {
    // Factions form through the story, not spontaneously. A world with none
    // must stay at none until something in the fiction names one — otherwise
    // the engine would invent politics the author never asked for.
    const world = { id: 'w', name: 'Blank', locations: [{ id: 'l1', name: 'Square', exits: [] }],
        entities: [{ id: 'e1', name: 'Bree', type: 'npc', startLocation: 'l1' }] };
    const sess = { id: 's', turnCount: 1, playerLocation: 'l1', entityStates: { e1: { location: 'l1', observations: [] } },
        scheduledEvents: [], locationStates: {}, npcRelationships: {}, npcScheduleOverrides: {},
        factions: [], economy: { currency: 'g', markets: {} }, worldNews: [], quests: [], livingWorldActivity: {} };
    context.__ruleModules = { livingWorld: true, relationships: true };
    context.normalizeLivingWorldState(world, sess);
    for (let turn = 2; turn <= 150; turn++) {
        sess.turnCount = turn;
        context.runLivingWorldTick(world, sess);
    }
    assert.equal(sess.factions.length, 0, 'a faction appeared with nothing in the world naming one');
});

test('once two powers exist they fight their war without anyone scripting it', () => {
    const world = { id: 'w', name: 'B',
        locations: [{ id: 'l1', name: 'Square', exits: [] }, { id: 'l2', name: 'Mine', exits: [] }],
        entities: [{ id: 'e1', name: 'Bree', type: 'npc', startLocation: 'l1' }] };
    const sess = { id: 's', turnCount: 1, playerLocation: 'l1', entityStates: { e1: { location: 'l1', observations: [] } },
        scheduledEvents: [], locationStates: {}, npcRelationships: {}, npcScheduleOverrides: {},
        economy: { currency: 'g', markets: {} }, worldNews: [], quests: [], livingWorldActivity: {},
        factions: [
            { id: 'f_hand', name: 'The Ashen Hand', influence: 60, reputation: 0, resources: 50,
              goal: 'Take the mine', goalProgress: 0, status: 'active', territory: ['l2'],
              relations: [{ factionId: 'f_ferry', score: -70 }], achievements: [], goalPool: ['Tax the road'] },
            { id: 'f_ferry', name: 'The Ferrymen', influence: 45, reputation: 0, resources: 50,
              goal: 'Hold the ford', goalProgress: 0, status: 'active', territory: ['l1'],
              relations: [{ factionId: 'f_hand', score: -70 }], achievements: [], goalPool: [] }] };
    context.__ruleModules = { livingWorld: true, relationships: true };
    context.normalizeLivingWorldState(world, sess);
    for (let turn = 2; turn <= 400; turn++) {
        sess.turnCount = turn;
        context.runLivingWorldTick(world, sess);
    }
    const hand = sess.factions.find(f => f.id === 'f_hand');
    assert(hand.achievements.length >= 2, 'no aim was ever carried to completion');
    assert(hand.achievements.includes('Tax the road'), 'the follow-up aim in the pool was never taken up');
    assert(hand.goal && !hand.achievements.includes(hand.goal) === false || hand.goal,
        'a faction that finished everything went inert instead of finding a new aim');
    const news = sess.worldNews.filter(item => item.type === 'faction').map(item => item.text);
    assert(news.some(text => /achieved its objective/.test(text)), 'a victory was never announced');
    assert(news.some(text => /has taken/.test(text)), 'ground never changed hands');
});

let failures = 0;
for (const { name, fn } of tests) {
    try {
        fn();
        console.log(`✓ ${name}`);
    } catch (error) {
        failures++;
        console.error(`✗ ${name}\n  ${error.message}`);
    }
}
if (failures) {
    console.error(`\n${failures} living-world check(s) failed.`);
    process.exit(1);
}
console.log(`\n${tests.length} living world checks passed.`);
