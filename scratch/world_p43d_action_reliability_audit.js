'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { executeLinkedActions } = require('../worlds/linked-world-actions');
const context = require('../worlds/turn-context');

const world = JSON.parse(fs.readFileSync(path.join(__dirname,
    'world-model-p43b-2026-10-27/The_Submission_Vault_source.horde_world'), 'utf8'));
const linda = world.entities.find(entity => entity.type === 'npc' && entity.name === 'Linda');
const key = world.entities.find(entity => entity.type === 'item'
    && entity.name === 'Cell key' && entity.startLocation === 'loc_antechamber');
const door = 'door:loc_antechamber::loc_round_room';
assert(linda && key);
const seed = () => ({ id: 'p43d_probe', playerLocation: 'loc_antechamber',
    inventory: ['Cell key'], unlockedExits: {}, turnCount: 1,
    entityStates: { [linda.id]: { location: 'loc_antechamber', inventory: [] } } });
const action = (id, kind, status, effects = {}, depends_on = []) => ({
    action_id: id, kind, status, request: id, response_id: `${id}_p`,
    action_effects: effects, depends_on });
const passage = (id, text) => ({ id: `${id}_p`, action_id: id, text });
const event = (id, type, actor, fields = {}) => ({ id: `${id}_event`,
    action_id: id, passage_id: `${id}_p`, type, actor_id: actor,
    status: 'completed', ...fields });
const canMove = (view, session, actor, from, to) => ({ ok: from === 'loc_antechamber'
    && to === 'loc_round_room' && session.unlockedExits?.[door] === true,
    reason: 'locked_exit', travelTime: 0 });

const initial = context.actionAffordances(world, seed(), 'loc_antechamber');
assert(initial.doors.some(item => item.door_id === door && item.lock_state === 'locked'
    && item.required_item === 'Cell key'
    && item.actors_holding_required_item.includes('player')));
assert(initial.loose_items.some(item => item.item_id === key.id));
assert.deepEqual(context.requestClauses('I ask Linda to wait and unlock the door.')
    .map(item => item.request), ['I ask Linda to wait', 'and unlock the door.']);
assert.equal(context.contextBudget({ lore: 320 }).parts.lore.estimatedTokens, 100);

const player = seed();
const playerPlan = { actions: [
    action('ask', 'speech', 'resolved'),
    action('unlock', 'physical', 'resolved', { interactable_transition: [{
        target_id: door, actor_id: 'player', to_state: 'open' }] }),
    action('enter', 'travel', 'resolved', { actor_move: [{ actor_id: 'player',
        to_location_id: 'loc_round_room' }] }, [{ action_id: 'unlock', outcome: 'succeeded' }])
], narrative: [passage('ask', 'Linda hears the request.'),
    passage('unlock', 'The door opens.'), passage('enter', 'You enter the Round Room.')],
events: [event('unlock', 'environment', 'player', { target_id: door }),
    event('enter', 'movement', 'player', { from_location_id: 'loc_antechamber',
        to_location_id: 'loc_round_room' })] };
const opened = executeLinkedActions(playerPlan, world, player,
    { canMove, requireEffectWitnesses: true });
assert(opened.ok, JSON.stringify(opened.errors));
assert.equal(opened.working.getSession('unlockedExits')[door], true);
assert.equal(opened.working.getSession('playerLocation'), 'loc_round_room');
assert.equal(player.playerLocation, 'loc_antechamber');
const accompanied = executeLinkedActions({ actions: [
    action('ask_linda', 'speech', 'resolved'),
    action('linda_joins', 'other', 'resolved', { npc_follow: [{
        actor_id: linda.id, following: true }] }),
    action('open_for_both', 'physical', 'resolved', { interactable_transition: [{
        target_id: door, actor_id: 'player', to_state: 'open' }] },
    [{ action_id: 'linda_joins', outcome: 'succeeded' }]),
    Object.assign(action('both_enter', 'travel', 'resolved', { actor_move: [{ actor_id: 'player',
        to_location_id: 'loc_round_room' }] },
    [{ action_id: 'open_for_both', outcome: 'succeeded' }]), {
        state_conditions: [{ fact: 'following_player', subject_id: linda.id,
            operator: 'equals', value: 'true' }] })
], narrative: [passage('ask_linda', 'You invite Linda to come.'),
    passage('linda_joins', 'Linda says, "I will come with you."'),
    passage('open_for_both', 'The door opens.'),
    passage('both_enter', 'You and Linda enter the Round Room.')],
speech: [{ speaker: linda.id, statement: 'I will come with you.',
    listeners: ['player'], action_id: 'linda_joins', passage_id: 'linda_joins_p' }],
events: [event('linda_joins', 'escort', linda.id, { target_id: 'player',
    action: 'join', evidence: 'Linda says, "I will come with you."' }),
    event('open_for_both', 'environment', 'player', { target_id: door }),
    event('both_enter', 'movement', 'player', { from_location_id: 'loc_antechamber',
        to_location_id: 'loc_round_room' }),
    event('both_enter', 'movement', linda.id, { from_location_id: 'loc_antechamber',
        to_location_id: 'loc_round_room', id: 'linda_move_event' })] }, world, seed(),
{ canMove, requireEffectWitnesses: true });
assert(accompanied.ok, JSON.stringify(accompanied.errors));
assert.equal(accompanied.working.getEntity(linda.id).state.followingPlayer, true);
assert.equal(accompanied.working.getEntity(linda.id).state.location, 'loc_round_room');
assert.equal(accompanied.working.getSession('playerLocation'), 'loc_round_room');
const continuation = accompanied.working.prepare().session;
continuation.turnCount += 1;
const continued = executeLinkedActions({ actions: [action('return', 'travel', 'resolved',
    { actor_move: [{ actor_id: 'player', to_location_id: 'loc_antechamber' }] })],
    narrative: [passage('return', 'You and Linda return to the Antechamber.')],
    events: [event('return', 'movement', 'player', {
        from_location_id: 'loc_round_room', to_location_id: 'loc_antechamber' }),
    event('return', 'movement', linda.id, { id: 'linda_return_event',
        from_location_id: 'loc_round_room', to_location_id: 'loc_antechamber' })] },
world, continuation, { requireEffectWitnesses: true, canMove: (_view, _session,
    _actor, from, to) => ({ ok: from === 'loc_round_room'
        && to === 'loc_antechamber', travelTime: 0 }) });
assert(continued.ok, JSON.stringify(continued.errors));
assert.equal(continued.working.getEntity(linda.id).state.location, 'loc_antechamber');
assert.equal(continued.working.getEntity(linda.id).state.followingPlayer, true);
const noConsent = executeLinkedActions({ actions: [action('linda_joins', 'other', 'resolved',
    { npc_follow: [{ actor_id: linda.id, following: true }] })],
    narrative: [passage('linda_joins', 'Linda follows.')],
    events: [event('linda_joins', 'escort', linda.id,
        { target_id: 'player', action: 'join', evidence: 'Linda follows.' })] },
world, seed(), { requireEffectWitnesses: true });
assert(!noConsent.ok && noConsent.errors.some(item => item.reason === 'missing_npc_follow_consent'));
const tableKeyOwner = seed();
tableKeyOwner.inventory = [{ id: key.id, name: 'Cell key', quantity: 1 }];
tableKeyOwner.entityStates[key.id] = { location: '', quantity: 0 };
const tableKeyOpen = executeLinkedActions({ actions: [playerPlan.actions[1]],
    narrative: [playerPlan.narrative[1]], events: [playerPlan.events[0]] },
world, tableKeyOwner, { requireEffectWitnesses: true });
assert(tableKeyOpen.ok, JSON.stringify(tableKeyOpen.errors));
assert.equal(tableKeyOpen.working.getSession('unlockedExits')[door], true,
    'the distinct table key opens the same name-gated door');

const npc = seed();
const npcPlan = { actions: [
    action('request', 'speech', 'resolved'),
    action('linda_takes', 'physical', 'resolved', { item_transfer: [{ item_id: key.id,
        from_id: 'loc_antechamber', to_id: linda.id, actor_id: linda.id }] }),
    action('linda_opens', 'physical', 'resolved', { interactable_transition: [{
        target_id: door, actor_id: linda.id, to_state: 'open' }] },
    [{ action_id: 'linda_takes', outcome: 'succeeded' }])
], narrative: [passage('request', 'Linda agrees to help.'),
    passage('linda_takes', 'Linda takes the table key.'),
    passage('linda_opens', 'Linda opens the door.')], events: [
    event('linda_takes', 'inventory', linda.id, { item: 'Cell key', action: 'take' }),
    event('linda_opens', 'environment', linda.id, { target_id: door })] };
const helped = executeLinkedActions(npcPlan, world, npc,
    { requireEffectWitnesses: true });
assert(helped.ok, JSON.stringify(helped.errors));
assert.equal(helped.working.getSession('unlockedExits')[door], true);
assert.deepEqual(helped.working.getEntity(linda.id).state.inventory,
    [{ id: key.id, name: 'Cell key', quantity: 1 }]);
assert.deepEqual(helped.working.getSession('inventory'), ['Cell key']);
assert.equal(helped.working.getEntity(key.id).state.quantity, 0);
const handoff = executeLinkedActions({ actions: [action('give_key', 'physical', 'resolved',
    { item_transfer: [{ item_id: key.id, from_id: linda.id, to_id: 'player',
        actor_id: linda.id }] })],
    narrative: [passage('give_key', 'Linda gives the table key to you.')],
    events: [event('give_key', 'inventory', linda.id,
        { item: 'Cell key', action: 'give' })] }, world,
helped.working.prepare().session, { requireEffectWitnesses: true });
assert(handoff.ok, JSON.stringify(handoff.errors));
assert(handoff.working.getSession('inventory').some(item => item?.id === key.id));
assert.equal(handoff.working.getEntity(linda.id).state.inventory.length, 0);

const noKey = seed(); noKey.inventory = ['Brass key'];
const denied = executeLinkedActions({ actions: [action('unlock', 'physical', 'blocked',
    { interactable_transition: [{ target_id: door, actor_id: 'player', to_state: 'open' }] })],
    narrative: [passage('unlock', 'The wrong key does not turn.')], events: [] }, world, noKey);
assert(denied.ok, JSON.stringify(denied.errors));
assert.equal(denied.outcomes.get('unlock'), 'blocked');
assert.equal(denied.working.getSession('unlockedExits')?.[door], undefined);
const wrongInstance = executeLinkedActions({ actions: [action('give', 'physical', 'blocked',
    { item_transfer: [{ item_id: key.id, from_id: 'player', to_id: linda.id }] })],
    narrative: [passage('give', 'The table key is not held.')], events: [] }, world, seed());
assert(wrongInstance.ok, JSON.stringify(wrongInstance.errors));
assert.equal(wrongInstance.outcomes.get('give'), 'blocked');
let keyedRoutes = 0;
for (const location of world.locations) for (const exit of location.exits || []) {
    if (exit.requiredItem !== 'Cell key' || exit.lockState !== 'locked') continue;
    for (const inventory of [['Cell key'], [{ id: key.id, name: 'Cell key', quantity: 1 }]]) {
        const local = seed(); local.playerLocation = location.id;
        local.inventory = inventory;
        if (typeof inventory[0] === 'object')
            local.entityStates[key.id] = { location: '', quantity: 0 };
        const plan = { actions: [
            action('open_cell', 'physical', 'resolved', { interactable_transition: [{
                target_id: exit.doorId, actor_id: 'player', to_state: 'open' }] }),
            action('close_cell', 'physical', 'resolved', { interactable_transition: [{
                target_id: exit.doorId, actor_id: 'player', to_state: 'locked' }] },
            [{ action_id: 'open_cell', outcome: 'succeeded' }])],
        narrative: [passage('open_cell', 'The keyed door opens.'),
            passage('close_cell', 'The keyed door locks again.')],
        events: [event('open_cell', 'environment', 'player', { target_id: exit.doorId }),
            event('close_cell', 'environment', 'player', { target_id: exit.doorId })] };
        const result = executeLinkedActions(plan, world, local,
            { requireEffectWitnesses: true });
        assert(result.ok, `${location.id} ${exit.doorId}: ${JSON.stringify(result.errors)}`);
        assert.equal(result.working.getSession('unlockedExits')?.[exit.doorId], undefined);
        keyedRoutes++;
    }
}
assert(keyedRoutes >= 20, 'both key instances must open and close the authored cell routes');

(async () => {
    let saved;
    await helped.working.commit(async candidate => { saved = JSON.stringify(candidate); });
    const reloaded = JSON.parse(saved).session;
    assert.equal(reloaded.unlockedExits[door], true);
    assert.equal(reloaded.entityStates[linda.id].inventory[0].id, key.id);
    assert.deepEqual(reloaded.inventory, ['Cell key']);
    let accompaniedSaved;
    await accompanied.working.commit(async candidate => {
        accompaniedSaved = JSON.stringify(candidate);
    });
    const accompaniedReloaded = JSON.parse(accompaniedSaved).session;
    assert.equal(accompaniedReloaded.entityStates[linda.id].followingPlayer, true);
    assert.equal(accompaniedReloaded.entityStates[linda.id].location, 'loc_round_room');
    assert.equal(accompaniedReloaded.playerLocation, 'loc_round_room');
    console.log('PASS P4.3d context, speech plus action, door chain, NPC key identity, rollback controls, reload');
})().catch(error => { console.error(error); process.exitCode = 1; });
