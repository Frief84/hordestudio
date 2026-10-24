'use strict';
const assert = require('node:assert/strict');
const { executeLinkedActions } = require('../worlds/linked-world-actions');
const world = { id: 'scene_items', entities: [
    { id: 'book', name: 'Book', type: 'item', startLocation: 'room' },
    { id: 'keeper', name: 'Keeper', type: 'npc' }
], locations: [
    { id: 'room', name: 'Room', items: [{ name: 'Pair of handcuffs', quantity: 3 },
        'Book'], exits: [{ targetLocationId: 'hall' }] },
    { id: 'hall', name: 'Hall', exits: [{ targetLocationId: 'room' }] }
] };
const session = { id: 'save_a', playerLocation: 'room', inventory: [],
    entityStates: { keeper: { location: 'room', inventory: [] } },
    sceneItemSeeds: {}, worldStateVersion: 0 };
const action = (id, effects, status = 'resolved') => ({ action_id: id,
    kind: 'physical', status, action_effects: effects });
const run = (actions, target = session, source = world) => executeLinkedActions({
    actions, events: [], narrative: [] }, source, target);
async function main() {
    let result = run([action('take', { item_transfer: [{ item_id: 'Pair of handcuffs',
        from_id: 'room', to_id: 'player' }] })]);
    assert(result.ok, JSON.stringify(result.errors));
    const id = result.working.getSession('inventory')[0].id;
    assert.equal(result.working.getEntity(id).state.quantity, 2);
    assert.equal(result.working.getSession('inventory')[0].quantity, 1);
    assert.equal(result.working.getEntitiesByFilter(item => item.definition?.name === 'Book').length, 1);
    let saved;
    await result.working.commit(async candidate => { saved = structuredClone({
        world: candidate.world, session: candidate.session }); });
    assert.equal(session.inventory[0].id, id);
    const replay = structuredClone(saved);
    result = run([action('take_again', { item_transfer: [{ item_id: id,
        from_id: 'room', to_id: 'player' }] })], replay.session, replay.world);
    assert(result.ok, JSON.stringify(result.errors));
    assert.equal(result.working.getEntity(id).state.quantity, 1);
    assert.equal(result.working.getSession('inventory').reduce((n, item) =>
        n + (item.id === id ? item.quantity : 0), 0), 2);
    assert.equal(result.working.getEntitiesByFilter(item => item.definition?.sceneOrigin === 'room').length, 1);
    let secondSave;
    await result.working.commit(async candidate => { secondSave = structuredClone({
        world: candidate.world, session: candidate.session }); });
    const given = run([action('give', { item_transfer: [{ item_id: id,
        from_id: 'player', to_id: 'keeper' }] })], secondSave.session, secondSave.world);
    assert(given.ok, JSON.stringify(given.errors));
    assert.equal(given.working.getEntity('keeper').state.inventory[0].id, id);
    const dropped = run([action('drop', { item_transfer: [{ item_id: id,
        from_id: 'player', to_id: 'room' }] })], secondSave.session, secondSave.world);
    assert(dropped.ok, JSON.stringify(dropped.errors));
    assert.equal(dropped.working.getEntity(id).state.quantity, 2);
    assert.equal(dropped.working.getSession('inventory').reduce((n, item) =>
        n + (item.id === id ? item.quantity : 0), 0), 1);
    const consumed = run([action('consume', { item_consume: [{ item_id: id,
        actor_id: 'player' }] })], secondSave.session, secondSave.world);
    assert(consumed.ok, JSON.stringify(consumed.errors));
    assert.equal(consumed.working.getSession('inventory').reduce((n, item) =>
        n + (item.id === id ? item.quantity : 0), 0), 1);
    const travel = (target, id) => ({ action_id: id, kind: 'travel', status: 'resolved',
        action_effects: { actor_move: [{ actor_id: 'player', to_location_id: target }] } });
    const away = run([travel('hall', 'leave')], secondSave.session, secondSave.world);
    assert(away.ok, JSON.stringify(away.errors));
    const awayState = away.working.prepare();
    const back = run([travel('room', 'return')], awayState.session, awayState.world);
    assert(back.ok, JSON.stringify(back.errors));
    assert.equal(back.working.getEntity(id).state.quantity, 1);
    assert.equal(back.working.getEntitiesByFilter(item => item.definition?.sceneOrigin === 'room').length, 1);
    const bad = run([action('remote', { item_transfer: [{ item_id: id,
        from_id: 'room', to_id: 'keeper' }] })], {
        ...structuredClone(saved.session), entityStates: { ...saved.session.entityStates,
            keeper: { location: 'hall', inventory: [] } } }, saved.world);
    assert(!bad.ok);
    assert.equal(saved.world.entities.filter(item => item.id === id).length, 1);
    assert.equal(saved.session.entityStates[id].quantity, 2);
    const invalid = run([action('impossible', { item_transfer: [{ item_id: id,
        from_id: 'room', to_id: 'player', quantity: 3 }] })], saved.session, saved.world);
    assert(!invalid.ok);
    assert.equal(saved.session.entityStates[id].quantity, 2);
    const decorative = { id: 'decor', entities: [], locations: [{ id: 'room',
        name: 'Room', description: 'A painted key hangs on the wall.' }] };
    const empty = { id: 'save_b', playerLocation: 'room', inventory: [], entityStates: {},
        sceneItemSeeds: {} };
    const look = run([action('look', {}, 'attempted')], empty, decorative);
    assert(look.ok && !look.working.getEntitiesByFilter(item => item.definition?.type === 'item').length);
    assert.equal(look.working.getSession('sceneItemSeeds').room, true);
    const described = { id: 'counted', entities: [], locations: [{ id: 'room',
        name: 'Room', items: ['three pairs of handcuffs'] }] };
    const counted = run([action('look', {}, 'attempted')], structuredClone(empty), described);
    assert(counted.ok);
    assert.equal(counted.working.getEntitiesByFilter(item => item.definition?.type === 'item')[0].state.quantity, 3);
    const inaccessible = { id: 'inaccessible', entities: [], locations: [{ id: 'room',
        name: 'Room', items: [{ name: 'Sealed box', reachable: false }] }] };
    const blockedPickup = run([action('take', { item_transfer: [{ item_id: 'Sealed box',
        from_id: 'room', to_id: 'player' }] })], structuredClone(empty), inaccessible);
    assert(!blockedPickup.ok);
    assert.equal(inaccessible.entities.length, 0);
    const generated = { id: 'generated', entities: [], locations: [{ id: 'room',
        name: 'Room', discoverableItems: ['Loose stone'] }] };
    const proposed = { actions: [action('discover', { item_introduce: [{ id: 'loose_stone',
        name: 'Loose stone', location_id: 'room', quantity: 2 }] })],
        events: [{ type: 'discovery', status: 'completed', actor_id: 'player',
            action_id: 'discover', target_id: 'loose_stone', item: 'Loose stone' }], narrative: [] };
    const confirmed = executeLinkedActions(proposed, generated, structuredClone(empty));
    assert(confirmed.ok, JSON.stringify(confirmed.errors));
    assert.equal(confirmed.working.getEntity('loose_stone').state.quantity, 2);
    const unconfirmed = executeLinkedActions({ ...proposed, events: [] }, generated,
        structuredClone(empty));
    assert(!unconfirmed.ok);
    assert.equal(generated.entities.length, 0);
    const unsupported = executeLinkedActions(proposed, { id: 'plain', entities: [],
        locations: [{ id: 'room', name: 'Room' }] }, structuredClone(empty));
    assert(!unsupported.ok, 'a discovery event cannot prove its own object');
    const ordinaryWorld = { id: 'ordinary', entities: [], locations: [{ id: 'room',
        name: 'Room', discoveryPolicy: { ordinaryCategories: ['natural'], maxQuantity: 2 } }] };
    const ordinary = structuredClone(proposed);
    ordinary.actions[0].action_effects.item_introduce[0].category = 'natural';
    const ordinaryResult = executeLinkedActions(ordinary, ordinaryWorld, structuredClone(empty));
    assert(ordinaryResult.ok, JSON.stringify(ordinaryResult.errors));
    assert.equal(ordinaryResult.working.getEntity('loose_stone').definition.category, 'natural');
    const keyedWorld = structuredClone(ordinaryWorld);
    keyedWorld.locations[0].exits = [{ targetLocationId: 'hall', lockKeyItem: 'Cell key' }];
    keyedWorld.locations.push({ id: 'hall', name: 'Hall' });
    const falseKey = { actions: [action('find_key', { item_introduce: [{
        id: 'cell_key', name: 'Cell key', category: 'natural',
        location_id: 'room' }] })], events: [{ id: 'proof_key', type: 'discovery',
        status: 'completed', actor_id: 'player', action_id: 'find_key',
        target_id: 'cell_key', item: 'Cell key' }], narrative: [] };
    assert(!executeLinkedActions(falseKey, keyedWorld, structuredClone(empty)).ok,
        'ordinary category cannot mint a key required by an authored exit');
    const ordinarySaved = ordinaryResult.working.prepare();
    ordinarySaved.session.inventory = [{ id: 'loose_stone', name: 'Loose stone', quantity: 2 }];
    ordinarySaved.session.entityStates.loose_stone.location = '';
    ordinarySaved.session.entityStates.loose_stone.quantity = 0;
    assert(!executeLinkedActions({ ...ordinary, actions: [action('discover', {
        item_introduce: [{ id: 'loose_stone_again', name: 'Loose stone',
            location_id: 'room', quantity: 1, category: 'natural' }] })],
        events: [{ ...ordinary.events[0], target_id: 'loose_stone_again' }] },
    ordinarySaved.world, ordinarySaved.session).ok,
    'picking up an item does not make its discovery available again');
    const repeated = run([action('again', { item_introduce: [{ id: 'loose_stone',
        name: 'Loose stone', location_id: 'room' }] })],
        confirmed.working.prepare().session, confirmed.working.prepare().world);
    assert(!repeated.ok, 'repeated descriptions cannot recreate an item');
    const specialWorld = { id: 'created', entities: [{ id: 'maker', name: 'Maker', type: 'npc',
        abilities: ['forge_relic'] }], locations: [{ id: 'room', name: 'Room' }],
        itemCreationRules: [
            { id: 'staff', cause: 'crafting', item: { name: 'Staff' },
                ability_id: 'woodcraft', materials: [{ item_id: 'Wood', quantity: 2 }],
                tools: ['Knife'] },
            { id: 'relic', cause: 'conjuration', item: { name: 'Royal relic',
                properties: { unique: true, access: 'royal' } }, ability_id: 'forge_relic' },
            { id: 'gold', cause: 'transmutation', item: { name: 'Gold piece' },
                ability_id: 'alchemy', source_item_id: 'Stone' },
            { id: 'temporary', cause: 'conjuration', item: { name: 'Spectral blade' },
                ability_id: 'summoning', duration_minutes: 10 },
            { id: 'machine', cause: 'replication', item: { name: 'Replica' },
                materials: [{ item_id: 'Fuel', quantity: 1 }] }
        ] };
    const creationSession = { id: 'create_save', playerLocation: 'room',
        inventory: ['Wood', 'Wood', 'Knife', 'Stone', 'Fuel'],
        playerIdentity: { skills: ['woodcraft', 'alchemy', 'summoning'] },
        entityStates: { maker: { location: 'room', inventory: [] } },
        sceneItemSeeds: {}, worldClock: { absoluteMinutes: 100 }, turnCount: 3 };
    const create = (id, name, cause, actor = 'player', extra = {}) => ({
        actions: [action(id, { item_introduce: [{ id, name, cause, actor_id: actor,
            location_id: 'room', rule_id: extra.rule_id || id,
            ...(extra.duration_minutes ? { duration_minutes: extra.duration_minutes } : {}),
            ...(extra.source_item_id ? { source_item_id: extra.source_item_id } : {}) }] })],
        events: [{ id: `proof_${id}`, type: cause === 'discovery' ? 'discovery' : 'inventory',
            status: 'completed', actor_id: actor, action_id: id, target_id: id, item: name }],
        narrative: [] });
    const staff = executeLinkedActions(create('staff', 'Staff', 'crafting'),
        specialWorld, structuredClone(creationSession));
    assert(staff.ok, JSON.stringify(staff.errors));
    assert.equal(staff.working.getSession('inventory').filter(i => i === 'Wood').length, 0);
    assert.equal(staff.working.getEntity('staff').state.originCause, 'crafting');
    const noSpecial = executeLinkedActions(create('relic', 'Royal relic', 'conjuration'),
        specialWorld, structuredClone(creationSession));
    assert(!noSpecial.ok, 'an unqualified actor cannot create a special item');
    const npcSpecial = executeLinkedActions(create('relic', 'Royal relic', 'conjuration', 'maker'),
        specialWorld, structuredClone(creationSession));
    assert(npcSpecial.ok, JSON.stringify(npcSpecial.errors));
    assert.equal(npcSpecial.working.getEntity('relic').definition.properties.access, 'royal');
    const npcSaved = npcSpecial.working.prepare();
    const duplicateRelic = create('relic_again', 'Royal relic', 'conjuration', 'maker',
        { rule_id: 'relic' });
    assert(!executeLinkedActions(duplicateRelic, npcSaved.world, npcSaved.session).ok,
        'a unique artifact cannot be produced twice');
    const gold = executeLinkedActions(create('gold', 'Gold piece', 'transmutation',
        'player', { source_item_id: 'Stone' }), specialWorld, structuredClone(creationSession));
    assert(gold.ok, JSON.stringify(gold.errors));
    assert(!gold.working.getSession('inventory').includes('Stone'));
    const blade = executeLinkedActions(create('temporary', 'Spectral blade',
        'conjuration', 'player', { duration_minutes: 10 }),
        specialWorld, structuredClone(creationSession));
    assert(blade.ok, JSON.stringify(blade.errors));
    assert.equal(blade.working.getEntity('temporary').state.expiresAtMinute, 110);
    const bladeSaved = blade.working.prepare();
    const elapsedBlade = executeLinkedActions({ actions: [{ ...action('wait_blade', {
        time_advance: [{ minutes: 10 }] }), kind: 'wait' }], events: [{ id: 'proof_wait_blade',
        type: 'time', status: 'completed', actor_id: 'player',
        action_id: 'wait_blade', minutes_elapsed: 10 }], narrative: [] },
    bladeSaved.world, bladeSaved.session);
    assert(elapsedBlade.ok, JSON.stringify(elapsedBlade.errors));
    assert.equal(elapsedBlade.working.getEntity('temporary').state.expired, true);
    assert(elapsedBlade.working.getSession('engineEvents').some(event =>
        event.id === 'item_expired_temporary'));
    bladeSaved.session.worldClock.absoluteMinutes = 111;
    const expired = run([action('look', {}, 'attempted')], bladeSaved.session, bladeSaved.world);
    assert(expired.ok);
    assert.equal(expired.working.getEntity('temporary').state.expired, true);
    const machine = executeLinkedActions(create('machine', 'Replica', 'replication'),
        specialWorld, structuredClone(creationSession));
    assert(machine.ok, JSON.stringify(machine.errors));
    assert(!machine.working.getSession('inventory').includes('Fuel'));
    const resourceWorld = structuredClone(specialWorld);
    resourceWorld.itemCreationRules.push({ id: 'spark', cause: 'conjuration',
        item: { name: 'Spark' }, ability_id: 'summoning',
        resource: { id: 'mana', amount: 3 } });
    const resourceSession = structuredClone(creationSession);
    resourceSession.playerStats = { mana: 5 };
    const spark = executeLinkedActions(create('spark', 'Spark', 'conjuration'),
        resourceWorld, resourceSession);
    assert(spark.ok, JSON.stringify(spark.errors));
    assert.equal(spark.working.getSession('playerStats').mana, 2);
    assert.equal(resourceSession.playerStats.mana, 5);
    const checkedWorld = structuredClone(resourceWorld);
    checkedWorld.itemCreationRules.push({ id: 'ritual', cause: 'conjuration',
        item: { name: 'Ritual mark' }, ability_id: 'summoning',
        check_id: 'ritual_check', time_minutes: 5 });
    const checkedSession = structuredClone(creationSession);
    checkedSession.checkHistory = [{ id: 'ritual_check', success: true, turn: 3 }];
    const ritual = create('ritual', 'Ritual mark', 'conjuration');
    assert(!executeLinkedActions(ritual, checkedWorld, checkedSession).ok,
        'a successful check does not waive required time');
    ritual.actions[0].action_effects.time_advance = [{ minutes: 5 }];
    ritual.events.push({ id: 'ritual_time', type: 'time', status: 'completed',
        actor_id: 'player', action_id: 'ritual', minutes_elapsed: 5 });
    const checked = executeLinkedActions(ritual, checkedWorld, checkedSession);
    assert(checked.ok, JSON.stringify(checked.errors));
    assert.equal(checked.working.getSession('itemCreationChecks').ritual_check, 'ritual');
    const badCheck = structuredClone(checkedSession);
    badCheck.checkHistory[0].success = false;
    assert(!executeLinkedActions(ritual, checkedWorld, badCheck).ok);
    const failedAttempt = executeLinkedActions({
        actions: [action('miss', {}, 'attempted')], events: [], narrative: [] },
    specialWorld, structuredClone(creationSession));
    assert(failedAttempt.ok);
    assert(!failedAttempt.working.getEntity('staff').definition);
    const lacking = structuredClone(creationSession); lacking.inventory = ['Wood', 'Knife'];
    assert(!executeLinkedActions(create('staff', 'Staff', 'crafting'),
        specialWorld, lacking).ok);
    assert.equal(lacking.inventory.length, 2, 'failed creation leaves canonical inventory intact');
    const old = { ...structuredClone(empty) }; delete old.sceneItemSeeds;
    assert(run([action('look', {}, 'attempted')], old, decorative).ok);
    const failedSave = run([action('take', { item_transfer: [{ item_id: 'Pair of handcuffs',
        from_id: 'room', to_id: 'player' }] })], saved.session, saved.world);
    assert(failedSave.ok);
    await assert.rejects(failedSave.working.commit(async () => { throw Error('disk failure'); }), /disk failure/);
    assert.equal(saved.session.inventory.length, 1);
    assert.equal(saved.session.entityStates[id].quantity, 2);
    let createdSave;
    await staff.working.commit(async candidate => {
        createdSave = structuredClone({ world: candidate.world, session: candidate.session });
    });
    const reloadedStaff = executeLinkedActions({ actions: [action('take_staff', {
        item_transfer: [{ item_id: 'staff', from_id: 'room', to_id: 'player' }] })],
        events: [{ id: 'proof_take_staff', type: 'inventory', status: 'completed',
            actor_id: 'player', action_id: 'take_staff', item: 'Staff' }], narrative: [] },
    createdSave.world, createdSave.session);
    assert(reloadedStaff.ok, JSON.stringify(reloadedStaff.errors));
    assert.equal(reloadedStaff.working.getSession('inventory').find(item => item.id === 'staff').quantity, 1);
    assert.equal(reloadedStaff.working.getEntity('staff').state.originEventId, 'proof_staff');
    console.log('PASS scene items: discovery, creation, costs, NPCs, expiry, identity, legacy, persistence rollback');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
