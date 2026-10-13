'use strict';
const assert = require('node:assert/strict');
const ctx = require('../worlds/turn-context');
const old = { id: 'promise', role: 'dm', location: 'garden', witnesses: ['linda'],
    text: 'Linda promised to bring the silver compass after the festival.',
    sceneMemory: { receiptId: 'r1', location: 'garden', turn: 1,
        records: [{ kind: 'testimony', actor: 'linda', listeners: ['player'],
            text: 'Linda promised to bring the silver compass after the festival.' }] } };
const noise = Array.from({ length: 30 }, (_, i) => ({ id: `noise${i}`, role: 'dm', location: 'hall',
    sceneMemory: { receiptId: `rn${i}`, location: 'hall', turn: i + 2,
        records: [{ kind: 'event', actor: 'guard', text: 'The guard had cleaned the hall. She was outside.' }] } }));
const history = [old, ...noise];
const options = { primaryQuery: 'What had she promised?', actorIds: ['linda'], text: m => m.text || '' };
let recalled = ctx.recall(history, 'What had she promised? Hall guard wooden walls', 'hall', 4500, [], options);
assert.match(recalled, /silver compass/, 'an old promise must outrank newer unrelated room descriptions');
assert.equal(JSON.parse(recalled.split('\n').find(line => line.includes('silver compass'))).records[0].kind, 'testimony');
const german = { ...old, id: 'versprechen', sceneMemory: { ...old.sceneMemory,
    records: [{ kind: 'testimony', actor: 'linda', listeners: ['player'], text: 'Linda versprach den silbernen Kompass nach dem Fest mitzubringen.' }] } };
assert.match(ctx.recall([german, ...noise], 'Was hatte sie damals versprochen?', 'hall', 4500, [],
    { ...options, primaryQuery: 'Was hatte sie damals versprochen?' }), /silbernen Kompass/);
const proseOnly = { id: 'old-prose', role: 'dm', stateSource: 'tool_call', location: 'garden', witnesses: ['linda'],
    text: `${'The garden was quiet. '.repeat(80)}The festival password was marigold.`, sceneMemory: { records: [] } };
recalled = ctx.recall([proseOnly, ...noise], 'What was the festival password?', 'hall', 4500, [],
    { ...options, primaryQuery: 'What was the festival password?' });
assert.match(recalled, /marigold/, 'retrieve a relevant passage outside the stored summary and beyond the start of a long message');
assert.match(recalled, /narrative_excerpt/);
assert.match(recalled, /witnesses/);
assert(!ctx.recall([proseOnly], 'festival password', 'hall', 4500, ['old-prose'], options));
assert(!ctx.recall([{ ...proseOnly, stateSource: 'frozen_no_receipt' }], 'festival password', 'hall', 4500, [], options));
assert(!ctx.recall([], 'festival password', 'hall', 4500, [], options));
const rerolled = { ...proseOnly, text: 'The password was obsolete.',
    versions: ['The password was obsolete.', 'The password was marigold.'], currentVersion: 1 };
const versionOptions = { ...options, primaryQuery: 'password', text: m => m.versions[m.currentVersion] };
assert.match(ctx.recall([rerolled], 'password', 'hall', 4500, [], versionOptions), /marigold/);
assert(!ctx.recall([rerolled], 'password', 'hall', 4500, [], versionOptions).includes('obsolete'), 'recall only the selected take');
const hidden = { ...proseOnly, text: 'A quiet room. <internal_states>The password was forbidden.</internal_states>' };
assert(!ctx.recall([hidden], 'password', 'hall', 4500, [], { ...options, primaryQuery: 'password' }), 'hidden state is not recalled as narrative');
const large = { ...old, id: 'large', sceneMemory: { ...old.sceneMemory,
    records: [...Array.from({ length: 11 }, () => ({ kind: 'event', text: 'Unrelated scenery. '.repeat(35) })), old.sceneMemory.records[0]] } };
assert.match(ctx.recall([large], 'silver compass', 'hall', 1800, [], { ...options, primaryQuery: 'silver compass' }), /silver compass/,
    'select relevant records instead of dropping an oversized scene as a whole');
assert(ctx.recall(history, 'silver compass', 'hall', 800, [], options).length <= 800);
assert.equal(ctx.recall(history, 'silver compass', 'hall', 1, [], options), '');
console.log('PASS long-term recall: old promises, German phrasing, legacy prose, record budgets, provenance and deleted/rejected source exclusion');
