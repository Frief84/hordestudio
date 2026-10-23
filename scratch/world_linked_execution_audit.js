'use strict';
const assert = require('node:assert/strict');
const { executeLinkedActions } = require('../worlds/linked-world-actions');
const world = { id: 'unseen_world', entities: [
    { id: 'key_1', name: 'Bronze key', type: 'item' },
    { id: 'guide_1', name: 'Guide', type: 'npc' }
], locations: [
    { id: 'foyer', name: 'Foyer', exits: [{ targetLocationId: 'archive', doorId: 'archive_gate',
        requiredItem: 'Bronze key', lockState: 'locked' }] },
    { id: 'archive', name: 'Archive', exits: [{ targetLocationId: 'foyer', doorId: 'archive_gate',
        requiredItem: 'Bronze key', lockState: 'locked' }] }
] };
const session = { id: 'save_1', playerLocation: 'foyer', inventory: [], unlockedExits: {},
    entityStates: { key_1: { location: 'foyer' }, guide_1: { location: 'foyer', followingPlayer: true },
        player: { location: 'foyer' } }, locationStates: {}, npcRelationships: {},
    engineEvents: [], turnCount: 3, worldStateVersion: 7 };
const canMove = (view, state, actor, from, to) => {
    const exit = view.locations.find(place => place.id === from)?.exits
        .find(item => item.targetLocationId === to);
    if (!exit) return { ok: false, reason: 'unreachable' };
    if (exit.doorId && !state.unlockedExits?.[exit.doorId])
        return { ok: false, reason: 'locked_exit' };
    return { ok: true };
};
const action = (id, status, action_effects = {}, depends_on = []) => ({
    action_id: id, kind: 'physical', status, depends_on, action_effects
});
const plan = { actions: [
    action('take', 'resolved', { item_transfer: [{ item_id: 'key_1', from_id: 'foyer', to_id: 'player' }] }),
    action('open', 'resolved', { interactable_transition: [{ target_id: 'archive_gate', to_state: 'open' }] },
        [{ action_id: 'take', outcome: 'succeeded' }]),
    action('enter', 'resolved', { actor_move: [{ actor_id: 'player', to_location_id: 'archive' }] },
        [{ action_id: 'open', outcome: 'succeeded' }])
], events: [], narrative: [
    { action_id: 'take', text: 'You pick up the bronze key.' },
    { action_id: 'open', text: 'The gate opens.' },
    { action_id: 'enter', text: 'You and your guide enter the archive.' }
] };
const result = executeLinkedActions(plan, world, session, { canMove });
assert(result.ok, JSON.stringify(result.errors));
assert.deepEqual(Object.fromEntries(result.outcomes),
    { take: 'succeeded', open: 'succeeded', enter: 'succeeded' });
assert.equal(session.playerLocation, 'foyer', 'canonical location cannot move before commit');
assert.equal(result.working.getSession('playerLocation'), 'archive');
assert.equal(result.working.getEntity('guide_1').state.location, 'archive');
assert(result.working.dirtySet.has('entity:guide_1'));
assert(result.working.dirtySet.has('location:foyer'));
assert(result.working.dirtySet.has('location:archive'));
assert.equal(result.working.getSession('inventory')[0], 'Bronze key');

const blockedPlan = { actions: [
    action('move', 'blocked', { actor_move: [{ actor_id: 'player', to_location_id: 'archive' }] }),
    action('next', 'resolved', { outfit_set: [{ actor_id: 'player', outfit: 'blue coat' }] },
        [{ action_id: 'move', outcome: 'succeeded' }])
], events: [], narrative: [{ action_id: 'move', text: 'The locked gate stops you.' },
    { action_id: 'next', text: 'You change clothes inside.' }] };
const blocked = executeLinkedActions(blockedPlan, world, session, { canMove });
assert(blocked.ok, JSON.stringify(blocked.errors));
assert.deepEqual(Object.fromEntries(blocked.outcomes), { move: 'blocked', next: 'skipped' });
assert(!blocked.narrative.includes('change clothes'));
const onFailure = structuredClone(blockedPlan);
onFailure.actions[1].depends_on[0].outcome = 'blocked';
onFailure.actions[1].status = 'resolved';
const recovery = executeLinkedActions(onFailure, world, session, { canMove });
assert(recovery.ok && recovery.working.getSession('outfit') === 'blue coat');
const unknown = executeLinkedActions({ actions: [action('magic', 'resolved', {
    spontaneous_teleport: [{ to: 'archive' }] })], events: [], narrative: [] }, world, session);
assert(!unknown.ok && unknown.errors[0].reason.startsWith('unknown_technical_effect'));
assert.equal(session.playerLocation, 'foyer');
const stocked = structuredClone(session);
stocked.inventory = [{ id: 'saffron_lens', name: 'Saffron lens', quantity: 2 }];
const given = executeLinkedActions({ actions: [action('give', 'resolved', {
    item_transfer: [{ item_id: 'saffron_lens', from_id: 'player', to_id: 'guide_1' }]
})], events: [], narrative: [] }, world, stocked);
assert(given.ok, JSON.stringify(given.errors));
assert.equal(given.working.getSession('inventory')[0].quantity, 1);
assert.deepEqual(given.working.getEntity('guide_1').state.inventory, ['Saffron lens']);
const relationshipChange = [{ source_npc_id: 'guide_1', target_npc_id: 'player', change: 2,
    reason: 'A respectful gesture earns a little trust.' }];
let forwardedRelationshipChange = null;
const relationship = executeLinkedActions({ actions: [action('react', 'resolved', {
    npc_relationship_updates: relationshipChange
})], events: [], narrative: [] }, world, session, {
    legacyEffectKeys: ['npc_relationship_updates'],
    applyLegacyEffect: (type, payload) => { forwardedRelationshipChange = { type, payload }; }
});
assert(relationship.ok, JSON.stringify(relationship.errors));
assert.deepEqual(forwardedRelationshipChange,
    { type: 'npc_relationship_updates', payload: relationshipChange },
    'legacy relationship effects exposed under linked action_effects reach the existing reducer');
console.log('PASS linked action chain, confirmed guards, safe unknown effects and working state');
