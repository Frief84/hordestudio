'use strict';
const assert = require('node:assert/strict');
const scene = require('../worlds/scene-draft');
const binding = require('../worlds/turn-binding');

// Full Aslan shoulder reply from world_server_binding_browser_audit.js.
const input = `Aslan considers the options for a moment, his golden eyes gleaming with amusement.

"The shoulder, I think. I've spent quite enough time sitting on a stone, and exchanging a view of the road for the inside of a pocket seems a rather questionable improvement."

"Now then, my good fellow, would you mind lending me a hand? These legs of mine are better suited to dignified sitting than heroic climbing."`;
const eventFields = Object.fromEntries(['type', 'actor_id', 'status', 'action', 'item', 'outfit',
    'from_location_id', 'to_location_id', 'activity', 'condition', 'next_status',
    'target_id'].map(key => [key, { type: 'string', maxLength: 1000 }]));
const canonical = scene.schema({ events: { type: 'array', items: { type: 'object',
    properties: eventFields, required: ['type', 'actor_id', 'status'] } } },
'scene_draft_v3', { linkedRequired: true });
const proposal = { protocol: 'scene_draft_v3', actions: [{
    kind: 'gesture', status: 'resolved',
    effects: { relation_set: [{ subject_id: 'lorne', target_id: 'aslan', value: 50 }] },
    response: [{ text: 'Lorne offers his hand to Aslan.' }]
}] };
const context = { turnId: 'turn_aslan_shoulder', input, now: 485 };

assert.deepEqual(binding.validate(proposal, binding.schema(canonical)), [],
    'the proposal is structurally valid before the gesture-specific check');
const rejected = binding.bind(proposal, context, canonical);
assert.equal(rejected.ok, false);
assert.deepEqual(rejected.errors, [
    { reason: 'gesture_has_world_effects', detail: 'actions.0.effects' }
]);
assert.equal(rejected.draft, undefined, 'no canonical draft is released for compilation or execution');

const effectFree = structuredClone(proposal);
effectFree.actions[0].effects = [];
const accepted = binding.bind(effectFree, context, canonical);
assert.equal(accepted.ok, true, JSON.stringify(accepted.errors));
assert.equal(accepted.draft.actions[0].request, input,
    'a single action binds the complete dialogue, gestures and request');
console.log('PASS full Aslan shoulder input: contradictory gesture effect rejected before compilation');
