'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const scene = require('../worlds/scene-draft');
const binding = require('../worlds/turn-binding');
const linked = require('../worlds/linked-world-actions');
const { executeNpcGoalStep } = require('../worlds/npc-goal-actions');

const world = JSON.parse(fs.readFileSync(path.join(__dirname,
    'world-model-p43b-2026-10-27/The_Submission_Vault_source.horde_world'), 'utf8'));
const linda = world.entities.find(entity => entity.type === 'npc' && entity.name === 'Linda');
const key = world.entities.find(entity => entity.type === 'item'
    && entity.name === 'Cell key' && entity.startLocation === 'loc_antechamber');
const door = 'door:loc_antechamber::loc_round_room';
assert(linda && key);
const inputParts = [
    'I ask Linda to come with me. ',
    'I take my Cell key and open the door to the Round Room. ',
    'I walk into the Round Room with her if she agrees.'
];
const input = inputParts.join('');
const fields = Object.fromEntries(['type', 'actor_id', 'status', 'action',
    'target_id', 'from_location_id', 'to_location_id', 'item']
    .map(name => [name, { type: 'string', maxLength: 1000 }]));
const canonical = scene.schema({ events: { type: 'array', items: { type: 'object',
    properties: fields, required: ['type', 'actor_id', 'status'] } } },
'scene_draft_v3', { linkedRequired: true, input });
const seed = () => ({ id: 'vault_p43e', playerLocation: 'loc_antechamber',
    inventory: ['Cell key'], unlockedExits: {}, turnCount: 1, worldStateVersion: 0,
    entityStates: { [linda.id]: { location: 'loc_antechamber', inventory: [] } },
    locationStates: {}, npcRelationships: {}, engineEvents: [] });
const proposal = { protocol: 'scene_draft_v3', actions: [
    { request: inputParts[0], kind: 'speech', status: 'resolved', effects: [],
        response: [{ text: 'Linda considers your invitation.' }] },
    { request: inputParts[1], kind: 'physical', status: 'resolved',
        effects: { interactable_transition: [{ target_id: door, actor_id: 'player',
            to_state: 'open' }] }, response: [{ text: 'The Cell key turns and the door opens.',
            events: [{ type: 'environment', actor_id: 'player', status: 'completed',
                target_id: door, action: 'open' }] }] },
    { request: inputParts[2], kind: 'travel', status: 'resolved',
        state_conditions: [{ fact: 'following_player', subject_id: linda.id,
            operator: 'equals', value: 'true' }],
        effects: { actor_move: [{ actor_id: 'player',
            to_location_id: 'loc_round_room', companion_ids: [linda.id] }] },
        response: [{ text: 'You and Linda enter the Round Room.', events: [
            { type: 'movement', actor_id: 'player', status: 'completed',
                from_location_id: 'loc_antechamber', to_location_id: 'loc_round_room' },
            { type: 'movement', actor_id: linda.id, status: 'completed',
                from_location_id: 'loc_antechamber', to_location_id: 'loc_round_room' }
        ] }] }
], reactions: [{ after_action_index: 0,
    text: 'Linda says "I will come with you."',
    speech: [{ speaker: linda.id, listeners: ['player'],
        quote: 'I will come with you.' }],
    effects: { npc_follow: [{ actor_id: linda.id, following: true }] },
    events: [{ type: 'escort', actor_id: linda.id, status: 'completed',
        target_id: 'player', action: 'join' }] }] };
const references = [...world.locations.map(location => ({ id: location.id,
    name: location.name, type: 'location' })),
...world.entities.map(entity => ({ id: entity.id,
    name: entity.name, type: entity.type }))];
const context = { turnId: 'vault_p43e_turn', input, now: 480, references };
const bound = binding.bind(proposal, context, canonical);
assert(bound.ok, JSON.stringify(bound.errors));
assert.deepEqual(bound.draft.actions.map(action => action.action_id), [
    'vault_p43e_turn_action_0', 'vault_p43e_turn_world_0',
    'vault_p43e_turn_action_1', 'vault_p43e_turn_action_2']);
const compiled = scene.compile(bound.draft, { input,
    location: 'loc_antechamber', playerStart: 'loc_antechamber',
    present: [linda.id], locations: world.locations.map(location => location.id),
    now: 480, linkedRequired: true, contract: canonical });
assert(compiled.ok, JSON.stringify(compiled.errors));
const original = seed();
const executed = linked.executeLinkedActions(compiled.linkedPlan, world, original,
    { worldActionIds: bound.binding.worldActionIds, requireEffectWitnesses: true,
        canMove: (_world, session, _actor, from, to) => ({
            ok: from === 'loc_antechamber' && to === 'loc_round_room'
                && session.unlockedExits?.[door] === true,
            reason: 'locked_exit', travelTime: 0 }) });
assert(executed.ok, JSON.stringify(executed.errors));
assert.equal(original.playerLocation, 'loc_antechamber');
assert.equal(executed.working.getSession('unlockedExits')[door], true);
assert.equal(executed.working.getSession('playerLocation'), 'loc_round_room');
assert.equal(executed.working.getEntity(linda.id).state.location, 'loc_round_room');
assert.equal(executed.working.getEntity(linda.id).state.followingPlayer, true);
assert.deepEqual(executed.working.getSession('inventory'), ['Cell key']);
assert(executed.confirmedEffects.some(item => item.type === 'npc_follow'));
assert(executed.confirmedEffects.some(item => item.type === 'interactable_transition'));
assert(executed.confirmedEffects.some(item => item.type === 'actor_move'));
assert(executed.events.some(item => item.type === 'escort' && item.actor_id === linda.id));
assert(executed.events.some(item => item.type === 'movement' && item.actor_id === linda.id));
const refusal = structuredClone(proposal);
refusal.reactions[0] = { after_action_index: 0, text: 'Linda says "No."',
    speech: [{ speaker: linda.id, listeners: ['player'], quote: 'No.' }], effects: [] };
refusal.actions[2].status = 'blocked';
refusal.actions[2].effects = [];
refusal.actions[2].response = [{ text: 'Linda refuses to come; you remain here.' }];
const refusedBound = binding.bind(refusal, context, canonical);
assert(refusedBound.ok, JSON.stringify(refusedBound.errors));
const refusedCompiled = scene.compile(refusedBound.draft, { input,
    location: 'loc_antechamber', playerStart: 'loc_antechamber',
    present: [linda.id], locations: world.locations.map(location => location.id),
    now: 480, linkedRequired: true, contract: canonical });
assert(refusedCompiled.ok, JSON.stringify(refusedCompiled.errors));
const refused = linked.executeLinkedActions(refusedCompiled.linkedPlan, world, seed(),
    { worldActionIds: refusedBound.binding.worldActionIds, requireEffectWitnesses: true });
assert(refused.ok, JSON.stringify(refused.errors));
assert.equal(refused.working.getSession('playerLocation'), 'loc_antechamber');
assert.equal(refused.working.getSession('unlockedExits')[door], true,
    'the independent door opening remains successful');
const taskInput = 'I ask Linda to take the table Cell key and open the Round Room door.';
const taskProposal = { protocol: 'scene_draft_v3', actions: [{
    kind: 'speech', status: 'resolved', effects: [],
    response: [{ text: 'Linda considers the task.' }] }], reactions: [{
    after_action_index: 0, text: 'Linda says "I will take the key and open the door."',
    speech: [{ speaker: linda.id, listeners: ['player'],
        quote: 'I will take the key and open the door.' }],
    effects: { npc_goal_set: [{ actor_id: linda.id,
        goal: 'Take the table Cell key and open the Round Room door' }] },
    events: [{ type: 'quest', actor_id: linda.id, status: 'completed', action: 'accept' }]
}] };
const taskBound = binding.bind(taskProposal,
    { ...context, turnId: 'vault_p43e_task', input: taskInput }, canonical);
assert(taskBound.ok, JSON.stringify(taskBound.errors));
const taskCompiled = scene.compile(taskBound.draft, { input: taskInput,
    location: 'loc_antechamber', playerStart: 'loc_antechamber',
    present: [linda.id], locations: world.locations.map(location => location.id),
    now: 480, linkedRequired: true, contract: canonical });
assert(taskCompiled.ok, JSON.stringify(taskCompiled.errors));
const assigned = linked.executeLinkedActions(taskCompiled.linkedPlan, world, seed(),
    { worldActionIds: taskBound.binding.worldActionIds, requireEffectWitnesses: true });
assert(assigned.ok, JSON.stringify(assigned.errors));
assert.equal(assigned.working.getEntity(linda.id).state.goalStatus, 'active');
const unconsentedTask = structuredClone(taskProposal);
delete unconsentedTask.reactions[0].speech;
unconsentedTask.reactions[0].text = 'Linda considers the task without agreeing.';
const unconsentedBound = binding.bind(unconsentedTask,
    { ...context, turnId: 'vault_p43e_bad_task', input: taskInput }, canonical);
assert(unconsentedBound.ok, JSON.stringify(unconsentedBound.errors));
const unconsentedCompiled = scene.compile(unconsentedBound.draft, { input: taskInput,
    location: 'loc_antechamber', playerStart: 'loc_antechamber',
    present: [linda.id], locations: world.locations.map(location => location.id),
    now: 480, linkedRequired: true, contract: canonical });
assert(unconsentedCompiled.ok, JSON.stringify(unconsentedCompiled.errors));
const unconsented = linked.executeLinkedActions(unconsentedCompiled.linkedPlan, world, seed(),
    { worldActionIds: unconsentedBound.binding.worldActionIds, requireEffectWitnesses: true });
assert(!unconsented.ok && unconsented.errors.some(item =>
    item.reason === 'missing_npc_goal_consent'));
const disabledWorld = structuredClone(world);
disabledWorld.gameRules ||= {};
disabledWorld.gameRules.modules = { ...disabledWorld.gameRules.modules,
    livingWorld: false };
const disabledTask = linked.executeLinkedActions(taskCompiled.linkedPlan,
    disabledWorld, seed(), { worldActionIds: taskBound.binding.worldActionIds,
        requireEffectWitnesses: true });
assert(!disabledTask.ok && disabledTask.errors.some(item =>
    item.reason === 'module_disabled'));
let taskSession = JSON.parse(JSON.stringify(assigned.working.prepare().session));
for (const [index, step] of [
    { label: 'Linda takes the table key', effect: { type: 'item_transfer', payload: {
        actor_id: linda.id, item_id: key.id,
        from_id: 'loc_antechamber', to_id: linda.id } } },
    { label: 'Linda opens the Round Room door', effect: {
        type: 'interactable_transition', payload: {
            actor_id: linda.id, target_id: door, to_state: 'open' } } }
].entries()) {
    taskSession.turnCount += 1;
    const tick = executeNpcGoalStep(linda, step, world, taskSession);
    assert(tick.ok, `${index}: ${tick.reason}`);
    taskSession = JSON.parse(JSON.stringify(tick.candidate.session));
}
assert.equal(taskSession.entityStates[linda.id].goalStatus, 'active');
assert(taskSession.entityStates[linda.id].inventory.some(item => item.id === key.id));
assert.equal(taskSession.unlockedExits[door], true);
assert.deepEqual(taskSession.inventory, ['Cell key']);
(async () => {
    let saved;
    await executed.working.commit(async candidate => { saved = JSON.stringify(candidate); });
    const reloaded = JSON.parse(saved).session;
    assert.equal(reloaded.playerLocation, 'loc_round_room');
    assert.equal(reloaded.unlockedExits[door], true);
    assert.equal(reloaded.entityStates[linda.id].followingPlayer, true);
    assert.equal(reloaded.entityStates[linda.id].location, 'loc_round_room');
    assert.deepEqual(reloaded.inventory, ['Cell key']);
    console.log('PASS P4.3e bound Vault turn: NPC consent/refusal, door, movement, effects, events, reload');
})().catch(error => { console.error(error); process.exitCode = 1; });
