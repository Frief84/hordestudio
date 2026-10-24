'use strict';
const assert = require('node:assert/strict');
const { executeLinkedActions } = require('../worlds/linked-world-actions');
const world = { id: 'physical_reach', entities: [
    { id: 'chest', name: 'Chest', type: 'item', locationId: 'room', interactable: {
        initialState: 'locked', transitions: [
            { from: 'locked', to: 'open', requiredItem: 'Key' },
            { from: 'open', to: 'closed' }, { from: 'closed', to: 'open' }] } },
    { id: 'shelf', name: 'Shelf', type: 'item', locationId: 'room', interactable: {
        initialState: 'blocked', transitions: [{ from: 'blocked', to: 'removed' }] } },
    { id: 'guard', name: 'Guard', type: 'npc' }
], locations: [{ id: 'room', name: 'Room', items: [
    { name: 'Gem', containerId: 'chest' },
    { name: 'Scroll', blockedBy: 'shelf' },
    { name: 'Apple' }] }] };
const initial = { id: 'physical_save', playerLocation: 'room', inventory: [],
    entityStates: { guard: { location: 'room', inventory: ['Coin'] } },
    sceneItemSeeds: {}, worldStateVersion: 0 };
const action = (id, effects, status = 'resolved') => ({ action_id: id,
    kind: 'physical', status, action_effects: effects });
const run = (actions, session = initial, source = world) => executeLinkedActions({
    actions, events: [], narrative: [] }, source, session);
async function main() {
    const seeded = run([action('look', {}, 'attempted')]);
    assert(seeded.ok);
    const state = seeded.working.prepare();
    const gem = state.world.entities.find(item => item.name === 'Gem').id;
    const scroll = state.world.entities.find(item => item.name === 'Scroll').id;
    const apple = state.world.entities.find(item => item.name === 'Apple').id;
    assert(!run([action('take_gem', { item_transfer: [{ item_id: gem,
        from_id: 'room', to_id: 'player' }] })], state.session, state.world).ok);
    assert(!run([action('take_scroll', { item_transfer: [{ item_id: scroll,
        from_id: 'room', to_id: 'player' }] })], state.session, state.world).ok);
    assert(!run([action('open', { interactable_transition: [{ target_id: 'chest',
        to_state: 'open' }] })], state.session, state.world).ok);
    const equipped = structuredClone(state.session); equipped.inventory.push('Key');
    const opened = run([action('open', { interactable_transition: [{ target_id: 'chest',
        to_state: 'open' }] }), action('take_gem', { item_transfer: [{ item_id: gem,
        from_id: 'room', to_id: 'player' }] })], equipped, state.world);
    assert(opened.ok, JSON.stringify(opened.errors));
    assert.equal(opened.working.getEntity(gem).state.quantity, 0);
    assert.equal(opened.working.getEntity(gem).state.containerId, undefined);
    assert.equal(opened.working.getSession('inventory').filter(item => item.id === gem).length, 1);
    const obstacle = run([action('remove', { interactable_transition: [{ target_id: 'shelf',
        to_state: 'removed' }] }), action('take', { item_transfer: [{ item_id: scroll,
        from_id: 'room', to_id: 'player' }] })], state.session, state.world);
    assert(obstacle.ok, JSON.stringify(obstacle.errors));
    const stolen = run([action('steal', { item_transfer: [{ item_id: 'Coin',
        from_id: 'guard', to_id: 'player' }] })], state.session, state.world);
    assert(stolen.ok, JSON.stringify(stolen.errors));
    const npcEquipped = structuredClone(state.session);
    npcEquipped.entityStates.guard.inventory.push('Key');
    const npcOpened = run([action('guard_opens', { interactable_transition: [{
        target_id: 'chest', to_state: 'open', actor_id: 'guard' }] })],
    npcEquipped, state.world);
    assert(npcOpened.ok, JSON.stringify(npcOpened.errors));
    const npcTakes = run([action('guard_takes', { item_transfer: [{ item_id: gem,
        from_id: 'room', to_id: 'guard', actor_id: 'guard' }] })],
    npcOpened.working.prepare().session, npcOpened.working.prepare().world);
    assert(npcTakes.ok, JSON.stringify(npcTakes.errors));
    assert.equal(npcTakes.working.getEntity('guard').state.inventory[2].id, gem);
    const resisted = run([action('steal', {}, 'attempted')], state.session, state.world);
    assert(resisted.ok && resisted.working.getEntity('guard').state.inventory[0] === 'Coin');
    const bound = structuredClone(state.session);
    bound.playerSceneConditions = [{ label: 'bound_hands', blocksItemInteraction: true }];
    assert(!run([action('bound_take', { item_transfer: [{ item_id: apple,
        from_id: 'room', to_id: 'player' }] })], bound, state.world).ok);
    assert.equal(bound.inventory.length, 0);
    const held = opened.working.prepare();
    const returned = run([action('return', { item_transfer: [{ item_id: gem,
        from_id: 'player', to_id: 'room', container_id: 'chest' }] })], held.session, held.world);
    assert(returned.ok, JSON.stringify(returned.errors));
    assert.equal(returned.working.getEntity(gem).state.containerId, 'chest');
    const boxed = returned.working.prepare();
    const closed = run([action('close', { interactable_transition: [{ target_id: 'chest',
        to_state: 'closed' }] })], boxed.session, boxed.world);
    assert(closed.ok, JSON.stringify(closed.errors));
    const closedState = closed.working.prepare();
    assert(!run([action('blocked_take', { item_transfer: [{ item_id: gem,
        from_id: 'room', to_id: 'player' }] })], closedState.session, closedState.world).ok);
    assert.equal(closedState.session.entityStates[gem].quantity, 1);
    const failedBatch = run([action('take_apple', { item_transfer: [{ item_id: apple,
        from_id: 'room', to_id: 'player' }] }), action('too_many', { item_transfer: [{
        item_id: apple, from_id: 'room', to_id: 'player', quantity: 2 }] })],
    state.session, state.world);
    assert(!failedBatch.ok);
    assert.equal(state.session.inventory.length, 0);
    let saved;
    await returned.working.commit(async candidate => { saved = structuredClone(candidate); });
    const reloaded = run([action('take_again', { item_transfer: [{ item_id: gem,
        from_id: 'room', to_id: 'player' }] })], saved.session, saved.world);
    assert(reloaded.ok, JSON.stringify(reloaded.errors));
    assert.equal(saved.session.entityStates[gem].containerId, 'chest');
    const legacy = { id: 'legacy', entities: [{ id: 'stone', name: 'Stone',
        type: 'item', startLocation: 'room' }], locations: [{ id: 'room', name: 'Room' }] };
    const legacyResult = run([action('take', { item_transfer: [{ item_id: 'Stone',
        from_id: 'room', to_id: 'player' }] })], { id: 'old', playerLocation: 'room',
        inventory: [], entityStates: {} }, legacy);
    assert(legacyResult.ok, JSON.stringify(legacyResult.errors));
    const separate = structuredClone(world);
    separate.locations[0].items.push({ name: 'Gem' });
    const split = run([action('look', {}, 'attempted')], structuredClone(initial), separate);
    assert(split.ok);
    assert.equal(split.working.getEntitiesByFilter(entity => entity.definition?.name === 'Gem').length, 2,
        'an accessible copy and a boxed copy must remain distinct stock');
    console.log('PASS physical reachability: containers, obstacles, NPC stock, failure, persistence, legacy');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
