'use strict';
const assert = require('node:assert/strict');
const scene = require('../worlds/scene-draft');
const binding = require('../worlds/turn-binding');
const linked = require('../worlds/linked-world-actions');

const canonical = scene.schema({ events: { type: 'array', items: {
    type: 'object', properties: { ...Object.fromEntries(['type', 'actor_id', 'status',
        'action', 'target_id', 'cause', 'evidence'].map(name => [name, { type: 'string' }])),
        change: { type: 'integer' } },
    required: ['type', 'actor_id', 'status']
} } }, 'scene_draft_v3', { linkedRequired: true });
const input = 'I press the handle and release it.';
const context = { turnId: 'turn_temporary_interaction', input,
    playerLocation: 'room', presentActorIds: [], now: 0,
    references: [{ id: 'door', name: 'handle', type: 'item', locationId: 'room' }] };
const proposal = { protocol: 'scene_draft_v3', actions: [{ request: input,
    kind: 'physical', status: 'resolved', effects: [], response: [{
        text: 'The handle moves and springs back.', events: [{ type: 'interaction',
            actor_id: 'player', status: 'completed', target_id: 'door' }] }] }] };
const bound = binding.bind(proposal, context, canonical);
assert(bound.ok, JSON.stringify(bound.errors));
assert.equal(bound.draft.events[0].action, input);
assert(bound.binding.repairs.some(repair => repair.type === 'bind_completed_interaction_action'));
assert.equal(proposal.actions[0].response[0].events[0].action, undefined,
    'binding must not mutate the provider draft');
const compiled = scene.compile(bound.draft, { input, location: 'room',
    playerStart: 'room', present: [], locations: ['room'], now: 0,
    linkedRequired: true, contract: canonical });
assert(compiled.ok, JSON.stringify(compiled.errors));
const world = { id: 'temporary_interaction_world', locations: [
    { id: 'room', exits: [] }], entities: [{ id: 'door', name: 'Handle',
        type: 'item', startLocation: 'room' }] };
const session = { id: 'temporary_interaction_save', playerLocation: 'room',
    inventory: [], entityStates: { door: { location: 'room' } },
    locationStates: {}, npcRelationships: {}, engineEvents: [], worldStateVersion: 1 };
const executed = linked.executeLinkedActions(compiled.linkedPlan, world, session,
    { allowPartialRecovery: true, requireEffectWitnesses: true });
assert(executed.ok, JSON.stringify(executed.errors));
assert.equal(executed.outcomes.get(compiled.linkedPlan.actions[0].action_id), 'succeeded');
assert.equal(executed.working.getSession('playerLocation'), 'room');
assert.equal(executed.confirmedEffects.length, 0);

const speechInput = 'I say hello.';
const zeroChange = binding.bind({ protocol: 'scene_draft_v3', actions: [{
    kind: 'speech', status: 'resolved', effects: [], response: [{
        text: 'You say hello.', events: [{ type: 'relationship',
            actor_id: 'player', target_id: 'door', status: 'completed', change: 0,
            cause: 'greeting' }] }] }] }, { ...context, input: speechInput }, canonical);
assert(zeroChange.ok, JSON.stringify(zeroChange.errors));
assert.equal(zeroChange.draft.events.length, 0,
    'a declared zero delta is not a completed relationship change');
assert(zeroChange.binding.repairs.some(repair =>
    repair.type === 'discard_zero_change_relationship_event'));

console.log('PASS temporary interaction is witnessed without an invented lasting effect');
