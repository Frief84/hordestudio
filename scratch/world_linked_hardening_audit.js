'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const registry = require('../worlds/effect-registry');
const scene = require('../worlds/scene-draft');
const linked = require('../worlds/linked-world-actions');
const workingApi = require('../worlds/working-state');

const legacySchemas = { inventory_add: { type: 'array', items: { type: 'string' } } };
const capability = registry.capabilities({ legacySchemas });
const contract = scene.schema({ events: { type: 'array', items: { type: 'object',
    properties: { type: { type: 'string' }, actor_id: { type: 'string' },
        status: { type: 'string' } } } }, ...legacySchemas },
'scene_draft_v3', { linkedRequired: true, capability });
const expandedContract = scene.schema({ events: { type: 'array', items: { type: 'object',
    properties: { type: { type: 'string' }, actor_id: { type: 'string' },
        status: { type: 'string' } } } }, ...legacySchemas },
'scene_draft_v3', { linkedRequired: false, capability });
const withoutSchemaDescriptions = node => Array.isArray(node)
    ? node.map(withoutSchemaDescriptions) : node && typeof node === 'object'
        ? Object.fromEntries(Object.entries(node).filter(([key]) => key !== 'description')
            .map(([key, value]) => [key, key === 'properties' && value
                ? Object.fromEntries(Object.entries(value).map(([field, spec]) =>
                    [field, withoutSchemaDescriptions(spec)]))
                : withoutSchemaDescriptions(value)])) : node;
const compactEffects = contract.properties.actions.items.properties.action_effects;
assert.deepEqual(compactEffects, withoutSchemaDescriptions(
    expandedContract.properties.actions.items.properties.action_effects),
    'compact V3 may remove schema descriptions only, never fields, bounds or requirements');
assert.equal(compactEffects.properties.event_emit.items.properties.description.type, 'string');
assert(compactEffects.properties.event_emit.items.required.includes('description'));
assert.deepEqual(Object.keys(contract.properties.actions.items.properties.action_effects.properties).sort(),
    capability.names.slice().sort());
assert.deepEqual(linked.createWorldEffectRegistry(capability.legacyNames).types().sort(),
    capability.names.filter(name => name !== 'checks').sort());
for (const name of capability.nativeNames) {
    const descriptor = registry.technicalEffects.get(name);
    assert.equal(typeof descriptor.validate, 'function', `${name} must bind validation`);
    assert.equal(typeof descriptor.reduce, 'function', `${name} must bind execution`);
}
assert.throws(() => registry.capabilities({ protocol: 'scene_draft_v2', executionMode: 'legacy' }),
    error => error.code === 'derived_from_empty_schema' && error.stage === 'capability_derivation');
const empty = registry.capabilities({ protocol: 'scene_draft_v2', executionMode: 'legacy',
    legacySchemas, intentionallyEffectFree: true });
assert.equal(empty.status, 'intentionally_effect_free');
assert.deepEqual(empty.names, []);
const emptyContract = scene.schema({ events: { type: 'array' }, ...legacySchemas },
    'scene_draft_v2', { capability: empty });
assert.deepEqual(emptyContract.properties.effects.properties, {});

const world = { id: 'synthetic_archive', entities: [
    { id: 'key_1', name: 'Bronze key', type: 'item' },
    { id: 'guide_1', name: 'Guide', type: 'npc' }
], locations: [
    { id: 'foyer', name: 'Foyer', exits: [{ targetLocationId: 'archive', doorId: 'gate_1' }] },
    { id: 'archive', name: 'Archive', exits: [{ targetLocationId: 'foyer', doorId: 'gate_1' }] }
] };
const initial = { id: 'synthetic_save', playerLocation: 'foyer', inventory: [],
    unlockedExits: {}, entityStates: { player: { location: 'foyer' },
        key_1: { location: 'foyer' }, guide_1: { location: 'foyer', followingPlayer: true } },
    locationStates: {}, npcRelationships: {}, engineEvents: [], worldStateVersion: 1 };
const action = (id, status, action_effects = {}, depends_on = []) =>
    ({ action_id: id, kind: 'physical', status, action_effects, depends_on });
const run = (actions, events = [], options = {}) => linked.executeLinkedActions({ actions, events,
    narrative: actions.map(item => ({ action_id: item.action_id, text: item.action_id })) },
world, structuredClone(initial), options);
const unknown = run([action('strange', 'resolved', { impossible_effect: [{}] })]);
assert.equal(unknown.ok, false);
assert.equal(unknown.errors[0].code, 'unknown_technical_effect');
assert.equal(unknown.errors[0].effect, 'impossible_effect');
assert(unknown.errors[0].available.includes('actor_move'));
assert.equal(unknown.errors[0].action_id, 'strange');
assert.equal(unknown.errors[0].source, 'worlds/effect-registry.js');
const unsupported = run([action('move', 'resolved', { actor_move: [
    { actor_id: 'player', to_location_id: 'archive' }] })], [], { capability: empty });
assert.equal(unsupported.errors[0].code, 'unsupported_capability');
assert.deepEqual(unsupported.errors[0].available, []);
const invalidPayload = run([action('bad_shape', 'resolved', { actor_move: [
    { actor_id: 'player', to_location_id: 'archive', invented: true }] })]);
assert.equal(invalidPayload.errors[0].code, 'invalid_technical_effect');
assert.equal(invalidPayload.errors[0].stage, 'payload_validation');
for (const effects of [{}, { event_emit: [{ id: 'claim', type: 'claim',
    description: 'The model claims success.' }] }, {
    time_advance: [{ minutes: 1 }], event_emit: [{ id: 'claim',
        type: 'claim', description: 'The model claims success.' }] }]) {
    const unsupportedSuccess = run([action('claim', 'resolved', effects)]);
    assert.equal(unsupportedSuccess.ok, false);
    assert.equal(unsupportedSuccess.errors[0].code, 'unverified_action_success');
}
assert.equal(run([{ ...action('claim', 'resolved'), verifiedLocalInteraction: true }]).ok,
    false, 'a local-interaction flag without an observed event cannot prove success');
const uncommittedTravel = run([{ ...action('walk', 'resolved'), kind: 'travel' }], [
    { action_id: 'walk', type: 'movement', actor_id: 'player', status: 'completed',
        to_location_id: 'archive' }]);
assert.equal(uncommittedTravel.errors[0].code, 'unverified_action_success');
const effectFreeSpeech = linked.executeLinkedActions({ actions: [{
    ...action('speak', 'resolved'), kind: 'speech', request: 'That is the wrong answer.',
    response_id: 'spoken_reply' }], events: [], narrative: [{ id: 'spoken_reply',
    action_id: 'speak', text: 'The reply acknowledges the correction.' }] },
world, structuredClone(initial), { capability: empty });
assert(effectFreeSpeech.ok, JSON.stringify(effectFreeSpeech.errors));
assert.equal(effectFreeSpeech.outcomes.get('speak'), 'succeeded');
const unlinkedSpeech = run([{ ...action('claim', 'resolved'), kind: 'speech' }]);
assert.equal(unlinkedSpeech.errors[0].code, 'unverified_action_success');

const input = 'I wave.';
const draft = { protocol: 'scene_draft_v3', narrative: [
    { id: 'p1', action_id: 'wave', text: 'You wave to the guide.' } ],
    actions: [{ action_id: 'wave', kind: 'physical', status: 'resolved', response_id: 'p1',
        action_effects: {} }], events: [{ type: 'interaction', actor_id: 'player',
            status: 'completed', passage_id: 'p1' }], effects: {}, speech: [], commitments: [] };
const context = { input, linkedRequired: true, capability, contract,
    location: 'foyer', playerStart: 'foyer', present: ['guide_1'],
    locations: ['foyer', 'archive'], commitments: [], now: 0 };
const compoundInput = 'I tap the desk and wave to the guide.';
const compoundContract = scene.schema({ events: { type: 'array', items: { type: 'object',
    properties: { type: { type: 'string' }, actor_id: { type: 'string' },
        status: { type: 'string' } } } }, ...legacySchemas }, 'scene_draft_v3',
{ linkedRequired: true, capability, input: compoundInput });
assert(compoundContract.properties.actions.items.required.includes('request'));
const compoundDraft = { protocol: 'scene_draft_v3', narrative: [
    { id: 'tap_passage', action_id: 'tap', text: 'You tap the desk.' },
    { id: 'wave_passage', action_id: 'wave', text: 'You wave to the guide.' }],
    actions: [
        { action_id: 'tap', kind: 'physical', status: 'resolved',
            request: 'I tap the desk', response_id: 'tap_passage', action_effects: {} },
        { action_id: 'wave', kind: 'physical', status: 'resolved',
            request: 'and wave to the guide.', response_id: 'wave_passage', action_effects: {} }
    ], events: [
        { type: 'interaction', actor_id: 'player', status: 'completed',
            action_id: 'tap', passage_id: 'tap_passage' },
        { type: 'interaction', actor_id: 'player', status: 'completed',
            action_id: 'wave', passage_id: 'wave_passage' }
    ], effects: {}, speech: [], commitments: [] };
const compoundContext = { ...context, input: compoundInput, contract: compoundContract };
const missingCompoundRequest = scene.compile({ ...compoundDraft,
    actions: compoundDraft.actions.map(({ request, ...action }) => action) }, compoundContext);
assert(missingCompoundRequest.errors.some(error => error.reason === 'explicit_request_coverage_required'));
const compoundCompiled = scene.compile(compoundDraft, compoundContext);
assert(compoundCompiled.ok, JSON.stringify(compoundCompiled.errors));
const compoundResult = linked.executeLinkedActions(compoundCompiled.linkedPlan, world,
    structuredClone(initial), { capability });
assert(compoundResult.ok, JSON.stringify(compoundResult.errors));
assert.deepEqual(Object.fromEntries(compoundResult.outcomes),
    { tap: 'succeeded', wave: 'succeeded' });
const unlinkedInteraction = linked.executeLinkedActions({
    ...compoundCompiled.linkedPlan,
    events: compoundCompiled.linkedPlan.events.map((event, index) => index === 0
        ? { ...event, passage_id: 'wave_passage' } : event)
}, world, structuredClone(initial), { capability });
assert.equal(unlinkedInteraction.errors[0].code, 'unverified_action_success');
const repaired = scene.compile(draft, context);
assert(repaired.ok, JSON.stringify(repaired.errors));
assert.equal(repaired.linkedPlan.actions[0].verifiedLocalInteraction, true);
const localSuccess = linked.executeLinkedActions(repaired.linkedPlan, world,
    structuredClone(initial), { capability });
assert(localSuccess.ok, JSON.stringify(localSuccess.errors));
assert.equal(localSuccess.outcomes.get('wave'), 'succeeded');
const spokenInput = 'That is the wrong answer; do not forget your purpose.';
const spokenDraft = { protocol: 'scene_draft_v3', narrative: [{ id: 'reply',
    action_id: 'spoken_correction', text: 'The response acknowledges the correction.' }],
    actions: [{ action_id: 'spoken_correction', kind: 'speech', status: 'resolved',
        request: spokenInput, response_id: 'reply', action_effects: {} }],
    events: [], effects: {}, speech: [], commitments: [] };
for (const kind of ['speech', 'question', 'observation', 'other']) {
    const candidate = { ...spokenDraft, actions: [{ ...spokenDraft.actions[0], kind,
        status: kind === 'question' ? 'answered' : 'resolved' }] };
    const spokenCompiled = scene.compile(candidate, { ...context, input: spokenInput });
    assert(spokenCompiled.ok, JSON.stringify(spokenCompiled.errors));
    const spokenResult = linked.executeLinkedActions(spokenCompiled.linkedPlan, world,
        structuredClone(initial), { capability });
    assert(spokenResult.ok, JSON.stringify(spokenResult.errors));
    assert.equal(spokenResult.outcomes.get('spoken_correction'), 'succeeded');
}
const quotedInput = '"Well, really! What exactly is that supposed to mean, peculiar? Hmph. Ahem... Is there something we can help you with?"';
const quotedDraft = { ...spokenDraft, actions: [{ ...spokenDraft.actions[0],
    request: quotedInput }], events: [{ type: 'status', actor_id: 'guide_1',
    status: 'completed', action_id: 'spoken_correction', passage_id: 'reply' }] };
const quotedCompiled = scene.compile(quotedDraft, { ...context, input: quotedInput });
assert(quotedCompiled.ok, JSON.stringify(quotedCompiled.errors));
assert.deepEqual(quotedCompiled.linkedPlan.events, []);
assert.equal(quotedCompiled.repairCount, 1);
assert.equal(quotedCompiled.repairs[0].type, 'discard_uncommitted_speech_event');
const quotedOmittingEmptyFields = scene.compile({ ...quotedDraft, effects: undefined,
    actions: [{ ...quotedDraft.actions[0], action_effects: undefined }] },
{ ...context, input: quotedInput });
assert(quotedOmittingEmptyFields.ok, JSON.stringify(quotedOmittingEmptyFields.errors));
assert.equal(quotedOmittingEmptyFields.repairCount, 1);
const quotedResult = linked.executeLinkedActions(quotedCompiled.linkedPlan, world,
    structuredClone(initial), { capability });
assert(quotedResult.ok, JSON.stringify(quotedResult.errors));
const substantiveQuotedEvent = scene.compile({ ...quotedDraft, events: [{
    ...quotedDraft.events[0], next_status: 'gone' }] },
{ ...context, input: quotedInput, contract: null });
assert(substantiveQuotedEvent.ok, JSON.stringify(substantiveQuotedEvent.errors));
assert.equal(substantiveQuotedEvent.linkedPlan.events.length, 1,
    'a proposed lasting status change must not be discarded as speech');
const uncommittedStatus = linked.executeLinkedActions({
    actions: [{ ...spokenDraft.actions[0], request: quotedInput }],
    narrative: [{ id: 'reply', action_id: 'spoken_correction',
        text: 'The response acknowledges the correction.' }],
    events: [{ type: 'status', actor_id: 'guide_1', status: 'completed',
        next_status: 'gone', action_id: 'spoken_correction', passage_id: 'reply' }]
}, world, structuredClone(initial), { capability });
assert.equal(uncommittedStatus.errors[0].code, 'uncommitted_completed_event');
assert.equal(uncommittedStatus.errors[0].effect, 'status');
assert.equal(uncommittedStatus.errors[0].event_index, 0);
assert.deepEqual(uncommittedStatus.errors[0].requiredEffects, ['npc_status_changes']);
const unquotedReaction = { ...spokenDraft, events: [{ type: 'status', actor_id: 'guide_1',
    status: 'completed', action_id: 'spoken_correction', passage_id: 'reply' }] };
const unquotedCompiled = scene.compile(unquotedReaction, { ...context, input: spokenInput });
assert(unquotedCompiled.ok, JSON.stringify(unquotedCompiled.errors));
assert.deepEqual(unquotedCompiled.linkedPlan.events, [],
    'a payload-free NPC reaction in a speech response is narrative, not a completed change');
assert.equal(unquotedCompiled.repairCount, 1);
assert.equal(unquotedReaction.events.length, 1, 'the original model draft must remain untouched');
const unquotedResult = linked.executeLinkedActions(unquotedCompiled.linkedPlan, world,
    structuredClone(initial), { capability });
assert(unquotedResult.ok, JSON.stringify(unquotedResult.errors));
const aslanReply = `Aslan slowly raises his head, his faintly glowing golden eyes settling on the traveller.\n"How observant. And here I was, hoping to pass for a particularly handsome pebble."\nHe shifts slightly on his sun-warmed stone.\n"Tell me, traveller, do you often stop to insult the local wildlife, or am I receiving special treatment?"`;
const aslanConversation = { ...spokenDraft,
    narrative: [{ id: 'reply', action_id: 'spoken_correction', text: aslanReply }],
    events: [{ type: 'movement', actor_id: 'guide_1', status: 'completed',
        action: 'shifts slightly on his stone', action_id: 'spoken_correction',
        passage_id: 'reply' }] };
const aslanCompiled = scene.compile(aslanConversation,
    { ...context, input: spokenInput });
assert(aslanCompiled.ok, JSON.stringify(aslanCompiled.errors));
assert.deepEqual(aslanCompiled.linkedPlan.events, [],
    'a local shift in a speech response is narrative, not mapped travel');
assert(aslanCompiled.repairs.some(repair => repair.type === 'discard_uncommitted_speech_event'));
const aslanResult = linked.executeLinkedActions(aslanCompiled.linkedPlan, world,
    structuredClone(initial), { capability });
assert(aslanResult.ok, JSON.stringify(aslanResult.errors));
const aslanStatus = scene.compile({ ...aslanConversation, events: [{
    ...aslanConversation.events[0], type: 'status' }] },
{ ...context, input: spokenInput });
assert(aslanStatus.ok, JSON.stringify(aslanStatus.errors));
assert.deepEqual(aslanStatus.linkedPlan.events, [],
    'a temporary NPC pose must not become a lifecycle status change');
const mappedAslanMove = scene.compile({ ...aslanConversation, events: [{
    ...aslanConversation.events[0], from_location_id: 'foyer',
    to_location_id: 'archive' }] }, { ...context, input: spokenInput,
    contract: null });
assert(mappedAslanMove.ok, JSON.stringify(mappedAslanMove.errors));
assert.equal(mappedAslanMove.linkedPlan.events.length, 1,
    'a mapped NPC move must still require a validated effect');
const mappedAslanResult = linked.executeLinkedActions(mappedAslanMove.linkedPlan,
    world, structuredClone(initial), { capability });
assert.equal(mappedAslanResult.errors[0].code, 'uncommitted_completed_event');
const unquotedSubstantive = scene.compile({ ...unquotedReaction, events: [{
    ...unquotedReaction.events[0], next_status: 'gone' }] },
{ ...context, input: spokenInput, contract: null });
assert(unquotedSubstantive.ok, JSON.stringify(unquotedSubstantive.errors));
assert.equal(unquotedSubstantive.linkedPlan.events.length, 1,
    'a lasting NPC status change must not be silently removed');
const unquotedPlayerEvent = scene.compile({ ...unquotedReaction, events: [{
    ...unquotedReaction.events[0], actor_id: 'player' }] },
{ ...context, input: spokenInput, contract: null });
assert(unquotedPlayerEvent.ok, JSON.stringify(unquotedPlayerEvent.errors));
assert.equal(unquotedPlayerEvent.linkedPlan.events.length, 1,
    'a player event must not be silently removed from unquoted input');
const unquotedInventoryEvent = scene.compile({ ...unquotedReaction, events: [{
    ...unquotedReaction.events[0], type: 'inventory' }] },
{ ...context, input: spokenInput, contract: null });
assert(unquotedInventoryEvent.ok, JSON.stringify(unquotedInventoryEvent.errors));
assert.equal(unquotedInventoryEvent.linkedPlan.events.length, 1,
    'an inventory claim must not be silently removed from unquoted input');
const wrongActionReference = scene.compile({ ...unquotedReaction, events: [{
    ...unquotedReaction.events[0], action_id: 'nonexistent_action' }] },
{ ...context, input: spokenInput });
assert.equal(wrongActionReference.ok, false);
assert(wrongActionReference.errors.some(error => error.reason === 'unknown_action_reference'));
const forgedLocal = scene.compile({ ...draft, actions: [{ ...draft.actions[0],
    request: 'I open the sealed gate', verifiedLocalInteraction: true }] }, context);
assert.equal(forgedLocal.ok, false, 'model-authored proof fields must fail the contract');
assert.equal(repaired.repairCount, 1);
assert.deepEqual(repaired.repairs[0].original,
    { event_index: 0, passage_id: 'p1', action_id: null });
assert.deepEqual(repaired.repairs[0].corrected,
    { event_index: 0, passage_id: 'p1', action_id: 'wave' });
const compound = scene.compile({ ...draft, actions: [{ ...draft.actions[0],
    request: 'I wave then open the gate' }] },
    { ...context, input: 'I wave then open the gate' });
assert.equal(compound.ok, false);
assert(compound.errors.some(error => error.reason === 'unknown_action_reference'));
assert.equal(draft.events[0].action_id, undefined, 'compilation cannot alter model input');
const unsupportedDraft = scene.compile({ ...draft, actions: [{ ...draft.actions[0],
    action_effects: { imaginary_change: [{}] } }] }, context);
assert.equal(unsupportedDraft.errors[0].code, 'unsupported_capability');
assert.equal(unsupportedDraft.errors[0].effect, 'imaginary_change');
assert.equal(unsupportedDraft.errors[0].action_id, 'wave');

const undoProbe = registry.defineTechnicalEffect('audit_probe', {
    schema: { type: 'array', items: { type: 'object', properties: {
        value: { type: 'string' } }, required: ['value'], additionalProperties: false } },
    validate: value => typeof value?.value === 'string',
    reduce: (value, working) => {
        working.writeSession('auditProbe', field => { field.value = value.value; });
    }
});
try {
    const changed = registry.capabilities();
    assert(changed.names.includes('audit_probe'));
    const changedSchema = scene.schema({ events: { type: 'array' } }, 'scene_draft_v3',
        { linkedRequired: true, capability: changed });
    assert(changedSchema.properties.actions.items.properties.action_effects.properties.audit_probe);
    const result = run([action('probe', 'resolved', { audit_probe: [{ value: 'present' }] })],
        [], { capability: changed });
    assert(result.ok, JSON.stringify(result.errors));
    assert.equal(result.working.getSession('auditProbe'), 'present');
} finally { undoProbe(); }

const undoFailure = registry.defineTechnicalEffect('audit_fail', {
    schema: { type: 'array', items: { type: 'object' } }, validate: () => true,
    reduce: (value, working) => {
        working.writeSession('auditProbe', field => { field.value = 'unsafe'; });
        throw new Error('reducer_boom');
    }
});
try {
    const state = structuredClone(initial);
    const result = linked.executeLinkedActions({ actions: [
        action('first', 'resolved', { outfit_set: [{ actor_id: 'player', outfit: 'blue coat' }] }),
        action('second', 'resolved', { audit_fail: [{}] }) ], events: [], narrative: [] },
    world, state, { capability: registry.capabilities() });
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, 'reducer_boom');
    assert.equal(state.outfit, undefined);
    assert.equal(state.auditProbe, undefined);
} finally { undoFailure(); }
const undoFollowUp = registry.defineTechnicalEffect('audit_follow_up', {
    schema: { type: 'array', items: { type: 'object' } }, validate: () => true,
    reduce: (value, working) => {
        working.writeSession('auditProbe', field => { field.value = 'transient'; });
        return [{ type: 'missing_follow_up', payload: {} }];
    }
});
try {
    const state = structuredClone(initial);
    const result = linked.executeLinkedActions({ actions: [action('follow', 'resolved',
        { audit_follow_up: [{}] })], events: [], narrative: [] }, world, state,
    { capability: registry.capabilities() });
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, 'unknown_technical_effect');
    assert.equal(state.auditProbe, undefined);
} finally { undoFollowUp(); }
// Follow-up effects need both the triggering event and their own completed
// event. The callback is test-only; authored rules are not connected here.
const eventFollowUpPlan = { actions: [action('signal', 'resolved', {
    outfit_set: [{ actor_id: 'player', outfit: 'blue coat' }],
    event_emit: [{ id: 'signal', type: 'environment', description: 'A signal sounds.' }]
})], events: [
    { action_id: 'signal', type: 'outfit', actor_id: 'player', status: 'completed',
        outfit: 'blue coat' },
    { id: 'signal', action_id: 'signal', type: 'environment', actor_id: 'player', status: 'completed' }
], narrative: [{ action_id: 'signal', text: 'A signal sounds.' }] };
const emittedCondition = target_id => [{ type: 'condition_change',
    payload: { target_id, condition: 'alerted', action: 'add' } }];
const eventFollowUp = linked.executeLinkedActions(eventFollowUpPlan,
world, structuredClone(initial), { onEvent: () => emittedCondition('guide_1') });
assert.equal(eventFollowUp.ok, false, 'missing follow-up event evidence must remain detectable');
assert.equal(eventFollowUp.errors[0].reason, 'unwitnessed_follow_up_effect');
assert.deepEqual(eventFollowUp.confirmedEffects, []);
const withFollowUpEvents = structuredClone(eventFollowUpPlan);
withFollowUpEvents.events.push({ id: 'guide_alerted', action_id: 'signal', type: 'condition',
    actor_id: 'guide_1', status: 'completed', condition: 'alerted', action: 'add' });
const confirmedFollowUp = linked.executeLinkedActions(withFollowUpEvents,
world, structuredClone(initial), { onEvent: () => emittedCondition('guide_1') });
assert(confirmedFollowUp.ok, JSON.stringify(confirmedFollowUp.errors));
assert(confirmedFollowUp.working.getEntity('guide_1').state.conditions.includes('alerted'));
const confirmedCondition = confirmedFollowUp.confirmedEffects.find(effect =>
    effect.type === 'condition_change');
assert.equal(confirmedCondition.cause_event_id, 'signal');
assert.deepEqual(confirmedCondition.event_indices, [2]);
assert.deepEqual(confirmedCondition.payload,
    { target_id: 'guide_1', condition: 'alerted', action: 'add' });
const missingCause = structuredClone(withFollowUpEvents);
delete missingCause.events[1].id;
const rejectedCause = linked.executeLinkedActions(missingCause,
world, structuredClone(initial), { onEvent: () => emittedCondition('guide_1') });
assert.equal(rejectedCause.errors[0].reason, 'unwitnessed_follow_up_cause');
const wrongEffectProof = structuredClone(withFollowUpEvents);
wrongEffectProof.events[2].condition = 'unrelated';
const rejectedProof = linked.executeLinkedActions(wrongEffectProof,
world, structuredClone(initial), { onEvent: () => emittedCondition('guide_1') });
assert.equal(rejectedProof.errors[0].reason, 'unwitnessed_follow_up_effect');
const repeatedEventId = structuredClone(withFollowUpEvents);
repeatedEventId.events[2].id = 'signal';
const rejectedAmbiguity = linked.executeLinkedActions(repeatedEventId,
world, structuredClone(initial), { onEvent: () => emittedCondition('guide_1') });
assert.equal(rejectedAmbiguity.errors[0].reason, 'unwitnessed_follow_up_cause');
const multiplePlan = structuredClone(withFollowUpEvents);
multiplePlan.events.push({ id: 'guide_ready', action_id: 'signal', type: 'condition',
    actor_id: 'guide_1', status: 'completed', condition: 'ready', action: 'add' });
const multiple = linked.executeLinkedActions(multiplePlan, world, structuredClone(initial),
    { onEvent: () => [...emittedCondition('guide_1'), { type: 'condition_change',
        payload: { target_id: 'guide_1', condition: 'ready', action: 'add' } }] });
assert(multiple.ok, JSON.stringify(multiple.errors));
assert.deepEqual(multiple.confirmedEffects.filter(effect => effect.origin === 'reducer')
    .map(effect => effect.event_indices[0]), [2, 3]);
const duplicate = linked.executeLinkedActions(withFollowUpEvents, world, structuredClone(initial),
    { onEvent: () => [...emittedCondition('guide_1'), ...emittedCondition('guide_1')] });
assert.equal(duplicate.errors[0].reason, 'duplicate_follow_up_effect');
const directHookWrite = linked.executeLinkedActions(withFollowUpEvents, world,
    structuredClone(initial), { onEvent: (_event, working) => {
        working.writeEntity('guide_1', holder => { holder.state.conditions = ['alerted']; });
        return [];
    } });
assert.equal(directHookWrite.errors[0].reason, 'untracked_event_hook_mutation');
assert.deepEqual(directHookWrite.confirmedEffects, []);
const blockedFollowUp = linked.executeLinkedActions({ actions: [
    action('gate', 'blocked', { actor_move: [{ actor_id: 'player',
        to_location_id: 'archive' }] }), { ...withFollowUpEvents.actions[0], depends_on: [
        { action_id: 'gate', outcome: 'succeeded' }] }], events: withFollowUpEvents.events,
    narrative: withFollowUpEvents.narrative }, world, structuredClone(initial),
{ onEvent: () => emittedCondition('guide_1'), canMove: () => ({ ok: false, reason: 'locked_exit' }) });
assert(blockedFollowUp.ok, JSON.stringify(blockedFollowUp.errors));
assert.equal(blockedFollowUp.outcomes.get('signal'), 'skipped');
assert.equal(blockedFollowUp.working.getEntity('guide_1').state.conditions, undefined);
// Optional authored rule: a completed, actor-scoped signal alerts its exact
// target. The target comes from structured event data, never from prose.
const playWorld = structuredClone(world);
playWorld.entities.push({ id: 'watcher_1', name: 'Watcher', type: 'npc' });
playWorld.eventRules = [{ id: 'raise_alert', on: { type: 'outfit', outfit: 'signal sash' },
    when: [{ fact: 'actor_at', subject_id: 'player', operator: 'equals', value: 'foyer' }],
    effect: { type: 'condition_change', payload: {
        target_id: { event_field: 'actor_id' }, condition: 'alerted', action: 'add' } },
    result_event: { type: 'condition', actor_id: { event_field: 'actor_id' },
        condition: 'alerted', action: 'add' } }];
const playInitial = structuredClone(initial);
playInitial.entityStates.watcher_1 = { location: 'foyer', observations: [] };
const npcSignal = { worldActionIds: ['signal'] };
const signalPlan = (targets, status = 'resolved', emit = true) => ({ actions: [action('signal', status,
    { outfit_set: targets.map(actor_id => ({ actor_id, outfit: 'signal sash' })),
        ...(emit ? { event_emit: targets.map((_, index) => ({ id: `notice_${index + 1}`,
            type: 'outfit', description: 'A signal sash is donned.' })) } : {}) })],
    events: status === 'resolved' ? targets.map((target_id, index) => ({
        id: `notice_${index + 1}`, action_id: 'signal', type: 'outfit',
        actor_id: target_id, outfit: 'signal sash', status: 'completed' })) : [],
    narrative: [{ action_id: 'signal', text: 'The signal sash is donned.' }] });
const playable = linked.executeLinkedActions(signalPlan(['guide_1']), playWorld,
    structuredClone(playInitial), npcSignal);
assert(playable.ok, JSON.stringify(playable.errors));
assert(playable.working.getEntity('guide_1').state.conditions.includes('alerted'));
assert.equal(playable.working.getEntity('watcher_1').state.conditions, undefined);
assert.equal(playable.confirmedEffects.find(effect => effect.type === 'condition_change')
    .cause_event_id, 'notice_1');
assert(playable.events.some(event => event.id === 'notice_1_raise_alert'
    && event.actor_id === 'guide_1'));
const twoSignals = linked.executeLinkedActions(signalPlan(['guide_1', 'watcher_1']),
    playWorld, structuredClone(playInitial), npcSignal);
assert(twoSignals.ok, JSON.stringify(twoSignals.errors));
assert(twoSignals.working.getEntity('guide_1').state.conditions.includes('alerted'));
assert(twoSignals.working.getEntity('watcher_1').state.conditions.includes('alerted'));
assert.deepEqual(twoSignals.confirmedEffects.filter(effect => effect.type === 'condition_change')
    .map(effect => effect.cause_event_id), ['notice_1', 'notice_2']);
const independentSignals = linked.executeLinkedActions(
    signalPlan(['guide_1', 'watcher_1'], 'resolved', false),
    playWorld, structuredClone(playInitial), npcSignal);
assert(independentSignals.ok, JSON.stringify(independentSignals.errors));
assert(independentSignals.working.getEntity('guide_1').state.conditions.includes('alerted'));
assert(independentSignals.working.getEntity('watcher_1').state.conditions.includes('alerted'));
assert.deepEqual(independentSignals.confirmedEffects
    .filter(effect => effect.type === 'condition_change')
    .map(effect => [effect.cause_event_id, independentSignals.events[effect.event_indices[0]].id]),
    [['notice_1', 'notice_1_raise_alert'], ['notice_2', 'notice_2_raise_alert']]);
const unprovedIndependent = signalPlan(['guide_1'], 'resolved', false);
unprovedIndependent.events = [];
const missingIndependentProof = linked.executeLinkedActions(unprovedIndependent,
    playWorld, structuredClone(playInitial), npcSignal);
assert.equal(missingIndependentProof.ok, false);
assert.deepEqual(missingIndependentProof.confirmedEffects, []);
const brokenRuleWorld = structuredClone(playWorld);
brokenRuleWorld.eventRules[0].effect.payload.target_id = 'missing_npc';
const invalidRuleTarget = linked.executeLinkedActions(signalPlan(['guide_1']),
    brokenRuleWorld, structuredClone(playInitial), npcSignal);
assert.equal(invalidRuleTarget.ok, false);
assert.deepEqual(invalidRuleTarget.confirmedEffects, []);
const forgedCause = signalPlan(['guide_1']);
delete forgedCause.actions[0].action_effects.outfit_set;
const rejectedCauseRule = linked.executeLinkedActions(forgedCause, playWorld,
    structuredClone(playInitial), npcSignal);
assert.equal(rejectedCauseRule.errors[0].reason, 'uncommitted_completed_event');
const blockedRulePlan = signalPlan(['guide_1'], 'blocked', false);
blockedRulePlan.actions[0].state_conditions = [
    { fact: 'actor_at', subject_id: 'player', operator: 'equals', value: 'archive' }];
const blockedRule = linked.executeLinkedActions(blockedRulePlan, playWorld,
    structuredClone(playInitial), npcSignal);
assert(blockedRule.ok, JSON.stringify(blockedRule.errors));
assert.equal(blockedRule.outcomes.get('signal'), 'blocked');
assert.equal(blockedRule.working.getEntity('guide_1').state.conditions, undefined);
const unmetRuleSession = structuredClone(playInitial);
unmetRuleSession.playerLocation = 'archive';
unmetRuleSession.entityStates.player.location = 'archive';
const unmetRule = linked.executeLinkedActions(signalPlan(['guide_1']), playWorld,
    unmetRuleSession, npcSignal);
assert(unmetRule.ok, JSON.stringify(unmetRule.errors));
assert.equal(unmetRule.working.getEntity('guide_1').state.conditions, undefined);
const wrongRuleProofWorld = structuredClone(playWorld);
wrongRuleProofWorld.eventRules[0].result_event.condition = 'unrelated';
const wrongRuleProof = linked.executeLinkedActions(signalPlan(['guide_1'], 'resolved', false),
    wrongRuleProofWorld, structuredClone(playInitial), npcSignal);
assert.equal(wrongRuleProof.errors[0].reason, 'unwitnessed_follow_up_effect');
const duplicateSignal = signalPlan(['guide_1']);
duplicateSignal.actions[0].action_effects.event_emit.push(
    structuredClone(duplicateSignal.actions[0].action_effects.event_emit[0]));
const duplicateRule = linked.executeLinkedActions(duplicateSignal, playWorld,
    structuredClone(playInitial), npcSignal);
assert.equal(duplicateRule.errors[0].reason, 'duplicate_event_rule_trigger');
const noRuleWorld = structuredClone(playWorld);
delete noRuleWorld.eventRules;
const noRule = linked.executeLinkedActions(signalPlan(['guide_1']), noRuleWorld,
    structuredClone(playInitial), npcSignal);
assert(noRule.ok, JSON.stringify(noRule.errors));
assert.equal(noRule.working.getEntity('guide_1').state.conditions, undefined);
for (const options of [{ worldModules: { conditions: false }, onEvent: () => emittedCondition('guide_1') },
    { onEvent: () => emittedCondition('missing_npc') }]) {
    const source = structuredClone(initial);
    const rejected = linked.executeLinkedActions(withFollowUpEvents, world, source, options);
    assert.equal(rejected.ok, false, JSON.stringify(rejected.errors));
    assert.equal(source.outfit, undefined, 'a rejected follow-up rolls the whole plan back');
    assert.equal(source.entityStates.guide_1.conditions, undefined);
}
const partial = run([
    action('dress', 'resolved', { outfit_set: [{ actor_id: 'player', outfit: 'blue coat' }] }),
    action('enter', 'blocked', { actor_move: [{ actor_id: 'player', to_location_id: 'archive' }] })
], [], { canMove: () => ({ ok: false, reason: 'locked_exit' }) });
assert(partial.ok, JSON.stringify(partial.errors));
assert.equal(partial.working.getSession('outfit'), 'blue coat');
assert.equal(partial.working.getSession('playerLocation'), 'foyer');
assert.deepEqual(Object.fromEntries(partial.outcomes), { dress: 'succeeded', enter: 'blocked' });
const companionDenied = run([action('enter', 'blocked', { actor_move: [
    { actor_id: 'player', to_location_id: 'archive' }] })], [], {
    canMove: (view, state, actor) => ({ ok: actor === 'player', reason: 'npc_access_denied' }) });
assert(companionDenied.ok, JSON.stringify(companionDenied.errors));
assert.equal(companionDenied.working.getEntity('guide_1').state.location, 'foyer');
const stacked = structuredClone(initial);
stacked.inventory = [{ id: 'key_1', name: 'Bronze key', quantity: 2 }];
stacked.entityStates.key_1.location = '';
const impossibleDrop = linked.executeLinkedActions({ actions: [action('drop', 'blocked', {
    item_transfer: [{ item_id: 'key_1', from_id: 'player', to_id: 'foyer', quantity: 2 }]
})], events: [], narrative: [] }, world, stacked);
assert(impossibleDrop.ok, JSON.stringify(impossibleDrop.errors));
assert.equal(impossibleDrop.working.getSession('inventory')[0].quantity, 2);
assert.equal(impossibleDrop.working.getEntity('key_1').state.location, '');

const canMove = (view, state, actor, from, to) => ({ ok: !!state.unlockedExits?.gate_1
    && from === 'foyer' && to === 'archive', reason: 'locked_exit' });
const plan = [
    action('take', 'resolved', { item_transfer: [{ item_id: 'key_1', from_id: 'foyer',
        to_id: 'player' }] }),
    action('open', 'resolved', { interactable_transition: [{ target_id: 'gate_1', to_state: 'open' }] }),
    action('enter', 'resolved', { actor_move: [{ actor_id: 'player', to_location_id: 'archive' }] }),
    action('trust', 'resolved', { relation_set: [{ subject_id: 'guide_1',
        target_id: 'player', value: 25 }], event_emit: [{ id: 'archive_seen',
        type: 'discovery', description: 'The archive is reached.' }] })
];
const events = [{ type: 'movement', status: 'completed', action_id: 'enter',
    actor_id: 'player', to_location_id: 'archive' }];
const state = structuredClone(initial);
const result = linked.executeLinkedActions({ actions: plan, events,
    narrative: plan.map(item => ({ action_id: item.action_id, text: item.action_id })) },
world, state, { canMove });
assert(result.ok, JSON.stringify(result.errors));
const candidate = result.working.prepare();
const receipt = { scene: { player_location_id: candidate.session.playerLocation },
    events: result.events };
assert(workingApi.assertWorldModelInvariants(world, state, candidate));
assert(workingApi.assertReceiptMatchesCandidate(receipt, candidate));
assert(workingApi.assertReceiptMatchesCandidate({ scene: receipt.scene, events: [
    { type: 'movement', status: 'completed', actor_id: 'player', to_location_id: 'foyer' },
    ...result.events
] }, candidate), 'only the final completed move must match the final canonical location');
assert.throws(() => workingApi.assertReceiptMatchesCandidate({ scene: {
    player_location_id: 'foyer' }, events: result.events }, candidate),
    /receipt_state_mismatch/);
const invalidLocation = { ...candidate, session: { ...candidate.session,
    entityStates: { ...candidate.session.entityStates,
        guide_1: { ...candidate.session.entityStates.guide_1, location: 'nowhere' } } },
    dirtySet: new Set(['entity:guide_1']) };
assert.throws(() => workingApi.assertWorldModelInvariants(world, state, invalidLocation),
    /unknown_entity_location/);
const normalizeSnapshot = value => {
    if (Array.isArray(value)) return value.map(normalizeSnapshot);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !['generatedAt', 'worldStateVersion', 'durationMs'].includes(key))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, normalizeSnapshot(entry)]));
};
const snapshot = {
    positions: Object.fromEntries(Object.entries(candidate.session.entityStates)
        .map(([id, value]) => [id, value.location || '']).sort(([a], [b]) => a.localeCompare(b))),
    playerLocation: candidate.session.playerLocation,
    inventory: candidate.session.inventory,
    relationships: candidate.session.npcRelationships,
    objectStates: Object.fromEntries(Object.entries(candidate.session.entityStates)
        .filter(([, value]) => value.interactableState).map(([id, value]) => [id, value.interactableState])),
    doors: candidate.session.unlockedExits,
    events: { emitted: candidate.session.engineEvents, receipt: result.events },
    actionResults: Object.fromEntries(result.outcomes), generatedAt: Date.now(),
    worldStateVersion: candidate.session.worldStateVersion
};
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures',
    'world_linked_turn_snapshot.json'), 'utf8'));
assert.deepEqual(normalizeSnapshot(snapshot), normalizeSnapshot(golden));

(async () => {
    const playSave = structuredClone(playInitial);
    const firstTurn = linked.executeLinkedActions(signalPlan(['guide_1']),
        playWorld, playSave, npcSignal);
    assert(firstTurn.ok, JSON.stringify(firstTurn.errors));
    let playDurable;
    await firstTurn.working.commit(async candidate => {
        playDurable = structuredClone(candidate.session);
    }, 1);
    const reloadedWorld = JSON.parse(JSON.stringify(playWorld));
    const reloadedSession = JSON.parse(JSON.stringify(playDurable));
    const nextTurn = linked.executeLinkedActions({ actions: [{
        ...action('respond', 'resolved', { outfit_set: [
            { actor_id: 'player', outfit: 'alert patrol coat' }] }),
        state_conditions: [{ fact: 'condition', subject_id: 'guide_1',
            operator: 'exists', value: 'alerted' }] }], events: [
        { action_id: 'respond', type: 'outfit', actor_id: 'player',
            status: 'completed', outfit: 'alert patrol coat' }], narrative: [] },
    reloadedWorld, reloadedSession);
    assert(nextTurn.ok, JSON.stringify(nextTurn.errors));
    assert.equal(nextTurn.outcomes.get('respond'), 'succeeded');
    assert.equal(nextTurn.working.getEntity('watcher_1').state.conditions, undefined);
    const failedPlaySave = structuredClone(playInitial);
    const failedPlay = linked.executeLinkedActions(signalPlan(['guide_1'], 'resolved', false),
        playWorld, failedPlaySave, npcSignal);
    await assert.rejects(failedPlay.working.commit(async () => {
        throw new Error('storage_boom');
    }, 1), /storage_boom/);
    assert.deepEqual(failedPlaySave, playInitial);
    const saved = structuredClone(initial);
    const committedFollowUp = linked.executeLinkedActions(withFollowUpEvents, world, saved,
        { onEvent: () => emittedCondition('guide_1') });
    let durable;
    await committedFollowUp.working.commit(async candidate => {
        durable = structuredClone(candidate.session);
    }, 1);
    assert.deepEqual(saved, durable);
    assert(saved.entityStates.guide_1.conditions.includes('alerted'));
    assert.equal(saved.engineEvents.length, 1);
    const reloaded = structuredClone(durable);
    const continued = linked.executeLinkedActions({ actions: [action('continue', 'resolved',
        { outfit_set: [{ actor_id: 'player', outfit: 'traveler coat' }] })], events: [
        { action_id: 'continue', type: 'outfit', actor_id: 'player', status: 'completed',
            outfit: 'traveler coat' }], narrative: [] }, world, reloaded);
    assert(continued.ok, JSON.stringify(continued.errors));
    assert.equal(continued.working.prepare().session.engineEvents.length, 1);
    assert(continued.working.prepare().session.entityStates.guide_1.conditions.includes('alerted'));
    const rejectedSave = structuredClone(initial);
    const preparedFollowUp = linked.executeLinkedActions(withFollowUpEvents, world,
        rejectedSave, { onEvent: () => emittedCondition('guide_1') });
    await assert.rejects(preparedFollowUp.working.commit(async () => {
        throw new Error('storage_boom');
    }, 1), /storage_boom/);
    assert.deepEqual(rejectedSave, initial);
    await assert.rejects(result.working.commit(async () => {
        throw new Error('storage_boom');
    }, 1), /storage_boom/);
    assert.deepEqual(state, initial, 'storage failure cannot partially publish a turn');
    console.log('PASS linked effect contract, diagnostics, repairs, invariants, snapshots and rollback');
})().catch(error => { console.error(error); process.exitCode = 1; });
