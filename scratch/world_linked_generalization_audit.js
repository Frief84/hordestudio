/** Unseen world names, verbs, entities and state graphs use the same operations. */
'use strict';
const assert = require('node:assert/strict');
const { compile } = require('../worlds/scene-draft');
const { executeLinkedActions } = require('../worlds/linked-world-actions');

function runWorld(seed, verb, initialState, nextState, requirement) {
    const world = { id: `world_${seed}`, entities: [{ id: `device_${seed}`,
        name: `Device ${seed}`, type: 'object', interactable: {
            initialState, transitions: [{ from: initialState, to: nextState,
                requiredItem: requirement }] } }], locations: [
        { id: `place_${seed}`, name: `Place ${seed}`, exits: [] }
    ] };
    const session = { id: `session_${seed}`, playerLocation: `place_${seed}`,
        entityStates: { [`device_${seed}`]: { location: `place_${seed}` } },
        locationStates: {}, inventory: [requirement], npcRelationships: {},
        history: [], turnCount: 1, worldStateVersion: 1 };
    const input = `I ${verb} the device.`;
    const draft = { protocol: 'scene_draft_v3', narrative: [
        { id: 'p1', action_id: 'alter_device', text: `The device becomes ${nextState}.` }
    ], actions: [{ action_id: 'alter_device', kind: 'physical', status: 'resolved',
        response_id: 'p1', action_effects: { interactable_transition: [
            { target_id: `device_${seed}`, to_state: nextState } ] } }],
    events: [], effects: {}, speech: [], commitments: [] };
    const compiled = compile(draft, { input, linkedRequired: true, effectKeys: [],
        inventory: session.inventory, locations: world.locations.map(item => item.id),
        present: [], commitments: [], now: 0 });
    assert(compiled.ok, JSON.stringify(compiled.errors));
    const result = executeLinkedActions(compiled.linkedPlan, world, session);
    assert(result.ok, JSON.stringify(result.errors));
    assert.equal(result.working.getEntity(`device_${seed}`).state.interactableState, nextState);
    assert.equal(session.entityStates[`device_${seed}`].interactableState, undefined);
}
runWorld('moss', 'consecrate', 'dormant', 'luminous', 'Saffron lens');
runWorld('brass', 'retune', 'discordant', 'harmonic', 'Copper fork');
runWorld('glass', 'anneal', 'brittle', 'resilient', 'Silver tongs');

const dynamicWorld = { id: 'dynamic_world', entities: [],
    locations: [{ id: 'quay', name: 'Quay', exits: [] }] };
const dynamicSession = { id: 'dynamic_session', playerLocation: 'quay',
    entityStates: {}, locationStates: {}, inventory: [], npcRelationships: {},
    history: [], turnCount: 1, worldStateVersion: 1 };
const accepted = executeLinkedActions({ actions: [
    { action_id: 'discover', status: 'resolved', action_effects: { location_introduce: [
        { id: 'amber_alcove', name: 'Amber Alcove', connects_to: 'quay' }] } },
    { action_id: 'meet', status: 'resolved', depends_on: [
        { action_id: 'discover', outcome: 'succeeded' } ], action_effects: {
            entity_introduce: [{ id: 'npc_tavi', name: 'Tavi',
                location_id: 'amber_alcove', persona: 'patient cartographer' }] } },
    { action_id: 'enter', status: 'resolved', depends_on: [
        { action_id: 'meet', outcome: 'succeeded' } ], action_effects: {
            actor_move: [{ actor_id: 'player', to_location_id: 'amber_alcove' }] } },
    { action_id: 'trust', status: 'resolved', state_conditions: [
        { fact: 'actor_at', subject_id: 'npc_tavi', operator: 'equals', value: 'amber_alcove' }
    ], action_effects: { relation_set: [{ subject_id: 'npc_tavi',
        target_id: 'player', value: 35 }] } }
], events: [], narrative: [] }, dynamicWorld, dynamicSession);
// Player is a valid actor ID even without a stored entity definition.
assert(accepted.ok, JSON.stringify(accepted.errors));
assert.equal(accepted.working.getSession('playerLocation'), 'amber_alcove');
assert.equal(accepted.working.getEntity('npc_tavi').state.location, 'amber_alcove');
assert.equal(accepted.working.getSession('npcRelationships')['npc_tavi|player'].score, 35);
assert.equal(dynamicSession.playerLocation, 'quay');
console.log('PASS unseen verbs, worlds, interactables, and same-turn dynamic references');
