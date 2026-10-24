'use strict';
const assert = require('node:assert/strict');
const { executeLinkedActions } = require('../worlds/linked-world-actions');
const world = { id: 'unseen_world', entities: [
    { id: 'key_1', name: 'Bronze key', type: 'item' },
    { id: 'guide_1', name: 'Guide', type: 'npc' }
], locations: [
    { id: 'foyer', name: 'Foyer', exits: [{ targetLocationId: 'archive', doorId: 'archive_gate',
        requiredItem: 'Bronze key', lockState: 'locked' }] },
    { id: 'archive', name: 'Archive', exits: [{ targetLocationId: 'foyer', doorId: 'archive_gate',
        requiredItem: 'Bronze key', lockState: 'locked' }] }
] };
const session = { id: 'save_1', playerLocation: 'foyer', inventory: [], unlockedExits: {},
    entityStates: { key_1: { location: 'foyer' }, guide_1: { location: 'foyer', followingPlayer: true },
        player: { location: 'foyer' } }, locationStates: {}, npcRelationships: {},
    engineEvents: [], turnCount: 3, worldStateVersion: 7 };
const canMove = (view, state, actor, from, to) => {
    const exit = view.locations.find(place => place.id === from)?.exits
        .find(item => item.targetLocationId === to);
    if (!exit) return { ok: false, reason: 'unreachable' };
    if (exit.doorId && !state.unlockedExits?.[exit.doorId])
        return { ok: false, reason: 'locked_exit' };
    return { ok: true };
};
const action = (id, status, action_effects = {}, depends_on = []) => ({
    action_id: id, kind: 'physical', status, depends_on, action_effects
});
const plan = { actions: [
    action('take', 'resolved', { item_transfer: [{ item_id: 'key_1', from_id: 'foyer', to_id: 'player' }] }),
    action('open', 'resolved', { interactable_transition: [{ target_id: 'archive_gate', to_state: 'open' }] },
        [{ action_id: 'take', outcome: 'succeeded' }]),
    action('enter', 'resolved', { actor_move: [{ actor_id: 'player', to_location_id: 'archive' }] },
        [{ action_id: 'open', outcome: 'succeeded' }])
], events: [], narrative: [
    { action_id: 'take', text: 'You pick up the bronze key.' },
    { action_id: 'open', text: 'The gate opens.' },
    { action_id: 'enter', text: 'You and your guide enter the archive.' }
] };
const result = executeLinkedActions(plan, world, session, { canMove });
assert(result.ok, JSON.stringify(result.errors));
assert.deepEqual(Object.fromEntries(result.outcomes),
    { take: 'succeeded', open: 'succeeded', enter: 'succeeded' });
assert.equal(session.playerLocation, 'foyer', 'canonical location cannot move before commit');
assert.equal(result.working.getSession('playerLocation'), 'archive');
assert.equal(result.working.getEntity('guide_1').state.location, 'archive');
assert(result.working.dirtySet.has('entity:guide_1'));
assert(result.working.dirtySet.has('location:foyer'));
assert(result.working.dirtySet.has('location:archive'));
assert.equal(result.working.getSession('inventory')[0], 'Bronze key');

const blockedPlan = { actions: [
    action('move', 'blocked', { actor_move: [{ actor_id: 'player', to_location_id: 'archive' }] }),
    action('next', 'resolved', { outfit_set: [{ actor_id: 'player', outfit: 'blue coat' }] },
        [{ action_id: 'move', outcome: 'succeeded' }])
], events: [], narrative: [{ action_id: 'move', text: 'The locked gate stops you.' },
    { action_id: 'next', text: 'You change clothes inside.' }] };
const blocked = executeLinkedActions(blockedPlan, world, session, { canMove });
assert(blocked.ok, JSON.stringify(blocked.errors));
assert.deepEqual(Object.fromEntries(blocked.outcomes), { move: 'blocked', next: 'skipped' });
assert(!blocked.narrative.includes('change clothes'));
const onFailure = structuredClone(blockedPlan);
onFailure.actions[1].depends_on[0].outcome = 'blocked';
onFailure.actions[1].status = 'resolved';
const recovery = executeLinkedActions(onFailure, world, session, { canMove });
assert(recovery.ok && recovery.working.getSession('outfit') === 'blue coat');
const unknown = executeLinkedActions({ actions: [action('magic', 'resolved', {
    spontaneous_teleport: [{ to: 'archive' }] })], events: [], narrative: [] }, world, session);
assert(!unknown.ok && unknown.errors[0].reason.startsWith('unknown_technical_effect'));
assert.equal(session.playerLocation, 'foyer');
const stocked = structuredClone(session);
stocked.inventory = [{ id: 'saffron_lens', name: 'Saffron lens', quantity: 2 }];
const given = executeLinkedActions({ actions: [action('give', 'resolved', {
    item_transfer: [{ item_id: 'saffron_lens', from_id: 'player', to_id: 'guide_1' }]
})], events: [], narrative: [] }, world, stocked);
assert(given.ok, JSON.stringify(given.errors));
assert.equal(given.working.getSession('inventory')[0].quantity, 1);
assert.deepEqual(given.working.getEntity('guide_1').state.inventory, ['Saffron lens']);
const relationshipChange = [{ source_npc_id: 'guide_1', target_npc_id: 'player', change: 2,
    reason: 'A respectful gesture earns a little trust.' }];
let forwardedRelationshipChange = null;
const relationship = executeLinkedActions({ actions: [action('react', 'resolved', {
    npc_relationship_updates: relationshipChange
})], events: [], narrative: [] }, world, session, {
    legacyEffectKeys: ['npc_relationship_updates'],
    applyLegacyEffect: (type, payload) => { forwardedRelationshipChange = { type, payload }; }
});
assert(relationship.ok, JSON.stringify(relationship.errors));
assert.deepEqual(forwardedRelationshipChange,
    { type: 'npc_relationship_updates', payload: relationshipChange },
    'legacy relationship effects exposed under linked action_effects reach the existing reducer');
const sceneAction = (id, kind, status, effects = {}) => ({ action_id: id, kind, status,
    request: 'I try to move with the guide.', response_id: `${id}_p`, action_effects: effects });
const passage = (id, text) => ({ id: `${id}_p`, action_id: id, text });
const moveEvent = (id, actor) => ({ type: 'movement', actor_id: actor,
    from_location_id: 'foyer', to_location_id: 'archive', status: 'completed',
    action_id: id, passage_id: `${id}_p` });
const openRoute = () => ({ ok: true, travelTime: 0 });
const accepted = executeLinkedActions({ actions: [sceneAction('together', 'travel', 'resolved',
    { actor_move: [{ actor_id: 'player', to_location_id: 'archive', companion_ids: ['guide_1'] }] })],
events: [moveEvent('together', 'player'), moveEvent('together', 'guide_1')],
narrative: [passage('together', 'The guide agrees and walks beside you into the archive.')] },
world, session, { canMove: openRoute, requireEffectWitnesses: true });
assert(accepted.ok, JSON.stringify(accepted.errors));
assert.equal(accepted.working.getSession('playerLocation'), 'archive');
assert.equal(accepted.working.getEntity('guide_1').state.location, 'archive');
assert.equal(session.playerLocation, 'foyer', 'execution stays detached before commit');
const missingCompanionWitness = executeLinkedActions({ actions: [sceneAction('unwitnessed',
    'travel', 'resolved', { actor_move: [{ actor_id: 'player',
        to_location_id: 'archive', companion_ids: ['guide_1'] }] })],
events: [moveEvent('unwitnessed', 'player')],
narrative: [passage('unwitnessed', 'The guide follows.')] },
world, session, { canMove: openRoute, requireEffectWitnesses: true });
assert.equal(missingCompanionWitness.ok, false);
assert.equal(missingCompanionWitness.errors[0].reason,
    'unwitnessed_companion_or_actor_move');
assert.deepEqual(missingCompanionWitness.errors[0].missingWitnesses,
    [{ actor: 'guide_1', from: 'foyer', to: 'archive' }]);
assert.equal(missingCompanionWitness.errors[0].proposedEvents.length, 1);
assert.equal(session.entityStates.guide_1.location, 'foyer');
const refused = executeLinkedActions({ actions: [sceneAction('refused', 'travel', 'attempted')],
events: [], narrative: [passage('refused', 'The guide plants their feet and refuses to come.')] },
world, session, { canMove: openRoute, requireEffectWitnesses: true });
assert(refused.ok, JSON.stringify(refused.errors));
assert.equal(refused.outcomes.get('refused'), 'failed');
assert.match(refused.narrative, /refuses/);
assert.equal(refused.working.getEntity('guide_1').state.location, 'foyer');
const spokenRefusal = executeLinkedActions({ actions: [sceneAction('spoken_refusal',
    'speech', 'resolved')], events: [{ type: 'dialogue', actor_id: 'guide_1',
    status: 'completed', action_id: 'spoken_refusal', passage_id: 'spoken_refusal_p' }],
narrative: [passage('spoken_refusal', 'The guide says no and remains in the foyer.')] },
world, session, { requireEffectWitnesses: true });
assert(spokenRefusal.ok, JSON.stringify(spokenRefusal.errors));
assert.equal(spokenRefusal.working.getEntity('guide_1').state.location, 'foyer');
const falseFailedEvent = executeLinkedActions({ actions: [sceneAction('refused', 'travel', 'attempted')],
events: [moveEvent('refused', 'guide_1')],
narrative: [passage('refused', 'The guide refuses to move.')] },
world, session, { canMove: openRoute, requireEffectWitnesses: true });
assert.equal(falseFailedEvent.ok, false);
assert.equal(falseFailedEvent.errors[0].code, 'failed_action_has_completed_event');
assert.equal(session.entityStates.guide_1.location, 'foyer');
const forced = executeLinkedActions({ actions: [sceneAction('force', 'physical', 'resolved',
    { actor_move: [{ actor_id: 'guide_1', to_location_id: 'archive' }] })],
events: [moveEvent('force', 'guide_1')],
narrative: [passage('force', 'The push carries the guide into the archive.')] },
world, session, { canMove: openRoute, requireEffectWitnesses: true });
assert(forced.ok, JSON.stringify(forced.errors));
assert.equal(forced.working.getEntity('guide_1').state.location, 'archive');
const resisted = executeLinkedActions({ actions: [sceneAction('resist', 'physical', 'attempted')],
events: [], narrative: [passage('resist', 'The guide braces against the push and stays put.')] },
world, session, { canMove: openRoute, requireEffectWitnesses: true });
assert(resisted.ok, JSON.stringify(resisted.errors));
assert.equal(resisted.working.getEntity('guide_1').state.location, 'foyer');
const conditionEvent = { type: 'condition', actor_id: 'guide_1', condition: 'shaken',
    action: 'add', status: 'completed', action_id: 'change', passage_id: 'change_p' };
const changed = executeLinkedActions({ actions: [sceneAction('change', 'physical', 'resolved',
    { condition_change: [{ target_id: 'guide_1', condition: 'shaken', action: 'add' }] })],
events: [conditionEvent], narrative: [passage('change', 'The guide remains shaken.')] },
world, session, { requireEffectWitnesses: true });
assert(changed.ok, JSON.stringify(changed.errors));
assert(changed.working.getEntity('guide_1').state.conditions.includes('shaken'));
const unchanged = executeLinkedActions({ actions: [sceneAction('nochange', 'physical', 'attempted')],
events: [], narrative: [passage('nochange', 'The guide steadies themself.')] },
world, session, { requireEffectWitnesses: true });
assert(unchanged.ok, JSON.stringify(unchanged.errors));
assert.equal(unchanged.working.getEntity('guide_1').state.conditions, undefined);
const falseArrival = executeLinkedActions({ actions: [sceneAction('false_move', 'physical',
    'resolved', { actor_move: [{ actor_id: 'guide_1', to_location_id: 'archive' }] })],
events: [{ ...moveEvent('false_move', 'guide_1'), to_location_id: 'foyer' }],
narrative: [passage('false_move', 'The guide enters the archive.')] },
world, session, { canMove: openRoute, requireEffectWitnesses: true });
assert(!falseArrival.ok, 'a mismatched completed movement must roll back');
assert.equal(session.entityStates.guide_1.location, 'foyer');
const unnoticedFollower = executeLinkedActions({ actions: [sceneAction('unnoticed', 'travel',
    'resolved', { actor_move: [{ actor_id: 'player', to_location_id: 'archive' }] })],
events: [moveEvent('unnoticed', 'player')],
narrative: [passage('unnoticed', 'You and the guide reach the archive.')] },
world, session, { canMove: openRoute, requireEffectWitnesses: true });
assert(!unnoticedFollower.ok, 'a follower cannot move without a matching completed event');
assert.equal(session.entityStates.guide_1.location, 'foyer');
const withinRoom = executeLinkedActions({ actions: [sceneAction('shove', 'physical',
    'resolved')], events: [{ type: 'interaction', actor_id: 'player', status: 'completed',
    action_id: 'shove', passage_id: 'shove_p', target_id: 'guide_1' }],
narrative: [passage('shove', 'The guide stumbles toward the wall but stays in the foyer.')] },
world, session, { requireEffectWitnesses: true });
assert(withinRoom.ok, JSON.stringify(withinRoom.errors));
assert.equal(withinRoom.working.getEntity('guide_1').state.location, 'foyer');
const partial = executeLinkedActions({ actions: [sceneAction('grip', 'physical',
    'resolved', { condition_change: [{ target_id: 'guide_1', condition: 'held',
        action: 'add' }] })], events: [{ type: 'condition', actor_id: 'guide_1',
        condition: 'held', action: 'add', status: 'completed', action_id: 'grip',
        passage_id: 'grip_p' }],
narrative: [passage('grip', 'You hold the guide, but cannot drag them through the gate.')] },
world, session, { requireEffectWitnesses: true });
assert(partial.ok, JSON.stringify(partial.errors));
assert(partial.working.getEntity('guide_1').state.conditions.includes('held'));
assert.equal(partial.working.getEntity('guide_1').state.location, 'foyer');
const journey = executeLinkedActions({ actions: [sceneAction('depart', 'physical',
    'resolved', { actor_move: [{ actor_id: 'guide_1', to_location_id: 'archive',
        mode: 'journey' }] })], events: [{ type: 'activity', actor_id: 'guide_1',
        to_location_id: 'archive', status: 'completed', action_id: 'depart',
        passage_id: 'depart_p' }], narrative: [passage('depart',
        'The guide sets out for the archive and has not arrived yet.')] },
world, session, { canMove: openRoute, requireEffectWitnesses: true,
    startJourney: (working, actor, target) => {
        working.writeEntity(actor, entity => { entity.state.journey = { destinationId: target }; });
        return true;
    } });
assert(journey.ok, JSON.stringify(journey.errors));
assert.equal(journey.working.getEntity('guide_1').state.location, 'foyer');
assert.equal(journey.working.getEntity('guide_1').state.journey.destinationId, 'archive');
(async () => {
    let saved;
    await accepted.working.commit(async candidate => {
        saved = JSON.stringify({ world: candidate.world, session: candidate.session });
    }, session.worldStateVersion);
    const reloaded = JSON.parse(saved);
    assert.equal(reloaded.session.playerLocation, 'archive');
    assert.equal(reloaded.session.entityStates.guide_1.location, 'archive');
    assert.deepEqual(reloaded.session.inventory, session.inventory);
    assert.equal(session.entityStates.guide_1.location, 'archive',
        'the confirmed move publishes only after persistence');
    console.log('PASS linked action chain, NPC movement and state, rollback, save/reload');
})().catch(error => { console.error(error); process.exitCode = 1; });
