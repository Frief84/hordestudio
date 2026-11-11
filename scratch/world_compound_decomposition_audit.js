'use strict';
const assert = require('node:assert/strict');
const binding = require('../worlds/turn-binding');
const scene = require('../worlds/scene-draft');
const linked = require('../worlds/linked-world-actions');
const context = require('../worlds/turn-context');
const fixture = JSON.parse(require('./world-chair-c-engine-2026-11-01-r5.json')[0]
    .bindingResponses[0].request);
const references = fixture.context.references.filter(item => item.id !== 'chair');
const world = { id: 'isolated_decomposition',
    locations: [{ id: 'foyer', exits: [{ targetLocationId: 'round' }] },
        { id: 'round', exits: [] }],
    entities: [{ id: 'linda', type: 'npc', name: 'Linda' }] };
const seed = () => ({ id: 'isolated_decomposition', playerLocation: 'foyer',
    turnCount: 0, inventory: [], entityStates: { linda: { location: 'foyer' } },
    locationStates: {}, npcRelationships: {}, engineEvents: [], worldStateVersion: 1,
    worldClock: { absoluteMinutes: 485, turnCount: 0, bonusTimeMinutes: 0 } });
const run = (proposal, input, turnId, options = {}) => {
    const bound = binding.bind(proposal, { ...fixture.context, references,
        input, turnId, playerName: '', prepareCertainEffects: true }, fixture.canonical);
    assert(bound.ok, JSON.stringify(bound.errors));
    const compiled = scene.compile(bound.draft, { input, location: 'foyer',
        playerStart: 'foyer', present: ['linda'], locations: ['foyer', 'round'],
        now: 485, linkedRequired: true, contract: fixture.canonical });
    assert(compiled.ok, JSON.stringify(compiled.errors));
    const executed = linked.executeLinkedActions(compiled.linkedPlan, world, seed(),
        { worldActionIds: bound.binding.worldActionIds,
            canMove: () => ({ ok: true, travelTime: 0 }), ...options });
    assert(executed.ok, JSON.stringify(executed.errors));
    return { bound, compiled, executed };
};

const input = 'I pirouette, then signal to Linda and murmur "Ready.", then tap the floor.';
const proposal = { protocol: 'scene_draft_v3', actions: [
    { request: 'I pirouette', kind: 'physical', status: 'resolved', effects: [],
        response: [{ text: 'The player pirouettes.', events: [
            { type: 'activity', actor_id: 'player', status: 'completed', activity: 'pirouetting' }] }] },
    { request: 'then signal to Linda and murmur "Ready."', kind: 'physical',
        status: 'resolved', effects: [], response: [{
            text: 'The player signals to Linda and murmurs, "Ready."',
            events: [
                { type: 'activity', actor_id: 'player', status: 'completed', activity: 'signaling' },
                { type: 'dialogue', actor_id: 'player', status: 'completed', activity: 'murmur' },
                { type: 'dialogue', actor_id: 'linda', status: 'completed', activity: 'hear' }
            ], speech: [{ speaker: 'player', listeners: ['linda'], quote: 'Ready.' }] }] },
    { request: 'then tap the floor.', kind: 'physical', status: 'resolved', effects: [],
        depends_on: [{ action_index: 1, outcome: 'succeeded' }],
        response: [{ text: 'The floor sounds hollow.', events: [
            { type: 'interaction', actor_id: 'player', status: 'completed', action: 'tap' }] }] }
], reactions: [{ after_action_index: 1, text: 'Linda listens.' }] };
const mixed = run(proposal, input, 'isolated_novel_mixed');
assert.deepEqual(mixed.bound.draft.actions.filter(action => action.request)
    .map(action => action.kind), ['physical', 'physical', 'speech', 'physical']);
assert.deepEqual(mixed.bound.draft.actions.find(action =>
    action.action_id === 'isolated_novel_mixed_action_3').depends_on,
    [{ action_id: 'isolated_novel_mixed_action_1', outcome: 'succeeded' },
        { action_id: 'isolated_novel_mixed_action_2', outcome: 'succeeded' }]);
assert.equal(mixed.bound.draft.speech.length, 1);
assert.equal(mixed.bound.draft.events.filter(event => event.actor_id === 'player').length, 4);
assert(mixed.bound.draft.actions.some(action => action.action_id === 'isolated_novel_mixed_world_0'));
assert.deepEqual([...mixed.executed.outcomes.values()],
    ['succeeded', 'succeeded', 'succeeded', 'succeeded', 'succeeded']);

const moveInput = 'I move to the Round Room and say "Ready."';
assert.deepEqual(context.requestClauses(moveInput).map(item => item.request),
    ['I move to the Round Room', 'and say "Ready."']);
assert.deepEqual(context.requestClauses('Ich bewege mich in die Küche und sage "Bereit."')
    .map(item => item.request), ['Ich bewege mich in die Küche', 'und sage "Bereit."']);
const moving = run({ protocol: 'scene_draft_v3', actions: [{
    kind: 'physical', status: 'resolved', effects: { actor_move: [
        { actor_id: 'player', to_location_id: 'round' }] },
    response: [{ text: 'You enter the Round Room and say "Ready."',
        events: [
            { type: 'movement', actor_id: 'player', status: 'completed',
                from_location_id: 'foyer', to_location_id: 'round' },
            { type: 'dialogue', actor_id: 'player', status: 'completed', activity: 'say' }
        ], speech: [{ speaker: 'player', listeners: ['linda'], quote: 'Ready.' }] }]
}] }, moveInput, 'isolated_move_speech');
assert.deepEqual(moving.bound.draft.actions.map(action => action.kind),
    ['travel', 'speech']);
assert.equal(moving.bound.draft.actions[0].action_effects.actor_move.length, 1);
assert.deepEqual(moving.bound.draft.actions[1].action_effects, {});
assert.equal(moving.executed.working.prepare().session.playerLocation, 'round');
assert.equal(moving.executed.confirmedEffects.filter(effect => effect.type === 'actor_move').length, 1);
assert.equal(moving.bound.draft.speech.length, 1);
const collapsedInput = 'I try to enter the Round Room and tell Linda "The door is shut."';
const collapsed = binding.bind({ protocol: 'scene_draft_v3', actions: [{
    request: collapsedInput, kind: 'speech', status: 'resolved', effects: [],
    response: [{ text: 'You tell Linda, "The door is shut."',
        speech: [{ speaker: 'player', listeners: ['linda'], quote: 'The door is shut.' }] }]
}] }, { ...fixture.context, references, input: collapsedInput,
    turnId: 'isolated_collapsed_travel', playerName: '',
    prepareCertainEffects: true }, fixture.canonical);
assert.equal(collapsed.ok, false,
    'a single speech action must not erase an independently requested place change');
assert(collapsed.errors.some(error => error.reason === 'player_action_kind_mismatch'
    || error.reason === 'request_coverage_mismatch'), JSON.stringify(collapsed.errors));
const frenchSpeech = binding.bind({ protocol: 'scene_draft_v3', actions: [{
    kind: 'speech', status: 'resolved', effects: [],
    response: [{ text: 'Linda listens.' }]
}] }, { ...fixture.context, references, input: 'I tell Linda "Ready."',
    turnId: 'isolated_french_speech', playerName: '', outputLanguage: 'fr',
    prepareCertainEffects: true }, fixture.canonical);
assert(frenchSpeech.ok, JSON.stringify(frenchSpeech.errors));
assert.match(frenchSpeech.draft.narrative[0].text, /^Vous dites : « Ready\. »/);
const redundantInput = 'I go to the Foyer and tell Linda "I am here."';
const redundantBound = binding.bind({ protocol: 'scene_draft_v3', actions: [
    { request: 'I go to the Foyer', kind: 'speech', status: 'resolved', effects: [],
        response: [{ text: 'You are already in the Foyer.' }] },
    { request: 'tell Linda "I am here."', kind: 'speech', status: 'resolved',
        effects: [], response: [{ text: 'You tell Linda, "I am here."' }] }
] }, { ...fixture.context,
    references: [...references.filter(item => item.id !== 'foyer'),
        { id: 'foyer', name: 'Foyer', type: 'location' }],
    input: redundantInput, playerLocation: 'foyer',
    turnId: 'isolated_redundant_speech', playerName: '',
    prepareCertainEffects: true }, fixture.canonical);
assert(redundantBound.ok, JSON.stringify(redundantBound.errors));
assert.deepEqual(redundantBound.draft.actions.map(action => action.kind),
    ['travel', 'speech']);
assert.deepEqual(redundantBound.draft.actions[0].action_effects, {});
const partial = linked.executeLinkedActions({ actions: [
    { action_id: 'miss', kind: 'physical', status: 'attempted', request: 'reach for absent object',
        response_id: 'miss_p', action_effects: {} },
    { action_id: 'signal', kind: 'physical', status: 'resolved', request: 'signal',
        response_id: 'signal_p', action_effects: {} },
    { action_id: 'use', kind: 'physical', status: 'resolved', request: 'use absent object',
        response_id: 'use_p', action_effects: {},
        depends_on: [{ action_id: 'miss', outcome: 'succeeded' }] },
    { action_id: 'speak', kind: 'speech', status: 'resolved', request: 'speak',
        response_id: 'speak_p', action_effects: {} }
], narrative: [
    { id: 'miss_p', action_id: 'miss', text: 'The object is not here.' },
    { id: 'signal_p', action_id: 'signal', text: 'Linda sees the signal.' },
    { id: 'use_p', action_id: 'use', text: 'The object changes.' },
    { id: 'speak_p', action_id: 'speak', text: 'Linda hears the words.' }
], events: [{ id: 'signal_e', type: 'activity', actor_id: 'player',
    status: 'completed', activity: 'signaling', action_id: 'signal', passage_id: 'signal_p' }] },
world, seed(), { allowPartialRecovery: true });
assert(partial.ok, JSON.stringify(partial.errors));
assert.deepEqual([...partial.outcomes.values()],
    ['failed', 'succeeded', 'skipped', 'succeeded']);
assert.equal(partial.events.filter(event => event.status === 'completed').length, 1);
assert(!partial.narrative.includes('The object changes.'));
const unverified = linked.executeLinkedActions({ actions: [
    { action_id: 'miss', kind: 'physical', status: 'resolved', request: 'lift an absent object',
        response_id: 'miss_p', action_effects: {} },
    { action_id: 'signal', kind: 'physical', status: 'resolved', request: 'signal',
        response_id: 'signal_p', action_effects: {} },
    { action_id: 'use', kind: 'physical', status: 'resolved', request: 'use it',
        response_id: 'use_p', action_effects: {},
        depends_on: [{ action_id: 'miss', outcome: 'succeeded' }] },
    { action_id: 'speak', kind: 'speech', status: 'resolved', request: 'speak',
        response_id: 'speak_p', action_effects: {} }
], narrative: [
    { id: 'miss_p', action_id: 'miss', text: 'An unsupported success claim.' },
    { id: 'signal_p', action_id: 'signal', text: 'Linda sees the signal.' },
    { id: 'use_p', action_id: 'use', text: 'The object changes.' },
    { id: 'speak_p', action_id: 'speak', text: 'Linda hears the words.' }
], events: [{ id: 'signal_e', type: 'activity', actor_id: 'player',
    status: 'completed', activity: 'signaling', action_id: 'signal', passage_id: 'signal_p' }] },
world, seed(), { allowPartialRecovery: true });
assert(unverified.ok, JSON.stringify(unverified.errors));
assert.deepEqual([...unverified.outcomes.values()],
    ['unresolved', 'succeeded', 'skipped', 'succeeded']);
assert.equal(unverified.actionFailures[0].reason, 'unverified_action_success');
assert(!unverified.narrative.includes('unsupported success'));
assert(!unverified.narrative.includes('The object changes.'));
const blocked = linked.executeLinkedActions({ actions: [
    { action_id: 'blocked', kind: 'physical', status: 'resolved', request: 'act elsewhere',
        response_id: 'blocked_p', action_effects: {}, state_conditions: [
            { fact: 'actor_at', subject_id: 'player', operator: 'equals', value: 'round' }] },
    { action_id: 'independent', kind: 'physical', status: 'resolved',
        request: 'signal', response_id: 'independent_p', action_effects: {} },
    { action_id: 'dependent', kind: 'speech', status: 'resolved', request: 'follow up',
        response_id: 'dependent_p', action_effects: {},
        depends_on: [{ action_id: 'blocked', outcome: 'succeeded' }] }
], narrative: [
    { id: 'blocked_p', action_id: 'blocked', text: 'False success.' },
    { id: 'independent_p', action_id: 'independent', text: 'The player signals.' },
    { id: 'dependent_p', action_id: 'dependent', text: 'False follow up.' }
], events: [{ id: 'independent_e', type: 'activity', actor_id: 'player',
    status: 'completed', activity: 'signaling', action_id: 'independent',
    passage_id: 'independent_p' }] }, world, seed(), { allowPartialRecovery: true });
assert(blocked.ok, JSON.stringify(blocked.errors));
assert.deepEqual([...blocked.outcomes.values()], ['blocked', 'succeeded', 'skipped']);
assert(!blocked.narrative.includes('False'));
assert.deepEqual(context.requestClauses('I move to the Round Room and say "Ready."')
    .map(item => item.request), ['I move to the Round Room', 'and say "Ready."']);
console.log('PASS novel activity/speech and movement/speech splitting with references and dependencies');
