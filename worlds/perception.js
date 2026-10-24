/* Deterministic, opt-in perception of confirmed World events. Rules belong to
 * the World definition; observations stay in the existing NPC entity state. */
(function (root) {
'use strict';
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const channels = new Set(['hearing', 'sight', 'smell']);
function eventLocation(event, session) {
    return event.location_id || event.from_location_id || event.to_location_id
        || (event.actor_id === 'player' ? session.playerLocation
            : session.entityStates?.[event.actor_id]?.location) || '';
}
function connected(world, session, from, channel, settings) {
    const location = (world.locations || []).find(item => item.id === from);
    const edges = [];
    for (const exit of location?.exits || []) {
        const target = typeof exit === 'string' ? exit : exit?.targetLocationId || exit?.to;
        if (!target || !(world.locations || []).some(item => item.id === target)) continue;
        const locked = exit?.doorId && session.unlockedExits?.[exit.doorId] !== true
            && (exit.lockState === 'locked' || !!exit.requiredItem || !!exit.lockKeyItem);
        if (channel === 'sight' && exit?.sight !== true) continue;
        if (channel === 'sight' && locked && exit?.sightWhenClosed !== true) continue;
        const attenuation = finite(exit?.perception?.[channel]?.attenuation,
            locked ? finite(settings.closedDoorAttenuation, 2) : finite(settings.edgeAttenuation, 1));
        edges.push({ target, cost: Math.max(0.01, attenuation) });
    }
    return edges;
}
function reach(world, session, origin, channel, strength, settings) {
    const best = new Map([[origin, strength]]);
    const pending = [[origin, strength]];
    const maxHops = Math.max(0, Math.min(32, Math.floor(finite(settings.maxHops,
        channel === 'sight' ? 1 : 8))));
    for (let index = 0; index < pending.length && index < 512; index++) {
        const [from, remaining, hops = 0] = pending[index];
        if (hops >= maxHops || remaining < best.get(from)) continue;
        for (const edge of connected(world, session, from, channel, settings)) {
            const next = remaining - edge.cost;
            if (next <= 0 || next <= (best.get(edge.target) || 0)) continue;
            best.set(edge.target, next);
            pending.push([edge.target, next, hops + 1]);
        }
    }
    return best;
}
function matchingRule(world, event) {
    return (world.perceptionRules || []).find(rule => rule?.on
        && Object.entries(rule.on).every(([key, value]) => event[key] === value));
}
function perceiveConfirmedEvent(world, session, event, options = {}) {
    if (event?.status !== 'completed' || !event.id) return [];
    const rule = matchingRule(world, event);
    if (!rule || !Array.isArray(rule.stimuli)) return [];
    const origin = eventLocation(event, session);
    if (!(world.locations || []).some(item => item.id === origin)) return [];
    const turn = Math.max(0, Number(session.turnCount) || 0);
    const absoluteMinute = Math.max(0, Number(session.worldClock?.absoluteMinutes) || 0);
    const settings = world.perception || {};
    const saved = [];
    for (const [index, stimulus] of rule.stimuli.slice(0, 8).entries()) {
        const channel = String(stimulus?.channel || '');
        const config = settings.channels?.[channel];
        if (!channels.has(channel) && !config || !stimulus?.text || !config?.enabled) continue;
        const strength = Math.max(0, Math.min(32, finite(stimulus.strength, 0)));
        if (!strength) continue;
        const reached = reach(world, session, origin, channel, strength, config);
        for (const npc of (world.entities || []).filter(item => item.type === 'npc')) {
            const state = session.entityStates?.[npc.id];
            const place = state?.location;
            if (!place || !reached.has(place) || state.status === 'dead' || state.status === 'gone') continue;
            if (state.senses?.[channel] === false || npc.senses?.[channel] === false) continue;
            const threshold = Math.max(0, finite(state.senses?.[channel]?.threshold
                ?? npc.senses?.[channel]?.threshold, finite(config.threshold, 0)));
            if (reached.get(place) < threshold) continue;
            if (channel === 'sight' && (state.visible === false || npc.visible === false)) continue;
            // Remote observers never inherit the local description implicitly.
            // An author must supply what that channel reveals at a distance.
            const actorHidden = stimulus.identifiesActor === true
                && (session.entityStates?.[event.actor_id]?.visible === false
                    || (world.entities || []).find(item => item.id === event.actor_id)?.visible === false);
            const text = String(actorHidden ? stimulus.hiddenText || ''
                : place === origin ? stimulus.text : stimulus.remoteText || '').trim().slice(0, 500);
            if (!text) continue;
            const id = `obs_${event.id}_${npc.id}_${index}`.slice(0, 100);
            state.observations ||= [];
            if (state.observations.some(item => item.id === id)) continue;
            const entry = { id, eventId: event.id, text, channel, sourceType: 'witnessed',
                source: 'witnessed', evidenceMode: 'direct', confidence: 1,
                visibility: 'private', allowedToShare: stimulus.allowedToShare !== false,
                turn, learnedAt: { turn, absoluteMinute }, sourceLocationId: origin,
                kind: String(stimulus.kind || '').slice(0, 80),
                tags: (Array.isArray(stimulus.tags) ? stimulus.tags : [])
                    .filter(tag => typeof tag === 'string').slice(0, 8)
                    .map(tag => tag.slice(0, 80)) };
            state.observations.push(entry);
            saved.push({ npcId: npc.id, observation: entry });
        }
    }
    return saved;
}
const api = { perceiveConfirmedEvent, matchingRule, reach };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.HordeWorldPerception = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
