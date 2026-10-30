'use strict';
const assert = require('node:assert/strict');
const scene = require('../worlds/scene-draft');
const binding = require('../worlds/turn-binding');
const linked = require('../worlds/linked-world-actions');
const fields = Object.fromEntries(['type', 'actor_id', 'status', 'action', 'item',
    'from_location_id', 'to_location_id'].map(key => [key, { type: 'string' }]));
const canonical = scene.schema({ events: { type: 'array', items: { type: 'object',
    properties: fields, required: ['type', 'actor_id', 'status'] } } },
    'scene_draft_v3', { linkedRequired: true });
const world = { id: 'natural_actions', locations: [
    { id: 'hall', name: 'Hall', exits: [{ targetLocationId: 'garden' }] },
    { id: 'garden', name: 'Garden', exits: [{ targetLocationId: 'hall' }] }
], entities: [{ id: 'cup', name: 'Cup', type: 'item', locationId: 'hall' }] };
const input = 'I take the cup, then walk into the garden.';
const proposal = { protocol: 'scene_draft_v3', actions: [
    { request: 'I take the cup, ', kind: 'physical', status: 'resolved', effects: [],
        response: [{ text: 'You pick up the cup.' }] },
    { request: 'then walk into the garden.', kind: 'physical', status: 'resolved', effects: [],
        response: [{ text: 'You arrive in the garden.' }] }
] };
const references = [
    { id: 'cup', name: 'Cup', type: 'item', locationId: 'hall', reachable: true },
    { id: 'hall', name: 'Hall', type: 'location' },
    { id: 'garden', name: 'Garden', type: 'location' }
];
const context = { turnId: 'turn_natural', input, playerLocation: 'hall',
    references, prepareCertainEffects: true };
proposal.actions[0].response[0].events = [{ type: 'movement', actor_id: 'player',
    status: 'completed', from_location_id: 'hall', to_location_id: 'garden' }];
proposal.actions[1].response[0].events = [{ type: 'movement', actor_id: 'player',
    status: 'completed', action: 'walk' }];
const bound = binding.bind(proposal, context, canonical);
assert(bound.ok, JSON.stringify(bound.errors));
assert.equal(bound.draft.actions[0].action_effects.item_transfer[0].item_id, 'cup');
assert.equal(bound.draft.actions[1].action_effects.actor_move[0].to_location_id, 'garden');
assert(bound.draft.events.some(event => event.type === 'inventory'));
assert.equal(bound.draft.events.filter(event => event.type === 'movement').length, 1);
assert.equal(bound.draft.actions[1].kind, 'travel');
const compiled = scene.compile(bound.draft, { input, location: 'hall',
    playerStart: 'hall', present: [], locations: ['hall', 'garden'],
    linkedRequired: true, contract: canonical });
assert(compiled.ok, JSON.stringify(compiled.errors));
const session = { id: 'natural_session', playerLocation: 'hall', inventory: [], turnCount: 1,
    entityStates: { cup: { location: 'hall' } }, locationStates: {}, npcRelationships: {},
    worldClock: { absoluteMinutes: 480, turnCount: 1, bonusTimeMinutes: 0 } };
const executed = linked.executeLinkedActions(compiled.linkedPlan, world, session,
    { canMove: () => ({ ok: true, travelTime: 0, elapsedMinutes: 10 }) });
assert(executed.ok, JSON.stringify(executed.errors));
const final = executed.working.prepare().session;
assert.equal(final.playerLocation, 'garden');
assert(final.inventory.some(item => item === 'Cup' || item.id === 'cup' || item.name === 'Cup'));
const absent = binding.bind(proposal, { ...context, references: references.map(item =>
    item.id === 'cup' ? { ...item, locationId: 'garden' } : item) }, canonical);
assert(!absent.ok || !absent.draft.actions[0].action_effects.item_transfer,
    'the binder cannot prepare an absent item transfer');
const unusualInput = 'I scoop up the cup.';
const unusual = binding.bind({ protocol: 'scene_draft_v3', actions: [{
    request: unusualInput, kind: 'physical', status: 'resolved', effects: [],
    response: [{ text: 'You scoop up the cup.', events: [{ type: 'inventory',
        actor_id: 'player', status: 'completed', action: 'take', item: 'Cup' }] }]
}] }, { ...context, input: unusualInput }, canonical);
assert(unusual.ok, JSON.stringify(unusual.errors));
assert.equal(unusual.draft.actions[0].action_effects.item_transfer[0].item_id, 'cup');
console.log('PASS P4.3g natural action: engine-prepared pickup and movement, semantic event wording, absent-item guard');
