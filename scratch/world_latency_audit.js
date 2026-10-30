'use strict';
const assert = require('node:assert/strict');
const scene = require('../worlds/scene-draft');
const context = require('../worlds/turn-context');
const client = require('../worlds/model-client');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');
const accumulator = new Function(`${source.slice(source.indexOf('function accumulateWorldToolCall('), source.indexOf('\nfunction parseWorldToolArguments('))}; return accumulateWorldToolCall;`)();
const legacy = { events: { type: 'array', items: { type: 'object', properties: {
    type: { type: 'string', enum: ['interaction', 'inventory', 'movement', 'activity'] },
    actor_id: { type: 'string' }, status: { type: 'string', enum: ['completed', 'attempted'] },
    action: { type: 'string' }, item: { type: 'string' }, minutes_elapsed: { type: 'integer' },
    from_location_id: { type: 'string' },
    to_location_id: { type: 'string' }
}, required: ['type', 'actor_id', 'status'] } }, checks: { type: 'array', items: { type: 'object' } } };
const contract = scene.schema(legacy, 'scene_draft_v3');
for (const input of ['I take the cloth and clean the table.', 'Ich nehme das Tuch und reinige den Tisch.',
    'I take the cloth; I do not move the vase.']) {
    const compoundContract = scene.schema(legacy, 'scene_draft_v3', { input });
    assert(compoundContract.properties.actions.items.required.includes('request'),
        'the provider schema must require the same explicit coverage as the compiler');
}
assert(!scene.schema(legacy, 'scene_draft_v3', { input: 'I wave.' })
    .properties.actions.items.required.includes('request'), 'simple actions keep compact input mapping');
assert(scene.schema(legacy, 'scene_draft_v2', { input: 'I wave.' })
    .properties.actions.items.required.includes('request'), 'v2 contract stays unchanged');
const baseContext = { input: 'I show Linda the letter.', present: ['linda'], location: 'office', playerStart: 'office',
    actors: [{ id: 'linda', name: 'Linda' }], inventory: ['letter'], locations: ['office', 'hall'],
    effectKeys: ['checks'], now: 500, commitments: [], contract };
const draft = { protocol: 'scene_draft_v3', narrative: [{ id: 'p1', text: 'Linda studies the letter in your hand.' }],
    actions: [{ kind: 'physical', status: 'resolved', response_id: 'p1' }] };
const compiled = scene.compile(draft, baseContext);
assert(compiled.ok, JSON.stringify(compiled));
assert.equal(compiled.actions[0].request, baseContext.input);
assert.equal(compiled.actions[0].verifiedLocalInteraction, true);
assert.deepEqual(compiled.receipt.events, []);
assert.deepEqual(compiled.receipt.state_updates, {});
assert.equal(draft.actions[0].request, undefined, 'compiler is pure');
const stumble = scene.compile({ protocol: 'scene_draft_v3',
    narrative: [{ id: 'p1', action_id: 'a1', text: 'Du stolperst über einen Stuhl und fängst dich.' }],
    actions: [{ action_id: 'a1', kind: 'physical', status: 'resolved', response_id: 'p1', action_effects: {} }] },
{ ...baseContext, input: 'du stolperst über einen Stuhl', present: [], inventory: [] });
assert(stumble.ok, JSON.stringify(stumble.errors));
assert.equal(stumble.linkedPlan.events[0].type, 'interaction');
assert.equal(stumble.linkedPlan.events[0].actor_id, 'player');
assert.equal(stumble.linkedPlan.events[0].action_id, stumble.linkedPlan.actions[0].action_id);
const takingScenery = scene.compile({ protocol: 'scene_draft_v3',
    narrative: [{ id: 'p1', action_id: 'a1', text: 'Du nimmst einen Stuhl mit.' }],
    actions: [{ action_id: 'a1', kind: 'physical', status: 'resolved', response_id: 'p1', action_effects: {} }] },
{ ...baseContext, input: 'du nimmst einen Stuhl', present: [], inventory: [] });
assert(takingScenery.ok, JSON.stringify(takingScenery.errors));
assert.equal(takingScenery.linkedPlan.events.length, 0,
    'an unregistered prop cannot be acquired through incidental-action proof');
for (const input of ['I give Linda the letter.', 'I go to the hall.', 'I do not show Linda the letter.',
    'I show Linda the letter and give her the key.', 'I open the door.']) {
    assert.equal(scene.localInteraction(input, baseContext), false, input);
}
for (const input of ['I approach Linda.', 'I wave.', 'Ich zeige Linda den Brief.']) {
    assert(scene.localInteraction(input, { ...baseContext, inventory: ['Brief'] }), input);
}
assert(scene.localInteraction('I smile at Linda.', baseContext),
    'a harmless gesture toward a present character is a verified local interaction');
assert.equal(scene.localInteraction('I smile at Linda.', { ...baseContext, present: [] }), false);
for (const input of ['I greet Linda.', 'I tap Linda on the shoulder.', "I shake Linda's hand."]) {
    assert(scene.localInteraction(input, baseContext), input);
    assert.equal(scene.localInteraction(input, { ...baseContext, present: [] }), false, input);
}
assert.equal(scene.localInteraction(baseContext.input, { ...baseContext, inventory: [] }), false);
assert.equal(scene.localInteraction(baseContext.input, { ...baseContext, present: [] }), false);
const cosmeticCondition = scene.compile({ ...draft,
    narrative: [{ id: 'p1', text: 'You smile at Linda; she smiles back.' }],
    events: [{ type: 'condition', actor_id: 'linda', status: 'completed',
        action: 'smile', passage_id: 'p1' }] }, { ...baseContext, input: 'I smile at Linda.' });
assert(cosmeticCondition.ok, JSON.stringify(cosmeticCondition.errors));
assert.equal(cosmeticCondition.receipt.events[0].type, 'other',
    'a gesture mislabeled as a condition must not propose a persistent condition');
const lastingGestureClaim = scene.compile({ ...draft,
    narrative: [{ id: 'p1', text: 'Linda smiles, but remains poisoned.' }],
    events: [{ type: 'condition', actor_id: 'linda', status: 'completed',
        action: 'smile', passage_id: 'p1' }] }, { ...baseContext, input: 'I smile at Linda.' });
assert(lastingGestureClaim.errors.some(error => error.reason === 'missing_condition'),
    'a passage mentioning lasting harm cannot lose its missing condition event');
const unnamedCondition = scene.compile({ ...draft,
    events: [{ type: 'condition', actor_id: 'linda', status: 'completed',
        action: 'remove', passage_id: 'p1' }] }, baseContext);
assert(unnamedCondition.errors.some(error => error.reason === 'missing_condition'),
    'an unnamed lasting condition removal must fail before the reducer');
const unactedCondition = scene.compile({ ...draft,
    events: [{ type: 'condition', actor_id: 'linda', status: 'completed',
        condition: 'Poisoned', passage_id: 'p1' }] }, baseContext);
assert(unactedCondition.errors.some(error => error.reason === 'missing_condition_action'),
    'a lasting condition needs an explicit operation');
const conditionAlias = scene.compile({ ...draft,
    events: [{ type: 'condition', actor_id: 'linda', status: 'completed',
        action: 'add', value: 'Poisoned', passage_id: 'p1' }] }, { ...baseContext, contract: null });
assert(conditionAlias.ok, JSON.stringify(conditionAlias.errors));
assert.equal(conditionAlias.receipt.events[0].condition, 'Poisoned',
    'a lossless condition-value alias remains subject to the normal reducer');
assert(scene.localInteraction('I show Linda Smith the letter.', { ...baseContext, actors: [{ id: 'linda', name: 'Linda Smith' }] }));
assert.equal(scene.localInteraction(baseContext.input, { ...baseContext, inventory: [{ name: 'letter', quantity: 0 }] }), false);
const transient = { ...draft, narrative: [{ id: 'p1', text: 'You tap Linda on the shoulder; she turns.' }] };
assert(scene.compile(transient, { ...baseContext, input: 'I tap Linda on the shoulder.' }).actions[0]
    .verifiedLocalInteraction, 'present, non-durable contact needs no extra proof event');
assert(!scene.compile({ ...transient, effects: { checks: [] } },
    { ...baseContext, input: 'I tap Linda on the shoulder.' }).actions[0].verifiedLocalInteraction,
    'a proposed lasting or check effect cannot inherit the local exemption');
assert(!scene.compile(draft, { ...baseContext, input: 'I show Linda the letter and ask the deadline.' }).ok);
assert(!scene.compile({ ...draft, effects: { invented: [] } }, baseContext).ok);
assert(!scene.compile({ ...draft, actions: [{ ...draft.actions[0], status: 'attempted', request: null }] }, baseContext).ok);
const forged = scene.compile({ ...draft, actions: [{ ...draft.actions[0], verifiedLocalInteraction: true }] }, baseContext);
assert(!forged.ok, 'model cannot supply a compiler exemption');
const falseResolution = scene.compile({ ...draft, resolutions: [{ id: 'unrelated', passage_id: 'p1', event_index: 0 }] }, baseContext);
assert.equal(falseResolution.ok, false);
assert(falseResolution.errors.some(error => error.reason === 'unverified_commitment_resolution'
    && error.detail.includes('unknown_commitment_id')),
    'an unrelated action cannot resolve an unknown commitment, and the reason is diagnosable');
const withoutDeadline = scene.schema(legacy, 'scene_draft_v3', { input: baseContext.input,
    commitments: [], location: 'office', now: 500 });
assert(!('resolutions' in withoutDeadline.properties), 'no reachable deadline removes the field');
assert(scene.compile({ ...draft, resolutions: [] }, { ...baseContext, contract: withoutDeadline }).ok,
    'empty legacy-style resolutions may be dropped without another model call');
assert(scene.compile({ ...draft, resolutions: [{ id: 'unknown', passage_id: 'p1', event_index: 0 }] },
    { ...baseContext, contract: withoutDeadline }).errors.some(error =>
    error.reason === 'unverified_commitment_resolution' && error.detail.includes('unknown')),
    'nonempty unsupported resolutions remain explicit errors');
const deadlines = [
    { id: 'triggered_here', status: 'triggered', locationId: 'office', dueMinute: 450 },
    { id: 'scheduled_soon', status: 'scheduled', locationId: 'office', dueMinute: 510 },
    { id: 'scheduled_late', status: 'scheduled', locationId: 'office', dueMinute: 700 },
    { id: 'triggered_away', status: 'triggered', locationId: 'hall', dueMinute: 450 },
    { id: 'resolved_here', status: 'triggered', locationId: 'office', dueMinute: 450, sceneResolution: 'done' }
];
const rhetoricalDraft = { protocol: 'scene_draft_v3',
    narrative: [{ id: 'p1', text: 'Aslan asks whether you had somewhere to be.' }],
    actions: [], events: [], effects: {}, speech: [],
    commitments: [{ id: 'invented_meeting', title: 'Meeting', day: 1,
        minute_of_day: 400, location_id: 'office', status: 'scheduled',
        passage_id: 'p1' }] };
const pastProposal = scene.compile(rhetoricalDraft, { ...baseContext,
    input: '', contract: null, commitments: [] });
assert(pastProposal.errors.some(error => error.reason === 'new_commitment_in_past'),
    'a past deadline needs a corrected proposal before any turn may commit');
assert.equal(rhetoricalDraft.commitments[0].minute_of_day, 400,
    'compiler may not alter the model proposal');
const aslanSpeech = 'Aslan raises one brow ridge. "I provide you with stories no library possesses, and you share them with the world. Truthfully, mind you. And with proper attribution. My name is Aslan. Once upon a time, people actually prayed to me. A few of the older ones might still remember. I should rather like to remind the rest that I exist. Consider it a modest effort to correct humanity’s rather deplorable memory."';
const aslanDraft = { ...rhetoricalDraft,
    narrative: [{ id: 'p1', text: aslanSpeech }],
    commitments: [{ ...rhetoricalDraft.commitments[0], id: 'aslan_stories',
        title: 'Share Aslan’s stories', day: 1, minute_of_day: 400 }] };
const aslanProposal = scene.compile(aslanDraft, { ...baseContext,
    input: '', contract: null,
    now: 500, commitments: [] });
assert(aslanProposal.errors.some(error => error.reason === 'new_commitment_in_past'),
    'an invented past date cannot be silently removed');
const untimedDialogue = scene.compile({ ...aslanDraft, commitments: [] },
{ ...baseContext, input: '', contract: null, now: 500, commitments: [] });
assert(untimedDialogue.ok, JSON.stringify(untimedDialogue.errors));
assert.deepEqual(untimedDialogue.receipt.state_updates, {},
    'an effect-free dialogue has no scheduled World event');
const explicitPast = scene.compile({ ...rhetoricalDraft,
    narrative: [{ id: 'p1', text: 'Linda says, "Meet me today at 6:00."' }] },
{ ...baseContext, input: '', contract: null, now: 500, commitments: [] });
assert(explicitPast.errors.some(error => error.reason === 'new_commitment_in_past'
    && error.detail.includes('current day=1, minute_of_day=500')),
    'an expressly stated past deadline must still be rejected, never silently moved');
const explicitFuture = scene.compile({ ...rhetoricalDraft,
    narrative: [{ id: 'p1', text: 'Linda says, "Meet me tomorrow at 6:00."' }],
    commitments: [{ ...rhetoricalDraft.commitments[0], day: 2, minute_of_day: 360 }] },
{ ...baseContext, input: '', contract: null, now: 500, commitments: [] });
assert(explicitFuture.ok, JSON.stringify(explicitFuture.errors));
assert.equal(explicitFuture.commitments[0].dueMinute, 1800,
    'an expressly stated future deadline remains scheduled');
const deadlineSchema = scene.schema(legacy, 'scene_draft_v3', { input: baseContext.input,
    commitments: deadlines, location: 'office', now: 500, plannedWait: 15 });
assert.deepEqual(deadlineSchema.properties.resolutions.items.properties.id.enum,
    ['triggered_here', 'scheduled_soon']);
const noWaitSchema = scene.schema(legacy, 'scene_draft_v3', { input: baseContext.input,
    commitments: deadlines, location: 'office', now: 500 });
assert.deepEqual(noWaitSchema.properties.resolutions.items.properties.id.enum, ['triggered_here']);
assert(scene.schema(legacy, 'scene_draft_v2', { input: baseContext.input,
    commitments: [], location: 'office', now: 500 }).properties.resolutions,
    'v2 retains the stable legacy field');
const resolutionDraft = { protocol: 'scene_draft_v3', narrative: [{ id: 'p1',
    text: 'Linda confirms that the deadline has passed and closes the appointment.' }],
    actions: [], events: [{ type: 'interaction', actor_id: 'linda', status: 'completed',
        action: 'close the appointment', passage_id: 'p1' }],
    resolutions: [{ id: 'triggered_here', event_index: 0, passage_id: 'p1' }] };
const triggeredContext = { ...baseContext, input: '', commitments: [{ ...deadlines[0], sourceReceiptId: 'old' }],
    contract: noWaitSchema };
assert(scene.compile(resolutionDraft, triggeredContext).ok,
    'a reached, witnessed deadline remains resolvable');
const scheduledDraft = { ...resolutionDraft,
    events: [{ type: 'time', actor_id: 'player', status: 'completed', minutes_elapsed: 15,
        passage_id: 'p1' }, resolutionDraft.events[0]],
    resolutions: [{ id: 'scheduled_soon', event_index: 1, passage_id: 'p1' }] };
const scheduledResult = scene.compile(scheduledDraft, { ...triggeredContext,
    commitments: [deadlines[1]], contract: deadlineSchema });
assert(scheduledResult.ok, JSON.stringify(scheduledResult.errors));
assert(scene.compile({ ...scheduledDraft, events: [resolutionDraft.events[0]],
    resolutions: [{ id: 'scheduled_soon', event_index: 0, passage_id: 'p1' }] },
{ ...triggeredContext, commitments: [deadlines[1]], contract: deadlineSchema }).errors.some(error =>
    error.detail.includes('deadline_not_reached')), 'future deadline cannot resolve without elapsed time');
for (const past of [deadlines[3], deadlines[4]]) {
    const rejected = scene.compile({ ...resolutionDraft,
        resolutions: [{ id: past.id, event_index: 0, passage_id: 'p1' }] },
    { ...triggeredContext, commitments: [past], contract: deadlineSchema });
    assert(!rejected.ok, `remote or already resolved commitment ${past.id} stays rejected`);
}
const duplicate = '{"protocol":"scene_draft_v3","actions":[],"actions":[]}';
assert.equal(scene.decode(duplicate), null);
assert.deepEqual(scene.decode('```json\r\n{"protocol":"scene_draft_v3","actions":[]}```'),
    { protocol: 'scene_draft_v3', actions: [] },
    'CRLF fenced JSON with an adjacent closing fence is valid');
assert.equal(scene.transportFailureReason('{"protocol":"scene_draft_v3","actions":['),
    'incomplete_json_transport');
assert.equal(scene.transportFailureReason('{"protocol":"scene_draft_v3","actions":[', 'length'),
    'truncated_receipt');
assert.equal(scene.transportFailureReason('Here is some JSON:'), 'invalid_json_transport');

const valid = JSON.stringify({ ...draft, narrative: [{ id: 'p1', text: 'A quote: "yes", a brace: }, a slash: \\, and Unicode: ä.' }] });
for (let size = 1; size < valid.length; size++) {
    const calls = new Map(), checker = scene.streamValidator(contract);
    let previous = '';
    for (let i = 0; i < valid.length; i += size) {
        accumulator(calls, { index: 0, function: { ...(i ? {} : { name: 'commit_world_turn' }), arguments: valid.slice(i, i + size) } });
        const raw = calls.get('index:0').function.arguments;
        assert.equal(checker.push(raw.slice(previous.length)), null);
        previous = raw;
    }
    assert.equal(previous, valid, 'nested fragments are not replacement snapshots');
}
const snapshots = new Map();
accumulator(snapshots, { index: 0, function: { name: 'commit_world_', arguments: valid.slice(0, 30) } });
accumulator(snapshots, { index: 0, function: { name: 'turn', arguments: valid } });
accumulator(snapshots, { index: 0, function: { name: 'commit_world_turn', arguments: valid } });
assert.equal(snapshots.get('index:0').function.arguments, valid);
assert.equal(snapshots.get('index:0').function.name, 'commit_world_turn');
for (const wrapper of [s => s, s => `<world_turn_receipt>${s}</world_turn_receipt>`,
    s => '```json\n' + s + '\n```', s => '```json\r\n' + s + '```']) {
    const source = wrapper(valid);
    for (let size = 1; size <= source.length; size++) {
        const validator = scene.streamValidator(contract);
        for (let i = 0; i < source.length; i += size) assert.equal(validator.push(source.slice(i, i + size)), null);
    }
}
const unfinished = scene.streamValidator(contract);
assert.equal(unfinished.push('{"actions":[{"status":"res'), null);
assert.equal(unfinished.push('olved","response_id":"later"}]'), null, 'later passage references are not errors');
assert.equal(unfinished.push(',"narrative":[{"id":"later","text":"An answer."}],"protocol":"scene_draft_v3"}'), null);
const bad = scene.streamValidator(contract);
assert.equal(bad.push('{"actions":[{"status":"inv'), null);
assert.equal(bad.push('alid"').reason, 'invalid_stream_enum', 'closed enum is conclusively invalid');
assert.equal(scene.streamValidator(contract).push(duplicate).reason, 'duplicate_stream_key');

const history = [];
for (let i = 0; i < 12; i++) history.push(
    { id: `u${i}`, role: 'user', text: `Question ${i} about the letter.`, location: 'office' },
    { id: `d${i}`, role: 'dm', text: `Answer ${i}: ${'The letter is important. '.repeat(20)}`, location: 'office',
        sceneMemory: { receiptId: `r${i}`, location: 'office', turn: i,
            records: [{ kind: 'event', text: `Clue ${i} on the letter.` }] } });
history.push({ id: 'current', role: 'user', text: baseContext.input, location: 'office' });
let selectedIds;
const opts = { history, start: history.length - 1, budget: 20000, location: 'office', locations: [], text: m => m.text };
const selected = context.history({ ...opts, maxTurns: 5, onSelected: ids => { selectedIds = ids; } });
assert.equal(selected.length, 11);
assert.equal(selected[0].content, history[14].text);
assert.equal(selected.at(-1).content, baseContext.input);
const recall = context.recall(history, 'letter', 'office', 4500, selectedIds);
assert(recall.includes('d6'));
assert(!recall.includes('"sourceMessageId":"d7"'));
const budgeted = context.history({ ...opts, budget: 220, maxTurns: 5 });
assert.equal(budgeted.at(-1).content, baseContext.input);
assert.equal(budgeted.length % 2, 1, 'budget keeps whole pairs');
assert.throws(() => context.history({ ...opts, budget: 1, maxTurns: 5 }), /current player action/);
assert.equal(context.history({ ...opts, maxTurns: 0 }).length, 1);
const failed = [...history.slice(0, -1), { role: 'user', text: 'Abandoned.' },
    { id: 'bad', role: 'dm', text: 'Rejected.', stateSource: 'frozen_no_receipt', sceneMemory: history[1].sceneMemory }, history.at(-1)];
assert(!JSON.stringify(context.history({ ...opts, history: failed, start: failed.length - 1, maxTurns: 5 })).includes('Abandoned'));
assert(!context.recall(failed, 'letter', 'office').includes('"sourceMessageId":"bad"'));
const retryHistory = failed.slice(0, -1);
const retryMessages = context.history({ ...opts, history: retryHistory, start: retryHistory.length - 2, maxTurns: 5 });
assert.equal(retryMessages.at(-1).content, 'Abandoned.', 'reroll must retain the current request even when its previous reply was rejected');
assert(!JSON.stringify(retryMessages).includes('Rejected.'), 'the rejected reply itself must stay out of context');
const sample = (duration, repair = 0, stateSource = 'tool_call', model = 'test') => ({ role: 'dm', stateSource,
    callAudit: { protocol: 'scene_draft_v3', receiptRepair: repair, metrics: { acceptedDisplayMs: duration },
        calls: [{ provider: 'local', model }] } });
const timing = client.latencySummary([sample(100), sample(200, 1), sample(300), sample(400),
    sample(null, 1, 'frozen_no_receipt'), sample(null), sample(50, 0, 'tool_call', 'other')]);
assert.equal(timing.length, 2);
assert.equal(timing[0].medianMs, 250);
assert.equal(timing[0].p95Ms, 400);
assert.equal(timing[0].measuredTurns, 4);
assert.equal(timing[0].repairedTurns, 2);
assert.equal(timing[0].rejectedTurns, 1);

const v2 = { ...draft, protocol: 'scene_draft_v2', actions: [{ ...draft.actions[0], request: baseContext.input }],
    events: [], effects: {}, speech: [], commitments: [], resolutions: [] };
assert.deepEqual(scene.compile(v2, { ...baseContext, contract: scene.schema(legacy) }).receipt, compiled.receipt);
const rows = [];
for (const [name, input, kind, status, changes] of [
    ['show', baseContext.input, 'physical', 'resolved', {}],
    ['recall question', 'What did Linda say about the letter?', 'question', 'answered', {}],
    ['transfer', 'I give Linda the letter.', 'physical', 'resolved', { events: [{ type: 'inventory', actor_id: 'player', status: 'completed', action: 'give', item: 'letter', passage_id: 'p1' }] }],
    ['travel', 'I go to the hall.', 'travel', 'resolved', { events: [{ type: 'movement', actor_id: 'player', status: 'completed', from_location_id: 'office', to_location_id: 'hall', passage_id: 'p1' }] }],
    ['check', 'I inspect the lock.', 'physical', 'pending_check', { effects: { checks: [{ label: 'Inspect lock', on_success: {}, on_failure: {} }] } }]
]) {
    const old = { ...v2, actions: [{ request: input, kind, status, response_id: 'p1' }], ...changes };
    const compact = { ...draft, actions: [{ kind, status, response_id: 'p1' }], ...changes };
    const before = scene.compile(old, { ...baseContext, input, contract: scene.schema(legacy) });
    const after = scene.compile(compact, { ...baseContext, input });
    assert(before.ok && after.ok, name);
    assert.deepEqual(after.receipt, before.receipt, `${name}: same internal receipt`);
    rows.push({ scenario: name, v2Characters: JSON.stringify(old).length, v3Characters: JSON.stringify(compact).length });
}
console.table(rows);
console.log(JSON.stringify({ legacyHistoryCharacters: JSON.stringify(context.history(opts)).length,
    recentHistoryCharacters: JSON.stringify(selected).length,
    v2SchemaCharacters: JSON.stringify(scene.schema(legacy)).length,
    v3SchemaCharacters: JSON.stringify(contract).length,
    v3NoDeadlineSchemaCharacters: JSON.stringify(withoutDeadline).length }));
console.log('PASS v3 compatibility, local proofs, streaming boundaries, five-turn context and fixture size comparisons (no live model latency claims)');
