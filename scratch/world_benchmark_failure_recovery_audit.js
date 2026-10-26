'use strict';
const assert = require('node:assert/strict');
const scene = require('../worlds/scene-draft');
const binding = require('../worlds/turn-binding');
const linked = require('../worlds/linked-world-actions');

const fields = Object.fromEntries(['type', 'actor_id', 'status', 'action', 'item',
    'from_location_id', 'to_location_id', 'movement_mode', 'evidence']
    .map(key => [key, { type: 'string', maxLength: 1000 }]));
const effects = {
    item_transfer: { type: 'array', items: { type: 'object', properties: {
        item_id: { type: 'string' }, from_id: { type: 'string' }, to_id: { type: 'string' }
    }, required: ['item_id', 'from_id', 'to_id'] } },
    actor_move: { type: 'array', items: { type: 'object', properties: {
        actor_id: { type: 'string' }, to_location_id: { type: 'string' }
    }, required: ['actor_id', 'to_location_id'] } }
};
const canonical = scene.schema({ events: { type: 'array', items: { type: 'object',
    properties: fields, required: ['type', 'actor_id', 'status'] } }, ...effects },
    'scene_draft_v3', { linkedRequired: true });
const references = [{ id: 'key', name: 'Bronze key', type: 'item' },
    { id: 'round_room', name: 'Round Room', type: 'location' }];
const rules = [{ id: 'focus', name: 'Focus', match: { kind: 'physical',
    requestIncludes: 'focus' }, values: [{ subject: 'actor', source: 'stat', key: 'focus' }],
    difficulty: 7, results: [{ id: 'pass', kind: 'success', minMargin: 0, effects: [] },
        { id: 'fail', kind: 'failure', minMargin: -100, effects: [] }] }];
const proposal = (kind, text, status = 'resolved', actionEffects = []) => ({
    protocol: 'scene_draft_v3', actions: [{ kind, status, effects: actionEffects,
        response: [{ text }] }] });
function bind(input, draft, extra = {}) {
    return binding.bind(draft, { turnId: 'benchmark', input, references,
        universalCheckRules: rules, ...extra }, canonical);
}
function reason(result) { return result.errors?.map(item => item.reason) || []; }

// These two shapes reproduce the documented model disposition and missing payload.
assert(reason(bind('I take the key from the table.', proposal('speech',
    'You lift the key from the table.'))).includes('player_action_kind_mismatch'));
assert(reason(bind('I focus on the inscription on the table.', proposal('speech',
    'The inscription responds.'))).includes('universal_check_kind_mismatch'));

const goodPickup = bind('I take the key from the table.', proposal('physical',
    'You take the key.', 'resolved', { item_transfer: [{ item_id: 'key',
        from_id: 'foyer', to_id: 'player' }] }));
assert(goodPickup.ok, JSON.stringify(goodPickup.errors));
for (const input of ['Where is the key?', 'I ask Linda to take the key.',
    'I do not take the key.', 'I say "I take the key".',
    'Wo ist der Schlüssel?', 'Ich sage: "Nimm den Schlüssel."'])
    assert(bind(input, proposal('speech', 'Linda listens.'), { universalCheckRules: [] }).ok,
        input);
assert(bind('I look at the key.', proposal('observation', 'The key lies there.'),
    { universalCheckRules: [] }).ok);
assert(bind('I tell Linda to wait, then I take the key.', {
    protocol: 'scene_draft_v3', actions: [
        { request: 'I tell Linda to wait,', kind: 'speech', status: 'resolved',
            response: [{ text: 'Linda nods.' }], effects: [] },
        { request: 'then I take the key.', kind: 'speech', status: 'resolved',
            response: [{ text: 'You lift the key.' }], effects: [] }
    ] }, { universalCheckRules: [] }).errors.some(item => item.reason === 'player_action_kind_mismatch'));

const movement = bind('I walk through the open door to the Round Room.',
    proposal('travel', 'You enter the Round Room.'), { universalCheckRules: [] });
assert(reason(movement).includes('missing_player_movement_proof'));
assert(reason(bind('I take the key from the table.', proposal('physical',
    'You take the key.'), { universalCheckRules: [] })).includes('missing_player_pickup_proof'));
assert(bind('I take a look at the key.', proposal('observation',
    'The key lies there.'), { universalCheckRules: [] }).ok);
const combinedPickup = bind('I tell Linda to wait, then I take the key.', {
    protocol: 'scene_draft_v3', actions: [
        { request: 'I tell Linda to wait,', kind: 'speech', status: 'resolved',
            response: [{ text: 'Linda nods.' }], effects: [] },
        { request: 'then I take the key.', kind: 'physical', status: 'resolved',
            response: [{ text: 'You take the key.' }], effects: {
                item_transfer: [{ item_id: 'key', from_id: 'foyer', to_id: 'player' }] } }
    ] }, { universalCheckRules: [] });
assert(combinedPickup.ok, JSON.stringify(combinedPickup.errors));
assert.equal(combinedPickup.draft.actions.length, 2);
const world = { id: 'benchmark', locations: [{ id: 'foyer', exits: [
    { targetLocationId: 'round_room' }] }, { id: 'round_room', exits: [] }], entities: [] };
const session = { id: 'isolated', playerLocation: 'foyer', inventory: [], turnCount: 2,
    entityStates: {} };
const noMove = linked.executeLinkedActions({ actions: [{ action_id: 'a',
    kind: 'travel', status: 'resolved', request: 'I walk to the Round Room.',
    response_id: 'p', action_effects: {} }], narrative: [{ id: 'p', action_id: 'a',
    text: 'You enter the Round Room.' }], events: [] }, world, session);
assert(!noMove.ok && reason(noMove).includes('unverified_action_success'));
assert.equal(session.playerLocation, 'foyer');
assert.deepEqual(session.inventory, []);
const movePlan = { actions: [{ action_id: 'a', kind: 'travel', status: 'resolved',
    request: 'I walk to the Round Room.', response_id: 'p', action_effects: {
        actor_move: [{ actor_id: 'player', to_location_id: 'round_room' }] } }],
    narrative: [{ id: 'p', action_id: 'a', text: 'You enter the Round Room.' }],
    events: [{ id: 'e', action_id: 'a', passage_id: 'p', type: 'movement',
        actor_id: 'player', status: 'completed', from_location_id: 'foyer',
        to_location_id: 'round_room', movement_mode: 'voluntary' }] };
const moved = linked.executeLinkedActions(movePlan, world, session);
assert(moved.ok, JSON.stringify(moved.errors));
assert.equal(moved.working.prepare().session.playerLocation, 'round_room');
assert.equal(session.playerLocation, 'foyer');
assert(moved.events.some(event => event.type === 'movement' && event.actor_id === 'player'
    && event.from_location_id === 'foyer' && event.to_location_id === 'round_room'));
const wrongMovementEvent = structuredClone(movePlan);
wrongMovementEvent.events[0].from_location_id = 'round_room';
const wrongMovement = linked.executeLinkedActions(wrongMovementEvent, world, session);
assert(!wrongMovement.ok && reason(wrongMovement).includes('unwitnessed_companion_or_actor_move'),
    JSON.stringify(wrongMovement.errors));
assert.equal(session.playerLocation, 'foyer');
const unknownDestination = structuredClone(movePlan);
unknownDestination.actions[0].action_effects.actor_move[0].to_location_id = 'unknown_room';
unknownDestination.events[0].to_location_id = 'unknown_room';
assert(!linked.executeLinkedActions(unknownDestination, world, session).ok);
assert.equal(session.playerLocation, 'foyer');

const itemWorld = { ...world, entities: [{ id: 'key', name: 'Bronze key', type: 'item' }] };
const itemSession = { ...structuredClone(session), entityStates: { key: { location: 'foyer' } } };
const pickupPlan = { actions: [{ action_id: 'take', kind: 'physical', status: 'resolved',
    request: 'I take the key from the table.', response_id: 'take_p', action_effects: {
        item_transfer: [{ item_id: 'key', from_id: 'foyer', to_id: 'player' }] } }],
    narrative: [{ id: 'take_p', action_id: 'take', text: 'You take the key.' }],
    events: [{ id: 'take_e', action_id: 'take', passage_id: 'take_p', type: 'inventory',
        actor_id: 'player', status: 'completed', action: 'take', item: 'key' }] };
const pickedUp = linked.executeLinkedActions(pickupPlan, itemWorld, itemSession,
    { requireEffectWitnesses: true });
assert(pickedUp.ok, JSON.stringify(pickedUp.errors));
assert.deepEqual(pickedUp.working.prepare().session.inventory, ['Bronze key']);
assert.equal(pickedUp.working.getEntity('key').state.location, '');
assert(pickedUp.confirmedEffects.some(effect => effect.type === 'item_transfer'
    && effect.action_id === 'take'));
assert.deepEqual(itemSession.inventory, []);
assert.equal(itemSession.entityStates.key.location, 'foyer');
const unwitnessedPickup = structuredClone(pickupPlan);
unwitnessedPickup.events = [];
assert(!linked.executeLinkedActions(unwitnessedPickup, itemWorld, itemSession,
    { requireEffectWitnesses: true }).ok);
assert.deepEqual(itemSession.inventory, []);
const narratedPickup = structuredClone(pickupPlan);
narratedPickup.actions[0].action_effects = {};
narratedPickup.events = [];
const unprovedPickup = linked.executeLinkedActions(narratedPickup, itemWorld, itemSession);
assert(!unprovedPickup.ok && reason(unprovedPickup).includes('unverified_action_success'));
assert.deepEqual(itemSession.inventory, []);
const dependentPickup = structuredClone(pickupPlan);
dependentPickup.actions.unshift({ action_id: 'ask', kind: 'speech', status: 'resolved',
    request: 'I tell Linda to wait.', response_id: 'ask_p', action_effects: {} });
dependentPickup.actions[1].depends_on = [{ action_id: 'ask', outcome: 'succeeded' }];
dependentPickup.narrative.unshift({ id: 'ask_p', action_id: 'ask', text: 'Linda nods.' });
const dependent = linked.executeLinkedActions(dependentPickup, itemWorld, itemSession,
    { requireEffectWitnesses: true });
assert(dependent.ok, JSON.stringify(dependent.errors));
assert.deepEqual(Object.fromEntries(dependent.outcomes),
    { ask: 'succeeded', take: 'succeeded' });
assert.deepEqual(dependent.working.prepare().session.inventory, ['Bronze key']);

const checkWorld = { ...world, gameRules: { universalChecks: { enabled: true,
    rules: [{ ...rules[0], results: [{ ...rules[0].results[0],
        costs: [{ resourceId: 'energy', amount: 2 }] }, rules[0].results[1]] }] } } };
const checkSession = { ...session, playerStats: { focus: 9, energy: 5 },
    playerIdentity: { skills: [] } };
const focusPlan = { actions: [{ action_id: 'a', kind: 'physical', status: 'resolved',
    request: 'I focus on the inscription on the table.', response_id: 'p',
    action_effects: {} }], narrative: [{ id: 'p', action_id: 'a',
    text: 'You study the inscription.' }], events: [{ id: 'e', action_id: 'a',
        passage_id: 'p', type: 'interaction', actor_id: 'player', status: 'completed' }] };
const focused = linked.executeLinkedActions(focusPlan, checkWorld, checkSession);
assert(focused.ok, JSON.stringify(focused.errors));
assert.equal(focused.checkResults[0].kind, 'success');
assert.equal(focused.working.prepare().session.playerStats.energy, 3);
assert.equal(checkSession.playerStats.energy, 5);
assert(focused.confirmedEffects.some(effect => effect.type === 'resource_cost'
    && effect.origin === 'engine'));
const failedCheckWorld = structuredClone(checkWorld);
failedCheckWorld.gameRules.universalChecks.rules[0].results[1].costs = [
    { resourceId: 'energy', amount: 1 }];
const failedCheckSession = { ...structuredClone(checkSession), playerStats: {
    focus: 3, energy: 5 } };
const failedFocusPlan = structuredClone(focusPlan);
failedFocusPlan.actions[0].status = 'attempted';
failedFocusPlan.events = [];
const failedFocus = linked.executeLinkedActions(failedFocusPlan,
    failedCheckWorld, failedCheckSession);
assert(failedFocus.ok, JSON.stringify(failedFocus.errors));
assert.equal(failedFocus.checkResults[0].kind, 'failure');
assert.equal(failedFocus.outcomes.get('a'), 'failed');
assert.equal(failedFocus.working.prepare().session.playerStats.energy, 4);
assert.equal(failedCheckSession.playerStats.energy, 5);
const rejectedFocus = linked.executeLinkedActions(focusPlan,
    failedCheckWorld, failedCheckSession);
assert(!rejectedFocus.ok && reason(rejectedFocus).includes('check_outcome_status_mismatch'));
assert.equal(failedCheckSession.playerStats.energy, 5);
const disabledChecks = structuredClone(checkWorld);
disabledChecks.gameRules.universalChecks.enabled = false;
const withoutChecks = linked.executeLinkedActions(focusPlan, disabledChecks, checkSession);
assert(withoutChecks.ok, JSON.stringify(withoutChecks.errors));
assert.deepEqual(withoutChecks.checkResults, []);
assert.equal(withoutChecks.working.prepare().session.playerStats.energy, 5);
const legacyWorld = structuredClone(checkWorld);
delete legacyWorld.gameRules.universalChecks;
assert.equal(linked.executeLinkedActions(focusPlan, legacyWorld, checkSession)
    .checkResults.length, 0);

const germanRefs = [{ id: 'schluessel', name: 'Schlüssel', type: 'item' }];
assert(reason(bind('Ich nehme den Schlüssel.', proposal('speech',
    'Du nimmst den Schlüssel.'), { references: germanRefs,
    universalCheckRules: [] })).includes('player_action_kind_mismatch'));
assert(bind('Ich nehme den Schlüssel nicht.', proposal('speech',
    'Du lässt ihn liegen.'), { references: germanRefs,
    universalCheckRules: [] }).ok);
(async () => {
    let savedPickup;
    await pickedUp.working.commit(async candidate => {
        savedPickup = JSON.stringify(candidate);
    });
    const reloadedPickup = JSON.parse(savedPickup);
    assert.deepEqual(reloadedPickup.session.inventory, ['Bronze key']);
    assert.equal(reloadedPickup.session.entityStates.key.location, '');
    assert.deepEqual(itemSession.inventory, reloadedPickup.session.inventory);
    let savedMove;
    await moved.working.commit(async candidate => {
        savedMove = JSON.stringify(candidate);
    });
    assert.equal(JSON.parse(savedMove).session.playerLocation, 'round_room');
    assert.equal(session.playerLocation, 'round_room');
    console.log('PASS benchmark failure recovery: intent, pickup, movement, checks, costs, rollback, save/reload');
})().catch(error => { console.error(error); process.exitCode = 1; });
