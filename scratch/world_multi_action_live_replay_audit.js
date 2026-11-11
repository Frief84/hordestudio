'use strict';
// Replays one captured real Gemma reply through the current Node pipeline.
const assert = require('node:assert/strict');
const binding = require('../worlds/turn-binding');
const scene = require('../worlds/scene-draft');
const linked = require('../worlds/linked-world-actions');
const captured = require('./world-multi-action-node-live-2026-11-01-r3.json');
const chair = require('./world-chair-c-engine-2026-11-01-r5.json')[0];
const fixture = JSON.parse(chair.bindingResponses[0].request);
const input = captured.input;
const references = fixture.context.references.filter(ref => ref.id !== 'chair');
const result = binding.bind(captured.proposal, { ...fixture.context,
    turnId: 'isolated_live_replay', input, playerName: '', references }, fixture.canonical);
assert(result.ok, JSON.stringify(result.errors));
assert.deepEqual(result.draft.actions.map(action => action.kind),
    ['physical', 'physical', 'speech']);
assert.deepEqual(result.draft.speech.map(item => item.quote), ['Hello.']);
const compiled = scene.compile(result.draft, { input, location: 'foyer',
    playerStart: 'foyer', present: ['linda'], locations: ['foyer', 'round'],
    now: 485, linkedRequired: true, contract: fixture.canonical });
assert(compiled.ok, JSON.stringify(compiled.errors));
const world = { id: 'isolated_live_replay',
    locations: [{ id: 'foyer', exits: [] }, { id: 'round', exits: [] }],
    entities: [{ id: 'linda', type: 'npc', name: 'Linda' }] };
const session = { id: 'isolated_live_replay', playerLocation: 'foyer',
    turnCount: 0, inventory: [], entityStates: { linda: { location: 'foyer' } },
    locationStates: {}, npcRelationships: {}, engineEvents: [], worldStateVersion: 1,
    worldClock: { absoluteMinutes: 485, turnCount: 0, bonusTimeMinutes: 0 } };
const executed = linked.executeLinkedActions(compiled.linkedPlan, world, session,
    { worldActionIds: result.binding.worldActionIds });
assert(executed.ok, JSON.stringify(executed.errors));
assert(executed.verifiedEvents.length >= 2);
assert.equal(session.engineEvents.length, 0, 'working state must stay private before save');
(async () => {
    let saved;
    const prepared = structuredClone(executed.working.prepare().session);
    await executed.working.commit(async candidate => {
        saved = JSON.stringify(candidate);
    }, session.worldStateVersion);
    const loaded = JSON.parse(saved);
    assert.equal(loaded.session.playerLocation, 'foyer');
    assert.deepEqual(loaded.session, prepared);
    assert(executed.verifiedEvents.some(event => event.type === 'activity'));
    assert(executed.verifiedEvents.some(event => event.type === 'interaction'));
    console.log('PASS real Gemma reply replay: 3 actions, 1 speech, verified events, state reload');
})().catch(error => { console.error(error); process.exitCode = 1; });
