'use strict';
const assert = require('node:assert/strict');
const narration = require('../worlds/receipt-narration');
const scene = require('../worlds/scene-draft');

const world = { id: 'speaker_fixture', entities: [
    { id: 'linda', type: 'npc', name: 'Linda', startLocation: 'room' },
    { id: 'cassy', type: 'npc', name: 'Cassy', startLocation: 'room' }
] };
const passage = { id: 'p1', action_id: 'talk',
    text: 'Linda says "Yes." The door remains closed. Cassy says "Wait."' };
const speech = [
    { speaker: 'linda', statement: 'Yes.', listeners: ['player', 'cassy'],
        action_id: 'talk', passage_id: 'p1' },
    { speaker: 'cassy', statement: 'Wait.', listeners: ['player', 'linda'],
        action_id: 'talk', passage_id: 'p1' }
];
const receipt = { turn_id: 'turn_1', action_results: [{ action_id: 'talk', outcome: 'succeeded' }],
    confirmed_effects: [], events: [], passages: [passage], speech_attributions: speech,
    passage_speakers: [{ passage_id: 'p1', speaker_id: null }] };
const session = { worldStateVersion: 1, playerLocation: 'room', entityStates: {
    linda: { location: 'room' }, cassy: { location: 'room' } },
worldTurnReceipts: [{ receipt, audit: { world_state_version: 1,
    actions: [{ action_id: 'talk', outcome: 'succeeded' }] } }],
history: [{ role: 'user', text: 'I ask both women.' }, { role: 'dm',
    sceneMemory: { receiptId: 'turn_1', records: [] } }] };
const result = narration.project(world, session);
assert(result.ok, JSON.stringify(result));
assert.deepEqual(result.input.dialogue.map(item => [item.speaker, item.statement]),
    [['linda', 'Yes.'], ['cassy', 'Wait.']]);
assert.equal(result.input.narrativeDetails[0].speaker, null);
assert(!result.input.dialogue.some(item => item.statement.includes('door')));
const falseSpeaker = structuredClone(session);
falseSpeaker.worldTurnReceipts[0].receipt.passage_speakers[0].speaker_id = 'linda';
assert.equal(narration.project(world, falseSpeaker).reason, 'speaker_evidence_mismatch');
const native = { protocol: 'scene_draft_v3', narrative: [passage],
    actions: [{ action_id: 'talk', kind: 'question', status: 'answered',
        response_id: 'p1' }], events: [], effects: {}, speech: speech.map(item => ({
        speaker: item.speaker, listeners: item.listeners, passage_id: 'p1',
        action_id: 'talk', quote: item.statement })), commitments: [] };
const nativeContext = { input: 'I ask both women.', location: 'room', playerStart: 'room',
    present: ['linda', 'cassy'], locations: ['room'], now: 480, linkedRequired: true };
const compiled = scene.compile(native, nativeContext);
assert(compiled.ok, JSON.stringify(compiled.errors));
assert.deepEqual(compiled.linkedPlan.speech.map(item => item.statement),
    ['Yes.', 'Wait.']);
const unsupported = structuredClone(native);
delete unsupported.speech[1].quote;
assert(scene.compile(unsupported, nativeContext).errors.some(item =>
    item.reason === 'missing_speech_quote'));
console.log('PASS P4.3e mixed speaker and observation receipt projection');
