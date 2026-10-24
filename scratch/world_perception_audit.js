'use strict';
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const perception = require('../worlds/perception');
const location = (id, exits = []) => ({ id, exits });
const npc = id => ({ id, type: 'npc' });
function fixture() {
    const world = {
        locations: [location('shop', [{ targetLocationId: 'hall' },
            { targetLocationId: 'side' }]),
        location('hall', [{ targetLocationId: 'shop' },
            { targetLocationId: 'side', doorId: 'door', lockState: 'locked' }]),
        location('side', [{ targetLocationId: 'shop' },
            { targetLocationId: 'hall', doorId: 'door', lockState: 'locked' }]),
        location('cellar')],
        entities: ['a', 'b', 'c'].map(npc),
        perception: { channels: {
            hearing: { enabled: true, edgeAttenuation: 1, closedDoorAttenuation: 3,
                threshold: 0.5, maxHops: 4 },
            sight: { enabled: true, maxHops: 1, threshold: 0.5 },
            smell: { enabled: true, edgeAttenuation: 2, threshold: 0.5, maxHops: 2 }
        } },
        perceptionRules: [{ on: { type: 'environment', action: 'crash' }, stimuli: [
            { channel: 'hearing', strength: 4, text: 'A table crashes.',
                remoteText: 'A crash comes from the shop.' },
            { channel: 'sight', strength: 2, text: 'A table falls in the shop.',
                remoteText: 'A table falls in the shop.' }
        ] }]
    };
    const session = { turnCount: 3, worldClock: { absoluteMinutes: 123 },
        playerLocation: 'cellar', unlockedExits: {}, entityStates: {
            a: { location: 'shop', observations: [] },
            b: { location: 'hall', observations: [] },
            c: { location: 'cellar', observations: [] }
        } };
    return { world, session };
}
const event = { id: 'evt_crash', type: 'environment', action: 'crash',
    actor_id: 'player', location_id: 'shop', status: 'completed',
    cause: 'The player secretly pushed it.' };
{
    const { world, session } = fixture();
    assert.equal(perception.perceiveConfirmedEvent(world, session, event).length, 3);
    assert.deepEqual(session.entityStates.a.observations.map(item => item.channel),
        ['hearing', 'sight']);
    assert.deepEqual(session.entityStates.b.observations.map(item => item.channel),
        ['hearing']);
    assert.equal(session.entityStates.c.observations.length, 0);
    assert.equal(session.entityStates.b.observations[0].text,
        'A crash comes from the shop.');
    assert.equal(JSON.stringify(session.entityStates).includes('secretly'), false);
    assert.equal(perception.perceiveConfirmedEvent(world, session, event).length, 0);
    assert.equal(perception.perceiveConfirmedEvent(world, session,
        { ...event, id: 'rejected', status: 'failed' }).length, 0);
    assert.equal(session.entityStates.a.observations[0].eventId, event.id);
    assert.equal(JSON.parse(JSON.stringify(session)).entityStates.b.observations[0]
        .eventId, event.id);
    const before = structuredClone(session);
    const working = structuredClone(session);
    perception.perceiveConfirmedEvent(world, working, { ...event, id: 'rollback' });
    assert.deepEqual(session, before);
}
{
    const { world, session } = fixture();
    world.locations[0].exits = [{ targetLocationId: 'hall', doorId: 'door',
        lockState: 'locked' }];
    world.locations[1].exits = [{ targetLocationId: 'shop', doorId: 'door',
        lockState: 'locked' }];
    world.perceptionRules[0].stimuli = [{ channel: 'hearing', strength: 2,
        text: 'Quiet impact.', remoteText: 'A quiet impact nearby.' }];
    assert.equal(perception.perceiveConfirmedEvent(world, session, event).length, 1);
    world.perceptionRules[0].stimuli[0].strength = 5;
    assert.equal(perception.perceiveConfirmedEvent(world, session,
        { ...event, id: 'loud' }).length, 2);
}
{
    const { world, session } = fixture();
    world.perceptionRules[0].stimuli = [{ channel: 'sight', strength: 3,
        text: 'The player breaks a vase.', remoteText: 'A vase breaks.',
        hiddenText: 'A vase breaks.', identifiesActor: true }];
    session.entityStates.player = { visible: false };
    assert.equal(perception.perceiveConfirmedEvent(world, session, event)[0]
        .observation.text, 'A vase breaks.');
    assert.equal(session.entityStates.b.observations.length, 0);
    world.locations[0].exits[0].sight = true;
    assert.equal(perception.perceiveConfirmedEvent(world, session,
        { ...event, id: 'visible_route' }).length, 2);
}
{
    const { world, session } = fixture();
    world.perceptionRules[0].stimuli = [{ channel: 'smell', strength: 3,
        text: 'Smoke smells nearby.', remoteText: 'Smoke can be smelled.' },
        { channel: 'magic', strength: 3, text: 'A magical pulse.',
            remoteText: 'A magical pulse.' }];
    assert.equal(perception.perceiveConfirmedEvent(world, session, event).length, 2);
    world.perception.channels.magic = { enabled: true, maxHops: 1,
        edgeAttenuation: 1, threshold: 0.5 };
    assert.equal(perception.perceiveConfirmedEvent(world, session,
        { ...event, id: 'extended' }).length, 4);
}
{
    const { world, session } = fixture();
    world.locations = Array.from({ length: 48 }, (_, index) => location(`room${index}`,
        index < 47 ? [{ targetLocationId: `room${index + 1}` }] : []));
    world.entities = Array.from({ length: 48 }, (_, index) => npc(`npc${index}`));
    session.entityStates = Object.fromEntries(world.entities.map((item, index) =>
        [item.id, { location: `room${index}`, observations: [] }]));
    const start = performance.now();
    for (let index = 0; index < 100; index++) perception.perceiveConfirmedEvent(world,
        session, { ...event, id: `perf${index}`, location_id: 'room0' });
    console.log(`Perception only: ${(performance.now() - start).toFixed(2)} ms / 100 events, 48 rooms, 48 NPCs`);
}
console.log('world_perception_audit: passed');
