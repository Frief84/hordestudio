'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const turnContext = require('../worlds/turn-context');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const start = source.indexOf('function selectWorldNpcKnowledge(');
const end = source.indexOf('\nfunction normalizeWorldPlayerCommandPronoun(', start);
assert(start >= 0 && end > start, 'NPC recall selector is present');
const sandbox = { selectWorldNpcKnowledge: null };
vm.runInNewContext(`${source.slice(start, end)}\nthis.selectWorldNpcKnowledge = selectWorldNpcKnowledge;`, sandbox);
const select = sandbox.selectWorldNpcKnowledge;

const observations = [
    { text: 'Lorne first witnessed Aslan, a talking toad, answer him aloud.', sourceType: 'witnessed' },
    ...Array.from({ length: 16 }, (_, index) => ({
        text: `Lorne and Aslan discussed a different detail of the orchard at meeting ${index}.`,
        sourceType: 'witnessed'
    }))
];
const restored = structuredClone(observations);
const recalled = select(restored, 'Aslan asks Lorne whether an elderly toad can ride to Millbrook.');
assert(recalled.some(item => item.text.includes('talking toad')),
    'the first witnessed identity fact survives many turns and a save/reload copy');
assert(recalled.some(item => item.text.includes('meeting 15')),
    'the latest shared conversation remains available');
assert(recalled.length <= 10, 'recall respects the NPC prompt budget');
assert.equal(restored.length, observations.length, 'recall does not rewrite canonical observations');
const confirmed = { action_results: [{ action_id: 'act', outcome: 'succeeded' }],
    confirmed_effects: [{ action_id: 'act', type: 'condition_change', result: 'changed',
        payload: { target_id: 'actor' }, event_indices: [0] }],
    events: [{ action_id: 'act', type: 'condition', actor_id: 'actor', status: 'completed',
        evidence: 'The actor has a confirmed condition.', witnessed_by: ['witness'] }] };
const memory = turnContext.sceneMemory(confirmed, 'receipt', 'room', 2);
assert.deepEqual(memory.records.find(item => item.kind === 'event').witnesses,
    ['actor', 'witness'], 'an actor knows their own confirmed event without granting it to bystanders');
assert.deepEqual(memory.records.find(item => item.kind === 'effect').witnesses,
    ['actor', 'witness'], 'the effect trace carries the same bounded audience');
assert.deepEqual(turnContext.eventAudience({ type: 'observation', actor_id: 'actor',
    witnessed_by: ['remote'] }), ['actor'], 'personal observations do not leak through witness lists');
assert.equal(turnContext.circulatesAsWorldFact(confirmed.events[0]), true);
for (const change of [{ status: 'blocked' }, { source_type: 'told' },
    { source_type: 'believed' }, { allowed_to_share: false }, { evidence: '' },
    { type: 'observation' }, { type: 'dialogue' }]) assert.equal(turnContext.circulatesAsWorldFact({
    ...confirmed.events[0], ...change }), false, JSON.stringify(change));
const believed = turnContext.sceneMemory({ ...confirmed,
    events: [{ ...confirmed.events[0], source_type: 'believed' }]
}, 'belief', 'room', 3);
assert.equal(believed.records.find(item => item.actor === 'actor')?.kind, 'testimony',
    'a belief remains subjective in scene memory');
const blocked = turnContext.sceneMemory({ ...confirmed,
    action_results: [{ action_id: 'act', outcome: 'blocked' }]
}, 'blocked', 'room', 3);
assert(!blocked.records.some(item => item.kind === 'event' || item.kind === 'effect'),
    'blocked actions produce no scene fact or effect');
console.log('PASS NPC knowledge recall across long conversations and save/reload');
