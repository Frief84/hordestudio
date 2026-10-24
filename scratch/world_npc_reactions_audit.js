'use strict';
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const perception = require('../worlds/perception');
const goals = require('../worlds/npc-goal-actions');

const world = { id: 'reactions', locations: [
    { id: 'workshop', name: 'Workshop', exits: [{ targetLocationId: 'corridor' }] },
    { id: 'corridor', name: 'Corridor', exits: [{ targetLocationId: 'workshop' }] },
    { id: 'distant', name: 'Distant', exits: [] }
], entities: [
    { id: 'duty', type: 'npc', name: 'Duty', goal: 'Carry supplies',
        goalPriority: 50, personalityTraits: { duty: 90 } },
    { id: 'quiet', type: 'npc', name: 'Quiet', goal: 'Carry supplies',
        goalPriority: 50, personalityTraits: { duty: 10 } },
    { id: 'remote', type: 'npc', name: 'Remote', goal: 'Carry supplies',
        goalPriority: 50, personalityTraits: { duty: 90 } }
], perception: { channels: { hearing: { enabled: true, edgeAttenuation: 1,
    threshold: 0.5 } } }, perceptionRules: [{ on: { type: 'environment',
    action: 'crash' }, stimuli: [{ channel: 'hearing', kind: 'disturbance',
        strength: 3, text: 'A crash nearby.', remoteText: 'A crash from the workshop.' }] }],
reactionRules: [{ id: 'investigate', on: { channel: 'hearing', kind: 'disturbance' },
    when: [{ source: 'personality', key: 'duty', atLeast: 60 }],
    goal: { goal: 'Inspect Workshop', priority: 95,
        completion: { type: 'actor_location', locationId: 'workshop' } } }] };
const base = () => ({ id: 'reaction_save', playerLocation: 'distant', turnCount: 1,
    worldClock: { absoluteMinutes: 10 }, entityStates: {
        duty: { location: 'corridor', goal: 'Carry supplies', goalStatus: 'active',
            goalAutonomy: 'high', goalActionIndex: 2, observations: [] },
        quiet: { location: 'corridor', goal: 'Carry supplies', goalStatus: 'active',
            goalAutonomy: 'high', observations: [] },
        remote: { location: 'distant', goal: 'Carry supplies', goalStatus: 'active',
            goalAutonomy: 'high', observations: [] }
    }, locationStates: {}, npcRelationships: {} });
const event = { id: 'evt_crash', type: 'environment', action: 'crash',
    status: 'completed', actor_id: 'player', location_id: 'workshop' };
const uncommitted = base();
perception.perceiveConfirmedEvent(world, structuredClone(uncommitted), event);
assert.equal(uncommitted.entityStates.duty.observations.length, 0,
    'a discarded candidate cannot publish an observation');
let session = base();
assert.equal(perception.perceiveConfirmedEvent(world, session, event).length, 2);
assert.equal(session.entityStates.remote.observations.length, 0);
assert.equal(session.entityStates.duty.observations[0].text,
    'A crash from the workshop.');
assert(!JSON.stringify(session.entityStates.duty.observations).includes('player'));
assert.equal(goals.evaluateObservationReactions(world.entities[0], world, session, 1).added, 0,
    'a same-turn event cannot trigger a recursive reaction');
session.turnCount = 2;
assert.equal(goals.evaluateObservationReactions(world.entities[0], world, session, 2).added, 1);
assert.equal(goals.evaluateObservationReactions(world.entities[1], world, session, 2).added, 0);
assert.equal(goals.evaluateObservationReactions(world.entities[2], world, session, 2).added, 0);
const idle = base();
delete idle.entityStates.duty.goal;
delete idle.entityStates.duty.goalStatus;
idle.entityStates.duty.observations = structuredClone(
    session.entityStates.duty.observations);
assert.equal(goals.evaluateObservationReactions(world.entities[0], world, idle, 2).added, 1);
assert.equal(goals.selectNpcGoal(world.entities[0], world, idle, 2).goal,
    'Inspect Workshop', 'an NPC without a prior goal can react');
const trigger = session.entityStates.duty.goalPool[0];
assert.equal(trigger.sourceObservationId, session.entityStates.duty.observations[0].id);
assert.equal(trigger.sourceEventId, event.id);
const higherPriority = structuredClone(session);
const committedNpc = { ...world.entities[0], goalPriority: 100 };
assert.equal(goals.selectNpcGoal(committedNpc, world, higherPriority, 2).goal,
    'Carry supplies', 'an important ongoing goal keeps precedence');
const noRule = structuredClone(session);
delete noRule.entityStates.duty.goalPool;
delete noRule.entityStates.duty.reactionProcessedObservationIds;
assert.equal(goals.evaluateObservationReactions(world.entities[0],
    { ...world, reactionRules: [] }, noRule, 2).added, 0);
assert.equal(noRule.entityStates.duty.goalPool, undefined);
assert.equal(goals.selectNpcGoal(world.entities[0], world, session, 2).goal,
    'Inspect Workshop');
assert.equal(session.entityStates.duty.goalStates['Carry supplies'].goalActionIndex, 2);
assert.equal(session.entityStates.duty.goalStates['Carry supplies'].goalStatus,
    'interrupted');
assert.equal(goals.selectNpcGoal(world.entities[1], world, session, 2).goal,
    'Carry supplies');
session = JSON.parse(JSON.stringify(session));
assert.equal(goals.evaluateObservationReactions(world.entities[0], world, session, 3).added, 0);
assert.equal(session.entityStates.duty.goalPool.length, 1);
const step = goals.decideNpcGoalStep(world.entities[0], world, session);
assert.equal(step.effect.type, 'actor_move');
const before = performance.now();
const action = goals.executeNpcGoalStep(world.entities[0], step, world, session,
    { canMove: () => ({ ok: true }) });
const executionMs = performance.now() - before;
assert(action.ok, action.reason);
assert.equal(session.entityStates.duty.location, 'corridor');
session = JSON.parse(JSON.stringify(action.candidate.session));
assert.equal(session.entityStates.duty.location, 'workshop');
const proof = goals.goalCompletionProof(world.entities[0], step, world, session, action.event);
assert.equal(proof.eventId, action.event.id);
session.entityStates.duty.goalStatus = 'completed';
session.entityStates.duty.goalCompletionProof = proof;
assert.equal(goals.selectNpcGoal(world.entities[0], world, session, 4).goal,
    'Carry supplies');
assert.equal(session.entityStates.duty.goalActionIndex, 2);
const start = performance.now();
for (let i = 0; i < 200; i++) goals.evaluateObservationReactions(
    world.entities[0], world, session, 4 + i);
const reactionMs = performance.now() - start;
assert.equal(session.entityStates.duty.goalPool.length, 1);
const crowdedWorld = { ...world, entities: Array.from({ length: 40 }, (_, index) =>
    ({ id: `crowd_${index}`, type: 'npc', goal: 'Daily task',
        personalityTraits: { duty: index % 2 ? 20 : 90 } })) };
const crowded = { turnCount: 5, worldClock: { absoluteMinutes: 50 },
    entityStates: Object.fromEntries(crowdedWorld.entities.map(npc => [npc.id,
        { location: 'corridor', goal: 'Daily task', goalStatus: 'active',
            goalAutonomy: 'medium', observations: Array.from({ length: 10 }, (_, index) =>
                ({ id: `obs_${npc.id}_${index}`, eventId: `evt_${index}`,
                    turn: 4, sourceType: 'witnessed', evidenceMode: 'direct',
                    channel: 'hearing', kind: 'disturbance', tags: [], text: 'A sound.' })) }]) ) };
const reactionStart = performance.now();
for (const npc of crowdedWorld.entities)
    goals.evaluateObservationReactions(npc, crowdedWorld, crowded, 5);
const batchReactionMs = performance.now() - reactionStart;
const selectionStart = performance.now();
for (const npc of crowdedWorld.entities)
    goals.selectNpcGoal(npc, crowdedWorld, crowded, 5);
const selectionMs = performance.now() - selectionStart;
assert.equal(crowdedWorld.entities.filter(npc =>
    crowded.entityStates[npc.id].goalPool?.length === 1).length, 20);
console.log(`PASS NPC reactions: perception, personal predicates, offscreen linked action, proof, interruption, resume, reload, idempotence, rollback; 40 NPC x 10 observations reaction ${batchReactionMs.toFixed(2)} ms, goal update ${selectionMs.toFixed(2)} ms, linked action ${executionMs.toFixed(2)} ms; repeat ${reactionMs.toFixed(2)} ms / 200 evaluations`);
