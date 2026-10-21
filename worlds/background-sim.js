/* Deterministic World background clock. The caller supplies the existing
 * World scheduler for NPC movement; a clock-only worker cannot move actors. */
(function (root) {
    'use strict';
    if (!root.HordeWorldTime && typeof root.importScripts === 'function') root.importScripts('world-time.js');
    const worldTime = root.HordeWorldTime || (typeof module !== 'undefined' && module.exports ? require('./world-time.js') : null);
    if (!worldTime) throw new Error('World time rules are unavailable');
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const normalizeSettings = world => {
        if (!world) return { timeAdvancesWhenAway: false };
        world.settings = world.settings && typeof world.settings === 'object' ? world.settings : {};
        world.settings.timeAdvancesWhenAway = world.settings.timeAdvancesWhenAway === true;
        return world.settings;
    };
    const effectiveTimeAdvances = (session, world, globalDefault = false) =>
        worldTime.backgroundPolicy(world, session, globalDefault).enabled;
    const advanceStep = (world, session, gameMinutes, advanceActors) => {
        const { before, after } = worldTime.advanceMinutes(world, session, gameMinutes);
        const moved = typeof advanceActors === 'function'
            ? (advanceActors(world, session, after) || []) : [];
        return { moved, proof: { fromMinutes: before, toMinutes: after,
            moved: moved.map(item => ({ id: item.id, to: item.to })) } };
    };
    const tick = (world, session, gameMinutes = 60, advanceActors = null) => {
        const nextWorld = clone(world), nextSession = clone(session);
        return { world: nextWorld, session: nextSession,
            ...advanceStep(nextWorld, nextSession, gameMinutes, advanceActors) };
    };
    const catchUp = (world, session, realNow = Date.now(), globalDefault = false, advanceActors = null) => {
        const nextWorld = clone(world), nextSession = clone(session);
        normalizeSettings(nextWorld);
        nextSession.settings = nextSession.settings && typeof nextSession.settings === 'object' ? nextSession.settings : {};
        const previousSeen = Number(nextSession.lastBackgroundSeenAt);
        nextSession.lastBackgroundSeenAt = Number.isFinite(Number(realNow)) ? Number(realNow) : Date.now();
        const policy = worldTime.backgroundPolicy(nextWorld, nextSession, globalDefault);
        if (!policy.enabled || !Number.isFinite(previousSeen) || previousSeen >= nextSession.lastBackgroundSeenAt) {
            return { world: nextWorld, session: nextSession, ticks: 0, moved: [], skipped: true, proof: { reason: policy.reason || 'no_prior_seen_time' } };
        }
        const dueTicks = Math.floor((nextSession.lastBackgroundSeenAt - previousSeen) / 600000);
        const ticks = Math.min(10080, dueTicks);
        // Keep a partial ten-minute interval for the next enabled catch-up.
        // Paused/disabled time was discarded above; the week cap still drops
        // any excess beyond its existing per-absence limit.
        if (dueTicks <= 10080) nextSession.lastBackgroundSeenAt = previousSeen + ticks * 600000;
        const moved = [];
        let proof = null;
        for (let index = 0; index < ticks; index++) {
            const step = advanceStep(nextWorld, nextSession, 60, advanceActors);
            moved.push(...step.moved);
            proof = step.proof;
        }
        return { world: nextWorld, session: nextSession, moved, proof, ticks, skipped: false };
    };
    const api = Object.freeze({ normalizeSettings, effectiveTimeAdvances, tick, catchUp });
    root.HordeBackgroundSim = api;
    if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof self.document === 'undefined') {
        self.onmessage = event => {
            try { self.postMessage({ ok: true, result: catchUp(event.data.world, event.data.session, event.data.realNow, event.data.globalDefault) }); }
            catch (error) { self.postMessage({ ok: false, error: String(error?.message || error) }); }
        };
    }
})(typeof globalThis !== 'undefined' ? globalThis : window);
