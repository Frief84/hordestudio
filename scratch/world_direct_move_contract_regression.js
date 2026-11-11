'use strict';
const assert = require('node:assert/strict');
const scene = require('../worlds/scene-draft');
const binding = require('../worlds/turn-binding');
const linked = require('../worlds/linked-world-actions');

const schema = scene.schema({ events: { type: 'array', items: { type: 'object',
    properties: Object.fromEntries(['type', 'actor_id', 'status', 'from_location_id',
        'to_location_id', 'movement_mode', 'cause'].map(key => [key, { type: 'string' }])),
    required: ['type', 'actor_id', 'status'] } },
actor_move: { type: 'array', items: { type: 'object', properties: {
    actor_id: { type: 'string' }, to_location_id: { type: 'string' },
    mode: { type: 'string', enum: ['journey', 'teleport'] }
}, required: ['actor_id', 'to_location_id'] } } }, 'scene_draft_v3', { linkedRequired: true });
const input = 'I walk into the kitchen.';
const context = { turnId: 'turn_direct_move', input, playerLocation: 'hall',
    presentActorIds: [], references: [{ id: 'kitchen', name: 'kitchen', type: 'location' }],
    now: 0 };
const proposal = { protocol: 'scene_draft_v3', actions: [{ kind: 'travel',
    status: 'resolved', effects: { actor_move: [{ actor_id: 'player',
        to_location_id: 'kitchen', mode: 'teleport' }] },
    response: [{ text: 'You enter the kitchen.', events: [{ type: 'movement',
        actor_id: 'player', status: 'completed', from_location_id: 'hall',
        to_location_id: 'kitchen', movement_mode: 'voluntary' }] }] }] };
const bound = binding.bind(proposal, context, schema);
assert(bound.ok, JSON.stringify(bound.errors));
assert.equal(bound.draft.actions[0].action_effects.actor_move[0].mode, undefined);
assert(bound.binding.repairs.some(repair => repair.type === 'ordinary_move_mode'));
const unlabeledMove = structuredClone(proposal);
delete unlabeledMove.actions[0].response[0].events[0].movement_mode;
const unlabeledBound = binding.bind(unlabeledMove, context, schema);
assert(unlabeledBound.ok, JSON.stringify(unlabeledBound.errors));
assert.equal(unlabeledBound.draft.actions[0].action_effects.actor_move[0].mode, undefined,
    'an unlabelled adjacent movement still uses directed route validation');
const missingWitness = structuredClone(proposal);
missingWitness.actions[0].response[0].events = [];
const preparedBound = binding.bind(missingWitness,
    { ...context, prepareCertainEffects: true }, schema);
assert(preparedBound.ok, JSON.stringify(preparedBound.errors));
assert.equal(preparedBound.draft.actions[0].action_effects.actor_move[0].mode, undefined,
    'a witness created after preparation must also clear an unsupported teleport label');
assert(preparedBound.draft.events.some(event => event.type === 'movement'
    && event.to_location_id === 'kitchen'));
const explicitTeleport = structuredClone(proposal);
explicitTeleport.actions[0].response[0].events[0].movement_mode = 'teleport';
explicitTeleport.actions[0].response[0].events[0].cause = 'a registered portal';
const teleportBound = binding.bind(explicitTeleport, context, schema);
assert(teleportBound.ok, JSON.stringify(teleportBound.errors));
assert.equal(teleportBound.draft.actions[0].action_effects.actor_move[0].mode,
    'teleport', 'an explicitly witnessed teleport retains its distinct rule');
const compiled = scene.compile(bound.draft, { input, location: 'hall', playerStart: 'hall',
    present: [], locations: ['hall', 'kitchen'], now: 0,
    linkedRequired: true, contract: schema });
assert(compiled.ok, JSON.stringify(compiled.errors));
const world = { id: 'movement_test', entities: [], locations: [
    { id: 'hall', name: 'Hall', exits: [{ targetLocationId: 'kitchen' }] },
    { id: 'kitchen', name: 'Kitchen', exits: [{ targetLocationId: 'hall' }] }] };
const session = { id: 'movement_save', playerLocation: 'hall', inventory: [],
    entityStates: {}, locationStates: {}, npcRelationships: {}, engineEvents: [],
    worldStateVersion: 1 };
const result = linked.executeLinkedActions(compiled.linkedPlan, world, session);
assert(result.ok, JSON.stringify(result.errors));
assert.equal(result.working.getSession('playerLocation'), 'kitchen');
const blocked = linked.executeLinkedActions(compiled.linkedPlan,
    { ...world, locations: [{ id: 'hall', name: 'Hall', exits: [] }, world.locations[1]] },
    structuredClone(session));
assert.equal(blocked.outcomes.get(compiled.linkedPlan.actions[0].action_id), 'blocked');
assert.match(blocked.narrative, /not possible under the current conditions/,
    'a reducer-blocked action has a safe continuation without success prose');
assert(!blocked.narrative.includes('You enter the kitchen'),
    'a blocked action must not repeat uncommitted success');
for (let index = 0; index < 9; index++) {
    const from = `origin_${index}`, to = `destination_${index}`;
    const request = `I walk into Destination ${index}.`;
    const candidate = structuredClone(proposal);
    candidate.actions[0].effects.actor_move[0].to_location_id = to;
    delete candidate.actions[0].response[0].events[0].movement_mode;
    candidate.actions[0].response[0].events[0].from_location_id = from;
    candidate.actions[0].response[0].events[0].to_location_id = to;
    candidate.actions[0].response[0].text = `You arrive at Destination ${index}.`;
    const boundCandidate = binding.bind(candidate, { ...context, input: request,
        playerLocation: from, references: [{ id: to,
            name: `Destination ${index}`, type: 'location' }] }, schema);
    assert(boundCandidate.ok, JSON.stringify(boundCandidate.errors));
    const draft = scene.compile(boundCandidate.draft, { input: request, location: from,
        playerStart: from, present: [], locations: [from, to], now: 0,
        linkedRequired: true, contract: schema });
    assert(draft.ok, JSON.stringify(draft.errors));
    const hasDirectedExit = index % 3 !== 0;
    const generatedWorld = { id: `generated_${index}`, entities: [], locations: [
        { id: from, exits: hasDirectedExit ? [{ targetLocationId: to }] : [] },
        { id: to, exits: [{ targetLocationId: from }] }
    ] };
    const generatedSession = { ...structuredClone(session), playerLocation: from };
    const executed = linked.executeLinkedActions(draft.linkedPlan,
        generatedWorld, generatedSession);
    assert(executed.ok, JSON.stringify(executed.errors));
    assert.equal(executed.outcomes.get(draft.linkedPlan.actions[0].action_id),
        hasDirectedExit ? 'succeeded' : 'blocked');
    assert.equal(executed.working.getSession('playerLocation'),
        hasDirectedExit ? to : from);
}
console.log('PASS direct movement uses route checks; inaccessible route blocks');
