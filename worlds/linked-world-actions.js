/* Sequential World action execution. Language interpretation belongs to the
 * model's Scene Draft; this module accepts only exact IDs and typed effects. */
(function (root) {
'use strict';
const workingApi = typeof module !== 'undefined' && module.exports
    ? require('./working-state') : root.HordeWorkingState;
const registryApi = typeof module !== 'undefined' && module.exports
    ? require('./effect-registry') : root.HordeEffectRegistry;
const copy = value => value === undefined ? undefined : structuredClone(value);
const safeId = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,119}$/.test(value);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const itemName = item => typeof item === 'string' ? item : String(item?.name || item?.id || '');
const itemKey = item => itemName(item).normalize('NFKC').toLocaleLowerCase();
const itemMatches = (entry, reference) => itemKey(entry) === itemKey(reference)
    || (typeof entry === 'object' && itemKey(entry.id) === itemKey(reference));
const inventoryHas = (inventory, item) => Array.isArray(inventory)
    && inventory.some(entry => itemMatches(entry, item)
        && (typeof entry !== 'object' || Number(entry.quantity ?? 1) > 0));
const inventoryUnits = (inventory, item) => Array.isArray(inventory)
    ? inventory.reduce((total, entry) => total + (itemMatches(entry, item)
        ? Math.max(0, Number(typeof entry === 'object' ? entry.quantity ?? 1 : 1) || 0) : 0), 0) : 0;
const removeInventoryUnits = (inventory, item, quantity) => {
    let remaining = quantity;
    for (let index = 0; index < inventory.length && remaining > 0;) {
        const entry = inventory[index];
        if (!itemMatches(entry, item)) { index++; continue; }
        const units = typeof entry === 'object' ? Number(entry.quantity ?? 1) : 1;
        const consumed = Math.min(remaining, units);
        remaining -= consumed;
        if (consumed === units) inventory.splice(index, 1);
        else { entry.quantity = units - consumed; index++; }
    }
};
const pairKey = (a, b) => [a, b].sort().join('|');
class BlockedAction extends Error {
    constructor(reason) { super(reason); this.name = 'BlockedAction'; this.reason = reason; }
}
function createFactRegistry() {
    const facts = new Map();
    const register = (name, read) => {
        if (facts.has(name) || typeof read !== 'function') throw new TypeError('invalid_fact_registration');
        facts.set(name, read);
    };
    register('actor_at', (working, subject) => subject === 'player'
        ? working.getSession('playerLocation') : working.getEntity(subject).state?.location);
    register('has_item', (working, subject, expected) => {
        const inventory = subject === 'player' ? working.getSession('inventory')
            : working.getEntity(subject).state?.inventory;
        return inventoryHas(inventory, expected);
    });
    register('interactable_state', (working, subject) => working.getEntity(subject).state?.interactableState
        || (working.getSession('unlockedExits')?.[subject] ? 'open' : 'locked'));
    register('condition', (working, subject, expected) => {
        const conditions = subject === 'player' ? working.getSession('playerSceneConditions')
            : working.getEntity(subject).state?.conditions;
        return Array.isArray(conditions) && conditions.some(item =>
            String(typeof item === 'string' ? item : item?.label || item?.name || '') === expected);
    });
    register('relation', (working, subject, expected, condition) => {
        const target = condition.target_id;
        const factions = working.getSession('factions') || working.getWorld('factions') || [];
        const faction = factions.find(item => item.id === subject);
        if (faction && factions.some(item => item.id === target))
            return faction.relations?.find(item => item.factionId === target)?.score;
        return working.getSession('npcRelationships')?.[pairKey(subject, target)]?.score;
    });
    const test = (condition, working) => {
        const read = facts.get(condition?.fact);
        if (!read) throw new Error(`unknown_state_fact:${String(condition?.fact || '')}`);
        const actual = read(working, condition.subject_id, condition.value, condition);
        if (condition.operator === 'exists') return actual !== undefined && actual !== null && actual !== false;
        if (condition.operator === 'equals') return String(actual) === condition.value;
        if (condition.operator === 'not_equals') return String(actual) !== condition.value;
        throw new Error('invalid_fact_operator');
    };
    return { register, test, names: () => [...facts.keys()] };
}
function createWorldEffectRegistry(legacyEffectKeys = [], capability = null) {
    const registry = registryApi.createEffectRegistry();
    const registerNative = (name, validate, reduce) => {
        if (!registryApi.technicalEffects.has(name)) return;
        registryApi.bindTechnicalOperation(name, validate, reduce);
        registry.register(name, validate, reduce);
    };
    const ids = (...values) => values.every(safeId);
    const actorLocation = (working, actor) => actor === 'player'
        ? working.getSession('playerLocation') : working.getEntity(actor).state?.location;
    const moveActor = (working, actor, to) => {
        working.writeEntity(actor, entity => {
            entity.state ||= {};
            entity.state.location = to;
        });
        if (actor === 'player') working.writeSession('playerLocation', field => { field.value = to; });
    };
    registerNative('actor_move', value => ids(value?.actor_id, value?.to_location_id)
        && (value.companion_ids === undefined || Array.isArray(value.companion_ids)
            && value.companion_ids.every(safeId)), (value, working, context) => {
        const from = actorLocation(working, value.actor_id);
        const target = working.getLocation(value.to_location_id).definition;
        if (!from || !target) throw new BlockedAction('unknown_or_unreachable_destination');
        const scene = working.prepare();
        const verdict = context.canMove
            ? context.canMove(scene.world, scene.session, value.actor_id, from, value.to_location_id)
            : (() => {
                const source = working.getLocation(from).definition;
                const connected = (source?.exits || []).some(exit => {
                    const name = typeof exit === 'string' ? exit.replace(/^to\s+/i, '')
                        : exit?.targetLocationId || exit?.to || exit?.name;
                    return name === target.id || name === target.name;
                });
                return { ok: connected, reason: connected ? '' : 'unreachable' };
            })();
        if (!verdict?.ok) throw new BlockedAction(verdict?.reason || 'unreachable');
        const companions = new Set(value.companion_ids || []);
        if (value.actor_id === 'player') for (const actor of working.getEntitiesByFilter(entity =>
            entity.state?.followingPlayer === true && entity.state.location === from))
            companions.add(actor.definition.id);
        for (const companion of companions) {
            if (companion === value.actor_id || actorLocation(working, companion) !== from)
                throw new BlockedAction('companion_unavailable');
            if (context.canMove) {
                const allowed = context.canMove(scene.world, scene.session,
                    companion, from, value.to_location_id, { accompanyingPlayer: true });
                if (!allowed?.ok) throw new BlockedAction(allowed?.reason || 'companion_access_denied');
            }
        }
        moveActor(working, value.actor_id, target.id);
        for (const companion of companions) moveActor(working, companion, target.id);
        const turn = Number(working.getSession('turnCount')) || 1;
        working.writeLocation(from, location => {
            location.state ||= {}; location.state.lastExitedTurn = turn;
        });
        working.writeLocation(target.id, location => {
            location.state ||= {}; location.state.lastEnteredTurn = turn;
        });
    });
    registerNative('interactable_transition', value => ids(value?.target_id)
        && typeof value?.to_state === 'string' && !!value.to_state, (value, working, context) => {
        const entity = working.getEntity(value.target_id);
        if (entity.definition?.interactable) {
            const current = entity.state?.interactableState
                || entity.definition.interactable.initialState;
            const transition = (entity.definition.interactable.transitions || []).find(item =>
                item.from === current && item.to === value.to_state);
            if (!transition) throw new BlockedAction('unavailable_object_transition');
            if (transition.requiredItem && !inventoryHas(working.getSession('inventory'), transition.requiredItem))
                throw new BlockedAction('required_item');
            if (context.canTransition) {
                const scene = working.prepare();
                const verdict = context.canTransition(scene.world, scene.session, value, transition);
                if (!verdict?.ok) throw new BlockedAction(verdict?.reason || 'transition_blocked');
            }
            working.writeEntity(value.target_id, mutable => {
                mutable.state ||= {}; mutable.state.interactableState = value.to_state;
            });
            return;
        }
        const exits = working.locationIds().flatMap(locationId =>
            (working.getLocation(locationId).definition?.exits || [])
                .filter(exit => typeof exit === 'object' && exit.doorId === value.target_id)
                .map(exit => ({ locationId, exit })));
        if (!exits.length || !['open', 'locked'].includes(value.to_state))
            throw new Error('unknown_interactable_transition');
        const requiredItem = exits.map(entry => entry.exit.requiredItem || entry.exit.lockKeyItem).find(Boolean);
        if (requiredItem && !inventoryHas(working.getSession('inventory'), requiredItem))
            throw new BlockedAction('required_item');
        if (context.canTransition) {
            const scene = working.prepare();
            const verdict = context.canTransition(scene.world, scene.session, value, exits);
            if (!verdict?.ok) throw new BlockedAction(verdict?.reason || 'transition_blocked');
        }
        working.writeSession('unlockedExits', field => {
            field.value ||= {};
            if (value.to_state === 'open') field.value[value.target_id] = true;
            else delete field.value[value.target_id];
        });
    });
    registerNative('item_transfer', value => typeof value?.item_id === 'string'
        && !!value.item_id.trim() && value.item_id.length <= 120
        && ids(value?.from_id, value?.to_id)
        && (value.quantity === undefined || Number.isInteger(value.quantity)
            && value.quantity > 0 && value.quantity <= 100), (value, working) => {
        const quantity = value.quantity || 1;
        if (value.from_id === value.to_id) throw new BlockedAction('same_transfer_endpoint');
        const sourceInventory = value.from_id === 'player' ? working.getSession('inventory')
            : working.getEntity(value.from_id).state?.inventory;
        const itemEntity = working.getEntity(value.item_id);
        const sourceItem = Array.isArray(sourceInventory)
            ? sourceInventory.find(item => itemMatches(item, value.item_id)) : null;
        const transferName = itemEntity.definition?.name || itemName(sourceItem) || value.item_id;
        const looseItem = itemEntity.definition?.type === 'item'
            && itemEntity.state?.location === value.from_id;
        const destinationIsLocation = !!working.getLocation(value.to_id).definition;
        if (destinationIsLocation && (quantity !== 1 || itemEntity.definition?.type !== 'item'))
            throw new BlockedAction('unrepresentable_loose_item_transfer');
        if (!looseItem && itemEntity.definition?.type === 'item'
            && itemEntity.state?.location) throw new BlockedAction('item_already_placed');
        const sourceBefore = looseItem ? 1 : inventoryUnits(sourceInventory, value.item_id);
        const destinationInventory = destinationIsLocation ? null : value.to_id === 'player'
            ? working.getSession('inventory') : working.getEntity(value.to_id).state?.inventory;
        const destinationBefore = destinationIsLocation ? 0
            : inventoryUnits(destinationInventory, transferName);
        if (looseItem && quantity !== 1) throw new BlockedAction('loose_item_quantity');
        if (!looseItem && inventoryUnits(sourceInventory, value.item_id) < quantity)
            throw new BlockedAction('item_not_held_or_present');
        if (value.from_id === 'player') working.writeSession('inventory', field => {
            const inventory = field.value || [];
            removeInventoryUnits(inventory, value.item_id, quantity);
            field.value = inventory;
        });
        else if (!looseItem) working.writeEntity(value.from_id, entity => {
            removeInventoryUnits(entity.state.inventory, value.item_id, quantity);
        });
        if (destinationIsLocation) {
            if (itemEntity.definition) working.writeEntity(value.item_id, entity => {
                entity.state ||= {}; entity.state.location = value.to_id;
            });
            else throw new Error('unregistered_loose_item');
        } else if (value.to_id === 'player') working.writeSession('inventory', field => {
            field.value ||= [];
            for (let count = 0; count < quantity; count++)
                field.value.push(transferName);
        });
        else if (working.getEntity(value.to_id).definition) working.writeEntity(value.to_id, entity => {
            entity.state ||= {}; entity.state.inventory ||= [];
            for (let count = 0; count < quantity; count++)
                entity.state.inventory.push(transferName);
        });
        else throw new Error('unknown_transfer_destination');
        if (looseItem && value.to_id !== value.from_id) working.writeEntity(value.item_id, entity => {
            entity.state.location = destinationIsLocation ? value.to_id : '';
        });
        const sourceAfter = looseItem ? (working.getEntity(value.item_id).state?.location === value.from_id ? 1 : 0)
            : inventoryUnits(value.from_id === 'player' ? working.getSession('inventory')
                : working.getEntity(value.from_id).state?.inventory, value.item_id);
        const destinationAfter = destinationIsLocation
            ? (working.getEntity(value.item_id).state?.location === value.to_id ? 1 : 0)
            : inventoryUnits(value.to_id === 'player' ? working.getSession('inventory')
                : working.getEntity(value.to_id).state?.inventory, transferName);
        if (sourceAfter !== sourceBefore - quantity
            || destinationAfter !== destinationBefore + quantity)
            throw new Error('inventory_conservation_violation');
    });
    registerNative('item_introduce', value => ids(value?.id, value?.location_id)
        && typeof value?.name === 'string' && !!value.name, (value, working, context) => {
        if (working.getEntity(value.id).definition || !working.getLocation(value.location_id).definition)
            throw new Error('duplicate_or_unplaced_item');
        working.writeEntity(value.id, entity => {
            entity.definition = { id: value.id, name: value.name, type: 'item',
                description: value.description || '', sessionOrigin: context.sessionId };
            entity.state = { location: value.location_id };
        });
    });
    registerNative('entity_introduce', value => ids(value?.id, value?.location_id)
        && typeof value?.name === 'string' && typeof value?.persona === 'string',
    (value, working, context) => {
        if (working.getEntity(value.id).definition || !working.getLocation(value.location_id).definition)
            throw new Error('duplicate_or_unplaced_entity');
        working.writeEntity(value.id, entity => {
            entity.definition = { id: value.id, name: value.name, type: 'npc',
                persona: value.persona, sessionOrigin: context.sessionId };
            entity.state = { location: value.location_id, observations: [] };
        });
    });
    registerNative('location_introduce', value => ids(value?.id, value?.connects_to)
        && typeof value?.name === 'string' && !!value.name, (value, working, context) => {
        if (working.getLocation(value.id).definition || !working.getLocation(value.connects_to).definition)
            throw new Error('duplicate_or_unconnected_location');
        const anchor = working.getLocation(value.connects_to).definition;
        working.writeLocation(value.id, location => {
            location.definition = { id: value.id, name: value.name,
                description: value.description || '', sessionOrigin: context.sessionId,
                exits: [{ targetLocationId: anchor.id }] };
            location.state = {};
        });
        working.writeLocation(anchor.id, location => {
            location.definition.exits ||= [];
            location.definition.exits.push({ targetLocationId: value.id });
        });
    });
    registerNative('condition_change', value => ids(value?.target_id)
        && typeof value?.condition === 'string' && !!value.condition
        && ['add', 'remove'].includes(value.action), (value, working) => {
        const update = conditions => {
            const result = Array.isArray(conditions) ? conditions : [];
            const index = result.findIndex(item => String(typeof item === 'string'
                ? item : item?.label || item?.name || '') === value.condition);
            if (value.action === 'add' && index < 0) result.push(value.condition);
            if (value.action === 'remove' && index >= 0) result.splice(index, 1);
            return result;
        };
        if (value.target_id === 'player') working.writeSession('playerSceneConditions', field => {
            field.value = update(field.value);
        });
        else if (working.getEntity(value.target_id).definition) working.writeEntity(value.target_id, entity => {
            entity.state ||= {}; entity.state.conditions = update(entity.state.conditions);
        });
        else throw new Error('unknown_condition_target');
    });
    registerNative('relation_set', value => ids(value?.subject_id, value?.target_id)
        && Number.isInteger(value?.value) && value.value >= -100 && value.value <= 100,
    (value, working) => {
        const factions = working.getSession('factions') || working.getWorld('factions') || [];
        if (factions.some(item => item.id === value.subject_id)
            && factions.some(item => item.id === value.target_id)) {
            if (value.subject_id === value.target_id) throw new Error('self_relation');
            working.writeRelation('factions', field => {
                field.value ||= copy(factions);
                for (const [fromId, toId] of [[value.subject_id, value.target_id],
                    [value.target_id, value.subject_id]]) {
                    const faction = field.value.find(item => item.id === fromId);
                    faction.relations ||= [];
                    const existing = faction.relations.find(item => item.factionId === toId);
                    if (existing) existing.score = value.value;
                    else faction.relations.push({ factionId: toId, score: value.value });
                }
            });
            return;
        }
        if ((value.subject_id !== 'player' && !working.getEntity(value.subject_id).definition)
            || (value.target_id !== 'player' && !working.getEntity(value.target_id).definition))
            throw new Error('unknown_relation_target');
        working.writeRelation('npcRelationships', field => {
            field.value ||= {};
            field.value[pairKey(value.subject_id, value.target_id)] = {
                ...(field.value[pairKey(value.subject_id, value.target_id)] || {}),
                score: value.value, lastChangedTurn: Number(working.getSession('turnCount')) || 1
            };
        });
    });
    registerNative('event_emit', value => safeId(value?.id)
        && typeof value?.type === 'string' && typeof value?.description === 'string',
    (value, working, context) => {
        working.writeEvent('engineEvents', field => { field.value ||= []; field.value.push(copy(value)); });
        return typeof context.onEvent === 'function' ? context.onEvent(value, working) : [];
    });
    registerNative('time_advance', value => Number.isInteger(value?.minutes)
        && value.minutes > 0 && value.minutes <= 10080, (value, working, context) => {
        const included = Math.min(value.minutes, context.turnTimeBudget?.remaining || 0);
        if (context.turnTimeBudget) context.turnTimeBudget.remaining -= included;
        working.writeTime('bonusTimeMinutes', field => {
            field.value = (Number(field.value) || 0) + value.minutes - included;
        });
    });
    registerNative('outfit_set', value => safeId(value?.actor_id)
        && typeof value?.outfit === 'string' && !!value.outfit.trim(), (value, working) => {
        if (value.actor_id === 'player') working.writeSession('outfit', field => {
            field.value = value.outfit.trim();
        });
        else if (working.getEntity(value.actor_id).definition)
            working.writeEntity(value.actor_id, entity => {
                entity.state ||= {}; entity.state.outfit = value.outfit.trim();
            });
        else throw new Error('unknown_outfit_actor');
    });
    // Definitions added to the central registry carry their own validating
    // and reducing operation. No companion schema or executor list is edited.
    for (const descriptor of registryApi.technicalEffects.values())
        if (!registry.has(descriptor.name) && typeof descriptor.validate === 'function'
            && typeof descriptor.reduce === 'function')
            registry.register(descriptor.name, descriptor.validate, descriptor.reduce);
    for (const type of legacyEffectKeys) {
        if (registry.has(type) || registryApi.legacyOperation(type) === 'requestPendingCheck') continue;
        registry.register(type, () => true, (payload, working, context) => {
            if (typeof context.applyLegacyEffect !== 'function')
                throw new Error(`missing_legacy_effect_adapter:${type}`);
            if (type === 'time_skip_minutes' && Number.isInteger(payload) && payload > 0) {
                const included = Math.min(payload, context.turnTimeBudget?.remaining || 0);
                if (context.turnTimeBudget) context.turnTimeBudget.remaining -= included;
                context.applyLegacyEffect(type, payload - included, working);
            } else context.applyLegacyEffect(type, payload, working);
        });
    }
    return capability ? { ...registry,
        has: type => capability.names.includes(type) && registry.has(type),
        types: () => registry.types().filter(type => capability.names.includes(type)) }
        : registry;
}
function executeLinkedActions(plan, world, session, context = {}) {
    if (!plan || !Array.isArray(plan.actions)) throw new TypeError('invalid_linked_plan');
    const working = context.workingState || workingApi.createWorkingState(world, session);
    const capability = context.capability || registryApi.capabilities({
        protocol: 'scene_draft_v3', executionMode: 'linked',
        legacySchemas: Object.fromEntries((context.legacyEffectKeys || []).map(key =>
            [key, { type: 'array' }])) });
    const effects = createWorldEffectRegistry(context.legacyEffectKeys || [], capability);
    const facts = createFactRegistry();
    const outcomes = new Map();
    const events = [];
    const errors = [];
    // Only completed, structurally witnessed operations may survive a repair.
    // The reducer succeeding is deliberately insufficient: the action must
    // also have passed its guards, outcome check, event link and invariants.
    const verifiedEffects = [];
    const verifiedEvents = [];
    const eventTypes = { actor_move: ['movement'], interactable_transition: ['environment'],
        item_transfer: ['inventory'], item_introduce: ['inventory'],
        entity_introduce: ['environment'], location_introduce: ['environment'],
        condition_change: ['condition'], relation_set: ['relationship'],
        event_emit: null, time_advance: ['time'], time_skip_minutes: ['time'],
        outfit_set: ['outfit'] };
    const witnessed = (operation, actionEvents, moves = []) => actionEvents.some(event => {
        if (event.status !== 'completed') return false;
        const types = eventTypes[operation.type]
            || registryApi.technicalEffects.get(operation.type)?.eventTypes;
        if (!Object.hasOwn(eventTypes, operation.type) && !types) return false;
        if (types && !types.includes(event.type)) return false;
        if (operation.type === 'event_emit' && event.type !== operation.payload?.type) return false;
        const actor = operation.payload?.actor_id || operation.payload?.subject_id
            || (operation.type === 'condition_change' ? operation.payload?.target_id : '');
        if (actor && event.actor_id !== actor
            && !(operation.payload?.companion_ids || []).includes(event.actor_id)) return false;
        if (['interactable_transition', 'relation_set'].includes(operation.type)
            && event.target_id !== operation.payload?.target_id) return false;
        if (operation.type === 'outfit_set' && event.outfit !== operation.payload?.outfit) return false;
        if (operation.type === 'condition_change'
            && (event.condition !== operation.payload?.condition
                || event.action !== operation.payload?.action)) return false;
        if (operation.type === 'item_transfer' && !String(event.item || '').trim()) return false;
        if (['time_advance', 'time_skip_minutes'].includes(operation.type)
            && event.minutes_elapsed !== undefined
            && event.minutes_elapsed !== (operation.payload?.minutes || operation.payload)) return false;
        if (operation.type === 'actor_move'
            && (event.to_location_id !== operation.payload?.to_location_id
                || !event.from_location_id
                || !moves.some(move => move.actor === event.actor_id
                    && move.from === event.from_location_id
                    && move.to === event.to_location_id))) return false;
        return true;
    });
    const turnTimeBudget = { remaining: Math.max(0, Number(context.includedTurnMinutes) || 0) };
    for (const action of plan.actions) {
        const guards = action.depends_on || [];
        if (guards.some(guard => outcomes.get(guard.action_id) !== guard.outcome)) {
            outcomes.set(action.action_id, 'skipped');
            continue;
        }
        const point = working.savepoint();
        const includedTimeAtStart = turnTimeBudget.remaining;
        let appliedOperations = [];
        let actionMoves = [];
        try {
            if ((action.state_conditions || []).some(condition => !facts.test(condition, working)))
                throw new BlockedAction('state_condition_not_met');
            if (action.status === 'pending_check') {
                const operations = action.action_effects || {};
                if (Object.keys(operations).length !== 1 || !Array.isArray(operations.checks)
                    || operations.checks.length !== 1 || typeof context.requestPendingCheck !== 'function')
                    throw new Error('invalid_pending_check_action');
                registryApi.assertSupported(capability, 'checks', action.action_id,
                    'pending_check_dispatch');
                if (!context.requestPendingCheck(operations.checks[0], working))
                    throw new Error('check_not_pending');
                outcomes.set(action.action_id, 'pending');
                continue;
            }
            if (action.status === 'needs_clarification') {
                if (Object.keys(action.action_effects || {}).length)
                    throw new Error('unresolved_action_has_effects');
                outcomes.set(action.action_id, 'unresolved');
                continue;
            }
            if (action.status === 'attempted') {
                if (Object.keys(action.action_effects || {}).length)
                    throw new Error('failed_action_has_effects');
                outcomes.set(action.action_id, 'failed');
                continue;
            }
            if (action.status === 'blocked' && !Object.keys(action.action_effects || {}).length) {
                throw new Error('unverified_blockage');
            }
            const operations = Object.entries(action.action_effects || {}).flatMap(([type, values]) => {
                if ((context.legacyEffectKeys || []).includes(type)
                    && !registryApi.technicalEffects.has(type))
                    return [{ type, payload: values }];
                if (!Array.isArray(values)) throw new Error(`invalid_effect_list:${type}`);
                return values.map(payload => ({ type, payload }));
            });
            const moveTransitions = [], predictedLocations = new Map();
            for (const operation of operations) if (operation.type === 'actor_move')
                for (const actor of [operation.payload.actor_id,
                    ...(operation.payload.companion_ids || [])]) {
                    const from = predictedLocations.has(actor) ? predictedLocations.get(actor)
                        : actor === 'player' ? working.getSession('playerLocation')
                            : working.getEntity(actor).state?.location;
                    moveTransitions.push({ actor, from, to: operation.payload.to_location_id });
                    predictedLocations.set(actor, operation.payload.to_location_id);
                }
            actionMoves = moveTransitions;
            const applied = effects.run(operations, working, { ...context, capability, turnTimeBudget,
                protocol: capability.protocol, executionMode: capability.executionMode,
                actionId: action.action_id, sessionId: session.id });
            // Follow-up reducer effects are consequences, not model proposals
            // that a later draft must repeat verbatim.
            appliedOperations = operations.filter((_operation, index) => applied.changes[index]);
            if (action.status === 'resolved' || action.status === 'answered') {
                const executed = applied.applied;
                const stateEffect = executed.some(effect => ![
                    'event_emit', 'ledger_update', 'memory_write', 'npc_observations',
                    'world_events'
                ].includes(effect.type));
                const physicalEffect = executed.some(effect => ![
                    'event_emit', 'time_advance', 'time_skip_minutes', 'ledger_update',
                    'memory_write', 'npc_observations', 'world_events'
                ].includes(effect.type));
                const completed = plan.events.filter(event => event.action_id === action.action_id
                    && event.status === 'completed');
                const responseLinked = (!!String(action.request || '').trim()
                    || (context.worldActionIds || []).includes(action.action_id))
                    && plan.narrative.some(passage => passage.id === action.response_id
                        && passage.action_id === action.action_id
                        && !!String(passage.text || '').trim());
                const witnessedInteraction = responseLinked && completed.some(event =>
                    event.type === 'interaction' && event.actor_id === 'player'
                    && event.passage_id === action.response_id);
                const proved = action.kind === 'travel'
                    ? executed.some(effect => effect.type === 'actor_move'
                        && (effect.payload.actor_id === 'player'
                            || (effect.payload.companion_ids || []).includes('player')))
                    : action.kind === 'wait'
                        ? executed.some(effect => ['time_advance', 'time_skip_minutes'].includes(effect.type))
                        : action.kind === 'physical'
                            ? physicalEffect || witnessedInteraction
                            : stateEffect || ['speech', 'question', 'observation', 'other']
                                .includes(action.kind) && responseLinked;
                if (!proved) throw new Error('unverified_action_success');
            }
            outcomes.set(action.action_id, 'succeeded');
            for (const [eventIndex, event] of plan.events.entries()) {
                if (event.action_id !== action.action_id) continue;
                if (event.status === 'completed') {
                    const knownActor = event.actor_id === 'player'
                        || working.getEntity(event.actor_id).definition;
                    if (!knownActor) throw new Error('unknown_event_actor');
                    const requiredEffects = {
                        movement: ['actor_move'],
                        inventory: ['item_transfer', 'inventory_add', 'inventory_remove'],
                        outfit: ['outfit_set'],
                        condition: ['condition_change', 'player_condition_updates'],
                        relationship: ['relation_set', 'npc_relationship_updates'],
                        time: ['time_advance', 'time_skip_minutes'],
                        status: ['npc_status_changes']
                    }[event.type];
                    if (requiredEffects && !operations.some(operation =>
                        requiredEffects.includes(operation.type))) {
                        const error = new Error('uncommitted_completed_event');
                        Object.assign(error, { effect: event.type, event_index: eventIndex,
                            requiredEffects, stage: 'event_effect_consistency',
                            cause: `Completed ${event.type} event has no matching executed effect.` });
                        throw error;
                    }
                    if (event.type === 'movement' && !operations.some(operation =>
                        operation.type === 'actor_move'
                        && (operation.payload.actor_id === event.actor_id
                            || (operation.payload.companion_ids || []).includes(event.actor_id))
                        && operation.payload.to_location_id === event.to_location_id))
                        throw new Error('unlinked_movement_event');
                    if (event.type === 'movement' && event.to_location_id
                        && (event.actor_id === 'player' ? working.getSession('playerLocation')
                            : working.getEntity(event.actor_id).state?.location) !== event.to_location_id)
                        throw new Error('event_movement_mismatch');
                    if (event.type === 'movement' && event.from_location_id
                        && !moveTransitions.some(move => move.actor === event.actor_id
                            && move.from === event.from_location_id
                            && move.to === event.to_location_id))
                        throw new Error('event_movement_origin_mismatch');
                }
                events.push(copy(event));
            }
            const worldReaction = (context.worldActionIds || []).includes(action.action_id);
            const actionEvents = plan.events.filter(event => event.action_id === action.action_id);
            const unwitnessed = operations.find(operation => {
                // Server-bound player proposals need the same structural proof
                // as NPC reactions. Time advances are checked against the turn
                // clock; legacy operations keep their existing receipt checks.
                const eventBound = Object.hasOwn(eventTypes, operation.type)
                    || !!registryApi.technicalEffects.get(operation.type)?.eventTypes;
                const needsEvent = worldReaction || context.requireEffectWitnesses === true
                    && eventBound && !['time_advance', 'time_skip_minutes'].includes(operation.type);
                return needsEvent && !witnessed(operation, actionEvents, moveTransitions);
            });
            if (unwitnessed) {
                const error = new Error(worldReaction ? 'unwitnessed_world_effect'
                    : 'unwitnessed_action_effect');
                error.effect = unwitnessed.type;
                throw error;
            }
        } catch (error) {
            working.restore(point);
            turnTimeBudget.remaining = includedTimeAtStart;
            if (error instanceof BlockedAction) outcomes.set(action.action_id, 'blocked');
            else { errors.push({ action_id: action.action_id, reason: error.code || error.message,
                code: error.code || error.message, effect: error.effect || '',
                ...(Number.isInteger(error.event_index) ? { event_index: error.event_index } : {}),
                ...(error.requiredEffects ? { requiredEffects: error.requiredEffects } : {}),
                protocol: capability.protocol, executionMode: capability.executionMode,
                available: capability.names, source: error.source || capability.source,
                stage: error.stage || 'linked_action_execution',
                cause: error.cause || error.message }); break; }
        }
        const actual = outcomes.get(action.action_id);
        const proposed = action.status === 'resolved' || action.status === 'answered'
            ? 'succeeded' : action.status === 'attempted' ? 'failed'
                : action.status === 'blocked' ? 'blocked'
                    : action.status === 'pending_check' ? 'pending' : 'unresolved';
        if (actual !== proposed) {
            errors.push({ action_id: action.action_id, reason: 'action_outcome_mismatch',
                proposed, actual });
            break;
        }
        if (actual === 'succeeded') verifiedEvents.push(...plan.events
            .filter(event => event.action_id === action.action_id && event.status === 'completed')
            .map(copy));
        if (actual === 'succeeded' && appliedOperations.length) {
            const actionEvents = plan.events.filter(event => event.action_id === action.action_id);
            const supported = appliedOperations.filter(operation => witnessed(operation, actionEvents,
                actionMoves));
            if (supported.length) {
                try {
                    workingApi.assertWorldModelInvariants(world, session, working.prepare());
                    verifiedEffects.push({ action_id: action.action_id,
                        source: (context.worldActionIds || []).includes(action.action_id) ? 'reaction' : 'player',
                        request: action.request, kind: action.kind,
                        effects: supported.map(copy) });
                } catch (error) {
                    errors.push({ action_id: action.action_id, reason: 'world_invariant_violation',
                        cause: error.message });
                    break;
                }
            }
        }
    }
    if (errors.length) { working.rollback(); return { ok: false, errors, outcomes,
        verifiedEffects, verifiedEvents }; }
    try {
        workingApi.assertWorldModelInvariants(world, session, working.prepare());
    } catch (error) {
        working.rollback();
        return { ok: false, errors: [{ code: 'world_invariant_violation',
            reason: error.message, protocol: capability.protocol,
            executionMode: capability.executionMode, available: capability.names,
            source: 'worlds/working-state.js', stage: 'post_action_invariants',
            cause: error.message }], outcomes, verifiedEffects: [], verifiedEvents: [] };
    }
    const visiblePassages = (plan.narrative || []).filter(passage =>
        !passage.action_id || outcomes.get(passage.action_id) !== 'skipped');
    return { ok: true, working, outcomes, events, verifiedEffects, verifiedEvents,
        narrative: visiblePassages.map(passage => passage.text).join('\n\n'),
        skipped: [...outcomes].filter(([, result]) => result === 'skipped').map(([id]) => id) };
}
const api = { createFactRegistry, createWorldEffectRegistry, executeLinkedActions, BlockedAction };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.HordeLinkedWorldActions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
