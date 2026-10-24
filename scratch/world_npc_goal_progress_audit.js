'use strict';
const assert = require('node:assert/strict');
const { inspectNpcGoalStep, recordNpcGoalStep, acceptNpcGoalProposal,
    relevantNpcMemories,
    goalCompletionProof } = require('../worlds/npc-goal-actions');

const npc = { id: 'keeper', goal: 'Reach Archive' };
const world = { locations: [
    { id: 'store', name: 'Store', exits: [{ targetLocationId: 'archive',
        doorId: 'door', lockState: 'locked' }] },
    { id: 'archive', name: 'Archive' }
], entities: [npc, { id: 'key', type: 'item', name: 'Key' }] };
const session = { unlockedExits: {}, entityStates: { keeper: {
    location: 'store', goal: 'Reach Archive', goalStatus: 'active', inventory: []
} } };
const door = { effect: { type: 'interactable_transition', payload:
    { actor_id: 'keeper', target_id: 'door', to_state: 'open' } } };
let check = inspectNpcGoalStep(npc, door, world, session, 1);
assert(check.ok);
recordNpcGoalStep(npc, door, session, 1, check, { ok: false, reason: 'missing_key' });
assert.equal(inspectNpcGoalStep(npc, door, world, session, 1).reason,
    'already_checked_this_turn');
const saved = structuredClone(session);
assert.equal(inspectNpcGoalStep(npc, door, world, saved, 2).reason,
    'unchanged_blockage');
assert.equal(acceptNpcGoalProposal(npc, { npc_id: npc.id,
    goal: 'Reach Archive', effect: door.effect }, world, saved), false,
    'an unchanged failed step cannot be queued again by the agent');
saved.entityStates.keeper.inventory.push('Key');
assert(inspectNpcGoalStep(npc, door, world, saved, 2).ok,
    'resource change reactivates a blocked action');
const event = { id: 'receipt_2', actor_id: 'keeper', type: 'movement' };
saved.entityStates.keeper.location = 'archive';
assert.equal(goalCompletionProof(npc, { effect: { type: 'actor_move' } },
    world, saved, event).eventId, event.id);
saved.entityStates.keeper.goalCompletion = { type: 'inventory_contains', itemId: 'key' };
assert.equal(goalCompletionProof(npc, door, world, saved, event).eventId, event.id);
saved.entityStates.keeper.inventory = [];
assert.equal(goalCompletionProof(npc, door, world, saved, event), null);
assert.equal(goalCompletionProof(npc, door, world, saved,
    { ...event, actor_id: 'other' }), null);

const memoryState = { goal: 'Find the archive key', observations: [
    { text: 'The archive key was left in the store.', source: 'witnessed', turn: 1 },
    { text: 'It is raining outside.', source: 'witnessed', turn: 9 },
    { text: 'Lunch is at noon.', source: 'witnessed', turn: 10 },
    { text: 'A song was heard.', source: 'witnessed', turn: 11 }
] };
const news = [
    { text: 'The archive key is in the store.', knownBy: ['keeper'], turn: 1 },
    { text: 'A market opened.', knownBy: ['other'], turn: 12 },
    { text: 'The sky is cloudy.', knownBy: ['keeper'], turn: 13 }
];
const selected = relevantNpcMemories(memoryState, news, 'keeper', [], 3);
assert(selected.observations.some(item => item.text.includes('archive key')),
    'older relevant observation survives the context limit');
assert(selected.knownNews.some(item => item.text.includes('archive key')));
assert(!selected.knownNews.some(item => item.text.includes('market')),
    'another actor\'s news stays private');
assert(selected.knownNews.every(item => item.source === 'reported_news'),
    'reports retain their provenance');
const noMatch = relevantNpcMemories({ goal: 'zzzx', observations:
    memoryState.observations }, [], 'keeper', [], 2);
assert.deepEqual(noMatch.observations.map(item => item.turn), [11, 10],
    'recency wins when nothing is relevant');
console.log('PASS NPC goal progress: save/reload, blocked retry, changed resource, completion receipts, private relevant memories');
