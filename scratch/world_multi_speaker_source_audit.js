'use strict';
const assert = require('node:assert/strict');
const scene = require('../worlds/scene-draft');
const binding = require('../worlds/turn-binding');
const canonical = scene.schema({ events: { type: 'array', items: { type: 'object',
    properties: Object.fromEntries(['type', 'actor_id', 'status', 'activity']
        .map(key => [key, { type: 'string' }])),
    required: ['type', 'actor_id', 'status'] } } }, 'scene_draft_v3',
{ linkedRequired: true });
const input = 'I sit on the bench. "Hello." Linda says "Welcome."';
const draft = { protocol: 'scene_draft_v3', actions: [
    { request: 'I sit on the bench. "Hello."', kind: 'physical', status: 'resolved',
        effects: [], response: [{ text: 'You sit. "Hello."', events: [
            { type: 'activity', actor_id: 'player', status: 'completed', activity: 'sitting' }] }] },
    { request: 'Linda says "Welcome."', kind: 'speech', status: 'resolved',
        effects: [], response: [{ text: 'Linda says "Welcome."', speech: [
            { speaker: 'linda', listeners: ['player'], quote: 'Welcome.' }] }] }
] };
const result = binding.bind(draft, { turnId: 'test_multi_speaker', input,
    references: [{ id: 'linda', name: 'Linda', type: 'npc' }],
    presentActorIds: ['linda'], playerLocation: 'room' }, canonical);
assert(result.ok, JSON.stringify(result.errors));
assert(result.draft.speech.some(item => item.speaker === 'player' && item.quote === 'Hello.'));
assert(result.draft.speech.some(item => item.speaker === 'linda' && item.quote === 'Welcome.'));
assert(!result.draft.speech.some(item => item.speaker === 'player' && item.quote === 'Welcome.'));
const pose = { protocol: 'scene_draft_v3', actions: [{ kind: 'physical',
    status: 'resolved', effects: [], response: [{ text: 'You kneel.' }] }] };
const kneel = binding.bind(pose, { turnId: 'test_plain_pose', input: 'I kneel.',
    playerLocation: 'room', references: [] }, canonical);
assert(kneel.ok, JSON.stringify(kneel.errors));
assert(kneel.draft.events.some(event => event.type === 'activity'
    && event.actor_id === 'player' && event.status === 'completed'));
const absent = binding.bind(pose, { turnId: 'test_absent_support',
    input: 'I sit on the bench.', playerLocation: 'room', references: [] }, canonical);
assert(absent.ok, JSON.stringify(absent.errors));
assert(!absent.draft.events.some(event => event.status === 'completed'),
    'an absent support cannot acquire a completed event');
const liveProposal = { protocol: 'scene_draft_v3', actions: [
    { request: 'I kneel', kind: 'speech', status: 'resolved', effects: [],
        response: [{ text: 'I kneel', events: [{ type: 'activity',
            actor_id: 'player', status: 'completed', activity: 'kneeling' }] }] },
    { request: 'then wave to Linda', kind: 'speech', status: 'resolved', effects: [],
        response: [{ text: 'You wave.', events: [{ type: 'interaction',
            actor_id: 'player', status: 'completed', action: 'wave' }] }] },
    { request: 'and say "Hello."', kind: 'speech', status: 'resolved', effects: [],
        response: [{ text: 'You say "Hello."', speech: [{ speaker: 'player',
            listeners: ['linda'], quote: 'Hello.' }] }] }
] };
const chairCapture = require('./world-chair-c-engine-2026-11-01-r5.json')[0];
const liveFixture = JSON.parse(chairCapture.bindingResponses[0].request);
const liveInput = 'I kneel, then wave to Linda and say "Hello."';
const retained = binding.bind(liveProposal, { ...liveFixture.context,
    turnId: 'test_retained_actions', input: liveInput, playerName: '',
    references: liveFixture.context.references.filter(ref => ref.id !== 'chair') },
liveFixture.canonical);
assert(retained.ok, JSON.stringify(retained.errors));
assert.equal(retained.draft.actions.length, 3,
    'completed bodily subactions must not be merged into speech');
assert.deepEqual(retained.draft.actions.map(action => action.kind),
    ['physical', 'physical', 'speech']);
assert(retained.binding.gestureActionIds.includes(retained.draft.actions[1].action_id));
console.log('PASS source-backed player and NPC speech remain distinct');
