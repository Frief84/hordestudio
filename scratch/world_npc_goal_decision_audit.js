'use strict';
const assert = require('node:assert/strict');
const { npcGoalOptions, decideNpcGoalStep, acceptNpcGoalProposal } =
    require('../worlds/npc-goal-actions');

const npc = { id: 'keeper', type: 'npc', name: 'Keeper' };
const world = { locations: [
    { id: 'store', name: 'Store', exits: [{ targetLocationId: 'archive',
        doorId: 'archive_door', requiredItem: 'Brass key', lockState: 'locked' }] },
    { id: 'archive', name: 'Archive', exits: [] }
], entities: [npc, { id: 'key', type: 'item', name: 'Brass key', locationId: 'store' }] };
const session = { unlockedExits: {}, entityStates: {
    keeper: { location: 'store', inventory: [], goal: 'Reach Archive', goalStatus: 'active' },
    key: { location: 'store' }
} };
const context = { knowsPlace: () => true };
const options = () => npcGoalOptions(npc, world, session, context);
assert(!options().some(option => option.effect.type === 'actor_move'),
    'closed door must not be advertised as an immediately executable move');
assert(options().some(option => option.effect.type === 'interactable_transition'),
    'the existing door action remains available for a grounded decision');
assert(options().some(option => option.effect.type === 'item_transfer'),
    'the local key remains available');
assert.equal(decideNpcGoalStep(npc, world, session, context), null,
    'a named destination behind a closed door must not trigger a doomed move');
const move = { type: 'actor_move', payload: { actor_id: 'keeper', to_location_id: 'archive' } };
assert.equal(acceptNpcGoalProposal(npc, { npc_id: npc.id, goal: 'Reach Archive',
    effect: move }, world, session, context), false,
    'an agent cannot queue an unavailable move');
assert.equal(session.entityStates.keeper.goalActionProposal, undefined);
session.unlockedExits.archive_door = true;
assert.equal(decideNpcGoalStep(npc, world, session, context)?.effect.type, 'actor_move',
    'confirmed opening makes the named destination deterministically reachable');
assert.equal(acceptNpcGoalProposal(npc, { npc_id: npc.id, goal: 'Reach Archive',
    effect: move }, world, session, context), true);
const reloaded = structuredClone(session);
assert.equal(decideNpcGoalStep(npc, world, reloaded, context)?.effect.type, 'actor_move',
    'the accepted decision survives save and reload');
console.log('PASS NPC goal decision: closed door waits for a grounded step; open door resumes deterministic move');
