/* Sequential World action execution. Language interpretation belongs to the
 * model's Scene Draft; this module accepts only exact IDs and typed effects. */
(function (root) {
'use strict';
const workingApi = typeof module !== 'undefined' && module.exports
    ? require('./working-state') : root.HordeWorkingState;
const registryApi = typeof module !== 'undefined' && module.exports
    ? require('./effect-registry') : root.HordeEffectRegistry;
const checkApi = typeof module !== 'undefined' && module.exports
    ? require('./universal-checks') : root.HordeUniversalChecks;
const discoveryApi = typeof module !== 'undefined' && module.exports
    ? require('./dynamic-object-discovery') : root.HordeDynamicObjectDiscovery;
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
const actorInventory = (working, id) => id === 'player'
    ? working.getSession('inventory') : working.getEntity(id).state?.inventory;
const actorAt = (working, id) => id === 'player'
    ? working.getSession('playerLocation') : working.getEntity(id).state?.location;
const resourceBalance = (working, actorId, resourceId) => {
    if (actorId !== 'player' && working.getEntity(actorId).definition?.type !== 'npc')
        throw new Error('unknown_resource_actor');
    const values = actorId === 'player' ? working.getSession('playerStats')
        : working.getEntity(actorId).state?.resources;
    if (!values || !own(values, resourceId)) throw new Error('unknown_resource');
    const balance = values[resourceId];
    if (!Number.isFinite(balance) || balance < 0) throw new Error('invalid_resource_value');
    return balance;
};
function expireCreatedItems(working, elapsed = 0) {
    const now = Number(working.getSession('worldClock')?.absoluteMinutes) + elapsed;
    if (!Number.isFinite(now)) return;
    for (const item of working.getEntitiesByFilter(entity => entity.definition?.type === 'item'
        && Number.isFinite(entity.state?.expiresAtMinute)
        && entity.state.expiresAtMinute <= now && !entity.state.expired)) {
        const id = item.definition.id;
        working.writeEntity(id, entity => {
            entity.state.expired = true; entity.state.quantity = 0; entity.state.location = '';
        });
        working.writeEvent('engineEvents', field => {
            field.value ||= [];
            field.value.push({ id: `item_expired_${id}`, type: 'item_expired',
                item_id: id, atMinute: now });
        });
        working.writeSession('inventory', field => {
            field.value = (field.value || []).filter(entry => !itemMatches(entry, id));
        });
        for (const npc of working.getEntitiesByFilter(entity => entity.definition?.type === 'npc'
            && inventoryHas(entity.state?.inventory, id)))
            working.writeEntity(npc.definition.id, entity => {
                entity.state.inventory = entity.state.inventory.filter(entry => !itemMatches(entry, id));
            });
    }
}
// Only the author's structured room contents are inventory claims. Prose is
// deliberately excluded; it can describe scenery without granting ownership.
function seedAuthoredSceneItems(working, locationId, sessionId) {
    const seeded = working.getSession('sceneItemSeeds');
    if (!seeded || seeded[locationId]) return;
    const location = working.getLocation(locationId).definition;
    if (!location) return;
    const entries = Array.isArray(location.items) ? location.items : [];
    const grouped = new Map();
    for (const raw of entries) {
        let name = String(typeof raw === 'string' ? raw : raw?.name || '').trim();
        let quantity = typeof raw === 'string' ? 1 : Number(raw?.quantity ?? 1);
        if (typeof raw === 'string') {
            const count = name.match(/^(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\s+(.+)$/i);
            if (count) {
                quantity = Number(count[1]) || ['one', 'two', 'three', 'four', 'five',
                    'six', 'seven', 'eight', 'nine', 'ten'].indexOf(count[1].toLowerCase()) + 1;
                name = count[2].replace(/^pairs of\s+/i, 'pair of ');
            }
        }
        if (!name || name.length > 160 || !Number.isInteger(quantity)
            || quantity < 1 || quantity > 100) continue;
        const containerId = typeof raw === 'object' ? raw.containerId || raw.container_id : undefined;
        const blockedBy = typeof raw === 'object' ? raw.blockedBy || raw.blocked_by : undefined;
        const key = JSON.stringify([itemKey(name), containerId || '', blockedBy || '']);
        const prior = grouped.get(key);
        grouped.set(key, { name, quantity: (prior?.quantity || 0) + quantity,
            description: typeof raw === 'object' ? raw.description : '',
            reachable: prior?.reachable === false || typeof raw === 'object'
                && raw?.reachable === false ? false : true,
            containerId, blockedBy });
    }
    const used = new Set(working.entityIds());
    for (const { name, quantity, description, reachable, containerId, blockedBy } of grouped.values()) {
        if (quantity > 100) continue;
        const existing = working.getEntitiesByFilter(entity => entity.definition?.type === 'item'
            && (!entity.definition.sessionOrigin || entity.definition.sessionOrigin === sessionId)
            && itemKey(entity.definition.name) === itemKey(name)
            && (entity.state?.containerId || entity.definition?.properties?.containerId || '')
                === (containerId || '')
            && (entity.state?.blockedBy || entity.definition?.properties?.blockedBy || '')
                === (blockedBy || '')
            && (entity.state?.location === locationId
                || [entity.definition.locationId, entity.definition.location,
                    entity.definition.startLocation].includes(locationId)));
        if (existing.length) continue;
        const slug = name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '').slice(0, 45) || 'object';
        const base = `scene_${locationId}_${slug}`.slice(0, 105);
        let id = base;
        for (let suffix = 2; used.has(id); suffix++) id = `${base}_${suffix}`;
        used.add(id);
        working.writeEntity(id, entity => {
            entity.definition = { id, name, type: 'item', description:
                String(description || '').slice(0, 500),
                sessionOrigin: sessionId, sceneOrigin: locationId,
                ...(reachable === false ? { properties: { reachable: false } } : {}) };
            entity.state = { location: locationId, quantity,
                ...(safeId(containerId) ? { containerId } : {}),
                ...(safeId(blockedBy) ? { blockedBy } : {}) };
        });
    }
    working.writeSession('sceneItemSeeds', field => {
        field.value ||= {}; field.value[locationId] = true;
    });
}
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
    register('following_player', (working, subject) =>
        working.getEntity(subject).definition?.type === 'npc'
            ? working.getEntity(subject).state?.followingPlayer === true : undefined);
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
        const guardedReduce = (payload, working, context) => {
            const policy = registryApi.moduleVerdict(name,
                context.worldModules || working.getWorld('gameRules')?.modules);
            if (!policy.ok) throw new Error(policy.reason);
            return reduce(payload, working, context);
        };
        registryApi.bindTechnicalOperation(name, validate, guardedReduce);
        registry.register(name, validate, guardedReduce);
    };
    const ids = (...values) => values.every(safeId);
    const actorLocation = (working, actor) => actor === 'player'
        ? working.getSession('playerLocation') : working.getEntity(actor).state?.location;
    const moveActor = (working, actor, to) => {
        working.writeEntity(actor, entity => {
            entity.state ||= {};
            entity.state.location = to;
            delete entity.state.journey;
        });
        if (actor === 'player') working.writeSession('playerLocation', field => { field.value = to; });
    };
    registerNative('actor_move', value => ids(value?.actor_id, value?.to_location_id)
        && (value.mode === undefined || ['journey', 'teleport'].includes(value.mode))
        && (value.explore === undefined || typeof value.explore === 'boolean')
        && (value.companion_ids === undefined || Array.isArray(value.companion_ids)
            && value.companion_ids.every(safeId)), (value, working, context) => {
        const inTransit = value.actor_id === 'player' ? null
            : working.getEntity(value.actor_id).state?.journey;
        const from = actorLocation(working, value.actor_id)
            || (value.mode === 'teleport' && inTransit
                ? inTransit.path?.[inTransit.progressIndex || 0] || inTransit.originId : null);
        const target = working.getLocation(value.to_location_id).definition;
        if (!from || !target) throw new BlockedAction('unknown_or_unreachable_destination');
        const scene = working.prepare();
        const verdict = context.canMove
            ? context.canMove(scene.world, scene.session, value.actor_id, from, value.to_location_id,
                { mode: value.mode || 'arrival', explore: value.explore === true })
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
        if (value.mode === 'journey') {
            if (value.actor_id === 'player' || value.companion_ids?.length
                || typeof context.startJourney !== 'function'
                || !context.startJourney(working, value.actor_id, target.id, value.explore === true))
                throw new BlockedAction('journey_unavailable');
            return;
        }
        const companions = new Set(value.companion_ids || []);
        if (value.actor_id === 'player') for (const actor of working.getEntitiesByFilter(entity =>
            entity.state?.followingPlayer === true && entity.state.location === from))
            companions.add(actor.definition.id);
        for (const companion of companions) {
            if (companion === value.actor_id || actorLocation(working, companion) !== from)
                throw new BlockedAction('companion_unavailable');
            if (context.canMove) {
                const allowed = context.canMove(scene.world, scene.session,
                    companion, from, value.to_location_id,
                    { accompanyingPlayer: true, mode: value.mode || 'arrival',
                        explore: value.explore === true });
                if (!allowed?.ok) throw new BlockedAction(allowed?.reason || 'companion_access_denied');
                if (value.mode !== 'teleport' && Number(allowed.travelTime) > 0
                    && (Number(allowed.elapsedMinutes) || 0) - (context.travelSpent?.get(companion) || 0)
                        < Number(allowed.travelTime)) throw new BlockedAction('insufficient_travel_time');
            }
        }
        if (value.mode !== 'teleport' && Number(verdict.travelTime) > 0
            && (Number(verdict.elapsedMinutes) || 0) - (context.travelSpent?.get(value.actor_id) || 0)
                < Number(verdict.travelTime)) throw new BlockedAction('insufficient_travel_time');
        moveActor(working, value.actor_id, target.id);
        for (const companion of companions) moveActor(working, companion, target.id);
        if (value.actor_id === 'player')
            seedAuthoredSceneItems(working, target.id, context.sessionId);
        if (context.travelSpent && value.mode !== 'teleport')
            for (const actor of [value.actor_id, ...companions]) context.travelSpent.set(actor,
                (context.travelSpent.get(actor) || 0) + Number(verdict.travelTime || 0));
        const turn = Number(working.getSession('turnCount')) || 1;
        working.writeLocation(from, location => {
            location.state ||= {}; location.state.lastExitedTurn = turn;
        });
        working.writeLocation(target.id, location => {
            location.state ||= {}; location.state.lastEnteredTurn = turn;
        });
    });
    registerNative('interactable_transition', value =>
        typeof value?.target_id === 'string'
        && /^[a-zA-Z][a-zA-Z0-9_:-]{0,119}$/.test(value.target_id)
        && (value.actor_id === undefined || safeId(value.actor_id))
        && typeof value?.to_state === 'string' && !!value.to_state, (value, working, context) => {
        const actor = value.actor_id || 'player';
        const actorPlace = actorAt(working, actor);
        if (!actorPlace || actor !== 'player'
            && working.getEntity(actor).definition?.type !== 'npc')
            throw new BlockedAction('unknown_interaction_actor');
        const entity = working.getEntity(value.target_id);
        if (entity.definition?.interactable) {
            const place = entity.state?.location || entity.definition.locationId
                || entity.definition.location || entity.definition.startLocation;
            if (place && place !== actorPlace)
                throw new BlockedAction('interactable_out_of_reach');
            const current = entity.state?.interactableState
                || entity.definition.interactable.initialState;
            const transition = (entity.definition.interactable.transitions || []).find(item =>
                item.from === current && item.to === value.to_state);
            if (!transition) throw new BlockedAction('unavailable_object_transition');
            if (transition.requiredItem && !inventoryHas(actorInventory(working, actor), transition.requiredItem))
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
        if (!exits.some(entry => entry.locationId === actorPlace))
            throw new BlockedAction('interactable_out_of_reach');
        const requiredItem = exits.map(entry => entry.exit.requiredItem || entry.exit.lockKeyItem).find(Boolean);
        if (requiredItem && !inventoryHas(actorInventory(working, actor), requiredItem))
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
    registerNative('npc_follow', value => safeId(value?.actor_id)
        && typeof value?.following === 'boolean', (value, working, context) => {
        const npc = working.getEntity(value.actor_id);
        if (npc.definition?.type !== 'npc') throw new Error('unknown_follower');
        if (actorAt(working, value.actor_id) !== actorAt(working, 'player'))
            throw new BlockedAction('follower_not_present');
        const action = value.following ? 'join' : 'leave';
        const evidenceFor = event => String(event.evidence || (context.actionPassages || [])
            .find(passage => passage.id === event.passage_id)?.text || '');
        const proof = (context.actionEvents || []).filter(event => event.type === 'escort'
            && event.status === 'completed' && event.actor_id === value.actor_id
            && event.target_id === 'player' && event.action === action
            && evidenceFor(event).trim());
        if (proof.length !== 1) throw new Error('unwitnessed_npc_follow');
        const testimony = (context.actionSpeech || []).filter(speech =>
            speech.speaker === value.actor_id && String(speech.statement || '').trim()
            && evidenceFor(proof[0]).includes(speech.statement));
        if (testimony.length !== 1) throw new Error('missing_npc_follow_consent');
        working.writeEntity(value.actor_id, entity => {
            entity.state ||= {};
            entity.state.followingPlayer = value.following;
        });
    });
    registerNative('npc_goal_set', value => safeId(value?.actor_id)
        && typeof value?.goal === 'string' && !!value.goal.trim()
        && value.goal.length <= 200, (value, working, context) => {
        const npc = working.getEntity(value.actor_id);
        if (npc.definition?.type !== 'npc') throw new Error('unknown_goal_actor');
        if (actorAt(working, value.actor_id) !== actorAt(working, 'player'))
            throw new BlockedAction('goal_actor_not_present');
        const evidenceFor = event => String(event.evidence || (context.actionPassages || [])
            .find(passage => passage.id === event.passage_id)?.text || '');
        const proof = (context.actionEvents || []).filter(event => event.type === 'quest'
            && event.status === 'completed' && event.actor_id === value.actor_id
            && event.action === 'accept' && evidenceFor(event).trim());
        if (proof.length !== 1) throw new Error('unwitnessed_npc_goal_acceptance');
        const testimony = (context.actionSpeech || []).filter(speech =>
            speech.speaker === value.actor_id && String(speech.statement || '').trim()
            && evidenceFor(proof[0]).includes(speech.statement));
        if (testimony.length !== 1) throw new Error('missing_npc_goal_consent');
        const goal = value.goal.trim();
        const goalApi = typeof module !== 'undefined' && module.exports
            ? require('./npc-goal-actions') : root.HordeNpcGoalActions;
        if (typeof goalApi?.rememberNpcGoal !== 'function')
            throw new Error('npc_goal_runtime_unavailable');
        working.writeEntity(value.actor_id, entity => {
            entity.state ||= {};
            const state = entity.state;
            if (state.goal && state.goal !== goal) {
                goalApi.rememberNpcGoal(state);
                if (state.goalStates?.[state.goal]?.goalStatus === 'active')
                    state.goalStates[state.goal].goalStatus = 'interrupted';
            }
            state.goal = goal;
            state.goalStatus = 'active';
            state.goalProgress = 0;
            state.goalStepIndex = 0;
            state.goalActionIndex = 0;
            state.goalSteps = [];
            state.goalAutonomy = state.goalAutonomy === 'paused' ? 'medium'
                : state.goalAutonomy || 'medium';
            for (const field of ['goalActionProposal', 'goalActionProgress',
                'goalActionGoal', 'goalLastAction', 'goalBlockedReason',
                'goalWaitStatus', 'goalResolvedTurn', 'goalCompletionProof',
                'goalCompletion', 'goalDeadlineTurn']) delete state[field];
            state.goalPool ||= [];
            if (!state.goalPool.some(item => (typeof item === 'string' ? item : item?.goal) === goal))
                state.goalPool.push({ goal, priority: 70 });
            state.goalPool = state.goalPool.slice(-20);
        });
    });
    registerNative('item_transfer', value => typeof value?.item_id === 'string'
        && !!value.item_id.trim() && value.item_id.length <= 120
        && ids(value?.from_id, value?.to_id)
        && (value.actor_id === undefined || safeId(value.actor_id))
        && (value.container_id === undefined || safeId(value.container_id))
        && (value.quantity === undefined || Number.isInteger(value.quantity)
            && value.quantity > 0 && value.quantity <= 100), (value, working) => {
        const quantity = value.quantity || 1;
        if (value.from_id === value.to_id) throw new BlockedAction('same_transfer_endpoint');
        const sourceEntity = working.getEntity(value.from_id).definition;
        const destinationEntity = working.getEntity(value.to_id).definition;
        const sourceIsActor = value.from_id === 'player' || sourceEntity?.type === 'npc';
        const sourceIsLocation = !!working.getLocation(value.from_id).definition;
        const destinationIsActor = value.to_id === 'player' || destinationEntity?.type === 'npc';
        if (!sourceIsActor && !sourceIsLocation) throw new Error('unknown_transfer_source');
        if (!destinationIsActor && !working.getLocation(value.to_id).definition)
            throw new Error('unknown_transfer_destination');
        const actingActor = value.actor_id || 'player';
        const actionPlace = actorAt(working, actingActor);
        if (!actionPlace || actingActor !== 'player'
            && working.getEntity(actingActor).definition?.type !== 'npc')
            throw new BlockedAction('unknown_interaction_actor');
        const restrictions = actingActor === 'player'
            ? working.getSession('playerSceneConditions')
            : working.getEntity(actingActor).state?.conditions;
        if (Array.isArray(restrictions) && restrictions.some(condition =>
            condition && typeof condition === 'object'
            && condition.blocksItemInteraction === true))
            throw new BlockedAction('actor_cannot_manipulate_items');
        if ((sourceIsActor ? actorAt(working, value.from_id) : value.from_id) !== actionPlace
            || (destinationIsActor ? actorAt(working, value.to_id) : value.to_id) !== actionPlace)
            throw new BlockedAction('item_out_of_reach');
        const sourceInventory = value.from_id === 'player' ? working.getSession('inventory')
            : working.getEntity(value.from_id).state?.inventory;
        const placement = entity => entity.state?.location || (!entity.state
            ? entity.definition?.locationId || entity.definition?.location
                || entity.definition?.startLocation : '');
        const namedLoose = working.getEntitiesByFilter(entity =>
            entity.definition?.type === 'item'
            && itemKey(entity.definition.name) === itemKey(value.item_id)
            && placement(entity) === value.from_id);
        const resolvedId = working.getEntity(value.item_id).definition ? value.item_id
            : namedLoose.length === 1 ? namedLoose[0].definition.id : value.item_id;
        const itemEntity = working.getEntity(resolvedId);
        if (itemEntity.state?.expired) throw new BlockedAction('item_expired');
        const sourceItem = Array.isArray(sourceInventory)
            ? sourceInventory.find(item => itemMatches(item, value.item_id)) : null;
        const transferName = itemEntity.definition?.name || itemName(sourceItem) || value.item_id;
        // Older inventories store a registered item's display name as a
        // string. Its canonical ID must still be usable on a later transfer.
        const sourceReference = !inventoryHas(sourceInventory, value.item_id)
            && inventoryHas(sourceInventory, transferName) ? transferName : value.item_id;
        const sourceHasInstance = itemEntity.definition?.type === 'item'
            && Array.isArray(sourceInventory)
            && sourceInventory.some(entry => typeof entry === 'object'
                && entry.id === resolvedId);
        const duplicateIdentity = itemEntity.definition?.type === 'item'
            && (inventoryHas(working.getSession('inventory'), transferName)
                || working.getEntitiesByFilter(entity => entity.definition?.type === 'npc'
                    && inventoryHas(entity.state?.inventory, transferName)).length > 0
                || working.getEntitiesByFilter(entity => entity.definition?.type === 'item'
                    && entity.definition.id !== resolvedId
                    && itemKey(entity.definition.name) === itemKey(transferName)).length > 0);
        // A legacy name-only inventory entry cannot prove ownership of a
        // specific registered instance while a same-named loose copy exists.
        if (sourceIsActor && itemEntity.definition?.type === 'item'
            && value.item_id === itemEntity.definition.id
            && !sourceInventory?.some(entry => typeof entry === 'object'
                && entry.id === value.item_id)
            && working.getEntitiesByFilter(entity => entity.definition?.type === 'item'
                && entity.definition.id === value.item_id
                && placement(entity) && Number(entity.state?.quantity
                    ?? entity.definition.quantity ?? 1) > 0).length)
            throw new BlockedAction('item_instance_not_held');
        const looseItem = itemEntity.definition?.type === 'item'
            && placement(itemEntity) === value.from_id;
        const destinationIsLocation = !!working.getLocation(value.to_id).definition;
        const itemContainer = itemEntity.state?.containerId
            || itemEntity.definition?.properties?.containerId;
        const barrierId = itemEntity.state?.blockedBy
            || itemEntity.definition?.properties?.blockedBy;
        const passable = id => {
            const obstacle = working.getEntity(id);
            if (!obstacle.definition) throw new BlockedAction('unknown_item_obstacle');
            const state = obstacle.state?.interactableState
                || obstacle.definition.interactable?.initialState;
            return ['open', 'removed', 'cleared', 'broken'].includes(state);
        };
        if (looseItem && itemContainer && !passable(itemContainer))
            throw new BlockedAction('container_closed');
        if (looseItem && barrierId && !passable(barrierId))
            throw new BlockedAction('item_obstructed');
        if (value.container_id) {
            if (!destinationIsLocation || !sourceIsActor
                || actorAt(working, value.from_id) !== value.to_id)
                throw new BlockedAction('invalid_container_placement');
            const container = working.getEntity(value.container_id);
            if (!container.definition || (container.state?.location
                || container.definition.locationId || container.definition.location
                || container.definition.startLocation) !== value.to_id || !passable(value.container_id))
                throw new BlockedAction('container_unavailable');
        }
        if (destinationIsLocation && itemEntity.definition?.type === 'item'
            && Number(itemEntity.state?.quantity || 0) > 0
            && itemEntity.state?.location === value.to_id
            && (itemEntity.state?.containerId || '') !== (value.container_id || ''))
            throw new BlockedAction('mixed_container_stock');
        if (destinationIsLocation && (itemEntity.definition?.type !== 'item'
            || !itemEntity.definition?.sceneOrigin && quantity !== 1))
            throw new BlockedAction('unrepresentable_loose_item_transfer');
        const actorLocation = id => id === 'player' ? working.getSession('playerLocation')
            : working.getEntity(id).state?.location;
        if (sourceIsLocation && destinationIsLocation
            || sourceIsActor && destinationIsActor
            && actorLocation(value.from_id) !== actorLocation(value.to_id)
            || sourceIsActor && sourceIsLocation === false && !destinationIsActor
                && actorLocation(value.from_id) !== value.to_id
            || sourceIsLocation && destinationIsActor
                && actorLocation(value.to_id) !== value.from_id)
            throw new BlockedAction('item_out_of_reach');
        if (looseItem && (itemEntity.definition?.properties?.reachable === false
            || itemEntity.state?.reachable === false))
            throw new BlockedAction('item_out_of_reach');
        if (!looseItem && !itemEntity.definition?.sceneOrigin
            && itemEntity.definition?.type === 'item'
            && itemEntity.state?.location && itemEntity.state.location !== value.to_id)
            throw new BlockedAction('item_already_placed');
        const sourceBefore = looseItem ? Number(itemEntity.state?.quantity
            ?? itemEntity.definition?.quantity ?? 1)
            : inventoryUnits(sourceInventory, sourceReference);
        const destinationInventory = destinationIsLocation ? null : value.to_id === 'player'
            ? working.getSession('inventory') : working.getEntity(value.to_id).state?.inventory;
        const destinationBefore = destinationIsLocation
            ? Number(itemEntity.state?.location === value.to_id
                ? itemEntity.state?.quantity ?? 1 : 0)
            : inventoryUnits(destinationInventory, transferName);
        if (looseItem && sourceBefore < quantity) throw new BlockedAction('item_not_held_or_present');
        if (!looseItem && inventoryUnits(sourceInventory, sourceReference) < quantity)
            throw new BlockedAction('item_not_held_or_present');
        if (value.from_id === 'player') working.writeSession('inventory', field => {
            const inventory = field.value || [];
            removeInventoryUnits(inventory, sourceReference, quantity);
            field.value = inventory;
        });
        else if (!looseItem) working.writeEntity(value.from_id, entity => {
            removeInventoryUnits(entity.state.inventory, sourceReference, quantity);
        });
        if (destinationIsLocation) {
            if (itemEntity.definition) working.writeEntity(resolvedId, entity => {
                entity.state ||= {};
                entity.state.location = value.to_id;
                entity.state.quantity = Number(entity.state.quantity || 0) + quantity;
                if (value.container_id) entity.state.containerId = value.container_id;
                else delete entity.state.containerId;
            });
            else throw new Error('unregistered_loose_item');
        } else if (value.to_id === 'player') working.writeSession('inventory', field => {
            field.value ||= [];
            if (itemEntity.definition?.sceneOrigin || sourceHasInstance
                || looseItem && duplicateIdentity)
                field.value.push({ id: resolvedId, name: transferName, quantity });
            else for (let count = 0; count < quantity; count++) field.value.push(transferName);
        });
        else if (working.getEntity(value.to_id).definition) working.writeEntity(value.to_id, entity => {
            entity.state ||= {}; entity.state.inventory ||= [];
            if (itemEntity.definition?.sceneOrigin || sourceHasInstance
                || looseItem && duplicateIdentity)
                entity.state.inventory.push({ id: resolvedId, name: transferName, quantity });
            else for (let count = 0; count < quantity; count++)
                entity.state.inventory.push(transferName);
        });
        else throw new Error('unknown_transfer_destination');
        if (looseItem && value.to_id !== value.from_id) working.writeEntity(resolvedId, entity => {
            entity.state ||= {};
            entity.state.quantity = sourceBefore - quantity;
            entity.state.location = entity.state.quantity ? value.from_id : '';
            if (!entity.state.quantity) delete entity.state.containerId;
        });
        const sourceAfter = looseItem ? Number(working.getEntity(resolvedId).state?.quantity || 0)
            : inventoryUnits(value.from_id === 'player' ? working.getSession('inventory')
                : working.getEntity(value.from_id).state?.inventory, sourceReference);
        const destinationAfter = destinationIsLocation
            ? Number(working.getEntity(resolvedId).state?.location === value.to_id
                ? working.getEntity(resolvedId).state?.quantity || 0 : 0)
            : inventoryUnits(value.to_id === 'player' ? working.getSession('inventory')
                : working.getEntity(value.to_id).state?.inventory, transferName);
        if (sourceAfter !== sourceBefore - quantity
            || destinationAfter !== destinationBefore + quantity)
            throw new Error('inventory_conservation_violation');
    });
    registerNative('item_introduce', value => ids(value?.id, value?.location_id)
        && typeof value?.name === 'string' && !!value.name.trim()
        && (value.container_id === undefined || safeId(value.container_id))
        && (value.actor_id === undefined || safeId(value.actor_id))
        && (value.rule_id === undefined || safeId(value.rule_id))
        && (value.source_item_id === undefined || typeof value.source_item_id === 'string')
        && (value.duration_minutes === undefined || Number.isInteger(value.duration_minutes)
            && value.duration_minutes > 0 && value.duration_minutes <= 10080)
        && (value.quantity === undefined || Number.isInteger(value.quantity)
            && value.quantity >= 1 && value.quantity <= 100), (value, working, context) => {
        const cause = value.cause || 'discovery';
        const actor = value.actor_id || 'player';
        const proof = (context.actionEvents || []).filter(event => event.status === 'completed'
            && event.type === (cause === 'discovery' ? 'discovery' : 'inventory')
            && event.actor_id === actor
            && event.target_id === value.id && itemKey(event.item) === itemKey(value.name));
        if (proof.length !== 1 || actorAt(working, actor) !== value.location_id
            || actor !== 'player' && working.getEntity(actor).definition?.type !== 'npc')
            throw new BlockedAction('unconfirmed_scene_item');
        const rule = (working.getWorld('itemCreationRules') || []).find(entry =>
            entry.id === value.rule_id && entry.cause === cause
            && itemKey(entry.item?.name) === itemKey(value.name));
        const discoverable = cause === 'discovery' && !value.rule_id
            && (working.getLocation(value.location_id).definition?.discoverableItems || [])
                .some(entry => itemKey(entry) === itemKey(value.name)
                    && (typeof entry === 'string' || entry.special !== true));
        const discoveryPolicy = working.getLocation(value.location_id).definition?.discoveryPolicy;
        const categoryAllowed = cause === 'discovery' && !value.rule_id
            && typeof value.category === 'string'
            && (discoveryPolicy?.ordinaryCategories || []).includes(value.category)
            && (value.quantity || 1) <= Number(discoveryPolicy.maxQuantity || 1);
        const dynamicProof = context.dynamicDiscovery?.get(value.id);
        if (cause === 'discovery' && value.container_id) {
            const container = working.getEntity(value.container_id);
            const mode = discoveryApi.contentMode(container, working, value.location_id);
            if (mode !== 'unspecified' && !rule)
                throw new BlockedAction(`container_${mode}`);
        }
        const catalogItem = (working.getWorld('gameRules')?.itemCatalog || [])
            .find(item => itemKey(item.name) === itemKey(value.name));
        const guardedName = working.locationIds().some(id =>
            (working.getLocation(id).definition?.exits || []).some(exit =>
                [exit?.requiredItem, exit?.lockKeyItem].some(key => itemKey(key) === itemKey(value.name))))
            || working.getEntitiesByFilter(entity => entity.definition?.type === 'item'
                && itemKey(entity.definition.name) === itemKey(value.name)
                && (entity.definition.unique || entity.definition.questItem
                    || entity.definition.properties?.access || entity.definition.properties?.unique)).length;
        if (categoryAllowed && (guardedName || catalogItem && (catalogItem.unique || catalogItem.questItem
            || catalogItem.properties?.access || catalogItem.properties?.unique)))
            throw new BlockedAction('special_item_requires_rule');
        if (!rule && !discoverable && !categoryAllowed && dynamicProof?.type !== 'success')
            throw new BlockedAction('item_creation_not_authorized');
        if (dynamicProof?.type === 'success' && value.container_id) {
            const container = working.getEntity(value.container_id);
            if (!container.definition || (container.state?.location
                || container.definition.locationId || container.definition.startLocation)
                !== value.location_id) throw new BlockedAction('container_unavailable');
            const state = container.state?.interactableState
                || container.definition.interactable?.initialState;
            if (!['open', 'removed', 'cleared', 'broken'].includes(state))
                throw new BlockedAction('container_closed');
        }
        if (!rule && (value.duration_minutes || value.source_item_id))
            throw new BlockedAction('unruled_creation_property');
        if (rule) {
            if (rule.locations && (!Array.isArray(rule.locations)
                || !rule.locations.includes(value.location_id)))
                throw new BlockedAction('creation_location_denied');
            const abilities = actor === 'player'
                ? [...(working.getSession('playerIdentity')?.skills || []),
                    ...(working.getSession('playerIdentity')?.perks || []),
                    ...(working.getSession('playerIdentity')?.privileges || [])]
                : [...(working.getEntity(actor).definition?.skills || []),
                    ...(working.getEntity(actor).definition?.abilities || [])];
            if (rule.ability_id && !abilities.some(ability =>
                (typeof ability === 'string' ? ability : ability?.id) === rule.ability_id))
                throw new BlockedAction('missing_creation_ability');
            if (rule.check_id) {
                const check = (working.getSession('checkHistory') || []).find(entry =>
                    entry.id === rule.check_id && entry.success === true
                    && entry.turn === working.getSession('turnCount'));
                if (!check || working.getSession('itemCreationChecks')?.[rule.check_id])
                    throw new BlockedAction('creation_check_not_passed');
                working.writeSession('itemCreationChecks', field => {
                    field.value ||= {}; field.value[rule.check_id] = value.id;
                });
            }
            if (rule.duration_minutes !== undefined
                && value.duration_minutes !== rule.duration_minutes)
                throw new BlockedAction('creation_duration_mismatch');
            if (rule.duration_minutes === undefined && value.duration_minutes !== undefined)
                throw new BlockedAction('creation_duration_not_authorized');
            if ((value.quantity || 1) !== (rule.item.quantity || 1))
                throw new BlockedAction('creation_quantity_mismatch');
            if (rule.time_minutes && (context.actionOperations || [])
                .filter(operation => operation.type === 'time_advance')
                .reduce((total, operation) => total + Number(operation.payload?.minutes || 0), 0)
                < rule.time_minutes) throw new BlockedAction('creation_time_not_paid');
            if (rule.source_item_id !== undefined
                && value.source_item_id !== rule.source_item_id)
                throw new BlockedAction('creation_source_mismatch');
            for (const tool of rule.tools || [])
                if (!inventoryHas(actorInventory(working, actor), tool))
                    throw new BlockedAction('missing_creation_tool');
            const required = new Map();
            for (const material of [...(rule.materials || []),
                ...(rule.source_item_id ? [{ item_id: rule.source_item_id, quantity: 1 }] : [])]) {
                const count = Number(material.quantity || 1);
                if (!Number.isInteger(count) || count < 1 || count > 100
                    || !String(material.item_id || '').trim())
                    throw new BlockedAction('missing_creation_material');
                const key = itemKey(material.item_id);
                required.set(key, (required.get(key) || 0) + count);
                if (inventoryUnits(actorInventory(working, actor), material.item_id) < required.get(key))
                    throw new BlockedAction('missing_creation_material');
            }
            if (rule.resource) {
                const amount = Number(rule.resource.amount);
                const stock = actor === 'player' ? working.getSession('playerStats')
                    : working.getEntity(actor).state?.resources;
                if (!safeId(rule.resource.id) || !Number.isFinite(amount) || amount <= 0
                    || !Number.isFinite(Number(stock?.[rule.resource.id]))
                    || Number(stock[rule.resource.id]) < amount)
                    throw new BlockedAction('insufficient_creation_resource');
            }
        }
        if (working.getEntity(value.id).definition || !working.getLocation(value.location_id).definition
            || working.getEntitiesByFilter(entity => entity.definition?.type === 'item'
                && (!entity.definition.sessionOrigin
                    || entity.definition.sessionOrigin === context.sessionId)
                && itemKey(entity.definition.name) === itemKey(value.name)
                && (cause === 'discovery' && entity.definition.sceneOrigin === value.location_id
                    || entity.state?.location === value.location_id
                    || [entity.definition.locationId, entity.definition.location,
                        entity.definition.startLocation].includes(value.location_id))).length)
            throw new Error('duplicate_or_unplaced_item');
        if (rule?.item?.properties?.unique && working.getEntitiesByFilter(entity =>
            entity.definition?.type === 'item' && itemKey(entity.definition.name) === itemKey(value.name)
            && !entity.state?.expired).length)
            throw new BlockedAction('unique_item_exists');
        if (rule) {
            const costs = [...(rule.materials || []),
                ...(rule.source_item_id ? [{ item_id: rule.source_item_id, quantity: 1 }] : [])];
            if (costs.length) {
                const remove = inventory => {
                    for (const material of costs)
                        removeInventoryUnits(inventory, material.item_id, Number(material.quantity || 1));
                };
                if (actor === 'player') working.writeSession('inventory', field => {
                    field.value ||= []; remove(field.value);
                });
                else working.writeEntity(actor, entity => { remove(entity.state.inventory); });
            }
            if (rule.resource) {
                const { id, amount } = rule.resource;
                if (actor === 'player') working.writeSession('playerStats', field => {
                    field.value ||= {}; field.value[id] -= amount;
                });
                else working.writeEntity(actor, entity => {
                    entity.state.resources[id] -= amount;
                });
            }
        }
        const now = Number(working.getSession('worldClock')?.absoluteMinutes);
        if (value.duration_minutes && !Number.isFinite(now))
            throw new BlockedAction('creation_clock_unavailable');
        working.writeEntity(value.id, entity => {
            entity.definition = { id: value.id, name: value.name, type: 'item',
                description: value.description || '', sessionOrigin: context.sessionId,
                sceneOrigin: value.location_id,
                ...((rule?.item?.category || value.category)
                    ? { category: rule?.item?.category || value.category } : {}),
                ...(rule?.item?.properties ? { properties: copy(rule.item.properties) } : {}) };
            entity.state = { location: value.location_id, quantity: value.quantity || 1,
                originCause: cause, originEventId: proof[0].id || context.actionId,
                creatorId: actor,
                ...(dynamicProof?.type === 'success' && value.container_id
                    ? { containerId: value.container_id } : {}),
                ...(value.duration_minutes ? { expiresAtMinute: now + value.duration_minutes } : {}) };
        });
    });
    registerNative('item_consume', value => typeof value?.item_id === 'string'
        && !!value.item_id.trim() && value.item_id.length <= 120
        && safeId(value?.actor_id)
        && (value.quantity === undefined || Number.isInteger(value.quantity)
            && value.quantity >= 1 && value.quantity <= 100), (value, working) => {
        const quantity = value.quantity || 1;
        const actor = working.getEntity(value.actor_id);
        if (value.actor_id !== 'player' && actor.definition?.type !== 'npc')
            throw new Error('unknown_item_owner');
        const inventory = value.actor_id === 'player' ? working.getSession('inventory')
            : actor.state?.inventory;
        if (working.getEntity(value.item_id).state?.expired)
            throw new BlockedAction('item_expired');
        if (inventoryUnits(inventory, value.item_id) < quantity)
            throw new BlockedAction('item_not_held_or_present');
        if (value.actor_id === 'player') working.writeSession('inventory', field => {
            removeInventoryUnits(field.value, value.item_id, quantity);
        });
        else working.writeEntity(value.actor_id, entity => {
            removeInventoryUnits(entity.state.inventory, value.item_id, quantity);
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
        if (value.target_id !== 'player'
            && working.getEntity(value.target_id).definition?.type !== 'npc')
            throw new Error('unknown_condition_target');
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
    (value, working, context) => {
        const factions = working.getSession('factions') || working.getWorld('factions') || [];
        const factionSubject = factions.find(item => item.id === value.subject_id);
        const factionTarget = factions.find(item => item.id === value.target_id);
        const subjectType = factionSubject ? 'faction' : value.subject_id === 'player'
            ? 'player' : working.getEntity(value.subject_id).definition?.type === 'npc' ? 'npc' : '';
        const targetType = factionTarget ? 'faction' : value.target_id === 'player'
            ? 'player' : working.getEntity(value.target_id).definition?.type === 'npc' ? 'npc' : '';
        const currentScore = factionSubject && factionTarget
            ? factionSubject.relations?.find(item => item.factionId === value.target_id)?.score || 0
            : working.getSession('npcRelationships')?.[pairKey(value.subject_id, value.target_id)]?.score || 0;
        const verdict = registryApi.relationVerdict({
            modules: context.worldModules || working.getWorld('gameRules')?.modules,
            subjectId: value.subject_id, targetId: value.target_id,
            subjectType, targetType, currentScore, value: value.value,
            events: (context.actionEvents || []).filter(event =>
                !context.consumedRelationEvents?.has(event)), actionId: context.actionId,
            requireWitness: context.requireEffectWitnesses === true
                || (context.worldActionIds || []).includes(context.actionId)
        });
        if (!verdict.ok) throw new Error(verdict.reason);
        if (verdict.event) context.consumedRelationEvents?.add(verdict.event);
        if (factionSubject && factionTarget) {
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
        if (typeof context.onEvent !== 'function') return [];
        const beforeHook = working.prepare();
        const emitted = context.onEvent(value, working);
        const afterHook = working.prepare();
        if (JSON.stringify(beforeHook.world) !== JSON.stringify(afterHook.world)
            || JSON.stringify(beforeHook.session) !== JSON.stringify(afterHook.session))
            throw new Error('untracked_event_hook_mutation');
        return emitted;
    });
    registerNative('knowledge_share', value => ids(value?.actor_id,
        value?.recipient_id, value?.observation_id), (value, working, context) => {
        if (value.actor_id === value.recipient_id
            || working.getWorld('communication')?.inPerson === false)
            throw new BlockedAction('communication_unavailable');
        const sender = working.getEntity(value.actor_id);
        const recipient = working.getEntity(value.recipient_id);
        if (sender.definition?.type !== 'npc' || recipient.definition?.type !== 'npc'
            || !sender.state?.location || sender.state.location !== recipient.state?.location
            || ['dead', 'gone'].includes(sender.state.status)
            || ['dead', 'gone'].includes(recipient.state.status)
            || sender.state.canSpeak === false || sender.state.communicationBlocked === true
            || recipient.state.canHear === false
            || recipient.state.communicationBlocked === true)
            throw new BlockedAction('communication_unavailable');
        const source = (sender.state.observations || []).find(item =>
            item?.id === value.observation_id && item.allowedToShare !== false
            && typeof item.text === 'string' && !!item.text.trim());
        if (!source || !['witnessed', 'told', 'suspected', 'believed', 'public']
            .includes(source.sourceType))
            throw new BlockedAction('unknown_or_private_information');
        const actionId = String(context.actionId || '');
        const prior = actionId && (recipient.state.observations || []).find(item =>
            item.deliveryActionId === actionId
                || item.id === `obs_report_${actionId}_${value.recipient_id}`.slice(0, 100));
        if (prior) throw new BlockedAction('already_delivered');
        const repeatCount = (recipient.state.observations || []).filter(item =>
            item.sourceNpcId === value.actor_id
                && item.sourceObservationId === source.id).length;
        if (repeatCount >= 8) throw new BlockedAction('report_history_limit');
        // A relay creates a fresh source observation at every hop. Bound the
        // history for one origin as well, or A → B → C → A can grow forever.
        const originObservationId = source.originObservationId || source.id;
        const originNpcId = source.originNpcId || (source.sourceType === 'witnessed'
            ? value.actor_id : '');
        const originCount = (recipient.state.observations || []).filter(item =>
            item.sourceType === 'told'
                && item.originObservationId === originObservationId
                && item.originNpcId === originNpcId).length;
        if (originCount >= 8) throw new BlockedAction('report_origin_history_limit');
        const turn = Math.max(0, Number(working.getSession('turnCount')) || 0);
        const absoluteMinute = Math.max(0,
            Number(working.getSession('worldClock')?.absoluteMinutes) || 0);
        const id = `obs_report_${context.actionId || turn}_${value.recipient_id}`.slice(0, 100);
        const report = { id, eventId: String(source.eventId || '').slice(0, 100),
            text: source.text.slice(0, 500), sourceType: 'told', source: 'told',
            sourceNpcId: value.actor_id, sourceObservationId: source.id,
            originObservationId, originNpcId,
            reportedSourceType: source.sourceType,
            evidenceMode: 'hearsay',
            confidence: Math.max(0, Math.min(1, Number(source.confidence ?? 0.7) * 0.82)),
            visibility: 'private', allowedToShare: true, turn,
            learnedAt: { turn, absoluteMinute },
            sourceLocationId: source.sourceLocationId || '',
            deliveryLocationId: sender.state.location,
            deliveryActionId: actionId,
            deliveryEventId: `${context.actionId || turn}_event`,
            channel: source.channel || '', kind: source.kind || '',
            tags: Array.isArray(source.tags) ? source.tags.slice(0, 8) : [] };
        working.writeEntity(value.recipient_id, entity => {
            entity.state.observations ||= [];
            entity.state.observations.push(report);
        });
    });
    registerNative('time_advance', value => Number.isInteger(value?.minutes)
        && value.minutes > 0 && value.minutes <= 10080, (value, working, context) => {
        const included = Math.min(value.minutes, context.turnTimeBudget?.remaining || 0);
        if (context.turnTimeBudget) context.turnTimeBudget.remaining -= included;
        working.writeTime('bonusTimeMinutes', field => {
            field.value = (Number(field.value) || 0) + value.minutes - included;
        });
        expireCreatedItems(working, value.minutes - included);
    });
    registerNative('outfit_set', value => safeId(value?.actor_id)
        && typeof value?.outfit === 'string' && !!value.outfit.trim(), (value, working) => {
        if (value.actor_id !== 'player'
            && working.getEntity(value.actor_id).definition?.type !== 'npc')
            throw new Error('unknown_outfit_actor');
        if (value.actor_id === 'player') working.writeSession('outfit', field => {
            field.value = value.outfit.trim();
        });
        else if (working.getEntity(value.actor_id).definition)
            working.writeEntity(value.actor_id, entity => {
                entity.state ||= {}; entity.state.outfit = value.outfit.trim();
            });
        else throw new Error('unknown_outfit_actor');
    });
    registerNative('resource_cost', value => safeId(value?.actor_id)
        && safeId(value?.resource_id) && safeId(value?.rule_id)
        && safeId(value?.result_id) && Number.isFinite(value?.amount)
        && value.amount > 0 && value.amount <= 1e6
        && typeof value?.transaction_id === 'string'
        && value.transaction_id.length > 0 && value.transaction_id.length <= 600,
    (value, working, context) => {
        if (context.internalResourceCost !== true) throw new Error('unauthorized_resource_cost');
        const ledger = working.getSession('resourceCostLedger') || [];
        if (!Array.isArray(ledger) || ledger.includes(value.transaction_id))
            throw new Error('duplicate_resource_cost');
        const balance = resourceBalance(working, value.actor_id, value.resource_id);
        if (balance < value.amount) throw new BlockedAction('insufficient_resource');
        if (value.actor_id === 'player') working.writeSession('playerStats', field => {
            field.value[value.resource_id] = balance - value.amount;
        });
        else working.writeEntity(value.actor_id, entity => {
            entity.state.resources[value.resource_id] = balance - value.amount;
        });
        working.writeSession('resourceCostLedger', field => {
            field.value = [...ledger, value.transaction_id];
        });
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
    const publicEffect = type => !registryApi.technicalEffects.get(type)?.internalOnly
        && (!capability || capability.names.includes(type));
    return { ...registry,
        has: type => publicEffect(type) && registry.has(type),
        types: () => registry.types().filter(publicEffect) };
}
function executeLinkedActions(plan, world, session, context = {}) {
    if (!plan || !Array.isArray(plan.actions)) throw new TypeError('invalid_linked_plan');
    if (world?.gameRules?.dynamicObjectDiscovery?.enabled === true
        && (plan.events || []).some(event => event.type === 'discovery' && !event.id)) {
        plan = { ...plan, events: (plan.events || []).map((event, index) =>
            event.type === 'discovery' && !event.id
                ? { ...event, id: `discovery_event_${session.turnCount || 1}_${index}` }
                : event) };
    }
    const working = context.workingState || workingApi.createWorkingState(world, session);
    expireCreatedItems(working);
    if (working.getSession('sceneItemSeeds'))
        seedAuthoredSceneItems(working, working.getSession('playerLocation'), session.id);
    // Authored consequences are optional World definition data. Keep generated
    // proof events local until the same Working State transaction commits.
    const authoredRules = world?.eventRules;
    if (authoredRules !== undefined) plan = { ...plan, events: copy(plan.events || []) };
    const capability = context.capability || registryApi.capabilities({
        protocol: 'scene_draft_v3', executionMode: 'linked',
        legacySchemas: Object.fromEntries((context.legacyEffectKeys || []).map(key =>
            [key, { type: 'array' }])) });
    const effects = createWorldEffectRegistry(context.legacyEffectKeys || [], capability);
    const facts = createFactRegistry();
    const outcomes = new Map();
    const blockedReasons = new Map();
    const checkResults = [];
    const events = [];
    const checkConfig = world?.gameRules?.universalChecks;
    try { if (checkConfig?.enabled === true)
        checkApi.validateRules(checkConfig, new Set(effects.types())); }
    catch (error) {
        working.rollback();
        return { ok: false, errors: [{ reason: error.message, stage: 'check_rule_validation' }],
            outcomes, verifiedEffects: [], verifiedEvents: [], confirmedEffects: [], checkResults: [] };
    }
    const checkRules = checkConfig?.enabled === true ? checkConfig.rules : [];
    const costCapability = checkRules.some(rule => rule.results.some(result => result.costs?.length))
        ? { ...capability,
            names: [...capability.names, 'resource_cost'],
            schemas: { ...capability.schemas,
                resource_cost: registryApi.technicalEffects.get('resource_cost').schema } }
        : null;
    const costActor = (rule, action) => {
        if (rule.actor !== 'event_actor') return 'player';
        const references = (plan.events || [])
            .filter(event => event.action_id === action.action_id && event.actor_id !== undefined)
            .map(event => event.actor_id);
        if (references.some(actor => !safeId(actor))) throw new Error('invalid_resource_actor');
        const actors = [...new Set(references)];
        if (actors.length !== 1) throw new Error('ambiguous_resource_actor');
        return actors[0];
    };
    const validateCostTarget = (rule, action) => {
        if (!rule.target) return;
        const references = rule.target === 'event_target'
            ? (plan.events || []).filter(event => event.action_id === action.action_id
                && event.target_id !== undefined).map(event => event.target_id)
            : [rule.target];
        if (references.some(target => !safeId(target)))
            throw new Error('invalid_resource_check_target');
        const targets = [...new Set(references)];
        if (targets.length !== 1 || targets[0] !== 'player'
            && !working.getEntity(targets[0]).definition)
            throw new Error('invalid_resource_check_target');
    };
    const preflightCosts = (rules, action) => {
        const actors = new Map();
        const required = new Map();
        for (const rule of rules.filter(item => item.results.some(result => result.costs?.length))) {
            const actor = costActor(rule, action);
            validateCostTarget(rule, action);
            actors.set(rule.id, actor);
            const maximum = new Map();
            for (const result of rule.results) for (const cost of result.costs || [])
                maximum.set(cost.resourceId, Math.max(maximum.get(cost.resourceId) || 0, cost.amount));
            for (const [resourceId, amount] of maximum) {
                const key = JSON.stringify([actor, resourceId]);
                required.set(key, (required.get(key) || 0) + amount);
            }
        }
        // P4.2 policy: reserve the highest possible cost for every matching rule.
        // This policy is local to this version; a later authored strategy can replace it.
        for (const [key, amount] of required) {
            const [actor, resourceId] = JSON.parse(key);
            if (resourceBalance(working, actor, resourceId) < amount)
                throw new BlockedAction('insufficient_resource');
        }
        return actors;
    };
    const checkRoll = (min, max, ruleId, actionSlot) => {
        const seed = `${world.id}|${session.id}|${session.turnCount || 1}|${actionSlot}|${ruleId}`;
        let hash = 2166136261;
        for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
        return min + (hash >>> 0) % (max - min + 1);
    };
    const dynamicDiscovery = new Map();
    const errors = [];
    // Only completed, structurally witnessed operations may survive a repair.
    // The reducer succeeding is deliberately insufficient: the action must
    // also have passed its guards, outcome check, event link and invariants.
    const verifiedEffects = [];
    const verifiedEvents = [];
    const confirmedEffects = [];
    const generatedProofIds = new Set();
    const firedRules = new Set();
    const ruleCauses = new Set();
    const eventMatchKeys = new Set(['type', 'actor_id', 'target_id', 'condition',
        'action', 'from_location_id', 'to_location_id', 'item', 'outfit', 'next_status']);
    const eventBinding = value => value && typeof value === 'object'
        && !Array.isArray(value) && Object.keys(value).length === 1
        && eventMatchKeys.has(value.event_field);
    const ruleValue = value => value !== null && ['string', 'number', 'boolean'].includes(typeof value)
        || eventBinding(value);
    const resolveRuleFields = (fields, cause) => Object.fromEntries(Object.entries(fields)
        .map(([key, value]) => {
            if (!eventBinding(value)) return [key, copy(value)];
            const resolved = cause[value.event_field];
            if (typeof resolved !== 'string' || !resolved)
                throw new Error('invalid_event_rule_binding');
            return [key, resolved];
        }));
    const validRule = rule => safeId(rule?.id) && rule.on
        && typeof rule.on === 'object' && !Array.isArray(rule.on)
        && Object.keys(rule.on).length > 1
        && typeof rule.on.type === 'string'
        && Object.entries(rule.on).every(([key, value]) => eventMatchKeys.has(key)
            && typeof value === 'string' && !!value)
        && Array.isArray(rule.when) && rule.when.length <= 8
        && rule.when.every(item => item && facts.names().includes(item.fact)
            && safeId(item.subject_id) && ['equals', 'not_equals', 'exists'].includes(item.operator)
            && (item.operator === 'exists' || typeof item.value === 'string')
            && (item.fact !== 'relation' || safeId(item.target_id)))
        && registryApi.technicalEffects.has(rule.effect?.type)
        && rule.effect.type !== 'event_emit'
        && rule.effect.payload && typeof rule.effect.payload === 'object'
        && !Array.isArray(rule.effect.payload)
        && Object.values(rule.effect.payload).every(ruleValue)
        && rule.result_event && typeof rule.result_event === 'object'
        && !Array.isArray(rule.result_event)
        && typeof rule.result_event.type === 'string'
        && (safeId(rule.result_event.actor_id) || eventBinding(rule.result_event.actor_id))
        && !['id', 'action_id', 'status', 'passage_id', 'evidence', 'cause', 'observation']
            .some(key => own(rule.result_event, key))
        && Object.keys(rule.result_event).every(key => eventMatchKeys.has(key))
        && Object.values(rule.result_event).every(ruleValue);
    if (authoredRules !== undefined && (!Array.isArray(authoredRules)
        || authoredRules.length > 16 || authoredRules.some(rule => !validRule(rule))
        || new Set(authoredRules.map(rule => rule.id)).size !== authoredRules.length
        || authoredRules.length && context.onEvent)) {
        working.rollback();
        return { ok: false, errors: [{ reason: 'invalid_event_rules', stage: 'event_rule_validation' }],
            outcomes, verifiedEffects: [], verifiedEvents: [], confirmedEffects: [] };
    }
    const eventTypes = { actor_move: ['movement'], npc_follow: ['escort'],
        npc_goal_set: ['quest'],
        interactable_transition: ['environment'],
        item_transfer: ['inventory'], item_consume: ['inventory'],
        item_introduce: ['discovery', 'inventory'],
        entity_introduce: ['environment'], location_introduce: ['environment'],
        condition_change: ['condition'], relation_set: ['relationship'],
        event_emit: null, time_advance: ['time'], time_skip_minutes: ['time'],
        outfit_set: ['outfit'] };
    const witnessed = (operation, actionEvents, moves = []) => actionEvents.some(event => {
        if (event.status !== 'completed') return false;
        if (operation.type === 'actor_move' && operation.payload?.mode === 'journey')
            return event.type === 'activity' && event.actor_id === operation.payload.actor_id
                && event.to_location_id === operation.payload.to_location_id
                && (operation.payload.explore !== true || event.explore === true);
        const types = eventTypes[operation.type]
            || registryApi.technicalEffects.get(operation.type)?.eventTypes;
        if (!Object.hasOwn(eventTypes, operation.type) && !types) return false;
        if (types && !types.includes(event.type)) return false;
        if (operation.type === 'event_emit' && event.type !== operation.payload?.type) return false;
        const actor = operation.payload?.actor_id || operation.payload?.subject_id
            || (operation.type === 'condition_change' ? operation.payload?.target_id : '');
        if (actor && event.actor_id !== actor
            && !(operation.payload?.companion_ids || []).includes(event.actor_id)) return false;
        if (operation.type === 'knowledge_share'
            && (event.target_id !== operation.payload?.recipient_id
                || event.action !== 'report')) return false;
        if (['interactable_transition', 'relation_set'].includes(operation.type)
            && event.target_id !== operation.payload?.target_id) return false;
        if (operation.type === 'npc_follow'
            && (event.target_id !== 'player'
                || event.action !== (operation.payload.following ? 'join' : 'leave'))) return false;
        if (operation.type === 'npc_goal_set' && event.action !== 'accept') return false;
        if (operation.type === 'outfit_set' && event.outfit !== operation.payload?.outfit) return false;
        if (operation.type === 'condition_change'
            && (event.condition !== operation.payload?.condition
                || event.action !== operation.payload?.action)) return false;
        if (['item_transfer', 'item_consume'].includes(operation.type)
            && ![itemKey(operation.payload?.item_id), itemKey(working.getEntity(
                operation.payload?.item_id).definition?.name)].includes(itemKey(event.item))) return false;
        if (operation.type === 'item_consume' && event.action !== 'consume') return false;
        if (operation.type === 'item_introduce'
            && (event.target_id !== operation.payload?.id
                || itemKey(event.item) !== itemKey(operation.payload?.name))) return false;
        if (['time_advance', 'time_skip_minutes'].includes(operation.type)
            && event.minutes_elapsed !== undefined
            && event.minutes_elapsed !== (operation.payload?.minutes || operation.payload)) return false;
        if (operation.type === 'actor_move'
            && ((operation.payload?.mode === 'teleport'
                && (event.movement_mode !== 'teleport' || !String(event.cause || '').trim()))
                || (operation.payload?.explore === true && event.explore !== true)
                || event.to_location_id !== operation.payload?.to_location_id
                || !event.from_location_id
                || !moves.some(move => move.actor === event.actor_id
                    && move.from === event.from_location_id
                    && move.to === event.to_location_id))) return false;
        return true;
    });
    const applyAuthoredRules = (cause, state, actionId) => {
        const next = [];
        for (const rule of authoredRules || []) {
            if (!Object.entries(rule.on).every(([key, value]) => cause[key] === value)) continue;
            for (const condition of rule.when) {
                const factions = state.getSession('factions') || state.getWorld('factions') || [];
                const actor = id => id === 'player'
                    || state.getEntity(id).definition?.type === 'npc';
                const faction = id => factions.some(item => item.id === id);
                const known = condition.fact === 'interactable_state'
                    ? !!state.getEntity(condition.subject_id).definition
                    : condition.fact === 'relation'
                        ? actor(condition.subject_id) || faction(condition.subject_id)
                        : actor(condition.subject_id);
                if (!known || condition.fact === 'relation'
                    && !actor(condition.target_id) && !faction(condition.target_id))
                    throw new Error('unknown_event_rule_reference');
            }
            if (rule.when.some(condition => !facts.test(condition, state))) continue;
            const firing = `${actionId}:${cause.id}:${rule.id}`;
            if (firedRules.has(firing)) throw new Error('duplicate_event_rule_trigger');
            firedRules.add(firing);
            ruleCauses.add(`${actionId}:${cause.id}`);
            const id = `${cause.id}_${rule.id}`;
            if (!safeId(id) || plan.events.some(event => event.id === id))
                throw new Error('invalid_event_rule_result_id');
            plan.events.push({ ...resolveRuleFields(rule.result_event, cause), id,
                action_id: actionId, status: 'completed' });
            generatedProofIds.add(id);
            next.push({ type: rule.effect.type,
                payload: resolveRuleFields(rule.effect.payload, cause),
                proof_event_id: id });
        }
        return next;
    };
    const turnTimeBudget = { remaining: Math.max(0, Number(context.includedTurnMinutes) || 0) };
    const travelSpent = new Map();
    let actionSlot = 0;
    for (const action of plan.actions) {
        actionSlot++;
        const guards = action.depends_on || [];
        if (guards.some(guard => outcomes.get(guard.action_id) !== guard.outcome)) {
            outcomes.set(action.action_id, 'skipped');
            continue;
        }
        if (action.action_effects?.actor_move?.length
            && typeof context.syncClockEffects === 'function') {
            try { context.syncClockEffects(working); }
            catch (error) {
                working.rollback();
                return { ok: false, errors: [{ action_id: action.action_id,
                    reason: error.message, stage: 'movement_clock_sync' }],
                outcomes, verifiedEffects: [], verifiedEvents: [] };
            }
        }
        const point = working.savepoint();
        const includedTimeAtStart = turnTimeBudget.remaining;
        const travelSpentAtStart = new Map(travelSpent);
        let appliedOperations = [];
        let executedOperations = [];
        let actionMoves = [];
        try {
            if ((action.state_conditions || []).some(condition => !facts.test(condition, working)))
                throw new BlockedAction('state_condition_not_met');
            // A model may propose a discovery, but only this engine-owned gate
            // can authorize its existence. Run it only for an actual proposal.
            if (world?.gameRules?.dynamicObjectDiscovery?.enabled === true) {
                const introductions = action.action_effects?.item_introduce || [];
                for (const value of introductions) {
                    if ((value.cause || 'discovery') !== 'discovery' || value.rule_id) continue;
                    const place = working.getLocation(value.location_id).definition;
                    const mentionedContainers = working.getEntitiesByFilter(entity =>
                        entity.definition?.interactable
                        && (entity.state?.location || entity.definition?.locationId
                            || entity.definition?.startLocation) === value.location_id
                        && itemKey(action.request || '').includes(itemKey(entity.definition.name)))
                        .map(entity => entity.definition.id);
                    const containerMismatch = mentionedContainers.length === 1
                        && value.container_id !== mentionedContainers[0];
                    const authored = (place?.discoverableItems || []).some(item =>
                        itemKey(typeof item === 'string' ? item : item?.name) === itemKey(value.name))
                        || (place?.discoveryPolicy?.ordinaryCategories || []).includes(value.category);
                    if (authored && !containerMismatch) continue;
                    const actor = value.actor_id || 'player';
                    const result = containerMismatch ? { type: 'blocked', reason: 'container_scope_mismatch' }
                        : discoveryApi.resolveDynamicObjectDiscovery({
                        request: { ...value, properties: value.properties || {} }, actor,
                        location: place, container: value.container_id ? { id: value.container_id } : null,
                        worldRules: world.gameRules, world, workingState: working,
                        roll: (min, max, ruleId) => checkRoll(min, max, ruleId, actionSlot),
                        evaluateCheck: (rule, checkActor, roll) => checkApi.evaluate(rule,
                            { action_id: action.action_id, kind: 'observation', request: action.request },
                            [{ action_id: action.action_id, actor_id: checkActor }], working, roll)
                    });
                    if (result.check && !result.repeated) checkResults.push({ ...result.check,
                        action_slot: actionSlot, search_scope_id: value.container_id || value.location_id,
                        search_object: value.name, check_type: 'existence' });
                    if (result.type === 'existing') {
                        action.action_effects.item_introduce = (action.action_effects.item_introduce || [])
                            .filter(entry => entry.id !== value.id);
                        if (!action.action_effects.item_introduce.length)
                            delete action.action_effects.item_introduce;
                        for (const transfer of action.action_effects.item_transfer || [])
                            if (transfer.item_id === value.id) transfer.item_id = result.objectId;
                        plan.events = plan.events.filter(event => event.action_id !== action.action_id
                            || event.type !== 'discovery');
                        const passage = plan.narrative?.find(item => item.id === action.response_id);
                        if (passage) passage.text = /[äöüß]|\b(?:ich|suche|durchsuche|nach)\b/i
                            .test(action.request || '')
                            ? `Der vorhandene Gegenstand ist hier: ${value.name}.`
                            : `The existing ${value.name} is here.`;
                    } else if (result.type === 'success') {
                        dynamicDiscovery.set(value.id, result);
                        const passage = plan.narrative?.find(item => item.id === action.response_id);
                        if (passage && /^(?:You search the (?:container|area)\.|Du (?:durchsuchst den Behälter|suchst in der Umgebung)\.)$/.test(passage.text))
                            passage.text = /[äöüß]|\b(?:ich|suche|durchsuche|nach)\b/i
                                .test(action.request || '')
                                ? `Du findest den gesuchten Gegenstand: ${value.name}.`
                                : `You find ${/^[aeiou]/i.test(value.name) ? 'an' : 'a'} ${value.name}.`;
                        if (passage && /^(?:You reach for the object\.|Du greifst nach dem Gegenstand\.)$/.test(passage.text))
                            passage.text = /[äöüß]|\b(?:ich|nehme|nimm)\b/i.test(action.request || '')
                                ? `Du nimmst ${value.name} mit.`
                                : `You take the ${value.name}.`;
                    }
                    else {
                        // The search itself is valid. Replace the model's
                        // speculative success before receipt validation.
                        action.status = 'attempted';
                        action.action_effects = {};
                        plan.events = plan.events.filter(event => event.action_id !== action.action_id
                            || event.status !== 'completed');
                        const passage = plan.narrative?.find(item => item.id === action.response_id);
                        if (passage) passage.text = /[äöüß]|\b(?:ich|suche|durchsuche|nach)\b/i
                            .test(action.request || '')
                            ? 'Die Suche bringt keinen bestätigten neuen Gegenstand hervor.'
                            : 'The search reveals no confirmed new object.';
                        break;
                    }
                }
            }
            const matchingRules = checkRules.filter(rule => checkApi.matches(rule, action));
            const costActors = preflightCosts(matchingRules, action);
            const actionChecks = matchingRules
                .map(rule => ({ ...checkApi.evaluate(rule, action, plan.events, working,
                    (min, max, ruleId) => checkRoll(min, max, ruleId, actionSlot)), action_slot: actionSlot }));
            const costEvents = [];
            const costEffects = [];
            const applyCheckCosts = () => {
                for (const [checkIndex, check] of actionChecks.entries()) {
                    if (!check.costs?.length) continue;
                    const actor = costActors.get(check.rule_id);
                    if (!actor || actor !== check.actor_id) throw new Error('resource_actor_mismatch');
                    for (const [costIndex, cost] of check.costs.entries()) {
                        const eventId = `resource_cost_${Number(session.turnCount) || 1}_${
                            actionSlot}_${checkIndex}_${costIndex}`;
                        if ((plan.events || []).some(event => event.id === eventId)
                            || events.some(event => event.id === eventId))
                            throw new Error('duplicate_resource_cost_event');
                        const transactionId = JSON.stringify([world.id, session.id,
                            context.turnId || session.turnCount || 1, actionSlot,
                            check.rule_id, actor, cost.resourceId]);
                        const payload = { actor_id: actor, resource_id: cost.resourceId,
                            amount: cost.amount, rule_id: check.rule_id,
                            result_id: check.result_id, transaction_id: transactionId };
                        const applied = effects.run([{ type: 'resource_cost', payload }], working,
                            { ...context, capability: costCapability, internalResourceCost: true,
                                protocol: capability.protocol, executionMode: capability.executionMode,
                                actionId: action.action_id });
                        if (applied.changes[0] !== true) throw new Error('resource_cost_not_applied');
                        costEvents.push({ id: eventId, type: 'resource_cost',
                            action_id: action.action_id, passage_id: action.response_id || null,
                            actor_id: actor, status: 'completed', resource_id: cost.resourceId,
                            amount: cost.amount, rule_id: check.rule_id,
                            result_id: check.result_id, cause: 'confirmed_universal_check' });
                        costEffects.push({ action_id: action.action_id, source: 'rule',
                            type: 'resource_cost', payload: copy(payload), origin: 'engine',
                            result: 'changed' });
                        check.cost_changes ||= [];
                        check.cost_changes.push({ actor_id: actor, resource_id: cost.resourceId,
                            amount: cost.amount, event_id: eventId });
                    }
                }
            };
            const recordCheckCosts = () => {
                const firstIndex = events.length;
                events.push(...costEvents);
                confirmedEffects.push(...costEffects.map((effect, index) =>
                    ({ ...effect, event_indices: [firstIndex + index] })));
            };
            const expectedCheckStatus = actionChecks.some(check => check.kind === 'blocked') ? 'blocked'
                : actionChecks.some(check => check.kind === 'failure') ? 'attempted' : null;
            if (expectedCheckStatus && action.status !== expectedCheckStatus
                || !expectedCheckStatus && actionChecks.length
                    && !['resolved', 'answered'].includes(action.status))
                throw new Error('check_outcome_status_mismatch');
            if (expectedCheckStatus && Object.values(action.action_effects || {})
                .some(value => Array.isArray(value) ? value.length : !!value))
                throw new Error('check_outcome_has_effects');
            if (expectedCheckStatus && plan.events.some(event => event.action_id === action.action_id
                && event.status === 'completed')) throw new Error('check_outcome_has_completed_event');
            checkResults.push(...actionChecks);
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
                if (plan.events.some(event => event.action_id === action.action_id
                    && event.status === 'completed'
                    && (['movement', 'inventory', 'outfit', 'condition', 'relationship',
                        'time', 'status', 'escort', 'environment'].includes(event.type)
                        || event.type === 'interaction' && event.actor_id === 'player')))
                    throw new Error('failed_action_has_completed_event');
                applyCheckCosts();
                recordCheckCosts();
                outcomes.set(action.action_id, 'failed');
                continue;
            }
            if (action.status === 'blocked' && !Object.keys(action.action_effects || {}).length) {
                if (expectedCheckStatus === 'blocked') { outcomes.set(action.action_id, 'blocked'); continue; }
                throw new Error('unverified_blockage');
            }
            const operations = Object.entries(action.action_effects || {}).flatMap(([type, values]) => {
                if (type === 'resource_cost') throw new Error('unauthorized_resource_cost');
                if ((context.legacyEffectKeys || []).includes(type)
                    && !registryApi.technicalEffects.has(type))
                    return [{ type, payload: values }];
                if (!Array.isArray(values)) throw new Error(`invalid_effect_list:${type}`);
                return values.map(payload => ({ type, payload }));
            }).sort((a, b) => a.type === 'item_introduce' && b.type === 'item_transfer'
                ? -1 : a.type === 'item_transfer' && b.type === 'item_introduce' ? 1 : 0);
            if (actionChecks.length) {
                const denied = operations.find(operation => actionChecks.some(check =>
                    !check.allowed_effects.includes(operation.type)));
                if (denied) {
                    const error = new Error('check_effect_not_allowed');
                    error.checkDetail = {
                        rejected_effect: denied.type,
                        check_rules: actionChecks.map(check => ({ rule_id: check.rule_id,
                            result_id: check.result_id, kind: check.kind,
                            allowed_effects: check.allowed_effects }))
                    };
                    throw error;
                }
            }
            for (const operation of operations) if (['resolved', 'answered'].includes(action.status)
                && operation.type === 'actor_move'
                && ['journey', 'teleport'].includes(operation.payload?.mode)) {
                const direct = operation.payload.mode === 'teleport';
                const supported = (plan.events || []).some(event => event.action_id === action.action_id
                    && event.actor_id === operation.payload.actor_id
                    && event.to_location_id === operation.payload.to_location_id
                    && event.status === 'completed'
                    && (operation.payload.explore !== true || event.explore === true)
                    && (direct ? event.type === 'movement' && event.movement_mode === 'teleport'
                        && !!String(event.cause || '').trim() : event.type === 'activity'));
                if (!supported) throw new Error(direct ? 'unverified_direct_move' : 'unverified_journey_start');
            }
            const moveTransitions = [], predictedLocations = new Map();
            for (const operation of operations) if (operation.type === 'actor_move'
                && operation.payload?.mode !== 'journey') {
                const companions = new Set(operation.payload.companion_ids || []);
                const origin = predictedLocations.get(operation.payload.actor_id)
                    || actorAt(working, operation.payload.actor_id);
                if (operation.payload.actor_id === 'player')
                    for (const follower of working.getEntitiesByFilter(entity =>
                        entity.state?.followingPlayer === true
                        && (predictedLocations.get(entity.definition.id)
                            || entity.state.location) === origin)) companions.add(follower.definition.id);
                for (const actor of [operation.payload.actor_id, ...companions]) {
                    const from = predictedLocations.has(actor) ? predictedLocations.get(actor)
                        : actor === 'player' ? working.getSession('playerLocation')
                            : working.getEntity(actor).state?.location
                                || (operation.payload?.mode === 'teleport'
                                    ? working.getEntity(actor).state?.journey?.path?.[
                                        working.getEntity(actor).state?.journey?.progressIndex || 0]
                                        || working.getEntity(actor).state?.journey?.originId : null);
                    moveTransitions.push({ actor, from, to: operation.payload.to_location_id });
                    predictedLocations.set(actor, operation.payload.to_location_id);
                }
            }
            actionMoves = moveTransitions;
            const proposedEvents = plan.events.filter(event => event.action_id === action.action_id);
            if (action.status !== 'blocked'
                && (context.requireEffectWitnesses === true || !!action.response_id)
                && moveTransitions.some(move => !proposedEvents.some(event =>
                    event.type === 'movement' && event.status === 'completed'
                    && event.actor_id === move.actor
                    && event.from_location_id === move.from
                    && event.to_location_id === move.to))) {
                const error = new Error('unwitnessed_companion_or_actor_move');
                error.movementDiagnostic = {
                    proposedMoves: moveTransitions.slice(0, 12),
                    proposedEvents: proposedEvents.filter(event => event.type === 'movement')
                        .slice(0, 12).map(event => ({ id: event.id, actor_id: event.actor_id,
                            from_location_id: event.from_location_id,
                            to_location_id: event.to_location_id, status: event.status })),
                    missingWitnesses: moveTransitions.filter(move => !proposedEvents.some(event =>
                        event.type === 'movement' && event.status === 'completed'
                        && event.actor_id === move.actor && event.from_location_id === move.from
                        && event.to_location_id === move.to)).slice(0, 12)
                };
                throw error;
            }
            applyCheckCosts();
            const applied = effects.run(operations, working, { ...context, capability, turnTimeBudget,
                dynamicDiscovery,
                actionOperations: operations,
                travelSpent,
                actionEvents: plan.events.filter(event => event.action_id === action.action_id),
                actionSpeech: (plan.speech || []).filter(speech => speech.action_id === action.action_id),
                actionPassages: (plan.narrative || []).filter(passage => passage.action_id === action.action_id),
                consumedRelationEvents: new Set(),
                protocol: capability.protocol, executionMode: capability.executionMode,
                actionId: action.action_id, sessionId: session.id,
                onEvent: authoredRules?.length ? (emitted, state) => {
                    const causes = proposedEvents.filter(event => event.action_id === action.action_id
                        && event.id === emitted.id && event.type === emitted.type
                        && event.status === 'completed');
                    if (causes.length !== 1) throw new Error('unwitnessed_event_rule_cause');
                    return applyAuthoredRules(causes[0], state, action.action_id);
                } : context.onEvent });
            executedOperations = applied.applied.map((operation, index) => ({
                ...copy(operation), origin: index < operations.length ? 'proposal' : 'reducer',
                result: applied.changes[index] ? 'changed' : 'no_change',
                parentIndex: applied.parents[index] }));
            if (authoredRules?.length) {
                for (const cause of proposedEvents.filter(event => event.status === 'completed'
                    && authoredRules.some(rule => Object.entries(rule.on).every(([key, value]) =>
                        event[key] === value))
                    && !ruleCauses.has(`${action.action_id}:${event.id}`))) {
                    const parents = executedOperations.flatMap((operation, index) =>
                        operation.origin === 'proposal' && operation.type !== 'event_emit'
                        && operation.result === 'changed'
                        && witnessed(operation, [cause], moveTransitions) ? [index] : []);
                    if (!safeId(cause.id) || proposedEvents.filter(event => event.id === cause.id).length !== 1
                        || parents.length !== 1) throw new Error('unverified_event_rule_cause');
                    const generated = applyAuthoredRules(cause, working, action.action_id);
                    if (!generated.length) continue;
                    const follow = effects.run(generated, working, { ...context, capability,
                        turnTimeBudget, travelSpent, protocol: capability.protocol,
                        executionMode: capability.executionMode, actionId: action.action_id,
                        sessionId: session.id, onEvent: undefined });
                    const offset = executedOperations.length;
                    executedOperations.push(...follow.applied.map((operation, index) => ({
                        ...copy(operation), origin: 'reducer',
                        result: follow.changes[index] ? 'changed' : 'no_change',
                        parentIndex: follow.parents[index] === null ? parents[0]
                            : offset + follow.parents[index] })));
                }
            }
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
                const witnessedLocalActivity = responseLinked && completed.some(event =>
                    event.type === 'activity' && event.actor_id === 'player'
                    && event.passage_id === action.response_id
                    && !!String(event.activity || '').trim());
                const proved = action.kind === 'travel'
                    ? executed.some(effect => effect.type === 'actor_move'
                        && (effect.payload.actor_id === 'player'
                            || (effect.payload.companion_ids || []).includes('player')))
                    : action.kind === 'wait'
                        ? executed.some(effect => ['time_advance', 'time_skip_minutes'].includes(effect.type))
                        : action.kind === 'physical'
                            ? physicalEffect || witnessedInteraction || witnessedLocalActivity
                            : stateEffect || ['speech', 'question', 'observation', 'other']
                                .includes(action.kind) && responseLinked;
                if (!proved) throw new Error('unverified_action_success');
            }
            outcomes.set(action.action_id, 'succeeded');
            for (const [eventIndex, event] of plan.events.entries()) {
                if (event.action_id !== action.action_id) continue;
                if (event.status === 'completed') {
                    const knownActor = event.actor_id === 'player'
                        || working.getEntity(event.actor_id).definition
                        || event.type === 'relationship'
                            && (working.getSession('factions') || working.getWorld('factions') || [])
                                .some(faction => faction.id === event.actor_id);
                    if (!knownActor) throw new Error('unknown_event_actor');
                    const requiredEffects = {
                        movement: ['actor_move'],
                        inventory: ['item_transfer', 'item_consume', 'item_introduce',
                            'inventory_add', 'inventory_remove'],
                        outfit: ['outfit_set'],
                        condition: ['condition_change', 'player_condition_updates'],
                        relationship: ['relation_set', 'npc_relationship_updates'],
                        time: ['time_advance', 'time_skip_minutes'],
                        status: ['npc_status_changes'], escort: ['npc_follow']
                    }[event.type];
                    if (requiredEffects && !executedOperations.some(operation =>
                        requiredEffects.includes(operation.type))) {
                        const error = new Error('uncommitted_completed_event');
                        Object.assign(error, { effect: event.type, event_index: eventIndex,
                            requiredEffects, stage: 'event_effect_consistency',
                            cause: `Completed ${event.type} event has no matching executed effect.` });
                        throw error;
                    }
                    if (event.type === 'movement' && !moveTransitions.some(move =>
                        move.actor === event.actor_id && move.to === event.to_location_id))
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
            for (const event of actionEvents.filter(item =>
                ruleCauses.has(`${action.action_id}:${item.id}`))) {
                if (!executedOperations.some(operation => operation.origin === 'proposal'
                    && operation.type !== 'event_emit' && operation.result === 'changed'
                    && witnessed(operation, [event], moveTransitions)))
                    throw new Error('unverified_event_rule_cause');
            }
            const confirmedFollowUps = new Set();
            for (const operation of executedOperations.filter(effect => effect.origin === 'reducer')) {
                const parent = executedOperations[operation.parentIndex];
                const parentProofs = actionEvents.filter(event => String(event.id || '').trim()
                    && witnessed(parent, [event], moveTransitions)
                    && (parent.type !== 'event_emit' || event.id === parent.payload?.id));
                if (parentProofs.length !== 1 || actionEvents.filter(event =>
                    event.id === parentProofs[0]?.id).length !== 1) {
                    const error = new Error('unwitnessed_follow_up_cause');
                    error.effect = operation.type;
                    throw error;
                }
                const causeId = parentProofs[0].id;
                const proofs = actionEvents.filter(event => String(event.id || '').trim()
                    && event.id !== causeId && witnessed(operation, [event], moveTransitions));
                const relevantProofs = operation.proof_event_id
                    ? proofs.filter(event => event.id === operation.proof_event_id) : proofs;
                if (relevantProofs.length !== 1 || actionEvents.filter(event =>
                    event.id === relevantProofs[0]?.id).length !== 1) {
                    const error = new Error('unwitnessed_follow_up_effect');
                    error.effect = operation.type;
                    throw error;
                }
                operation.cause_event_id = causeId;
                operation.proof_event_id = relevantProofs[0].id;
                if (generatedProofIds.has(operation.proof_event_id)
                    && operation.result !== 'changed')
                    throw new Error('unconfirmed_event_rule_effect');
                const signature = JSON.stringify([causeId, operation.type, operation.payload]);
                if (confirmedFollowUps.has(signature)) {
                    const error = new Error('duplicate_follow_up_effect');
                    error.effect = operation.type;
                    throw error;
                }
                confirmedFollowUps.add(signature);
            }
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
            recordCheckCosts();
        } catch (error) {
            working.restore(point);
            turnTimeBudget.remaining = includedTimeAtStart;
            travelSpent.clear();
            for (const [actor, minutes] of travelSpentAtStart) travelSpent.set(actor, minutes);
            if (error instanceof BlockedAction) {
                outcomes.set(action.action_id, 'blocked');
                blockedReasons.set(action.action_id, error.message);
            }
            else { errors.push({ action_id: action.action_id, reason: error.code || error.message,
                code: error.code || error.message, effect: error.effect || '',
                ...(error.movementDiagnostic || {}),
                ...(error.checkDetail || {}),
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
                proposed, actual, ...(blockedReasons.has(action.action_id)
                    ? { cause: blockedReasons.get(action.action_id) } : {}) });
            break;
        }
        if (actual === 'succeeded') verifiedEvents.push(...plan.events
            .filter(event => event.action_id === action.action_id && event.status === 'completed')
            .map(copy));
        if (actual === 'succeeded') for (const operation of executedOperations) {
            const eventIndices = events.flatMap((event, index) => event.action_id === action.action_id
                && (operation.origin !== 'reducer' || event.id === operation.proof_event_id)
                && witnessed(operation, [event], actionMoves) ? [index] : []);
            confirmedEffects.push({ action_id: action.action_id,
                source: (context.worldActionIds || []).includes(action.action_id) ? 'reaction' : 'player',
                type: operation.type, payload: copy(operation.payload), origin: operation.origin,
                result: operation.result, event_indices: eventIndices,
                ...(operation.cause_event_id ? { cause_event_id: operation.cause_event_id } : {}) });
        }
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
        verifiedEffects, verifiedEvents, confirmedEffects: [] }; }
    try {
        workingApi.assertWorldModelInvariants(world, session, working.prepare());
    } catch (error) {
        working.rollback();
        return { ok: false, errors: [{ code: 'world_invariant_violation',
            reason: error.message, protocol: capability.protocol,
            executionMode: capability.executionMode, available: capability.names,
            source: 'worlds/working-state.js', stage: 'post_action_invariants',
        cause: error.message }], outcomes, verifiedEffects: [], verifiedEvents: [], confirmedEffects: [] };
    }
    const visiblePassages = (plan.narrative || []).filter(passage =>
        !passage.action_id || outcomes.get(passage.action_id) !== 'skipped');
    return { ok: true, working, outcomes, blockedReasons, events,
        verifiedEffects, verifiedEvents, confirmedEffects,
        checkResults: checkResults.map(check => ({ ...check,
            effect_types: confirmedEffects.filter(effect => effect.action_id === check.action_id)
                .map(effect => effect.type),
            event_ids: events.filter(event => event.action_id === check.action_id)
                .map(event => event.id).filter(Boolean) })),
        narrative: visiblePassages.map(passage => passage.text).join('\n\n'),
        skipped: [...outcomes].filter(([, result]) => result === 'skipped').map(([id]) => id) };
}
const api = { createFactRegistry, createWorldEffectRegistry, executeLinkedActions, BlockedAction };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.HordeLinkedWorldActions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
