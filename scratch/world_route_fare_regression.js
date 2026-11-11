'use strict';
const assert = require('node:assert/strict');
const { executeLinkedActions } = require('../worlds/linked-world-actions');

const world = { id: 'fare_world', entities: [], locations: [
    { id: 'quay', name: 'Quay', exits: [{ text: 'ferry to island',
        targetLocationId: 'island', travelTime: 12,
        fare: { resourceId: 'coins', amount: 2 } }] },
    { id: 'island', name: 'Island', exits: [] }
] };
const makeSession = coins => ({ id: `save_${coins}`, playerLocation: 'quay',
    playerStats: { coins }, inventory: [], entityStates: { player: { location: 'quay' } },
    locationStates: {}, unlockedExits: {}, engineEvents: [], turnCount: 4,
    worldStateVersion: 9 });
const makePlan = effects => ({ actions: [{ action_id: 'ferry_trip', kind: 'travel',
    status: 'resolved', request: 'Take the ferry to the island.', action_effects: effects }],
    events: [], narrative: [] });
const canMove = (_world, _session, _actor, from, to) => from === 'quay' && to === 'island'
    ? { ok: true, fare: { resourceId: 'coins', amount: 2 }, travelTime: 12, elapsedMinutes: 12 }
    : { ok: false, reason: 'unreachable' };

const paidSession = makeSession(5);
const paid = executeLinkedActions(makePlan({ actor_move: [{ actor_id: 'player',
    to_location_id: 'island' }] }), world, paidSession,
{ sessionId: paidSession.id, turnId: 'fare_turn_1', canMove });
assert(paid.ok, JSON.stringify(paid.errors));
assert.equal(paid.outcomes.get('ferry_trip'), 'succeeded');
assert.equal(paid.working.getSession('playerLocation'), 'island');
assert.equal(paid.working.getSession('playerStats').coins, 3);
assert.equal(paid.working.getSession('resourceCostLedger').length, 1);
assert.equal(paid.working.getSession('engineEvents').filter(event => event.cause === 'route_fare').length, 1);

const poorSession = makeSession(1);
const poor = executeLinkedActions(makePlan({ actor_move: [{ actor_id: 'player',
    to_location_id: 'island' }] }), world, poorSession,
{ sessionId: poorSession.id, turnId: 'fare_turn_2', canMove });
assert(poor.ok, JSON.stringify(poor.errors));
assert.equal(poor.outcomes.get('ferry_trip'), 'blocked');
assert.equal(poor.working.getSession('playerLocation'), 'quay');
assert.equal(poor.working.getSession('playerStats').coins, 1);
assert.equal(poor.working.getSession('resourceCostLedger'), undefined);

const rollbackSession = makeSession(5);
const rollback = executeLinkedActions(makePlan({
    actor_move: [{ actor_id: 'player', to_location_id: 'island' }],
    item_transfer: [{ item_id: 'missing_item', from_id: 'player', to_id: 'island' }]
}), world, rollbackSession,
{ sessionId: rollbackSession.id, turnId: 'fare_turn_3', canMove });
assert(rollback.ok, JSON.stringify(rollback.errors));
assert.equal(rollback.outcomes.get('ferry_trip'), 'blocked');
assert.equal(rollback.working.getSession('playerLocation'), 'quay');
assert.equal(rollback.working.getSession('playerStats').coins, 5);
assert.equal(rollback.working.getSession('resourceCostLedger'), undefined);
assert.equal(rollback.working.getSession('engineEvents').length, 0);

console.log('PASS typed route fare debit, insufficient balance, and atomic rollback');
