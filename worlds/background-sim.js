/* Deterministic, authored-only World background clock. No AI and no player
 * turn mutation. The browser entry point is also usable from a worker. */
(function (root) {
    'use strict';
    const DAY = 1440;
    const WEEK = 10080;
    const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const integer = (value, fallback = 0) => Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback;
    const normalizeSettings = world => {
        if (!world) return { timeAdvancesWhenAway: false };
        world.settings = world.settings && typeof world.settings === 'object' ? world.settings : {};
        world.settings.timeAdvancesWhenAway = world.settings.timeAdvancesWhenAway === true;
        return world.settings;
    };
    const effectiveTimeAdvances = (session, world, globalDefault = false) => {
        const override = session?.settings?.timeAdvancesWhenAway;
        return override === true || override === false ? override : (world?.settings?.timeAdvancesWhenAway === true || globalDefault === true);
    };
    const minuteOfDay = value => ((integer(value) % DAY) + DAY) % DAY;
    const dayIndex = value => Math.floor(integer(value) / DAY);
    const parseTime = value => {
        const match = String(value || '').trim().match(/^(\d{1,2})(?::(\d{1,2}))?$/);
        if (!match) return null;
        const hour = Number(match[1]), minute = Number(match[2] || 0);
        return hour >= 0 && hour < 24 && minute >= 0 && minute < 60 ? hour * 60 + minute : null;
    };
    const allowedDay = (raw, day) => {
        if (!raw) return true;
        const values = (Array.isArray(raw) ? raw : [raw]).flatMap(value => String(value).toLowerCase().split(/[\s,]+/)).filter(Boolean);
        if (!values.length || values.includes('daily') || values.includes('everyday')) return true;
        const name = DAYS[((day % 7) + 7) % 7];
        return values.includes(name) || values.includes(name.slice(0, 3))
            || (values.includes('weekday') && day % 7 < 5) || (values.includes('weekend') && day % 7 >= 5);
    };
    const scheduleAt = (entity, session, absoluteMinutes) => {
        const override = session?.npcScheduleOverrides?.[entity?.id];
        const blocks = Array.isArray(override) ? override : (Array.isArray(entity?.schedule) ? entity.schedule : []);
        const now = minuteOfDay(absoluteMinutes), day = dayIndex(absoluteMinutes);
        const candidates = blocks.map((block, index) => ({ block, index, time: parseTime(block?.time) }))
            .filter(item => item.time !== null && allowedDay(item.block?.days, day));
        if (!candidates.length) return null;
        candidates.sort((a, b) => a.time - b.time || a.index - b.index);
        return [...candidates].reverse().find(item => item.time <= now)?.block || candidates[candidates.length - 1].block;
    };
    const targetId = block => String(block?.locationId || block?.location || '').trim() || null;
    const locationMap = world => new Map((Array.isArray(world?.locations) ? world.locations : []).map(place => [String(place.id), place]));
    const exitTarget = (exit, map) => {
        const id = String(exit?.to || exit?.targetId || exit?.destinationId || exit?.locationId || exit?.destination || '').trim();
        return id && map.has(id) ? id : null;
    };
    const passable = exit => {
        const lock = String(exit?.lockState || exit?.state || '').toLowerCase();
        return !['locked', 'sealed', 'closed', 'blocked', 'unknown'].includes(lock)
            && exit?.sealed !== true && exit?.locked !== true && exit?.passable !== false
            && !exit?.requiredItem && !exit?.condition;
    };
    const authoredPath = (world, from, to) => {
        if (!from || !to) return null;
        if (from === to) return [from];
        const map = locationMap(world), queue = [from], parent = new Map([[from, null]]);
        while (queue.length) {
            const current = queue.shift(), place = map.get(current);
            for (const exit of Array.isArray(place?.exits) ? place.exits : []) {
                if (!passable(exit)) continue;
                const next = exitTarget(exit, map);
                if (!next || parent.has(next)) continue;
                parent.set(next, current);
                if (next === to) {
                    const path = [to];
                    while (path[0] !== from) path.unshift(parent.get(path[0]));
                    return path;
                }
                queue.push(next);
            }
        }
        return null;
    };
    const tick = (world, session, gameMinutes = 60) => {
        const nextWorld = clone(world), nextSession = clone(session);
        const before = integer(nextSession.worldClock?.absoluteMinutes, 0);
        const after = before + Math.max(0, integer(gameMinutes));
        nextSession.worldClock = { ...(nextSession.worldClock || {}), absoluteMinutes: after };
        nextSession.entityStates = nextSession.entityStates && typeof nextSession.entityStates === 'object' ? nextSession.entityStates : {};
        const moved = [];
        const entities = Array.isArray(nextWorld.entities) ? nextWorld.entities : [];
        for (const entity of entities) {
            if (entity?.type && entity.type !== 'npc') continue;
            const state = nextSession.entityStates[entity?.id];
            if (!state || !entity?.id) continue;
            const block = scheduleAt(entity, nextSession, after);
            const destination = targetId(block);
            if (!destination || !state.location || destination === state.location) continue;
            const path = authoredPath(nextWorld, String(state.location), destination);
            if (!path) continue;
            state.location = destination;
            state.backgroundActivity = String(block.activity || '').slice(0, 240);
            moved.push({ id: entity.id, from: path[0], to: destination, path, activity: state.backgroundActivity });
        }
        return { world: nextWorld, session: nextSession, moved, proof: { fromMinutes: before, toMinutes: after, moved: moved.map(item => ({ id: item.id, to: item.to })) } };
    };
    const catchUp = (world, session, realNow = Date.now(), globalDefault = false) => {
        const nextWorld = clone(world), nextSession = clone(session);
        normalizeSettings(nextWorld);
        nextSession.settings = nextSession.settings && typeof nextSession.settings === 'object' ? nextSession.settings : {};
        const previousSeen = Number(nextSession.lastBackgroundSeenAt);
        nextSession.lastBackgroundSeenAt = Number.isFinite(Number(realNow)) ? Number(realNow) : Date.now();
        if (!effectiveTimeAdvances(nextSession, nextWorld, globalDefault) || !Number.isFinite(previousSeen) || previousSeen >= nextSession.lastBackgroundSeenAt) {
            return { world: nextWorld, session: nextSession, ticks: 0, moved: [], skipped: true, proof: { reason: effectiveTimeAdvances(nextSession, nextWorld, globalDefault) ? 'no_prior_seen_time' : 'disabled' } };
        }
        const ticks = Math.min(10080, Math.floor((nextSession.lastBackgroundSeenAt - previousSeen) / 600000));
        let result = { world: nextWorld, session: nextSession, moved: [], proof: null };
        for (let index = 0; index < ticks; index++) {
            const step = tick(result.world, result.session, 60);
            result = { world: step.world, session: step.session, moved: result.moved.concat(step.moved), proof: step.proof };
        }
        return { ...result, ticks, skipped: false };
    };
    const api = Object.freeze({ normalizeSettings, effectiveTimeAdvances, authoredPath, scheduleAt, tick, catchUp });
    root.HordeBackgroundSim = api;
    if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof self.document === 'undefined') {
        self.onmessage = event => {
            try { self.postMessage({ ok: true, result: catchUp(event.data.world, event.data.session, event.data.realNow, event.data.globalDefault) }); }
            catch (error) { self.postMessage({ ok: false, error: String(error?.message || error) }); }
        };
    }
})(typeof globalThis !== 'undefined' ? globalThis : window);
