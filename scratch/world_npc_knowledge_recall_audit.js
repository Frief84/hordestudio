'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
console.log('PASS NPC knowledge recall across long conversations and save/reload');
