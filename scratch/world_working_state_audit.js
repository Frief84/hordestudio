'use strict';
const assert = require('node:assert/strict');
const { createWorkingState, guardCanonicalWrites, assertDirtyCoverage } = require('../worlds/working-state');
const { createEffectRegistry } = require('../worlds/effect-registry');

const world = { id: 'new_world', entities: [
    { id: 'player' }, { id: 'friend_1' }, { id: 'friend_2' }
], locations: [{ id: 'hall' }, { id: 'vault' }] };
const session = { id: 's1', worldStateVersion: 2, playerLocation: 'hall',
    entityStates: { player: { location: 'hall' }, friend_1: { location: 'hall' },
        friend_2: { location: 'hall' } }, locationStates: {},
    scheduledEvents: [], factionRelations: {}, history: [] };
const registry = createEffectRegistry();
registry.register('actor_move', payload => Array.isArray(payload.actors)
    && typeof payload.to === 'string', (payload, working) => {
    for (const actor of payload.actors) working.writeEntity(actor, entity => {
        entity.state.location = payload.to;
    });
    working.writeSession('playerLocation', field => { field.value = payload.to; });
    working.writeLocation('hall', location => { location.state ||= {}; location.state.lastDeparture = payload.to; });
    working.writeLocation(payload.to, location => { location.state ||= {}; location.state.arrivals = payload.actors; });
});
registry.register('interactable_transition', payload => typeof payload.location === 'string',
    (payload, working) => {
        working.writeLocation(payload.location, location => {
            location.state ||= {}; location.state.gate = 'open';
        });
        return [{ type: 'event_emit', payload: { id: 'gate_opened' } }];
    });
registry.register('event_emit', payload => typeof payload.id === 'string', (payload, working) => {
    working.writeEvent('scheduledEvents', field => { field.value ||= []; field.value.push(payload); });
    return [{ type: 'relation_set', payload: { id: 'gatekeeper', value: 'grateful' } }];
});
registry.register('relation_set', payload => typeof payload.id === 'string', (payload, working) => {
    working.writeRelation('factionRelations', field => { field.value ||= {}; field.value[payload.id] = payload.value; });
});
const working = createWorkingState(world, session);
registry.run([{ type: 'actor_move', payload: {
    actors: ['player', 'friend_1', 'friend_2'], to: 'vault' } }], working);
assert.deepEqual([...working.dirtySet].sort(), [
    'entity:friend_1', 'entity:friend_2', 'entity:player', 'location:hall',
    'location:vault', 'session:playerLocation'
]);
assert.equal(session.playerLocation, 'hall', 'pre-commit canonical state is unchanged');
assert.equal(working.getEntity('friend_2').state.location, 'vault');
assert.throws(() => { working.getEntity('friend_2').state.location = 'hall'; }, TypeError);
const chain = registry.run([{ type: 'interactable_transition', payload: { location: 'vault' } }], working);
assert.deepEqual(chain.applied.map(effect => effect.type),
    ['interactable_transition', 'event_emit', 'relation_set']);
assert(working.dirtySet.has('event') && working.dirtySet.has('relation'));
assert(working.dirtySet.has('location:vault'));
const before = structuredClone({ world, session });
assert.throws(() => assertDirtyCoverage(world, session, {
    world: { ...world, unregisteredWorldField: true }, session,
    dirtySet: new Set(['time'])
}), /untracked_world_diff:unregisteredWorldField/,
'a time key cannot hide an unrelated World mutation');
const guarded = guardCanonicalWrites(session, 'sess');
assert.throws(() => { guarded.playerLocation = 'vault'; }, /direct_canonical_write:sess:set/);
assert.throws(() => { guarded.entityStates.player.location = 'vault'; }, /direct_canonical_write/);
assert.throws(() => guarded.history.push('hidden write'), /direct_canonical_write/);
assert.throws(() => Object.defineProperty(guarded, 'playerLocation', { value: 'vault' }), /direct_canonical_write/);
const collections = guardCanonicalWrites({ map: new Map([['npc', { mood: 'calm' }]]),
    set: new Set([{ mood: 'calm' }]) }, 'collections');
assert.throws(() => collections.map.set('npc', {}), /direct_canonical_write/);
assert.throws(() => { collections.map.get('npc').mood = 'angry'; }, /direct_canonical_write/);
assert.throws(() => { [...collections.map.values()][0].mood = 'angry'; }, /direct_canonical_write/);
assert.throws(() => { [...collections.set][0].mood = 'angry'; }, /direct_canonical_write/);
assert.throws(() => collections.set.add('more'), /direct_canonical_write/);
const rejected = createWorkingState(world, session);
registry.register('bad_chain', () => true, () => [{ type: 'bad_chain', payload: {} }]);
assert.throws(() => registry.run([{ type: 'bad_chain', payload: {} }], rejected),
    /cyclic_follow_up_effect/);
rejected.rollback();
registry.register('growing_chain', () => true, payload => [
    { type: 'growing_chain', payload: { step: (payload.step || 0) + 1 } }
]);
assert.throws(() => registry.run([{ type: 'growing_chain', payload: { step: 0 } }],
    createWorkingState(world, session)), /follow_up_effect_budget_exceeded/);
assert.deepEqual({ world, session }, before);
(async () => {
    await assert.rejects(working.commit(async () => { throw new Error('storage failed'); }, 2), /storage failed/);
    assert.deepEqual({ world, session }, before, 'failed persistence cannot publish candidate');
    await working.commit(async candidate => {
        assert.equal(candidate.session.playerLocation, 'vault');
        assert.equal(candidate.session.scheduledEvents[0].id, 'gate_opened');
    }, 2);
    assert.equal(session.playerLocation, 'vault');
    assert.equal(session.entityStates.friend_1.location, 'vault');
    assert.equal(session.factionRelations.gatekeeper, 'grateful');
    console.log('PASS transactional working state, proxy barrier, indirect effects and budget');
})().catch(error => { console.error(error); process.exitCode = 1; });
