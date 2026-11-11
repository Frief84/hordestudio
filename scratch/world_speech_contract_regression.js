'use strict';
const assert = require('node:assert/strict');
const scene = require('../worlds/scene-draft');
const binding = require('../worlds/turn-binding');

const canonical = scene.schema({ events: { type: 'array', items: { type: 'object',
    properties: { type: { type: 'string' }, actor_id: { type: 'string' },
        status: { type: 'string' } }, required: ['type', 'actor_id', 'status'] } } },
'scene_draft_v3', { linkedRequired: true });
const context = { turnId: 'turn_speech_contract', input: '„Hallo.“',
    playerLocation: 'room', presentActorIds: [], references: [], now: 0 };
const proposal = { protocol: 'scene_draft_v3', actions: [{ kind: 'speech',
    status: 'resolved', effects: [], response: [{ text: 'Du sagst: „Hallo.“' }],
    speech: [{ speaker: 'player', listeners: [], quote: 'Hallo.' }] }] };
const bound = binding.bind(proposal, context, canonical);
assert(bound.ok, JSON.stringify(bound.errors));
assert.equal(bound.draft.speech.length, 1);
assert.deepEqual(bound.draft.speech[0].listeners, []);
assert(bound.binding.repairs.some(repair => repair.type === 'nest_action_speech'));
assert.equal(proposal.actions[0].speech.length, 1, 'binding must not mutate the model draft');
const compiled = scene.compile(bound.draft, { input: context.input, location: 'room',
    playerStart: 'room', present: [], locations: ['room'], now: 0,
    linkedRequired: true, contract: canonical });
assert(compiled.ok, JSON.stringify(compiled.errors));
assert.equal(compiled.receipt.events.filter(event => event.type === 'observation').length, 0);
const invalid = structuredClone(proposal);
invalid.actions[0].speech[0].listeners = ['absent'];
const rejected = binding.bind(invalid, context, canonical);
assert(rejected.ok, JSON.stringify(rejected.errors));
assert(scene.compile(rejected.draft, { input: context.input, location: 'room',
    playerStart: 'room', present: [], locations: ['room'], now: 0,
    linkedRequired: true, contract: canonical }).errors.some(error =>
    error.reason === 'invalid_witnessed_speech'));
const assertionInput = 'I am the light of the world. I bring hope.';
const assertion = binding.bind({ protocol: 'scene_draft_v3', actions: [{
    kind: 'speech', status: 'resolved', effects: [],
    response: [{ text: `Du sagst: „${assertionInput}“ The room falls quiet.`,
        speech: [{ speaker: 'player', listeners: [], quote: assertionInput }] }] }] },
{ ...context, input: assertionInput }, canonical);
assert(assertion.ok, JSON.stringify(assertion.errors));
assert.equal(assertion.draft.actions.length, 1,
    'several clauses in one spoken assertion are one speech action');
const unquoted = binding.bind({ protocol: 'scene_draft_v3', actions: [{
    kind: 'speech', status: 'resolved', effects: [], response: [{
        text: 'Linda replies, "Who are you?"',
        speech: [{ speaker: 'linda', listeners: ['player'], quote: 'Who are you?' }]
    }] }] }, { ...context, input: assertionInput,
    references: [{ id: 'linda', name: 'Linda', type: 'npc' }] }, canonical);
assert(!unquoted.ok && unquoted.errors.some(error =>
    error.reason === 'missing_player_speech_evidence'),
'an NPC reply cannot certify an omitted unquoted player utterance');
const partialUtterance = binding.bind({ protocol: 'scene_draft_v3', actions: [{
    kind: 'speech', status: 'resolved', effects: [], response: [{
        text: 'Du sagst: „I bring hope.“',
        speech: [{ speaker: 'player', listeners: [], quote: 'I bring hope.' }]
    }] }] }, { ...context, input: assertionInput }, canonical);
assert(!partialUtterance.ok && partialUtterance.errors.some(error =>
    error.reason === 'missing_player_speech_evidence'),
'one quoted fragment cannot certify the full unquoted speech');
const explicitlyBound = binding.bind({ protocol: 'scene_draft_v3', actions: [{
    kind: 'speech', status: 'resolved', effects: [], response: [{
        text: 'A listener turns toward you.',
        speech: [{ speaker: 'player', listeners: [], quote: assertionInput }]
    }] }] }, { ...context, input: assertionInput }, canonical);
assert(explicitlyBound.ok, JSON.stringify(explicitlyBound.errors));
assert(explicitlyBound.draft.narrative[0].text.includes(assertionInput));
assert(scene.compile(explicitlyBound.draft, { input: assertionInput,
    location: 'room', playerStart: 'room', present: [], locations: ['room'], now: 0,
    linkedRequired: true, contract: canonical }).ok,
'source-backed full player quote can be placed in its action passage');
const joinedQuote = binding.bind({ protocol: 'scene_draft_v3', actions: [{
    kind: 'speech', status: 'resolved', effects: [], response: [{
        text: `Du sagst: „${assertionInput}“ Linda replies, "Right," then adds "Who are you?"`,
        speech: [
            { speaker: 'player', listeners: ['linda'], quote: assertionInput },
            { speaker: 'linda', listeners: ['player'], quote: 'Right. Who are you?' }
        ] }] }] }, { ...context, input: assertionInput, presentActorIds: ['linda'],
    references: [{ id: 'linda', name: 'Linda', type: 'npc' }] }, canonical);
assert(joinedQuote.ok, JSON.stringify(joinedQuote.errors));
assert.deepEqual(joinedQuote.draft.speech.map(item => item.quote),
    [assertionInput, 'Right,', 'Who are you?']);
assert(joinedQuote.binding.repairs.some(item => item.type === 'split_joined_speech_quote'));
const inventedQuote = binding.bind({ protocol: 'scene_draft_v3', actions: [{
    kind: 'speech', status: 'resolved', effects: [], response: [{
        text: 'Linda says "Hello."', speech: [{ speaker: 'linda', listeners: ['player'],
            quote: 'A different sentence.' }] }] }] },
{ ...context, input: 'I ask Linda.', presentActorIds: ['linda'],
    references: [{ id: 'linda', name: 'Linda', type: 'npc' }] }, canonical);
assert(inventedQuote.ok, JSON.stringify(inventedQuote.errors));
assert(scene.compile(inventedQuote.draft, { input: 'I ask Linda.', location: 'room',
    playerStart: 'room', present: ['linda'], locations: ['room'], now: 0,
    linkedRequired: true, contract: canonical }).errors.some(error =>
    error.reason === 'speech_quote_not_in_passage'));
for (const input of ['"Hallo."', '„Hallo.“', '“Hello.”', '« Bonjour. »']) {
    const variant = binding.bind({ protocol: 'scene_draft_v3', actions: [{
        kind: 'speech', status: 'resolved', effects: [],
        response: [{ text: 'A pause follows.' }] }] },
    { ...context, input }, canonical);
    assert(variant.ok, `${input}: ${JSON.stringify(variant.errors)}`);
    assert.equal(variant.draft.speech.length, 1, input);
}
const persona = binding.bind({ protocol: 'scene_draft_v3', actions: [{
    kind: 'speech', status: 'resolved', effects: [], response: [{
        text: 'Jesus says, "Hello."', speech: [{ speaker: 'Jesus',
            listeners: ['Jesus'], quote: 'Hello.' }] }] }] },
{ ...context, input: '"Hello."', playerName: 'Jesus' }, canonical);
assert(persona.ok, JSON.stringify(persona.errors));
assert.equal(persona.draft.speech[0].speaker, 'player');
assert.deepEqual(persona.draft.speech[0].listeners, ['player']);
console.log('PASS speech contract: action nesting, no listener, unknown listener rejected');
