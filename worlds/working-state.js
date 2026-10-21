/* Isolated World receipt workspace. A reducer can only mutate copies obtained
 * through write methods; read methods never expose canonical references. */
(function (root) {
'use strict';
const clone = value => {
    if (value === undefined) return undefined;
    try { return structuredClone(value); }
    catch (error) {
        // Test instrumentation wraps canonical objects in recursive Proxies,
        // which structuredClone cannot clone. World data is JSON-persistent.
        if (error?.name !== 'DataCloneError') throw error;
        return JSON.parse(JSON.stringify(value));
    }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const unsafeId = value => typeof value !== 'string' || !value || value.length > 160
    || ['__proto__', 'prototype', 'constructor'].includes(value);
const dirtyPattern = /^(?:entity:[^:]+|location:[^:]+|session:[^:]+|time|event|relation|history)$/;
const MAX_FOLLOW_UP_EFFECTS = 16;
function frozenCopy(value) {
    const result = clone(value);
    const freeze = node => {
        if (!node || typeof node !== 'object' || Object.isFrozen(node)) return node;
        Object.values(node).forEach(freeze);
        return Object.freeze(node);
    };
    return freeze(result);
}
function createWorkingState(world, session) {
    if (!world || !session) throw new TypeError('World and session are required');
    const worldFields = new Map();
    const sessionFields = new Map();
    const entityDefs = new Map();
    const entityStates = new Map();
    const locationDefs = new Map();
    const locationStates = new Map();
    const dynamicExits = new Map();
    const dirtySet = new Set();
    let closed = false;
    const open = () => { if (closed) throw new Error('working_state_closed'); };
    const id = value => { if (unsafeId(value)) throw new TypeError('invalid_world_id'); return value; };
    const currentSession = field => sessionFields.has(field) ? sessionFields.get(field) : session[field];
    const currentWorld = field => worldFields.has(field) ? worldFields.get(field) : world[field];
    const entityDefinition = key => entityDefs.has(key) ? entityDefs.get(key)
        : (currentWorld('entities') || []).find(entry => entry?.id === key);
    const entityState = key => entityStates.has(key) ? entityStates.get(key)
        : (currentSession('entityStates') || {})[key];
    const locationDefinition = key => locationDefs.has(key) ? locationDefs.get(key)
        : (currentWorld('locations') || []).find(entry => entry?.id === key);
    const locationState = key => locationStates.has(key) ? locationStates.get(key)
        : (currentSession('locationStates') || {})[key];
    const getEntity = key => { open(); id(key); return frozenCopy({
        definition: entityDefinition(key), state: entityState(key) }); };
    const getLocation = key => { open(); id(key); return frozenCopy({
        definition: locationDefinition(key), state: locationState(key),
        dynamicExits: dynamicExits.has(key) ? dynamicExits.get(key)
            : (currentSession('dynamicExits') || {})[key] }); };
    const writeEntity = (key, mutate) => {
        open(); id(key);
        const value = clone({ definition: entityDefinition(key), state: entityState(key) });
        mutate(value);
        if (value.definition !== undefined && value.definition?.id !== key)
            throw new Error('entity_identity_changed');
        entityDefs.set(key, value.definition);
        entityStates.set(key, value.state);
        dirtySet.add(`entity:${key}`);
        return getEntity(key);
    };
    const writeLocation = (key, mutate) => {
        open(); id(key);
        const value = clone({ definition: locationDefinition(key), state: locationState(key),
            dynamicExits: dynamicExits.has(key) ? dynamicExits.get(key)
                : (currentSession('dynamicExits') || {})[key] });
        mutate(value);
        if (value.definition !== undefined && value.definition?.id !== key)
            throw new Error('location_identity_changed');
        locationDefs.set(key, value.definition);
        locationStates.set(key, value.state);
        dynamicExits.set(key, value.dynamicExits);
        dirtySet.add(`location:${key}`);
        return getLocation(key);
    };
    const writeSession = (field, mutate, dirtyKey = `session:${field}`) => {
        open(); id(field);
        if (!dirtyPattern.test(dirtyKey)) throw new TypeError('invalid_dirty_key');
        if (['entityStates', 'locationStates', 'dynamicExits'].includes(field))
            throw new Error('use_entity_or_location_writer');
        const holder = { value: clone(currentSession(field)) };
        mutate(holder);
        sessionFields.set(field, holder.value);
        dirtySet.add(dirtyKey);
        return frozenCopy(holder.value);
    };
    const prepare = () => {
        open();
        const nextWorld = { ...world, ...Object.fromEntries(worldFields) };
        const nextSession = { ...session, ...Object.fromEntries(sessionFields) };
        if (entityDefs.size) {
            const items = [...(nextWorld.entities || [])];
            for (const [key, value] of entityDefs) {
                const index = items.findIndex(entry => entry?.id === key);
                if (index < 0 && value !== undefined) items.push(value);
                else if (index >= 0 && value === undefined) items.splice(index, 1);
                else if (index >= 0) items[index] = value;
            }
            nextWorld.entities = items;
        }
        if (entityStates.size) {
            nextSession.entityStates = { ...(nextSession.entityStates || {}) };
            for (const [key, value] of entityStates) {
                if (value === undefined) delete nextSession.entityStates[key];
                else nextSession.entityStates[key] = value;
            }
        }
        if (locationDefs.size) {
            const items = [...(nextWorld.locations || [])];
            for (const [key, value] of locationDefs) {
                const index = items.findIndex(entry => entry?.id === key);
                if (index < 0 && value !== undefined) items.push(value);
                else if (index >= 0 && value === undefined) items.splice(index, 1);
                else if (index >= 0) items[index] = value;
            }
            nextWorld.locations = items;
        }
        for (const [name, source] of [['locationStates', locationStates], ['dynamicExits', dynamicExits]]) {
            if (!source.size) continue;
            nextSession[name] = { ...(nextSession[name] || {}) };
            for (const [key, value] of source) {
                if (value === undefined) delete nextSession[name][key];
                else nextSession[name][key] = value;
            }
        }
        // Serialization makes the prepared candidate stable while IndexedDB
        // commits. It also proves that no mutable live reference escaped.
        const candidate = { world: clone(nextWorld), session: clone(nextSession),
            dirtySet: new Set(dirtySet) };
        assertDirtyCoverage(world, session, candidate);
        return candidate;
    };
    const savepoint = () => {
        open();
        return { worldFields: clone([...worldFields]), sessionFields: clone([...sessionFields]),
            entityDefs: clone([...entityDefs]), entityStates: clone([...entityStates]),
            locationDefs: clone([...locationDefs]), locationStates: clone([...locationStates]),
            dynamicExits: clone([...dynamicExits]), dirty: [...dirtySet] };
    };
    const applyDetached = mutate => {
        open();
        const candidate = prepare();
        const result = mutate(candidate.world, candidate.session);
        const byId = items => new Map((items || []).map(item => [item.id, item]));
        for (const field of new Set([...Object.keys(world), ...Object.keys(candidate.world)])) {
            if (['entities', 'locations'].includes(field)) continue;
            if (!same(currentWorld(field), candidate.world[field]))
                throw new Error(`unsupported_detached_world_field:${field}`);
        }
        for (const [field, getter, writer] of [
            ['entities', entityDefinition, writeEntity],
            ['locations', locationDefinition, writeLocation]
        ]) {
            const existing = byId(currentWorld(field));
            const changed = byId(candidate.world[field]);
            for (const key of new Set([...existing.keys(), ...changed.keys()]))
                if (!same(getter(key), changed.get(key))) writer(key, value => {
                    value.definition = clone(changed.get(key));
                });
        }
        for (const [field, getter, writer, property] of [
            ['entityStates', entityState, writeEntity, 'state'],
            ['locationStates', locationState, writeLocation, 'state'],
            ['dynamicExits', key => dynamicExits.has(key) ? dynamicExits.get(key)
                : (currentSession('dynamicExits') || {})[key], writeLocation, 'dynamicExits']
        ]) {
            const existing = currentSession(field) || {};
            const changed = candidate.session[field] || {};
            for (const key of new Set([...Object.keys(existing), ...Object.keys(changed)]))
                if (!same(getter(key), changed[key])) writer(key, value => {
                    value[property] = clone(changed[key]);
                });
        }
        for (const field of new Set([...Object.keys(session), ...Object.keys(candidate.session)])) {
            if (['entityStates', 'locationStates', 'dynamicExits'].includes(field)
                || same(currentSession(field), candidate.session[field])) continue;
            const dirtyKey = field === 'history' ? 'history'
                : ['turnCount', 'worldTime', 'bonusTimeMinutes', 'lastLivingWorldMinute'].includes(field) ? 'time'
                    : ['engineEvents', 'scheduledEvents', 'worldEvents', 'turnEvents'].includes(field) ? 'event'
                        : ['npcRelationships', 'factionRelations'].includes(field) ? 'relation'
                            : `session:${field}`;
            writeSession(field, holder => { holder.value = clone(candidate.session[field]); }, dirtyKey);
        }
        return result;
    };
    const restore = point => {
        open();
        for (const [target, source] of [
            [worldFields, point.worldFields], [sessionFields, point.sessionFields],
            [entityDefs, point.entityDefs], [entityStates, point.entityStates],
            [locationDefs, point.locationDefs], [locationStates, point.locationStates],
            [dynamicExits, point.dynamicExits]
        ]) { target.clear(); for (const [key, value] of source) target.set(key, value); }
        dirtySet.clear(); point.dirty.forEach(key => dirtySet.add(key));
    };
    const commit = async (persist, expectedVersion = Number(session.worldStateVersion) || 0) => {
        const candidate = prepare();
        if ((Number(session.worldStateVersion) || 0) !== expectedVersion)
            throw new Error('stale_working_state');
        await persist(candidate);
        // The caller holds the World mutation lock through persistence. Once
        // the durable transaction succeeds, publish that exact candidate;
        // raising a second conflict here would strand disk and memory apart.
        Object.keys(candidate.world).forEach(field => {
            if (!same(world[field], candidate.world[field])) world[field] = candidate.world[field];
        });
        Object.keys(candidate.session).forEach(field => {
            if (!same(session[field], candidate.session[field])) session[field] = candidate.session[field];
        });
        closed = true;
        return candidate;
    };
    return { getEntity, getLocation, entityIds: () => [...new Set([
            ...(currentWorld('entities') || []).map(item => item.id), ...entityDefs.keys(),
            ...Object.keys(currentSession('entityStates') || {}), ...entityStates.keys()
        ])],
        locationIds: () => [...new Set([
            ...(currentWorld('locations') || []).map(item => item.id), ...locationDefs.keys()
        ])],
        getEntitiesByFilter: fn => frozenCopy([...new Set([
            ...(currentWorld('entities') || []).map(item => item.id), ...entityDefs.keys()
        ])].map(getEntity).filter(fn)),
        getSession: field => { open(); return frozenCopy(currentSession(field)); },
        getWorld: field => { open(); return frozenCopy(currentWorld(field)); },
        writeEntity, writeLocation, writeSession,
        writeTime: (field, mutate) => writeSession(field, mutate, 'time'),
        writeEvent: (field, mutate) => writeSession(field, mutate, 'event'),
        writeRelation: (field, mutate) => writeSession(field, mutate, 'relation'),
        writeHistory: mutate => writeSession('history', mutate, 'history'),
        prepare, applyDetached, savepoint, restore, commit,
        rollback: () => { closed = true; }, dirtySet };
}
function assertDirtyCoverage(world, session, candidate) {
    const dirty = candidate.dirtySet;
    for (const key of dirty) if (!dirtyPattern.test(key)) throw new Error(`invalid_dirty_key:${key}`);
    const beforeEntities = new Map((world.entities || []).map(item => [item.id, item]));
    const afterEntities = new Map((candidate.world.entities || []).map(item => [item.id, item]));
    for (const key of new Set([...beforeEntities.keys(), ...afterEntities.keys()]))
        if (!same(beforeEntities.get(key), afterEntities.get(key)) && !dirty.has(`entity:${key}`))
            throw new Error(`untracked_world_diff:entity:${key}`);
    const beforeLocations = new Map((world.locations || []).map(item => [item.id, item]));
    const afterLocations = new Map((candidate.world.locations || []).map(item => [item.id, item]));
    for (const key of new Set([...beforeLocations.keys(), ...afterLocations.keys()]))
        if (!same(beforeLocations.get(key), afterLocations.get(key)) && !dirty.has(`location:${key}`))
            throw new Error(`untracked_world_diff:location:${key}`);
    for (const field of new Set([...Object.keys(world), ...Object.keys(candidate.world)]))
        if (!['entities', 'locations'].includes(field) && !same(world[field], candidate.world[field]))
            throw new Error(`untracked_world_diff:${field}`);
    for (const field of new Set([...Object.keys(session), ...Object.keys(candidate.session)])) {
        if (same(session[field], candidate.session[field])) continue;
        if (['entityStates', 'locationStates', 'dynamicExits'].includes(field)) {
            const prefix = field === 'entityStates' ? 'entity:' : 'location:';
            const before = session[field] || {}, after = candidate.session[field] || {};
            for (const key of new Set([...Object.keys(before), ...Object.keys(after)]))
                if (!same(before[key], after[key]) && !dirty.has(`${prefix}${key}`))
                    throw new Error(`untracked_session_diff:${field}.${key}`);
        } else if (!dirty.has(`session:${field}`)
            && !(field === 'history' && dirty.has('history'))
            && !(['worldTime', 'turnCount', 'time', 'bonusTimeMinutes', 'lastLivingWorldMinute'].includes(field)
                && dirty.has('time'))
            && !(['scheduledEvents', 'worldEvents', 'eventLog', 'engineEvents', 'turnEvents'].includes(field)
                && dirty.has('event'))
            && !(['relationships', 'factionRelations', 'npcRelationships', 'factions'].includes(field)
                && dirty.has('relation')))
            throw new Error(`untracked_session_diff:${field}`);
    }
    return true;
}
function assertWorldModelInvariants(world, session, candidate) {
    const dirty = candidate.dirtySet;
    const locations = new Map((candidate.world.locations || []).map(item => [item.id, item]));
    const entities = new Map((candidate.world.entities || []).map(item => [item.id, item]));
    const reject = detail => { throw new Error(`world_invariant_violation:${detail}`); };
    const validInventory = (inventory, owner) => {
        if (!Array.isArray(inventory)) return reject(`invalid_inventory:${owner}`);
        for (const item of inventory) {
            if (typeof item === 'string') {
                if (!item.trim()) reject(`unnamed_inventory_item:${owner}`);
            } else if (!item || typeof item !== 'object'
                || !String(item.id || item.name || '').trim()
                || !Number.isInteger(Number(item.quantity ?? 1))
                || Number(item.quantity ?? 1) < 1)
                reject(`invalid_inventory_item:${owner}`);
        }
    };
    if (dirty.has('session:playerLocation') || dirty.has('entity:player')) {
        if (!locations.has(candidate.session.playerLocation)) reject('unknown_player_location');
        const playerState = candidate.session.entityStates?.player;
        if (playerState?.location && playerState.location !== candidate.session.playerLocation)
            reject('player_location_mismatch');
    }
    if (dirty.has('session:inventory')) validInventory(candidate.session.inventory || [], 'player');
    const validConditions = (conditions, owner) => {
        if (!Array.isArray(conditions) || conditions.some(item =>
            !String(typeof item === 'string' ? item : item?.label || item?.name || '').trim()))
            reject(`invalid_conditions:${owner}`);
    };
    if (dirty.has('session:playerSceneConditions'))
        validConditions(candidate.session.playerSceneConditions || [], 'player');
    for (const key of dirty) {
        if (key.startsWith('entity:')) {
            const id = key.slice(7);
            const entity = entities.get(id);
            const state = candidate.session.entityStates?.[id];
            if (id !== 'player' && !entity) reject(`unknown_entity:${id}`);
            if (state?.location && !locations.has(state.location)) reject(`unknown_entity_location:${id}`);
            if (state?.inventory !== undefined) validInventory(state.inventory, id);
            if (state?.conditions !== undefined
                && !same(state.conditions, session.entityStates?.[id]?.conditions))
                validConditions(state.conditions, id);
            if (state?.interactableState && entity?.interactable) {
                const states = new Set([entity.interactable.initialState]);
                for (const transition of entity.interactable.transitions || []) {
                    states.add(transition.from); states.add(transition.to);
                }
                if (!states.has(state.interactableState)) reject(`invalid_interactable_state:${id}`);
            }
        } else if (key.startsWith('location:')) {
            const id = key.slice(9);
            const location = locations.get(id);
            if (!location) reject(`unknown_location:${id}`);
            const original = (world.locations || []).find(item => item.id === id);
            const prior = new Set((original?.exits || []).map(exit => JSON.stringify(exit)));
            for (const exit of location.exits || []) {
                if (prior.has(JSON.stringify(exit))) continue;
                const target = typeof exit === 'object' && (exit.targetLocationId || exit.to);
                if (target && !locations.has(target)) reject(`unknown_route_target:${id}:${target}`);
            }
        }
    }
    if (dirty.has('session:unlockedExits')) {
        const doorIds = new Set([...locations.values()].flatMap(location =>
            (location.exits || []).map(exit => exit?.doorId).filter(Boolean)));
        for (const [doorId, opened] of Object.entries(candidate.session.unlockedExits || {}))
            if (opened !== (session.unlockedExits || {})[doorId]
                && (opened !== true || !doorIds.has(doorId)))
                reject(`invalid_door_state:${doorId}`);
    }
    if (dirty.has('relation')) {
        for (const [key, relation] of Object.entries(candidate.session.npcRelationships || {}))
            if (!same(relation, session.npcRelationships?.[key])
                && relation?.score !== undefined && (!Number.isFinite(relation.score)
                || relation.score < -100 || relation.score > 100))
                reject('invalid_relation_score');
        const factions = candidate.session.factions || candidate.world.factions || [];
        const previous = new Map((session.factions || world.factions || []).map(item => [item.id, item]));
        const byId = new Map(factions.map(item => [item.id, item]));
        for (const faction of factions) for (const relation of faction.relations || []) {
            if (same(relation, previous.get(faction.id)?.relations?.find(item =>
                item.factionId === relation.factionId))) continue;
            const reverse = byId.get(relation.factionId)?.relations?.find(item =>
                item.factionId === faction.id);
            if (!byId.has(relation.factionId) || !Number.isFinite(relation.score)
                || relation.score < -100 || relation.score > 100
                || reverse?.score !== relation.score)
                reject(`invalid_faction_relation:${faction.id}:${relation.factionId}`);
        }
    }
    return true;
}
function assertReceiptMatchesCandidate(receipt, candidate) {
    if (receipt.clock && (!Number.isFinite(receipt.clock.absolute_minutes)
        || receipt.clock.absolute_minutes !== candidate.session.worldClock?.absoluteMinutes))
        throw new Error('receipt_state_mismatch:clock');
    if (receipt?.scene?.player_location_id !== candidate.session.playerLocation)
        throw new Error('receipt_state_mismatch:player_location');
    const entities = new Set((candidate.world.entities || []).map(item => item.id));
    const lastMove = new Map();
    for (const event of receipt.events || []) {
        if (event.actor_id && event.actor_id !== 'player' && !entities.has(event.actor_id))
            throw new Error('receipt_state_mismatch:event_actor');
        if (event.status === 'completed' && event.type === 'movement'
            && event.actor_id) lastMove.set(event.actor_id, event.to_location_id);
    }
    for (const [actorId, destination] of lastMove)
        if ((actorId === 'player' ? candidate.session.playerLocation
            : candidate.session.entityStates?.[actorId]?.location) !== destination)
            throw new Error('receipt_state_mismatch:movement');
    return true;
}
function guardCanonicalWrites(value, path = 'canonical', memo = new WeakMap()) {
    if (!value || typeof value !== 'object') return value;
    if (memo.has(value)) return memo.get(value);
    const reject = operation => { throw new Error(`direct_canonical_write:${path}:${operation}\n${new Error().stack}`); };
    const proxy = new Proxy(value, {
        get(target, property, receiver) {
            const result = Reflect.get(target, property, receiver);
            if (typeof result === 'function' && (target instanceof Map || target instanceof Set)) {
                if (['set', 'add', 'delete', 'clear'].includes(property)) return () => reject(String(property));
                if (property === 'get' && target instanceof Map) return key =>
                    guardCanonicalWrites(target.get(key), `${path}.get(${String(key)})`, memo);
                if (property === 'forEach') return callback => target.forEach((entry, key) => {
                    if (target instanceof Map) callback(
                        guardCanonicalWrites(entry, `${path}.get(${String(key)})`, memo), key, proxy);
                    else callback(guardCanonicalWrites(entry, `${path}.value`, memo),
                        guardCanonicalWrites(entry, `${path}.value`, memo), proxy);
                });
                if (['values', 'keys', 'entries', Symbol.iterator].includes(property)) return function* () {
                    for (const entry of result.call(target)) {
                        if (Array.isArray(entry)) yield entry.map((item, index) =>
                            guardCanonicalWrites(item, `${path}.entry.${index}`, memo));
                        else yield guardCanonicalWrites(entry, `${path}.value`, memo);
                    }
                };
                return result.bind(target);
            }
            return guardCanonicalWrites(result, `${path}.${String(property)}`, memo);
        },
        set: () => reject('set'), deleteProperty: () => reject('delete'),
        defineProperty: () => reject('defineProperty'), setPrototypeOf: () => reject('setPrototypeOf')
    });
    memo.set(value, proxy);
    return proxy;
}
const api = { createWorkingState, assertDirtyCoverage, assertWorldModelInvariants,
    assertReceiptMatchesCandidate, guardCanonicalWrites,
    MAX_FOLLOW_UP_EFFECTS };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.HordeWorkingState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
