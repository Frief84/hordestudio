'use strict';
const assert = require('node:assert/strict');
const binding = require('../worlds/turn-binding');
const scene = require('../worlds/scene-draft');
const linked = require('../worlds/linked-world-actions');
const capture = require('./world-multi-action-qwen-2026-11-01.json');
const chair = require('./world-chair-c-engine-2026-11-01-r5.json')[0];
const fixture = JSON.parse(chair.bindingResponses[0].request);
const context = { ...fixture.context, turnId: 'isolated_qwen_label_replay',
    input: capture.input, playerName: '',
    references: fixture.context.references.filter(ref => ref.id !== 'chair') };
const bound = binding.bind(capture.proposal, context, fixture.canonical);
assert(bound.ok, JSON.stringify(bound.errors));
assert(bound.binding.repairs.some(item => item.type === 'normalize_activity_label'));
assert.deepEqual(bound.draft.events.filter(event => event.type === 'activity')
    .map(event => event.activity), ['kneeling', 'waving']);
assert.deepEqual(bound.draft.speech.map(item => item.quote), ['Hello.']);
const compiled = scene.compile(bound.draft, { input: capture.input, location: 'foyer',
    playerStart: 'foyer', present: ['linda'], locations: ['foyer', 'round'],
    now: 485, linkedRequired: true, contract: fixture.canonical });
assert(compiled.ok, JSON.stringify(compiled.errors));
const world = { id: 'isolated_qwen_label_replay',
    locations: [{ id: 'foyer', exits: [] }, { id: 'round', exits: [] }],
    entities: [{ id: 'linda', type: 'npc', name: 'Linda' }] };
const session = { id: 'isolated_qwen_label_replay', playerLocation: 'foyer',
    turnCount: 0, inventory: [], entityStates: { linda: { location: 'foyer' } },
    locationStates: {}, npcRelationships: {}, engineEvents: [], worldStateVersion: 1,
    worldClock: { absoluteMinutes: 485, turnCount: 0, bonusTimeMinutes: 0 } };
const executed = linked.executeLinkedActions(compiled.linkedPlan, world, session,
    { worldActionIds: bound.binding.worldActionIds });
assert(executed.ok, JSON.stringify(executed.errors));
assert.deepEqual([...executed.outcomes.values()], ['succeeded', 'succeeded', 'succeeded']);
assert.equal(executed.verifiedEvents.filter(event => event.type === 'activity').length, 2);
assert.equal(executed.confirmedEffects.length, 0);
const malformedSpeech = require('./world-multi-action-qwen-2026-11-01-r2.json');
const repairedSpeech = binding.bind(malformedSpeech.proposal,
    { ...context, turnId: 'isolated_qwen_empty_speech' }, fixture.canonical);
assert(repairedSpeech.ok, JSON.stringify(repairedSpeech.errors));
assert(repairedSpeech.binding.repairs.some(item => item.type === 'discard_unspoken_quote'));
assert.deepEqual(repairedSpeech.draft.speech.map(item => item.quote), ['Hello.']);
const gptOss = require('./world-multi-action-gpt-oss-2026-11-01.json');
const repairedFacts = binding.bind(gptOss.proposal,
    { ...context, turnId: 'isolated_gpt_oss_fact_replay' }, fixture.canonical);
assert(repairedFacts.ok, JSON.stringify(repairedFacts.errors));
assert.equal(repairedFacts.draft.actions.length, 3);
assert(repairedFacts.binding.repairs.filter(item =>
    item.type === 'discard_impossible_fact_reference').length >= 2);
assert(repairedFacts.draft.actions.every(action => !action.state_conditions?.length));
const gptCompiled = scene.compile(repairedFacts.draft, { input: gptOss.input,
    location: 'foyer', playerStart: 'foyer', present: ['linda'],
    locations: ['foyer', 'round'], now: 485, linkedRequired: true,
    contract: fixture.canonical });
assert(gptCompiled.ok, JSON.stringify(gptCompiled.errors));
const gptExecuted = linked.executeLinkedActions(gptCompiled.linkedPlan, world,
    structuredClone(session), { worldActionIds: repairedFacts.binding.worldActionIds });
assert(gptExecuted.ok, JSON.stringify(gptExecuted.errors));
assert.deepEqual([...gptExecuted.outcomes.values()],
    ['succeeded', 'succeeded', 'succeeded']);
const qwenCurrent = require('./world-multi-action-qwen-current-2026-11-01.json');
const split = binding.bind(qwenCurrent.proposal,
    { ...context, turnId: 'isolated_qwen_split' }, fixture.canonical);
assert(split.ok, JSON.stringify(split.errors));
assert.deepEqual(split.draft.actions.filter(action => action.request).map(action => action.kind),
    ['physical', 'physical', 'speech']);
assert.equal(split.draft.speech.length, 1);
assert.equal(split.draft.events.filter(event => event.actor_id === 'player'
    && event.type === 'activity').length, 2);
assert.equal(split.draft.events.filter(event => event.actor_id === 'player'
    && event.type === 'dialogue').length, 1);
const splitCompiled = scene.compile(split.draft, { input: qwenCurrent.input,
    location: 'foyer', playerStart: 'foyer', present: ['linda'],
    locations: ['foyer', 'round'], now: 485, linkedRequired: true,
    contract: fixture.canonical });
assert(splitCompiled.ok, JSON.stringify(splitCompiled.errors));
const splitExecuted = linked.executeLinkedActions(splitCompiled.linkedPlan, world,
    structuredClone(session), { worldActionIds: split.binding.worldActionIds });
assert(splitExecuted.ok, JSON.stringify(splitExecuted.errors));
assert.equal(splitExecuted.verifiedEvents.filter(event => event.actor_id === 'player'
    && event.status === 'completed').length, 3);
const mistral = require('./world-multi-action-mistral-2026-11-01.json');
const preserved = binding.bind(mistral.proposal,
    { ...context, turnId: 'isolated_mistral_graph_replay' }, fixture.canonical);
assert(!preserved.ok && preserved.errors.some(error =>
    error.reason === 'unverified_echoed_action'),
    'a misclassified physical clause must not commit as speech');
const gemmaPartial = require('./world-partial-gemma-live-2026-11-01.json');
const partialBound = binding.bind(gemmaPartial.proposal,
    { ...context, turnId: 'isolated_gemma_partial', input: gemmaPartial.input,
        prepareCertainEffects: true }, fixture.canonical);
assert(partialBound.ok, JSON.stringify(partialBound.errors));
const partialCompiled = scene.compile(partialBound.draft, { input: gemmaPartial.input,
    location: 'foyer', playerStart: 'foyer', present: ['linda'],
    locations: ['foyer', 'round'], now: 485, linkedRequired: true,
    contract: fixture.canonical });
assert(partialCompiled.ok, JSON.stringify(partialCompiled.errors));
const partialExecuted = linked.executeLinkedActions(partialCompiled.linkedPlan,
    world, structuredClone(session), { worldActionIds: partialBound.binding.worldActionIds,
        allowPartialRecovery: true });
assert(partialExecuted.ok, JSON.stringify(partialExecuted.errors));
assert.deepEqual([...partialExecuted.outcomes.values()],
    ['unresolved', 'unresolved', 'succeeded']);
assert.equal(partialExecuted.actionFailures[0].reason, 'unverified_action_success');
assert(partialExecuted.verifiedEvents.every(event => event.action_id
    !== partialBound.draft.actions[0].action_id));
console.log('PASS live-capture replays: Qwen field/speech repair, GPT-OSS fact repair, Mistral rejection');
