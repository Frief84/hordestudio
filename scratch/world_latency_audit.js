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
    action: { type: 'string' }, item: { type: 'string' }, from_location_id: { type: 'string' },
    to_location_id: { type: 'string' }
}, required: ['type', 'actor_id', 'status'] } }, checks: { type: 'array', items: { type: 'object' } } };
const contract = scene.schema(legacy, 'scene_draft_v3');
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
for (const input of ['I give Linda the letter.', 'I go to the hall.', 'I do not show Linda the letter.',
    'I show Linda the letter and give her the key.', 'I open the door.']) {
    assert.equal(scene.localInteraction(input, baseContext), false, input);
}
for (const input of ['I approach Linda.', 'I wave.', 'Ich zeige Linda den Brief.']) {
    assert(scene.localInteraction(input, { ...baseContext, inventory: ['Brief'] }), input);
}
assert.equal(scene.localInteraction(baseContext.input, { ...baseContext, inventory: [] }), false);
assert.equal(scene.localInteraction(baseContext.input, { ...baseContext, present: [] }), false);
assert(scene.localInteraction('I show Linda Smith the letter.', { ...baseContext, actors: [{ id: 'linda', name: 'Linda Smith' }] }));
assert.equal(scene.localInteraction(baseContext.input, { ...baseContext, inventory: [{ name: 'letter', quantity: 0 }] }), false);
assert(!scene.compile(draft, { ...baseContext, input: 'I show Linda the letter and ask the deadline.' }).ok);
assert(!scene.compile({ ...draft, effects: { invented: [] } }, baseContext).ok);
assert(!scene.compile({ ...draft, actions: [{ ...draft.actions[0], status: 'attempted', request: null }] }, baseContext).ok);
const forged = scene.compile({ ...draft, actions: [{ ...draft.actions[0], verifiedLocalInteraction: true }] }, baseContext);
assert(!forged.ok, 'model cannot supply a compiler exemption');
const duplicate = '{"protocol":"scene_draft_v3","actions":[],"actions":[]}';
assert.equal(scene.decode(duplicate), null);

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
for (const wrapper of [s => s, s => `<world_turn_receipt>${s}</world_turn_receipt>`, s => '```json\n' + s + '\n```']) {
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
    v2SchemaCharacters: JSON.stringify(scene.schema(legacy)).length, v3SchemaCharacters: JSON.stringify(contract).length }));
console.log('PASS v3 compatibility, local proofs, streaming boundaries, five-turn context and fixture size comparisons (no live model latency claims)');
