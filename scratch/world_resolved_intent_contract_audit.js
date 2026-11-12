'use strict';
const assert = require('node:assert/strict');
const intent = require('../worlds/resolved-intent');
const { playerRequestCoverage } = require('../worlds/scene-draft');
const binding = require('../worlds/turn-binding');
const scene = require('../worlds/scene-draft');
const linked = require('../worlds/linked-world-actions');
const { functionSource } = require('./app_source');
const vm = require('node:vm');
const references = ['player', 'kitchen', 'hall', 'garden', 'east_gallery', 'npc_mara', 'door_hall', 'brass_key']
    .map(id => ({ id, ...(id === 'brass_key' ? { type: 'item', name: 'brass key' } : {}) }));
const missingDependency = intent.validate({protocol:'resolved_intent_v1',steps:[
    {source_quote:'Try to enter the east gallery; ',kind:'travel',destination_id:'east_gallery'},
    {source_quote:'if that succeeds, take the brass key.',kind:'transfer',operation:'take',item_id:'brass_key',depends_on:[]}
]},{input:'Try to enter the east gallery; if that succeeds, take the brass key.',references});
assert(!missingDependency.ok && missingDependency.errors.some(e=>e.reason==='conditional_dependency_required'));

const cases = [
    { input: 'Pick up the brass key, pass through the hall door, and tell Mara “I am here.”',
        steps: [
            { source_quote: 'Pick up the brass key', kind: 'transfer', operation: 'take', item_id: 'brass_key' },
            { source_quote: 'pass through the hall door', kind: 'travel', destination_id: 'hall' },
            { source_quote: 'and tell Mara “I am here.”', kind: 'speech', utterance: 'I am here.' }
        ] },
    { input: 'Geh in den Garten, warte 10 Minuten und grüße Mara.',
        steps: [
            { source_quote: 'Geh in den Garten', kind: 'travel', destination_id: 'garden' },
            { source_quote: 'warte 10 Minuten', kind: 'wait', minutes: 10 },
            { source_quote: 'und grüße Mara', kind: 'speech', utterance: 'grüße Mara' }
        ] },
    { input: 'I am already in the hall; ask Mara about the storm.',
        steps: [
            { source_quote: 'I am already in the hall; ', kind: 'context' },
            { source_quote: 'ask Mara about the storm', kind: 'question', utterance: 'ask Mara about the storm' }
        ] }
];
for (const item of cases) {
    const checked = intent.validate({ protocol: 'resolved_intent_v1', steps: item.steps },
        { input: item.input, references });
    assert(checked.ok, JSON.stringify(checked.errors));
    assert(playerRequestCoverage(item.input,
        checked.intent.steps.map(step => ({ request: step.source_quote }))).ok);
}
assert.equal(intent.validate({ protocol: 'resolved_intent_v1', steps: [
    { source_quote: 'go to the lost place', kind: 'travel', destination_id: 'missing' }
] }, { input: 'go to the lost place', references }).ok, false);
assert.equal(intent.validate({ protocol: 'resolved_intent_v1', steps: [
    { source_quote: 'take the lost item', kind: 'transfer', operation: 'take', item_id: 'lost_item' }
] }, { input: 'take the lost item', references }).ok, false);
assert.equal(intent.validate({ protocol: 'resolved_intent_v1', steps: [
    { source_quote: 'go to the hall', kind: 'travel' }
] }, { input: 'go to the hall', references }).ok, false);
assert.equal(intent.validate({ protocol: 'resolved_intent_v1', steps: [
    { source_quote: 'ask Mara', kind: 'question' }
] }, { input: 'ask Mara', references }).ok, false);
assert.equal(intent.validate({ protocol: 'resolved_intent_v1', steps: [
    { source_quote: 'take the key', kind: 'transfer', operation: 'take', item_id: 'brass key' }
] }, { input: 'take the key', references: [...references,
    { id: 'rusty_key', name: 'brass key', type: 'item' }] }).errors[0].reason,
    'ambiguous_intent_item');
const noisySpeech = intent.normalizeProposal({ protocol: 'resolved_intent_v1', steps: [{
    source_quote: `tell Mara, 'I made it.'`, kind: 'speech',
    utterance: `I made it. 'I made it.' 'I made it.'`
}] }, { people: [{ id: 'npc_mara', name: 'Mara' }] });
assert.equal(noisySpeech.steps[0].utterance, 'I made it.');
assert.deepEqual(noisySpeech.steps[0].target_ids, ['npc_mara']);
assert(intent.validate(noisySpeech, { input: noisySpeech.steps[0].source_quote,
    references }).ok);
const noisyQuotedQuestion = intent.normalizeProposal({ protocol: 'resolved_intent_v1', steps: [
    { source_quote: 'enter the sealed door', kind: 'travel', destination_id: 'door_hall' },
    { source_quote: '"Have you seen the map?"', kind: 'speech', target_ids: ['npc_mara'],
        utterance: 'Have you seen the map?\n\nHave you seen the map?' }
] }, { input: 'Try to enter the sealed door, then ask Mara, "Have you seen the map?"', references });
assert.equal(noisyQuotedQuestion.steps[1].kind, 'question');
assert.equal(noisyQuotedQuestion.steps[1].source_quote, 'ask Mara, "Have you seen the map?"');
assert.equal(noisyQuotedQuestion.steps[1].utterance, 'Have you seen the map?');
const splitSpeechCue = intent.normalizeProposal({ protocol: 'resolved_intent_v1', steps: [
    { source_quote: 'Take the brass key', kind: 'transfer', operation: 'take', item_id: 'brass_key' },
    { source_quote: 'pass through the iron gate', kind: 'travel', destination_id: 'door_hall' },
    { source_quote: 'then tell Mara', kind: 'context', utterance: 'I made it.' },
    { source_quote: '"I made it."', kind: 'speech', target_ids: ['npc_mara'], utterance: 'I made it.' }
] }, { input: 'Take the brass key, pass through the iron gate, then tell Mara "I made it."',
    references, people: [{ id: 'npc_mara', name: 'Mara' }] });
assert.equal(splitSpeechCue.steps.length, 3);
assert.equal(splitSpeechCue.steps[2].source_quote, 'tell Mara "I made it."');
assert(intent.validate(splitSpeechCue, { input: 'Take the brass key, pass through the iron gate, then tell Mara "I made it."',
    references }).ok);
const appearance = { protocol: 'resolved_intent_v1', steps: [
    { source_quote: 'I put on the red cloak', kind: 'appearance', outfit: 'red cloak' },
    { source_quote: 'then sit by the fire.', kind: 'activity', activity: 'sit by the fire' }
] };
assert(intent.validate(appearance, { input: 'I put on the red cloak, then sit by the fire.',
    references }).ok);
assert(!intent.validate({ protocol: 'resolved_intent_v1', steps: [
    { source_quote: 'I put on a coat.', kind: 'appearance', outfit: 'silver armor' }
] }, { input: 'I put on a coat.', references }).ok);
const recoveredAppearance = intent.normalizeProposal({ protocol: 'resolved_intent_v1', steps: [
    { source_quote: 'I put on the silver armor', kind: 'other' }
] }, { input: 'I put on the silver armor', references });
assert.equal(recoveredAppearance.steps[0].kind, 'appearance');
assert.equal(recoveredAppearance.steps[0].outfit, 'silver armor');
const conditional = intent.normalizeProposal({ protocol: 'resolved_intent_v1', steps: [
    { source_quote: 'Try to enter the sealed east gallery', kind: 'travel',
        destination_id: 'east_gallery' },
    { source_quote: 'if that succeeds', kind: 'context' },
    { source_quote: 'take the brass key', kind: 'transfer', operation: 'take',
        item_id: 'brass_key', depends_on: [{ step_index: 0, outcome: 'succeeded' }] }
] }, { input: 'Try to enter the sealed east gallery; if that succeeds, take the brass key.', references });
assert(intent.validate(conditional, { input: 'Try to enter the sealed east gallery; if that succeeds, take the brass key.',
    references }).ok);
assert(!intent.validate({ protocol: 'resolved_intent_v1', steps: [
    { source_quote: 'Wave', kind: 'gesture', depends_on: [{ step_index: 0, outcome: 'succeeded' }] }
] }, { input: 'Wave', references }).ok);
const recoveredSpeechSpan = intent.normalizeProposal({ protocol: 'resolved_intent_v1', steps: [
    { source_quote: 'tell Mara', kind: 'speech', target_ids: ['npc_mara'], utterance: 'I am here.' }
] }, { input: 'Take key, tell Mara "I am here."', references });
assert.equal(recoveredSpeechSpan.steps[0].source_quote, 'tell Mara "I am here.');
assert(intent.validate(recoveredSpeechSpan, { input: 'Take key, tell Mara "I am here."',
    references }).ok);
const noisyFare = intent.normalizeProposal({ protocol: 'resolved_intent_v1', steps: [
    { source_quote: 'Take the ferry', kind: 'transfer',
        operation: 'consume', item_id: 'coins', quantity: 3 },
    { source_quote: 'Take the ferry', kind: 'travel', destination_id: 'market' }
] }, { input: 'Take the ferry to the market.', references: [...references,
    { id: 'market', name: 'Market' }] });
assert.equal(noisyFare.steps.length, 1);
assert.equal(noisyFare.steps[0].kind, 'travel');
assert.equal(noisyFare.steps[0].source_quote, 'Take the ferry to the market.');
assert(intent.validate(noisyFare, { input: noisyFare.steps[0].source_quote,
    references: [...references, { id: 'market', name: 'Market' }] }).ok);
assert.equal(intent.validate({ protocol: 'resolved_intent_v1', steps: [
    { source_quote: 'say hello', kind: 'speech', utterance: 'say goodbye' }
] }, { input: 'say hello', references }).ok, false);
assert.equal(intent.validate({ protocol: 'resolved_intent_v1', steps: [
    { source_quote: 'and speak', kind: 'speech', utterance: 'speak' },
    { source_quote: 'first move', kind: 'travel', destination_id: 'hall' }
] }, { input: 'first move and speak', references }).ok, false);

const failureBuilder = vm.runInNewContext(`(${functionSource('buildWorldResolvedIntentFailureDraft')})`, {
    worldOutputLanguage: () => 'de'
});
const fixture = JSON.parse(require('./world-chair-c-engine-2026-11-01-r5.json')[0]
    .bindingResponses[0].request);
const failedInput = 'Take the north road, then ask Mara about the bell.';
const fallback = failureBuilder(failedInput, {}, true);
assert.equal(fallback.safeFallback, true);
assert.equal(Object.keys(fallback.draft.actions[0].effects).length, 0);
assert.equal(fallback.draft.actions[0].response[0].events, undefined);
assert.match(fallback.draft.actions[0].response[0].text, /could not resolve this action/u);
const boundFallback = binding.bind(fallback.draft, { ...fixture.context,
    input: failedInput, turnId: 'resolved_intent_fail_closed', playerName: '',
    prepareCertainEffects: true }, fixture.canonical);
assert(boundFallback.ok, JSON.stringify(boundFallback.errors));
const compiledFallback = scene.compile(boundFallback.draft, { input: failedInput,
    location: fixture.context.playerLocation, playerStart: fixture.context.playerLocation,
    present: fixture.context.presentCharacterIds || [],
    locations: fixture.context.references.filter(ref => ref.type === 'location').map(ref => ref.name),
    now: fixture.context.now, linkedRequired: true, contract: fixture.canonical });
assert(compiledFallback.ok, JSON.stringify(compiledFallback.errors));
const fallbackLocation = fixture.context.playerLocation;
const fallbackWorld = { id: 'resolved_intent_fallback_fixture', locations: [
    { id: fallbackLocation, name: fallbackLocation, exits: [] }], entities: [] };
const fallbackSession = { id: 'resolved_intent_fallback_fixture', playerLocation: fallbackLocation,
    turnCount: 0, inventory: [], entityStates: {}, locationStates: {},
    worldClock: { absoluteMinutes: 0, turnCount: 0, bonusTimeMinutes: 0 } };
const beforeFallbackSession = JSON.parse(JSON.stringify(fallbackSession));
const executedFallback = linked.executeLinkedActions(compiledFallback.linkedPlan,
    fallbackWorld, fallbackSession, { worldActionIds: boundFallback.binding.worldActionIds });
assert(executedFallback.ok, JSON.stringify(executedFallback.errors));
assert.equal([...executedFallback.outcomes.values()][0], 'unresolved');
assert.deepEqual(fallbackSession, beforeFallbackSession);
const unboundFallback = failureBuilder(failedInput, {}, false);
const compiledUnboundFallback = scene.compile(unboundFallback.draft, { input: failedInput,
    location: fixture.context.playerLocation, playerStart: fixture.context.playerLocation,
    present: fixture.context.presentCharacterIds || [],
    locations: fixture.context.references.filter(ref => ref.type === 'location').map(ref => ref.name),
    now: fixture.context.now, linkedRequired: true, contract: fixture.canonical });
assert(compiledUnboundFallback.ok, JSON.stringify(compiledUnboundFallback.errors));

console.log(`PASS ResolvedIntent contract across ${cases.length} language/compound variants and invalid-reference guards`);
