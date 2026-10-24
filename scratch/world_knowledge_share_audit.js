'use strict';
const assert = require('node:assert/strict');
const goals = require('../worlds/npc-goal-actions');
const linked = require('../worlds/linked-world-actions');

const world = { id: 'knowledge_audit', entities: [
    { id: 'a', type: 'npc', name: 'Ada' },
    { id: 'b', type: 'npc', name: 'Ben' },
    { id: 'c', type: 'npc', name: 'Cy' }
], locations: [
    { id: 'hall', name: 'Hall', exits: [{ targetLocationId: 'workshop' }] },
    { id: 'workshop', name: 'Workshop', exits: [{ targetLocationId: 'hall' }] }
] };
const session = { id: 'knowledge_session', playerLocation: 'workshop', turnCount: 4,
    worldClock: { absoluteMinutes: 280 }, entityStates: {
        a: { location: 'hall', goal: 'Tell Ben about the noise', goalStatus: 'active',
            observations: [{ id: 'obs_crash_a', eventId: 'event_crash',
                text: 'A loud crash came from the workshop.', sourceType: 'witnessed',
                evidenceMode: 'direct', confidence: 1, channel: 'hearing',
                kind: 'disturbance', tags: ['noise'], allowedToShare: true, turn: 3 }] },
        b: { location: 'hall', observations: [] },
        c: { location: 'workshop', observations: [] }
    }, locationStates: {}, npcRelationships: {}, worldNews: [] };
const option = goals.npcGoalOptions(world.entities[0], world, session)
    .find(item => item.effect.type === 'knowledge_share' && item.targetId === 'b');
assert(option, 'the existing NPC option catalogue offers an in-person report');
assert(!goals.npcGoalOptions(world.entities[0], world, session)
    .some(item => item.effect.type === 'knowledge_share' && item.targetId === 'c'));
const first = goals.executeNpcGoalStep(world.entities[0], option, world, session);
assert(first.ok, first.reason);
assert.equal(session.entityStates.b.observations.length, 0, 'proposal has no side effect');
let saved = JSON.parse(JSON.stringify(first.candidate.session));
const reportB = saved.entityStates.b.observations[0];
assert.equal(reportB.sourceType, 'told');
assert.equal(reportB.evidenceMode, 'hearsay');
assert.equal(reportB.sourceNpcId, 'a');
assert.equal(reportB.originNpcId, 'a');
assert.equal(reportB.eventId, 'event_crash');
assert.equal(reportB.text, 'A loud crash came from the workshop.');
assert(!JSON.stringify(reportB).includes('table'), 'hidden cause was never copied');
assert.equal(saved.entityStates.c.observations.length, 0);
assert(!goals.executeNpcGoalStep(world.entities[0], option, world, saved).ok,
    'the same confirmed action cannot deliver twice');
saved.turnCount = 5;
const repeated = goals.executeNpcGoalStep(world.entities[0], option, world, saved);
assert(repeated.ok, repeated.reason);
assert.equal(repeated.candidate.session.entityStates.b.observations.length, 2,
    'a later conversation is a distinct delivery');
assert.notEqual(repeated.candidate.session.entityStates.b.observations[1].deliveryActionId,
    reportB.deliveryActionId);
assert(!goals.executeNpcGoalStep(world.entities[0], option, world,
    repeated.candidate.session).ok, 'the second action also remains idempotent');
saved = structuredClone(repeated.candidate.session);

saved.entityStates.c.location = 'hall';
saved.entityStates.b.goal = 'Tell Cy about the noise';
saved.entityStates.b.goalStatus = 'active';
saved.turnCount = 5;
saved.worldClock.absoluteMinutes = 285;
const relay = goals.npcGoalOptions(world.entities[1], world, saved)
    .find(item => item.effect.type === 'knowledge_share' && item.targetId === 'c');
assert(relay);
const second = goals.executeNpcGoalStep(world.entities[1], relay, world, saved);
assert(second.ok, second.reason);
const reportC = JSON.parse(JSON.stringify(second.candidate.session)).entityStates.c.observations[0];
assert.equal(reportC.sourceNpcId, 'b');
assert.equal(reportC.originNpcId, 'a');
assert.equal(reportC.sourceObservationId, reportB.id);
assert.equal(reportC.originObservationId, 'obs_crash_a');
assert.equal(reportC.reportedSourceType, 'told');
assert(reportC.confidence < reportB.confidence);

const returnSession = JSON.parse(JSON.stringify(second.candidate.session));
returnSession.turnCount = 6;
returnSession.entityStates.c.goal = 'Tell Ada about the noise';
returnSession.entityStates.c.goalStatus = 'active';
const returnStep = { label: 'tell Ada', effect: { type: 'knowledge_share',
    payload: { actor_id: 'c', recipient_id: 'a', observation_id: reportC.id } } };
const returned = goals.executeNpcGoalStep(world.entities[2], returnStep,
    world, returnSession);
assert(returned.ok, returned.reason);
const roundTrip = JSON.parse(JSON.stringify(returned.candidate.session));
const returnedReport = roundTrip.entityStates.a.observations.at(-1);
assert.equal(returnedReport.sourceNpcId, 'c');
assert.equal(returnedReport.sourceObservationId, reportC.id);
assert.equal(returnedReport.originNpcId, 'a');
assert.equal(returnedReport.originObservationId, 'obs_crash_a');
assert.equal(returnedReport.reportedSourceType, 'told');
assert.equal(returnedReport.sourceType, 'told');
assert.equal(returnedReport.evidenceMode, 'hearsay');
assert.equal(roundTrip.entityStates.a.observations[0].sourceType, 'witnessed');
assert.notEqual(returnedReport.deliveryActionId, reportC.deliveryActionId);

const cyclic = structuredClone(session);
cyclic.entityStates.c.location = 'hall';
const cyclicWorld = { ...world, reactionRules: [{ id: 'check_rumor',
    on: { sourceType: 'told' }, goal: { goal: 'Check the noise', priority: 70 } }] };
let cyclicDeliveries = 0;
let cyclicBlocked = false;
for (let i = 0; i < 40; i++) {
    const sender = ['a', 'b', 'c'][i % 3];
    const recipient = ['b', 'c', 'a'][i % 3];
    const source = cyclic.entityStates[sender].observations.at(-1);
    const step = { label: `relay ${i}`, effect: { type: 'knowledge_share',
        payload: { actor_id: sender, recipient_id: recipient,
            observation_id: source.id } } };
    cyclic.turnCount = 4 + i;
    const result = goals.executeNpcGoalStep(cyclicWorld.entities[i % 3], step,
        cyclicWorld, cyclic);
    if (!result.ok) { cyclicBlocked = true; break; }
    Object.assign(cyclic, result.candidate.session);
    cyclicDeliveries++;
    const last = cyclic.entityStates[recipient].observations.at(-1);
    assert.equal(last.evidenceMode, 'hearsay');
    assert.equal(last.originNpcId, 'a');
    assert.equal(last.originObservationId, 'obs_crash_a');
    goals.evaluateObservationReactions(cyclicWorld.entities[(i + 1) % 3],
        cyclicWorld, cyclic, cyclic.turnCount + 1);
    assert((cyclic.entityStates[recipient].goalPool || []).length <= 1,
        'a relay must not create an endless chain of duplicate reaction goals');
}
assert(cyclicBlocked, 'the rumor cycle must stop at a finite origin limit');
assert(cyclicDeliveries <= 24, 'one origin must have bounded storage across the cycle');
assert.equal(cyclic.worldNews.length, 0);

const privateSession = structuredClone(session);
privateSession.entityStates.a.observations[0].allowedToShare = false;
assert(!goals.npcGoalOptions(world.entities[0], world, privateSession)
    .some(item => item.effect.type === 'knowledge_share'));
assert(!goals.executeNpcGoalStep(world.entities[0], option, world, privateSession).ok);
const distant = structuredClone(session);
distant.entityStates.b.location = 'workshop';
assert(!goals.executeNpcGoalStep(world.entities[0], option, world, distant).ok);
for (const [name, mutate] of [
    ['inactive sender', s => { s.entityStates.a.status = 'gone'; }],
    ['inactive recipient', s => { s.entityStates.b.status = 'dead'; }],
    ['mute sender', s => { s.entityStates.a.canSpeak = false; }],
    ['deaf recipient', s => { s.entityStates.b.canHear = false; }],
    ['blocked sender', s => { s.entityStates.a.communicationBlocked = true; }],
    ['blocked recipient', s => { s.entityStates.b.communicationBlocked = true; }]
]) {
    const test = structuredClone(session);
    mutate(test);
    assert(!goals.executeNpcGoalStep(world.entities[0], option, world, test).ok, name);
    assert.equal(test.entityStates.b.observations.length, 0, name);
}
const noChannel = { ...world, communication: { inPerson: false } };
assert(!goals.npcGoalOptions(world.entities[0], noChannel, session)
    .some(item => item.effect.type === 'knowledge_share'));
assert(!goals.executeNpcGoalStep(world.entities[0], option, noChannel, session).ok);
const anotherRecipient = structuredClone(session);
anotherRecipient.entityStates.c.location = 'hall';
const cyOption = goals.npcGoalOptions(world.entities[0], world, anotherRecipient)
    .find(item => item.effect.type === 'knowledge_share' && item.targetId === 'c');
assert(cyOption);
const cyDelivery = goals.executeNpcGoalStep(world.entities[0], cyOption,
    world, anotherRecipient);
assert(cyDelivery.ok);
assert.equal(cyDelivery.candidate.session.entityStates.b.observations.length, 0);
assert.equal(cyDelivery.candidate.session.entityStates.c.observations.length, 1);

const conflicting = structuredClone(session);
conflicting.entityStates.c.location = 'hall';
conflicting.entityStates.b.observations = [{ id: 'obs_crash_b',
    eventId: 'event_crash', text: 'There was no crash.',
    sourceType: 'witnessed', evidenceMode: 'direct',
    allowedToShare: true, turn: 3 }];
const firstClaim = goals.executeNpcGoalStep(world.entities[0], cyOption,
    world, conflicting);
assert(firstClaim.ok);
const claimSession = firstClaim.candidate.session;
claimSession.turnCount = 5;
const contraryOption = goals.npcGoalOptions(world.entities[1], world, claimSession)
    .find(item => item.effect.type === 'knowledge_share' && item.targetId === 'c');
const secondClaim = goals.executeNpcGoalStep(world.entities[1], contraryOption,
    world, claimSession);
assert(secondClaim.ok);
const claims = secondClaim.candidate.session.entityStates.c.observations;
assert.equal(claims.length, 2);
assert.deepEqual(claims.map(item => item.sourceNpcId), ['a', 'b']);
assert.notEqual(claims[0].text, claims[1].text);
assert.equal(secondClaim.candidate.session.worldNews.length, 0);
assert.deepEqual(secondClaim.candidate.world, world);

const payload = option.effect.payload;
const forged = linked.executeLinkedActions({ actions: [{ action_id: 'forge',
    kind: 'speech', status: 'resolved', request: 'tell Ben', response_id: 'line',
    action_effects: { knowledge_share: [payload] } }],
events: [{ id: 'forge_event', action_id: 'forge', passage_id: 'line',
    actor_id: 'a', target_id: 'c',
    type: 'dialogue', action: 'report', status: 'completed' }],
narrative: [{ id: 'line', action_id: 'forge', text: 'Ada speaks.' }] }, world, session,
{ requireEffectWitnesses: true });
assert(!forged.ok, 'a mismatched recipient cannot witness delivery');
assert.equal(session.entityStates.b.observations.length, 0);
assert.equal(session.entityStates.b.goalPool, undefined,
    'failed delivery cannot leave a reaction goal');

const reactive = JSON.parse(JSON.stringify(first.candidate.session));
reactive.turnCount = 5;
world.reactionRules = [{ id: 'investigate_report',
    on: { sourceType: 'told', kind: 'disturbance' },
    goal: { goal: 'Inspect Workshop', priority: 80,
        completion: { type: 'actor_location', locationId: 'workshop' } } }];
assert.equal(goals.evaluateObservationReactions(world.entities[1], world, reactive, 5).added, 1);
assert.equal(goals.evaluateObservationReactions(world.entities[1], world, reactive, 6).added, 0);
assert.equal(reactive.entityStates.b.goalPool[0].sourceObservationId, reportB.id);

const consequenceWorld = structuredClone(world);
consequenceWorld.eventRules = [{ id: 'report_alerts_listener',
    on: { type: 'dialogue', action: 'report' }, when: [],
    effect: { type: 'condition_change', payload: {
        target_id: { event_field: 'target_id' }, condition: 'alerted', action: 'add'
    } }, result_event: { type: 'condition',
        actor_id: { event_field: 'target_id' }, condition: 'alerted', action: 'add' }
}];
const consequence = goals.executeNpcGoalStep(consequenceWorld.entities[0], option,
    consequenceWorld, session);
assert(consequence.ok, consequence.reason);
assert(consequence.candidate.session.entityStates.b.conditions.includes('alerted'));
assert.equal(consequence.events.length, 2, 'the consequence proof remains available to the tick');
assert(consequence.events.some(item => item.type === 'dialogue'
    && item.action_id === consequence.event.action_id));
assert(consequence.events.some(item => item.type === 'condition'));
assert.equal(session.entityStates.b.conditions, undefined,
    'the uncommitted source session has no consequence');
const consequenceReload = JSON.parse(JSON.stringify(consequence.candidate.session));
assert(consequenceReload.entityStates.b.conditions.includes('alerted'));
assert(!goals.executeNpcGoalStep(consequenceWorld.entities[0], option,
    consequenceWorld, consequenceReload).ok,
    'the same action cannot apply the consequence twice');
const unconfirmed = linked.executeLinkedActions({ actions: [{ action_id: 'unconfirmed',
    kind: 'speech', status: 'resolved', response_id: 'line',
    action_effects: { knowledge_share: [option.effect.payload] } }],
events: [{ id: 'unconfirmed_event', action_id: 'unconfirmed',
    passage_id: 'line', actor_id: 'a', target_id: 'b',
    type: 'dialogue', action: 'report', status: 'attempted' }],
narrative: [{ id: 'line', action_id: 'unconfirmed', text: 'Ada claims to speak.' }] },
consequenceWorld, session, { requireEffectWitnesses: true });
assert(!unconfirmed.ok);
assert.equal(session.entityStates.b.observations.length, 0);
assert.equal(session.entityStates.b.conditions, undefined);

const scaleSession = structuredClone(session);
const scaleWorld = structuredClone(world);
for (let i = 0; i < 16; i++) {
    const id = `n${i}`;
    scaleWorld.entities.push({ id, type: 'npc', name: `NPC ${i}` });
    scaleSession.entityStates[id] = { location: 'hall', observations: [] };
}
const started = performance.now();
let delivered = 0;
for (let i = 0; i < 16; i++) {
    const id = `n${i}`;
    const step = { label: `tell ${id}`, effect: { type: 'knowledge_share',
        payload: { actor_id: 'a', recipient_id: id,
            observation_id: 'obs_crash_a' } } };
    const result = goals.executeNpcGoalStep(scaleWorld.entities[0], step,
        scaleWorld, scaleSession);
    assert(result.ok);
    Object.assign(scaleSession, result.candidate.session);
    scaleSession.turnCount++;
    delivered++;
}
const shareMs = performance.now() - started;
assert.equal(delivered, 16);
assert.equal(scaleSession.entityStates.a.observations.length, 1);
assert.equal(scaleSession.entityStates.n15.observations.length, 1);
assert.equal(scaleSession.worldNews.length, 0);
const capped = structuredClone(session);
for (let turn = 5; turn < 13; turn++) {
    capped.turnCount = turn;
    const result = goals.executeNpcGoalStep(world.entities[0], option, world, capped);
    assert(result.ok, `legitimate conversation ${turn}`);
    Object.assign(capped, result.candidate.session);
}
capped.turnCount = 13;
assert(!goals.executeNpcGoalStep(world.entities[0], option, world, capped).ok);
assert.equal(capped.entityStates.b.observations.length, 8);
console.log(`knowledge-share cost only: ${shareMs.toFixed(1)} ms for ${delivered} deliveries, 19 NPCs`);
console.log('PASS knowledge share: delivery, relay provenance, privacy, range, witness, reaction, event-rule consequence, reload');
