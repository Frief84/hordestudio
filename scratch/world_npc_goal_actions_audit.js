'use strict';
const assert = require('node:assert/strict');
const { executeNpcGoalStep } = require('../worlds/npc-goal-actions');

const steps = [
    { label: 'takes the brass key', effect: { type: 'item_transfer',
        payload: { actor_id: 'keeper', item_id: 'brass_key', from_id: 'store', to_id: 'keeper' } } },
    { label: 'unlocks the archive door', effect: { type: 'interactable_transition',
        payload: { actor_id: 'keeper', target_id: 'archive_door', to_state: 'open' } } },
    { label: 'enters the archive', effect: { type: 'actor_move',
        payload: { actor_id: 'keeper', to_location_id: 'archive' } } }
];
const world = { id: 'npc_goal', entities: [
    { id: 'keeper', type: 'npc', name: 'Keeper' },
    { id: 'brass_key', type: 'item', name: 'Brass key' }
], locations: [
    { id: 'store', name: 'Store', exits: [{ targetLocationId: 'archive',
        doorId: 'archive_door', requiredItem: 'Brass key', lockState: 'locked' }] },
    { id: 'archive', name: 'Archive', exits: [{ targetLocationId: 'store' }] }
] };
const base = () => ({ id: 'goal_save', playerLocation: 'archive', inventory: [],
    unlockedExits: {}, entityStates: { keeper: { location: 'store', inventory: [] },
        brass_key: { location: 'store' } }, locationStates: {}, npcRelationships: {}, turnCount: 1 });
const canMove = (view, sess, actor, from, to) => ({ ok: !!view.locations.find(p => p.id === from)
    ?.exits.some(exit => exit.targetLocationId === to && (!exit.doorId
        || sess.unlockedExits?.[exit.doorId])), reason: 'locked_or_unmapped' });
const run = (sess, index) => executeNpcGoalStep(world.entities[0], steps[index], world, sess, { canMove });
const missing = base();
delete missing.entityStates.brass_key.location;
assert(!run(missing, 0).ok);
assert.deepEqual(missing.entityStates.keeper.inventory, []);
assert.equal(missing.unlockedExits.archive_door, undefined);
const owned = base();
owned.entityStates.brass_key.location = null;
owned.entityStates.other = { location: 'store', inventory: ['Brass key'] };
world.entities.push({ id: 'other', type: 'npc', name: 'Other' });
assert(!run(owned, 0).ok);
assert.equal(owned.entityStates.keeper.inventory.length, 0);
let session = base();
assert(!run(session, 1).ok, 'the locked door requires the actual key');
assert(!run(session, 2).ok, 'the closed route blocks movement');
for (let index = 0; index < steps.length; index++) {
    if (index === 1) {
        const sealed = executeNpcGoalStep(world.entities[0], steps[index], world, session,
            { canMove, canTransition: () => ({ ok: false, reason: 'sealed_route' }) });
        assert.equal(sealed.reason, 'goal_action_blocked');
        assert.equal(session.unlockedExits.archive_door, undefined,
            'a new obstacle between goal steps rolls back the attempted action');
    }
    const outcome = run(session, index);
    assert(outcome.ok, `${index}: ${outcome.reason}`);
    assert.equal(session.entityStates.keeper.location, 'store', 'no mutation before publication');
    session = structuredClone(outcome.candidate.session); // save/reload between every step
}
assert.equal(session.entityStates.keeper.location, 'archive');
assert.equal(session.unlockedExits.archive_door, true);
assert(session.entityStates.keeper.inventory.some(item =>
    (typeof item === 'string' ? item : item.name) === 'Brass key'));
assert(!run(session, 0).ok, 'a used key cannot be collected twice from its old location');
console.log('PASS NPC linked goal actions: key, locked door, travel, competing owner, save/reload');
