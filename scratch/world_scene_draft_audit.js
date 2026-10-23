'use strict';
const assert = require('node:assert/strict');
const { compile, schema, decode } = require('../worlds/scene-draft');
assert.deepEqual(decode('```json\n{"protocol":"scene_draft_v2"}\n```'), {protocol:'scene_draft_v2'});
assert.equal(decode('Here is JSON: {"protocol":"scene_draft_v2"}'), null);
assert.equal(decode('```json\n{"protocol": broken}\n```'), null);
assert.deepEqual(decode('<world_turn_receipt>{"protocol":"scene_draft_v2"}</world_turn_receipt>'), {protocol:'scene_draft_v2'});
const context = { input: 'I alert Denton and ask the deadline.', location: 'office', playerStart: 'office',
    present: ['denton', 'examiner'], locations: ['office'], now: 537, commitments: [],
    effectKeys: ['quests_update', 'location_introduced', 'checks'] };
const narrative = 'Denton hears that the examiner has arrived. The examiner says the files are due at 5 PM today.';
const draft = { protocol: 'scene_draft_v2', narrative,
    actions: [{ request: 'I alert Denton ', kind: 'speech', status: 'resolved',
        response: 'Denton hears that the examiner has arrived.' },
    { request: 'and ask the deadline.', kind: 'question', status: 'answered',
        response: 'The examiner says the files are due at 5 PM today.' }],
    events: [], effects: {}, speech: [{ speaker: 'player', listeners: ['denton'],
        statement: 'Denton hears that the examiner has arrived.' }],
    commitments: [{ id: 'files_due', title: 'Reserve files', description: 'Produce the reserve files.',
        day: 1, minute_of_day: 1020, location_id: 'office', status: 'scheduled', reschedule: false,
        evidence: 'The examiner says the files are due at 5 PM today.' }] };
const original = structuredClone(draft);
const result = compile(draft, context);
assert(result.ok, JSON.stringify(result.errors));
assert.deepEqual(draft, original, 'compilation must not mutate the proposal');
assert.equal(result.commitments[0].dueMinute, 1020);
assert.equal(result.receipt.state_updates.world_events[0].due_in_minutes, 483);
assert.equal(result.receipt.events[0].actor_id, 'denton');
assert.equal(result.receipt.events[0].source_type, 'told');
assert.deepEqual(result.receipt.scene.present_character_ids, context.present);
const reasons = (candidate, ctx = context) => compile(candidate, ctx).errors?.map(e => e.reason) || [];
assert.match(compile({ ...draft, actions: draft.actions.slice(0, 1) }, context).unaddressedRequest,
    /ask the deadline/, 'an omitted question is reported without discarding a separate action');
const lindaInput = 'You take LInda with you into the round room, unlock the door, and lock it again behind you.';
const lindaNarrative = 'Linda comes with you into the round room. You unlock the door and lock it behind you.';
const lindaDraft = { ...draft, narrative: lindaNarrative, events: [], effects: {}, speech: [], commitments: [],
    actions: [
        { request: 'Take Linda with you into the round room', kind: 'travel', status: 'resolved', response: lindaNarrative },
        { request: 'Unlock the door', kind: 'physical', status: 'resolved', response: lindaNarrative },
        { request: 'Lock it again behind you.', kind: 'physical', status: 'resolved', response: lindaNarrative }
    ] };
const lindaContext = { ...context, input: lindaInput };
assert.equal(compile(lindaDraft, lindaContext).unaddressedRequest, '',
    'case, punctuation, articles and joining words must not reject a complete compound action');
const attemptedDisplay = compile({ ...lindaDraft,
    narrative: 'You hold up the object, but Linda looks away.',
    actions: [{ request: 'You show Linda the object.', kind: 'physical', status: 'attempted',
        response: 'You hold up the object, but Linda looks away.' }],
    events: [] }, { ...lindaContext, input: 'You show Linda the object.' });
assert(attemptedDisplay.ok, JSON.stringify(attemptedDisplay.errors));
assert.equal(attemptedDisplay.receipt.events[0].type, 'interaction');
assert.equal(attemptedDisplay.receipt.events[0].status, 'attempted');
assert.equal(attemptedDisplay.receipt.events[0].actor_id, 'player');
const partialNarrative = 'Linda follows you into the round room. You unlock the door.';
const missingLock = compile({ ...lindaDraft, narrative: partialNarrative,
    actions: lindaDraft.actions.slice(0, 2).map(action => ({ ...action, response: partialNarrative })) }, lindaContext);
assert(missingLock.ok, JSON.stringify(missingLock.errors));
assert.match(missingLock.unaddressedRequest, /lock it again behind you/,
    'an omitted re-lock is reported without discarding earlier verified steps');
assert.deepEqual(missingLock.receipt.state_updates, {}, 'an omitted lock step cannot create a lock change');
const lostNegation = compile({ ...lindaDraft,
    actions: [{ ...lindaDraft.actions[1], request: 'Unlock the door' }] },
{ ...lindaContext, input: 'Do not unlock the door.' });
assert.match(lostNegation.unaddressedRequest, /not unlock/, 'negation remains significant');
assert(reasons({ ...draft, narrative: 'Nothing happens.' }).includes('response_missing_from_scene'));
assert(reasons({ ...draft, speech: [{ ...draft.speech[0], listeners: ['absent'] }] }).includes('invalid_witnessed_speech'));
assert(reasons({ ...draft, effects: { invented_state: true } }).includes('unsupported_draft_effect'));
const emptyUnknownEffects = { ...draft, effects: {
    invented_list: [], invented_object: {}, invented_text: '', invented_null: null
} };
assert.deepEqual(compile(emptyUnknownEffects, context).errors
    .filter(error => error.reason === 'unsupported_draft_effect').map(error => error.detail).sort(),
['effects.invented_list', 'effects.invented_null', 'effects.invented_object', 'effects.invented_text'],
    'even empty unsupported fields must be reported, not discarded');
assert.deepEqual(emptyUnknownEffects.effects,
    { invented_list: [], invented_object: {}, invented_text: '', invented_null: null },
    'compilation must preserve the rejected proposal for repair');
assert(reasons({ ...draft, state_updates: { quests_update: [] }, effects: {} })
    .includes('unsupported_draft_field'), 'an unapproved root wrapper must remain visible');
assert(reasons({ ...draft, effects: { state_updates: { quests_update: [] } } })
    .includes('unsupported_draft_effect'), 'an unapproved nested wrapper must remain visible');
assert(reasons({ ...draft, effects: { quests_update: [{ objectives: [{ type: 'location', target: 'vault' }] }] } })
    .includes('unknown_quest_location'));
const changedTime = { ...draft, commitments: [{ ...draft.commitments[0], minute_of_day: 1022 }] };
const later = { ...context, now: 600, commitments: [{ id: 'files_due', dueMinute: 1020, status: 'scheduled' }] };
assert(reasons(changedTime, later).includes('commitment_time_changed_without_reschedule'));
assert(compile(draft, later).ok, 'restatement preserves exact deadline');
assert(reasons(draft, { ...later, now: 1100, commitments: [{ ...later.commitments[0], status: 'triggered' }] })
    .includes('resolved_commitment_rearmed'));
assert(reasons({ ...draft, commitments: [draft.commitments[0], draft.commitments[0]] }).includes('invalid_commitment'));
assert(compile({ ...draft, effects: { location_introduced: [{ id: 'vault', name: 'Vault', parent_location_id: 'office' }],
    quests_update: [{ objectives: [{ type: 'location', target: 'vault' }] }] } }, context).ok);
const contract = schema({ events: { type: 'array' }, checks: { type: 'array' }, world_events: {}, npc_observations: {} });
assert(!contract.properties.scene);
assert(!contract.properties.effects.properties.world_events);
assert(!contract.properties.effects.properties.npc_observations);
const nestedContract = schema({ events: { type: 'array', items: { type: 'object',
    properties: { type: { type: 'string', enum: ['activity'] }, actor_id: { type: 'string' },
        status: { type: 'string' }, activity: { type: 'string' } } } },
checks: { type: 'array', items: { type: 'object', properties: {
    label: { type: 'string' }, on_success: { type: 'object',
        properties: { inventory_remove: { type: 'array', items: { type: 'string' } } } }
} } }, custom_values: { type: 'object', additionalProperties: { type: 'number' } } });
assert.equal(nestedContract.properties.events.items.additionalProperties, false);
assert.equal(nestedContract.properties.effects.properties.checks.items.additionalProperties, false);
assert.equal(nestedContract.properties.effects.properties.checks.items.properties.on_success.additionalProperties, false);
assert.deepEqual(nestedContract.properties.effects.properties.custom_values.additionalProperties,
    { type: 'number' }, 'schema-defined dynamic maps remain available');
console.log('PASS scene drafts: coverage, speech provenance, stable deadlines, location integrity, pure compilation');
const linked = { ...draft, narrative: [{ id: 'p1', text: narrative }],
    actions: draft.actions.map(a => ({ request: a.request, kind: a.kind, status: a.status, response_id: 'p1' })),
    speech: [{ speaker: 'player', listeners: ['denton'], passage_id: 'p1' }],
    commitments: draft.commitments.map(({ evidence, ...c }) => ({ ...c, passage_id: 'p1' })) };
assert(compile(linked, context).ok, 'passage links do not require repeated exact quotes');
const strictContext = { ...context, contract: nestedContract,
    effectKeys: [...context.effectKeys, 'checks'] };
assert(compile({ ...linked, events: [{ type: 'activity', actor_id: 'denton',
    status: 'completed', activity: 'sitting', passage_id: 'p1', invented: true }] }, strictContext)
    .errors.some(error => error.detail === 'events.0.invented'),
    'unknown event fields are rejected even when the backend ignores the schema');
const postureProposal = { ...linked, events: [{ type: 'posture', actor_id: 'denton',
    status: 'completed', posture: 'sitting at the desk', passage_id: 'p1' }] };
const normalizedPose = compile(postureProposal, strictContext);
assert(normalizedPose.ok, JSON.stringify(normalizedPose.errors));
assert.equal(normalizedPose.receipt.events[0].type, 'activity');
assert.equal(normalizedPose.receipt.events[0].activity, 'sitting at the desk');
assert.equal(postureProposal.events[0].posture, 'sitting at the desk',
    'the rejected-provider field is carried into the canonical activity without changing the source');
assert(compile({ ...linked, effects: { checks: [{ label: 'test', invented: true }] } }, strictContext)
    .errors.some(error => error.detail === 'effects.checks.0.invented'),
    'unknown nested effect fields are rejected without removing them');
const witnessContract = schema({ events: { type: 'array', items: { type: 'object', properties: {
    type: { type: 'string' }, actor_id: { type: 'string' }, status: { type: 'string' },
    witnessed_by: { type: 'array', items: { type: 'string' } }
} } } }, 'scene_draft_v2', { intentionallyEffectFree: true });
const witnessTypo = { ...linked, events: [{ type: 'dialogue', actor_id: 'denton',
    status: 'completed', passage_id: 'p1', witnessed_by__: ['player'] }] };
const correctedWitness = compile(witnessTypo, { ...context, contract: witnessContract });
assert(correctedWitness.ok, JSON.stringify(correctedWitness.errors));
assert.deepEqual(correctedWitness.receipt.events[0].witnessed_by, ['player']);
assert.deepEqual(witnessTypo.events[0].witnessed_by__, ['player'], 'alias handling cannot mutate the draft');
assert(compile({ ...witnessTypo, events: [{ ...witnessTypo.events[0], witnessed_by: ['denton'] }] },
    { ...context, contract: witnessContract }).errors.some(error =>
    error.reason === 'conflicting_event_field'), 'conflicting witness lists remain rejected');
const leakedEngineFields = compile({ ...linked, effects: {
    present_character_ids: ['invented_actor'], activities: { invented_actor: 'walking' }
} }, context);
assert.deepEqual(leakedEngineFields.errors.filter(error => error.reason === 'unsupported_draft_effect')
    .map(error => error.detail).sort(), ['effects.activities', 'effects.present_character_ids'],
    'engine-owned cast/activity proposals must be reported, not silently removed');
const singlePassageAlias = structuredClone(linked);
singlePassageAlias.actions.forEach(action => { action.response_id = 'provider_mangled_id'; });
singlePassageAlias.speech[0].passage_id = 'provider_mangled_id';
assert(compile(singlePassageAlias, context).ok,
    'a mismatched passage reference safely binds to the only available passage');
const multiPassageLinked = { ...linked, narrative: [...linked.narrative,
    { id: 'p2', text: 'The corridor remains quiet.' }] };
assert(reasons({ ...multiPassageLinked, speech: [{ speaker: 'player', listeners: ['denton'], passage_id: 'missing' }] })
    .includes('unknown_passage_id'), 'unknown references remain rejected when multiple passages make the target ambiguous');
assert(reasons({ ...linked, narrative: [linked.narrative[0], linked.narrative[0]] }).includes('invalid_passage'));
assert.equal(contract.properties.narrative.type, 'array');
assert(contract.properties.actions.items.properties.response_id);
const pending = { ...draft, effects: { checks: [{}] },
    actions: [draft.actions[0], { ...draft.actions[1], status: 'pending_check' }] };
assert(compile(pending, context).ok, 'one pending action can coexist with an answered action');
const typedOutcome = compile({...pending,effects:{checks:[{success_text:'The door opens.',
    failure_text:'All your tools break.',on_success:{},on_failure:{}}],ledger_update:'You try the lock.'}},
    {...context,effectKeys:[...context.effectKeys,'ledger_update']});
assert(typedOutcome.ok);
assert.equal(typedOutcome.receipt.state_updates.checks[0].outcome_contract,'state_delta_v1');
assert.equal(typedOutcome.receipt.state_updates.checks[0].failure_text,undefined);
assert.equal(typedOutcome.receipt.state_updates.ledger_update,undefined);
assert(!compile({...pending,effects:{checks:[{on_failure:{ledger_update:'All your tools break.'}}]}},context).ok);
assert(reasons({ ...pending, actions: draft.actions }).includes('check_requires_one_pending_action'));
assert(reasons({ ...pending, effects: {} }).includes('pending_action_requires_check'));
const minimalCommitment = structuredClone(linked);
delete minimalCommitment.commitments[0].description;
delete minimalCommitment.commitments[0].reschedule;
assert(compile(minimalCommitment, context).ok, 'display metadata must not force another model call');
const flatEffects = { ...linked, quests_update: [] };
assert(compile(flatEffects, context).ok, 'known explicit effect placement can be normalized without another API call');
assert(Object.hasOwn(flatEffects, 'quests_update'), 'placement adapter cannot mutate source');
assert(reasons({ ...flatEffects, effects: { quests_update: [{id:'other'}] } }).includes('conflicting_effect_placement'));
assert(reasons({ ...linked, invented_mutation: {} }).includes('unsupported_draft_field'));
assert.equal(compile({...linked,events:[{type:'speech',actor_id:'player',status:'completed',passage_id:'p1'}]},context)
    .receipt.events[0].type,'dialogue');
assert.equal(compile({...linked,events:[{actor_id:'player',status:'completed',action:'offers a deadline',passage_id:'p1'}]},context)
    .receipt.events[0].type,'other');
assert.equal(compile({...linked,events:[{actor_id:'player',status:'completed',to_location_id:'office',passage_id:'p1'}]},context)
    .receipt.events[0].type,undefined,'mechanical payload with missing type must still reach reducer as invalid');
assert.equal(compile({...linked,events:[{actor_id:'player',status:'completed',minutes_elapsed:60,passage_id:'p1'}]},context)
    .receipt.events[0].type,'time','an explicit duration is an unambiguous time operation, never prose inference');
assert(compile(linked, {...context,input:'I alert Denton, and ask the deadline.'}).ok,
    'a comma between exact request excerpts is presentation, not a missing action');
const omittedConstraint = compile(linked, {...context,input:'I alert Denton and ask the deadline. I do not leave.'});
assert(omittedConstraint.ok && /not leave/.test(omittedConstraint.unaddressedRequest),
    'an omitted constraint stays visible without discarding independently valid changes');
const spacedPassages = structuredClone(linked);
spacedPassages.narrative.forEach(p => { p.text = ' ' + p.text + ' '; });
assert(compile(spacedPassages, context).ok, 'linked passages use the same whitespace normalization as displayed prose');
const sharedAttempt = structuredClone(pending);
sharedAttempt.actions = [
    {...pending.actions[1],request:'I alert Denton '},
    {...pending.actions[1],request:'and ask the deadline.'}
];
assert(compile(sharedAttempt,context).ok,'multiple clauses bound to one attempt may share its single check');
sharedAttempt.actions[0].response=draft.actions[0].response;
assert(!compile(sharedAttempt,context).ok,'separate attempt passages cannot share one check');
