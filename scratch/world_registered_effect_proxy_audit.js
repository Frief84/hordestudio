'use strict';
const assert = require('node:assert/strict');
const { createWorkingState, guardCanonicalWrites } = require('../worlds/working-state');
const { createWorldEffectRegistry } = require('../worlds/linked-world-actions');
const world = { id: 'new_world', entities: [
    { id: 'player', type: 'player' }, { id: 'guide', type: 'npc' },
    { id: 'keeper', type: 'npc' }, { id: 'loose_key', name: 'Silver key', type: 'item' },
    { id: 'lever', type: 'object', interactable: {
        initialState: 'idle', transitions: [{ from: 'idle', to: 'active' }] } }
], locations: [{ id: 'hall', discoverableItems: ['Scroll'], exits: [{ targetLocationId: 'room' }] },
    { id: 'room', exits: [{ targetLocationId: 'hall' }] }] };
const session = { id: 's1', playerLocation: 'hall', inventory: ['Pebble'],
    entityStates: { player: { location: 'hall' }, guide: { location: 'hall' },
        keeper: { location: 'hall' }, loose_key: { location: 'hall' },
        lever: { location: 'hall' } }, locationStates: {}, dynamicExits: {},
    npcRelationships: {}, engineEvents: [], playerSceneConditions: [],
    bonusTimeMinutes: 0, turnCount: 2 };
const cases = {
    actor_move: { actor_id: 'player', to_location_id: 'room', companion_ids: ['guide'] },
    interactable_transition: { target_id: 'lever', to_state: 'active' },
    item_transfer: { item_id: 'loose_key', from_id: 'hall', to_id: 'player' },
    item_consume: { item_id: 'Pebble', actor_id: 'player' },
    item_introduce: { id: 'new_scroll', name: 'Scroll', location_id: 'hall' },
    entity_introduce: { id: 'new_visitor', name: 'Visitor', persona: 'traveler', location_id: 'hall' },
    location_introduce: { id: 'new_cellar', name: 'Cellar', connects_to: 'hall' },
    condition_change: { target_id: 'player', condition: 'tired', action: 'add' },
    relation_set: { subject_id: 'guide', target_id: 'keeper', value: 20 },
    event_emit: { id: 'event_1', type: 'signal', description: 'A bell rings.' },
    time_advance: { minutes: 10 },
    outfit_set: { actor_id: 'player', outfit: 'clean coat' }
};
const registry = createWorldEffectRegistry();
assert.deepEqual(registry.types().sort(), Object.keys(cases).sort(),
    'every registered operation needs a proxy-instrumented case');
for (const [type, payload] of Object.entries(cases)) {
    const guardedWorld = guardCanonicalWrites(world, 'world');
    const guardedSession = guardCanonicalWrites(session, 'sess');
    const working = createWorkingState(guardedWorld, guardedSession);
    registry.run([{ type, payload }], working, {
        sessionId: session.id, canMove: () => ({ ok: true }),
        actionEvents: [{ id: 'proof_scroll', type: 'discovery', status: 'completed',
            actor_id: 'player', target_id: 'new_scroll', item: 'Scroll' }]
    });
    const candidate = working.prepare();
    assert(working.dirtySet.size > 0, `${type} must report dirty state`);
    assert(candidate.world && candidate.session);
}
assert.equal(session.playerLocation, 'hall');
assert.deepEqual(session.engineEvents, []);
assert.throws(() => { guardCanonicalWrites(session, 'sess').entityStates.guide.location = 'room'; },
    /direct_canonical_write:sess\.entityStates\.guide/);
assert.throws(() => guardCanonicalWrites(session, 'sess').engineEvents.push({ id: 'bad' }),
    /direct_canonical_write/);
console.log('PASS all registered effects use guarded working state only');
