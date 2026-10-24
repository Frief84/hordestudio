'use strict';
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const goals = require('../worlds/npc-goal-actions');
const world = { locations: [{ id: 'room', name: 'Room', exits: [] }],
    entities: [{ id: 'ration', name: 'Ration', type: 'item',
        properties: { npcConsumable: true } }] };
const npc = { id: 'actor', goal: 'Primary', goalPriority: 50,
    goalActionSteps: [{ effect: { type: 'item_transfer', payload: {
        actor_id: 'actor', item_id: 'ration', from_id: 'room', to_id: 'actor' } } }],
    goalPool: [{ goal: 'Other', priority: 50 }, { goal: 'Urgent', priority: 90,
        priorityRules: [{ source: 'need', key: 'rest', atLeast: 70,
            weight: 5 }] }] };
const session = { entityStates: { actor: { goal: 'Primary',
    goalStatus: 'active', goalAutonomy: 'medium', location: 'room',
    inventory: ['ration'], needs: { rest: 80 }, goalActionIndex: 1 } },
worldClock: { absoluteMinutes: 600 }, locationStates: { room: { danger: 0 } } };
assert(goals.npcGoalOptions(npc, world, session).some(option =>
    option.effect.type === 'item_consume'));
assert.equal(goals.selectNpcGoal(npc, world, session, 1).goal, 'Urgent');
assert.equal(session.entityStates.actor.goalStates.Primary.goalActionIndex, 1);
session.entityStates.actor.goalStatus = 'completed';
npc.goalPool[1].priority = 10;
assert.equal(goals.selectNpcGoal(npc, world, session, 2).goal, 'Primary');
assert.equal(session.entityStates.actor.goalActionIndex, 1);
for (let turn = 3; turn < 20; turn++) {
    goals.selectNpcGoal(npc, world, session, turn);
    assert.equal(session.entityStates.actor.goal, 'Primary');
}
session.entityStates.actor.goalStatus = 'blocked';
session.entityStates.actor.goalActionProgress = { effect: npc.goalActionSteps[0].effect,
    key: goals.goalStepKey(npc, npc.goalActionSteps[0], world, session) };
assert.equal(goals.selectNpcGoal(npc, world, session, 20).goal, 'Other');

const many = Array.from({ length: 40 }, (_, index) => ({ id: `npc${index}`,
    goal: `Primary ${index}`, goalPriority: 50,
    goalPool: Array.from({ length: 9 }, (_, slot) =>
        ({ goal: `Other ${index}/${slot}`, priority: 30 + slot })) }));
const states = Object.fromEntries(many.map(actor => [actor.id,
    { goal: actor.goal, goalStatus: 'active', goalAutonomy: 'medium',
        location: 'room', inventory: [] }]));
const benchmarkSession = { entityStates: states, worldClock: { absoluteMinutes: 600 } };
const start = performance.now();
for (let turn = 1; turn <= 50; turn++) for (const actor of many)
    goals.selectNpcGoal(actor, world, benchmarkSession, turn);
const elapsed = performance.now() - start;
assert(elapsed < 5000, `goal scoring exceeded bounded audit: ${elapsed.toFixed(1)}ms`);
console.log(`PASS goal priority: rules, interruption, resume, blocked alternative, stable ties, item consume; 40 NPC x 10 goals x 50 ticks in ${elapsed.toFixed(1)}ms`);
