'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const client = require('../worlds/model-client');
const intent = require('../worlds/resolved-intent');
const { functionSource } = require('./app_source');
const input = 'Ich frage Jonas: „What are your plans? Und morgen?“';
const proposal = { protocol: 'resolved_intent_v1', steps: [{ source_quote: input,
    kind: 'question', target_ids: ['jonas'], utterance: 'What are your plans? Und morgen?' }] };
const json = JSON.stringify(proposal);
const envelopes = [
    { content: json },
    { content: '\n\uFEFF```json\n' + json + '\n```\n' },
    { content: [{ type: 'text', text: json.slice(0, 40) }, { type: 'text', text: json.slice(40) }] },
    { content: 'Here is the result.', tool_calls: [{ function: { name: 'resolved_intent_v1', arguments: json } }] },
    { content: null, function_call: { arguments: json } },
    { parsed: proposal },
    { content: json, reasoning_content: 'This must never become action data.' }
];
for (const message of envelopes) {
    const data = client.decodeCompletionBody(JSON.stringify({ choices: [{ message }] }));
    assert.deepEqual(client.structuredCompletion(data), proposal);
}
for (const [message, finish_reason, code] of [
    [{ content: '{broken' }, 'stop', 'WORLD_INTENT_INVALID_JSON'],
    [{ content: 'The answer is ' + json }, 'stop', 'WORLD_INTENT_INVALID_JSON'],
    [{ content: '', reasoning: json }, 'stop', 'WORLD_INTENT_EMPTY_RESPONSE'],
    [{ content: json }, 'length', 'WORLD_INTENT_TRUNCATED'],
    [{ refusal: 'Nein' }, 'stop', 'WORLD_INTENT_REFUSED'],
    [{ tool_calls: [{ function: { arguments: json } }, { function: { arguments: json } }] }, 'stop', 'WORLD_INTENT_AMBIGUOUS_RESPONSE']
]) assert.throws(() => client.structuredCompletion({ choices: [{ message, finish_reason }] }), { code });
assert(client.structuredFormatUnsupported({ status: 400 }, { error: { message: 'response_format json_schema is not supported' } }));
for (const status of [401, 429, 500, 504]) assert(!client.structuredFormatUnsupported({ status }, { error: 'response_format not supported' }));
assert(!client.structuredFormatUnsupported({ status: 400 }, { error: 'invalid schema properties' }));
const references = [{ id: 'jonas', name: 'Jonas' }, { id: 'apple', name: 'Apfel', type: 'item' }];
const branches = intent.schema().properties.steps.items.anyOf;
for (const kind of intent.kinds) assert(branches.some(branch => branch.properties.kind.const === kind));
const transferSchema = branches.find(branch => branch.properties.kind.const === 'transfer');
assert(transferSchema.required.includes('operation') && transferSchema.required.includes('item_id'));
assert.deepEqual(branches.filter(branch => branch.properties.kind.const === 'transfer')
    .map(branch => branch.properties.operation.const), ['take', 'drop', 'give', 'consume']);
assert.equal(transferSchema.properties.recipient_id, undefined);
assert(branches.find(branch => branch.properties.operation?.const === 'give').required.includes('recipient_id'));
assert.equal(transferSchema.properties.to_state, undefined);
assert.equal(transferSchema.properties.depends_on.minItems, 0);
const waitSchema = branches.find(branch => branch.properties.kind.const === 'wait');
assert(waitSchema.properties.minutes.anyOf.some(option => option.type === 'null'));
const errorText = vm.runInNewContext(`(${functionSource('humanizeApiError')})`, {});
for (const code of ['WORLD_MODEL_PROVIDER_ERROR', 'WORLD_MODEL_LOAD_FAILED', 'WORLD_MODEL_UNAVAILABLE',
    'WORLD_TURN_PERSISTENCE_FAILED', 'WORLD_MODEL_TIMEOUT']) {
    assert(!errorText({ code, message: 'Fehler beim Laden', status: 500 }, 'local').includes('Fehler'));
}
function normalize(input, steps) {
    return intent.normalizeProposal({ protocol: 'resolved_intent_v1', steps },
        { input, references, people: references.slice(0, 1) });
}
for (const text of ["Ich warte auf Jonas' Antwort.", 'I wait for Jonas to answer.']) {
    const checked = intent.validate(normalize(text, [{ source_quote: text, kind: 'wait' }]), { input: text, references });
    assert(checked.ok, JSON.stringify(checked.errors));
    assert.equal(checked.intent.steps[0].minutes, undefined);
}
const typography = normalize(input, [{ ...proposal.steps[0],
    source_quote: 'Ich frage Jonas: "What are your plans?  Und morgen?"',
    utterance: 'What are your plans?  Und morgen?', minutes: null }]);
assert.equal(typography.steps[0].source_quote, input);
assert.equal(typography.steps[0].utterance, proposal.steps[0].utterance);
assert(intent.validate(typography, { input, references }).ok);
assert.equal(intent.sourceSpan('Zoë sagt: „Grüße!“', 'Zoe\u0308 sagt: "Gru\u0308ße!"').end, 'Zoë sagt: „Grüße!“'.length);
const longInput = `Ich sage Jonas: „${'Heute sprechen wir über unsere Pläne. '.repeat(45)}What about tomorrow?“`;
const long = normalize(longInput, [{ source_quote: longInput, kind: 'speech', utterance: longInput.slice(16, -1) }]);
assert(intent.validate(long, { input: longInput, references }).ok);
const conditionalInput = 'I ask Jonas hello, then take the apple.';
const conditional = normalize(conditionalInput, [
    { source_quote: 'I ask Jonas', kind: 'context' },
    { source_quote: 'I ask Jonas hello', kind: 'question', utterance: 'hello' },
    { source_quote: 'then take the apple.', kind: 'transfer', operation: 'take', item_id: 'apple',
        depends_on: [{ step_index: 1, outcome: 'succeeded' }] }
]);
assert.equal(conditional.steps.length, 2);
assert.deepEqual(conditional.steps[1].depends_on, [{ step_index: 0, outcome: 'succeeded' }]);
assert(intent.validate(conditional, { input: conditionalInput, references }).ok);
for (const dependency of [{ step_index: 9, outcome: 'succeeded' }, { step_index: 0, outcome: 'failed' }]) {
    const invalid = normalize('Take the apple.', [{ source_quote: 'Take the apple.', kind: 'transfer',
        operation: 'take', item_id: 'apple', depends_on: [dependency] }]);
    assert(!intent.validate(invalid, { input: 'Take the apple.', references }).ok);
}
const unknown = normalize(input, [{ ...proposal.steps[0], target_ids: ['invented_person'] }]);
assert(!intent.validate(unknown, { input, references }).ok);
const nullDependency = normalize(input, [{ ...proposal.steps[0], depends_on: null }]);
assert(!intent.validate(nullDependency, { input, references }).ok);
const surplus = normalize('Take the apple.', [{ source_quote: 'Take the apple.', kind: 'transfer',
    operation: 'take', item_id: 'apple', recipient_id: 'invented_destination' }]);
assert.equal(surplus.steps[0].recipient_id, undefined);
assert(intent.validate(surplus, { input: 'Take the apple.', references }).ok);
const wrong = normalize('Take the apple.', [{ source_quote: 'Take the apple.', kind: 'transfer',
    operation: 'nehmen', item_id: 'invented_item' }]);
assert(!intent.validate(wrong, { input: 'Take the apple.', references }).ok);
const people = vm.runInNewContext(`(${functionSource('worldResolvedIntentPeople')})`, {
    sessionNpcs: world => world.entities, selectWorldNpcKnowledge: records => records
});
const npc = { id: 'jonas', name: 'Jonas', persona: 'Friendly' };
const oldSession = { history: [
    { role: 'dm', text: 'Jonas remembers the red scarf.', witnesses: ['jonas'] },
    { role: 'dm', text: 'A private secret.', witnesses: ['someone_else'] },
    { role: 'dm', text: 'Failed turn.', witnesses: ['jonas'], stateSource: 'frozen_no_receipt' },
    { role: 'dm', text: 'Legacy scene without witnesses.' }
] };
const session = { playerLocation: 'garden', entityStates: { jonas: { location: 'garden', observations: ['Old saved memory'] } } };
const before = JSON.stringify([oldSession, session]);
const context = people({ entities: [npc] }, oldSession, session, 'What about it?')[0];
assert.equal(context.conversation.length, 1);
assert.equal(context.conversation[0].text, 'Jonas remembers the red scarf.');
assert.equal(context.knowledge[0].text, 'Old saved memory');
assert.equal(JSON.stringify([oldSession, session]), before);
console.log('PASS shared completion envelopes, error categories, multilingual grounding, long speech, dependencies and legacy NPC memory');
