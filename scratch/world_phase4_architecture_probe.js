/**
 * Isolated Phase 4 clock audit. No user saves are opened.
 * Run: node scratch/world_phase4_architecture_probe.js
 */
'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildContext } = require('./app_source.js');
const time = require('../worlds/world-time.js');
require('../worlds/background-sim.js');
const lore = require('../assets/worlds/world-lore.js');
const sim = globalThis.HordeBackgroundSim;
const clock = buildContext(vm, ['getWorldTimeData']);
const copy = value => JSON.parse(JSON.stringify(value));
const world = {
    id: 'probe_world',
    settings: { timeAdvancesWhenAway: true },
    hudConfig: { timeStep: 0, startTimeHours: 8 },
    locations: [
        { id: 'a', name: 'A', exits: [{ targetLocationId: 'b', travelTime: 180 }] },
        { id: 'b', name: 'B', exits: [], access: { default: 'restricted', npcs: { n: 'deny' } } }
    ],
    entities: [{ id: 'n', name: 'N', type: 'npc',
        schedule: [{ time: '09:00', locationId: 'b' }] }]
};
const session = {
    id: 'probe_session', turnCount: 1, bonusTimeMinutes: 0, playerLocation: 'a',
    settings: { timeAdvancesWhenAway: true }, lastBackgroundSeenAt: 1000000,
    worldClock: { absoluteMinutes: 480, turnCount: 1, bonusTimeMinutes: 0 },
    entityStates: { n: { location: 'a' } },
    scheduledEvents: [{ id: 'due', dueMinute: 510, status: 'scheduled' }]
};
const original = JSON.stringify({ world, session });

const nextTurn = copy(session);
nextTurn.turnCount++;
assert.equal(clock.getWorldTimeData(world, nextTurn).currentTotalMinutes, 480,
    'a normal turn advanced a paused clock');
const paused = sim.catchUp(world, session, 1600000);
assert.equal(paused.ticks, 0);
assert.equal(paused.proof.reason, 'paused');
assert.equal(paused.session.worldClock.absoluteMinutes, 480);
assert.equal(paused.session.entityStates.n.location, 'a');
assert.equal(paused.session.scheduledEvents[0].status, 'scheduled');
assert.equal(paused.session.lastBackgroundSeenAt, 1600000,
    'paused real time must not be caught up after resuming');

// Round-trip the entire legacy-shaped session, including event and NPC state.
const reloaded = copy(paused.session);
assert.deepEqual(reloaded, paused.session);
assert.equal(clock.getWorldTimeData(world, reloaded).currentTotalMinutes, 480);
const stillPaused = sim.catchUp(world, reloaded, 2200000);
assert.equal(stillPaused.session.worldClock.absoluteMinutes, 480);
assert.equal(stillPaused.session.scheduledEvents[0].status, 'scheduled');

// A manual wait or explicit simulation step can advance time even with timeStep 0.
const manual = copy(session);
manual.bonusTimeMinutes += 30;
assert.equal(clock.getWorldTimeData(world, manual).currentTotalMinutes, 510);
manual.turnCount++;
assert.equal(clock.getWorldTimeData(world, manual).currentTotalMinutes, 510);
const explicit = sim.tick(world, session, 30);
assert.equal(explicit.session.worldClock.absoluteMinutes, 510);
assert.equal(clock.getWorldTimeData(world, explicit.session).currentTotalMinutes, 510);
assert.equal(explicit.session.scheduledEvents[0].status, 'scheduled',
    'the clock module must not silently dispatch World events');

const activeWorld = copy(world);
activeWorld.hudConfig.timeStep = 5;
const active = sim.catchUp(activeWorld, session, 1600000);
assert.equal(active.ticks, 1);
assert.equal(active.session.worldClock.absoluteMinutes, 540);
assert.equal(clock.getWorldTimeData(activeWorld, active.session).currentTotalMinutes, 540);
const partial = sim.catchUp(activeWorld, session, 1300000);
assert.equal(partial.ticks, 0);
assert.equal(partial.session.lastBackgroundSeenAt, 1000000,
    'an enabled partial interval must survive the next catch-up');
const accumulated = sim.catchUp(activeWorld, copy(partial.session), 1600000);
assert.equal(accumulated.ticks, 1);
assert.equal(accumulated.session.worldClock.absoluteMinutes, active.session.worldClock.absoluteMinutes);
assert.equal(accumulated.session.lastBackgroundSeenAt, 1600000);
const partialThenPaused = sim.catchUp(world, partial.session, 1600000);
assert.equal(partialThenPaused.session.lastBackgroundSeenAt, 1600000,
    'pausing must discard the partial interval');
const partialDisabled = copy(partial.session);
partialDisabled.settings.timeAdvancesWhenAway = false;
assert.equal(sim.catchUp(activeWorld, partialDisabled, 1600000).session.lastBackgroundSeenAt, 1600000,
    'disabling background time must discard the partial interval');
const manualSet = copy(active.session);
assert.equal(time.setAbsoluteMinutes(activeWorld, manualSet, 600).currentTotalMinutes, 600);
manualSet.turnCount++;
assert.equal(clock.getWorldTimeData(activeWorld, manualSet).currentTotalMinutes, 605);
const pausedSet = copy(explicit.session);
assert.equal(time.setAbsoluteMinutes(world, pausedSet, 600).currentTotalMinutes, 600);
pausedSet.turnCount++;
assert.equal(clock.getWorldTimeData(world, pausedSet).currentTotalMinutes, 600);
const resumed = sim.catchUp(activeWorld, copy(paused.session), 2200000);
assert.equal(resumed.ticks, 1);
assert.equal(resumed.session.worldClock.absoluteMinutes, 540);

const disabled = copy(session);
disabled.settings.timeAdvancesWhenAway = false;
const off = sim.catchUp(activeWorld, disabled, 1600000);
assert.equal(off.ticks, 0);
assert.equal(off.session.worldClock.absoluteMinutes, 480);
const defaultOffWorld = copy(activeWorld);
defaultOffWorld.settings.timeAdvancesWhenAway = false;
const defaultOffSession = copy(session);
defaultOffSession.settings.timeAdvancesWhenAway = null;
assert.equal(sim.catchUp(defaultOffWorld, defaultOffSession, 1600000).ticks, 0);
assert.equal(sim.catchUp(defaultOffWorld, defaultOffSession, 1600000, true).ticks, 1,
    'an explicitly enabled global background setting must still work');

const legacy = copy(session);
delete legacy.worldClock;
const legacyAdvance = sim.catchUp(activeWorld, legacy, 1600000);
assert.equal(legacyAdvance.session.worldClock.absoluteMinutes, 540,
    'a legacy session must start at the same authored time as a normal turn');
assert.equal(clock.getWorldTimeData(activeWorld, legacyAdvance.session).currentTotalMinutes, 540);
const legacyPaused = sim.catchUp(world, legacy, 1600000);
assert.equal(legacyPaused.ticks, 0);
assert.equal(clock.getWorldTimeData(world, legacyPaused.session).currentTotalMinutes, 480);
const sparseWorld = copy(activeWorld);
delete sparseWorld.hudConfig;
delete sparseWorld.settings;
const sparseSession = copy(legacy);
delete sparseSession.settings;
assert.equal(sim.catchUp(sparseWorld, sparseSession, 1600000).ticks, 0,
    'older worlds without background settings must stay disabled');
assert.equal(sim.catchUp(sparseWorld, sparseSession, 1600000, true).session.worldClock.absoluteMinutes, 540,
    'older worlds without a clock must use the normal default start time');

assert.equal(JSON.stringify({ world, session }), original, 'probe mutated canonical input');

// The pure clock has no second route or schedule engine. A caller without the
// canonical World scheduler cannot move an NPC, including via legacy aliases.
const aliasWorld = copy(activeWorld);
aliasWorld.locations[0].exits[0] = { to: 'b', travelTime: 180 };
const alias = sim.catchUp(aliasWorld, session, 1600000);
assert.equal(sim.authoredPath, undefined);
assert.equal(lore.exitTarget(aliasWorld, aliasWorld.locations[0].exits[0]), null);
assert.equal(lore.access(aliasWorld, 'n', 'b').ok, false);
assert.equal(alias.session.entityStates.n.location, 'a');
assert.equal(active.session.entityStates.n.location, 'a');
console.log('PASS World time: paused turns/background, manual steps, enabled/disabled, legacy, round trip; clock-only movement is inert');
