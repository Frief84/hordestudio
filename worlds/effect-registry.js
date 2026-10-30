/* Typed operation dispatcher. Reducers receive only workingState, never the
 * canonical World or session. Emitted effects share the receipt transaction. */
(function (root) {
'use strict';
const MAX_FOLLOW_UP_EFFECTS = 16;
const clone = value => structuredClone(value);
const field = (description, maxLength = 120) => ({ type: 'string', description, maxLength });
const list = items => ({ type: 'array', items, maxItems: 32 });
const shape = (properties, required = Object.keys(properties)) =>
    ({ type: 'object', properties, required, additionalProperties: false });
// The schema and runtime binding for every native technical effect live here.
// A provider may transform this schema for transport, but cannot change the
// logical capability set used by compilation and execution.
const technicalEffects = new Map(Object.entries({
    actor_move: list(shape({ actor_id: field('Exact actor ID.'),
        to_location_id: field('Exact mapped destination ID; one adjacent leg for completed movement.'),
        mode: { type: 'string', enum: ['journey', 'teleport'] },
        explore: { type: 'boolean' },
        companion_ids: list(field('Exact accompanying actor ID.')) },
    ['actor_id', 'to_location_id'])),
    npc_follow: list(shape({ actor_id: field('Exact consenting NPC ID.'),
        following: { type: 'boolean', description: 'True after an explicit NPC agreement to accompany the player; false when that NPC leaves.' } },
    ['actor_id', 'following'])),
    npc_goal_set: list(shape({ actor_id: field('Exact accepting NPC ID.'),
        goal: field('Concrete accepted NPC objective.', 200) }, ['actor_id', 'goal'])),
    interactable_transition: list(shape({ target_id: field('Exact object or door ID.'),
        to_state: field('Authored target state.', 80),
        actor_id: field('Exact acting player or NPC ID; defaults to player.') },
    ['target_id', 'to_state'])),
    item_transfer: list(shape({ item_id: field('Exact item ID or owned item name.'),
        from_id: field('Exact actor or location ID.'), to_id: field('Exact actor or location ID.'),
        actor_id: field('Exact acting player or NPC ID; defaults to player.'),
        container_id: field('Exact container ID when placing an item inside it.'),
        quantity: { type: 'integer', minimum: 1, maximum: 100 } },
    ['item_id', 'from_id', 'to_id'])),
    item_consume: list(shape({ item_id: field('Exact owned item ID or name.'),
        actor_id: field('Exact owning actor ID.'),
        quantity: { type: 'integer', minimum: 1, maximum: 100 } },
    ['item_id', 'actor_id'])),
    item_introduce: list(shape({ id: field('New stable item ID.'), name: field('Item name.', 160),
        location_id: field('Exact present location ID.'), description: field('Short description.', 500),
        container_id: field('Exact existing container ID when the object is found inside it.'),
        quantity: { type: 'integer', minimum: 1, maximum: 100 },
        actor_id: field('Exact creating or discovering actor ID.'),
        cause: { type: 'string', enum: ['discovery', 'crafting', 'conjuration', 'transmutation', 'replication'] },
        category: field('Authored ordinary discovery category.'),
        rule_id: field('Exact authored item creation rule ID.'),
        source_item_id: field('Exact owned input item ID or name.'),
        duration_minutes: { type: 'integer', minimum: 1, maximum: 10080 } },
    ['id', 'name', 'location_id'])),
    entity_introduce: list(shape({ id: field('New stable NPC ID.'), name: field('NPC name.', 160),
        location_id: field('Exact present location ID.'), persona: field('NPC persona.', 500) })),
    location_introduce: list(shape({ id: field('New stable location ID.'),
        name: field('Location name.', 160), connects_to: field('Exact existing location ID.'),
        description: field('Location description.', 500) }, ['id', 'name', 'connects_to'])),
    condition_change: list(shape({ target_id: field('Exact actor ID.'),
        condition: field('Named lasting condition.', 160),
        action: { type: 'string', enum: ['add', 'remove'] } })),
    relation_set: list(shape({ subject_id: field('Exact actor or faction ID.'),
        target_id: field('Exact actor or faction ID.'),
        value: { type: 'integer', minimum: -100, maximum: 100 } })),
    event_emit: list(shape({ id: field('Stable event ID.'), type: field('Registered event type.', 80),
        description: field('Observed event.', 500) })),
    knowledge_share: list(shape({ actor_id: field('Exact NPC sender ID.'),
        recipient_id: field('Exact NPC recipient ID.'),
        observation_id: field('Exact ID of a shareable observation owned by the sender.') })),
    time_advance: list(shape({ minutes: { type: 'integer', minimum: 1, maximum: 10080 } })),
    outfit_set: list(shape({ actor_id: field('Exact actor ID.'),
        outfit: field('Complete resulting outfit.', 500) })),
    resource_cost: list(shape({ actor_id: field('Exact acting player or NPC ID.'),
        resource_id: field('Exact world-defined resource ID.'),
        amount: { type: 'number', minimum: 0, maximum: 1000000 },
        rule_id: field('Exact universal check rule ID.'),
        result_id: field('Exact confirmed check result ID.'),
        transaction_id: field('Stable cost transaction ID.', 600) }))
}).map(([name, schema]) => [name, { name, schema, protocols: ['scene_draft_v3'],
    executionModes: ['linked'], operation: name,
    internalOnly: name === 'resource_cost' }]));
// NPC candidates are explicit, local and opt-in. The ordinary reducer still
// validates ownership and commits the effect against the current working state.
technicalEffects.get('item_consume').npcAction = {
    options: ({ npc, world, session }) => (session.entityStates?.[npc.id]?.inventory || [])
        .map(entry => world.entities?.find(item => item.type === 'item'
            && (item.id === (typeof entry === 'string' ? entry : entry.id)
                || item.name === (typeof entry === 'string' ? entry : entry.name))))
        .filter(item => item?.properties?.npcConsumable === true)
        .map(item => ({ label: `consume ${item.name || item.id}`,
            targetId: item.id, payload: { actor_id: npc.id, item_id: item.id,
                quantity: 1 }, prerequisites: ['owned', 'npc_consumable'] })),
    event: ({ step }) => ({ type: 'inventory', action: 'consume',
        item: step.effect.payload.item_id })
};
technicalEffects.get('item_introduce').npcAction = {
    options: ({ npc, world, session, locationId }) => {
        if (world.gameRules?.dynamicObjectDiscovery?.enabled !== true) return [];
        const goal = String(session.entityStates?.[npc.id]?.goal || '');
        const match = goal.match(/\b(?:find|search for|look for|suche nach|finde|suche)\s+(?:a|an|the|eine|einen|ein|der|die|das)?\s*([\p{L}\p{N} -]{3,80})/iu);
        if (!match) return [];
        const name = match[1].replace(/\s+(?:in|inside|from|im|in der|aus)\s+.*$/iu, '').trim();
        if (!name || name.split(/\s+/).length > 5) return [];
        const local = (world.entities || []).filter(item => item.interactable
            && (session.entityStates?.[item.id]?.location || item.locationId
                || item.startLocation) === locationId
            && ['open', 'removed', 'cleared', 'broken'].includes(
                session.entityStates?.[item.id]?.interactableState
                || item.interactable.initialState));
        if (local.length !== 1) return [];
        const container = local[0];
        const slug = name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '').slice(0, 40) || 'object';
        const id = `discovery_${locationId}_${slug}_${session.turnCount || 1}`.slice(0, 119);
        return [{ label: `search ${container.name || container.id} for ${name}`,
            targetId: container.id, payload: { id, name, actor_id: npc.id,
                location_id: locationId, container_id: container.id, cause: 'discovery' },
            prerequisites: ['grounded_context', 'open_container', 'universal_check'] }];
    },
    event: ({ step }) => ({ type: 'discovery', target_id: step.effect.payload.id,
        item: step.effect.payload.name }),
    satisfied: ({ step, world }) => world.entities?.some(item =>
        item.id === step.effect.payload.id)
};
technicalEffects.get('knowledge_share').npcAction = {
    options: ({ npc, world, session, locationId }) => {
        const source = session.entityStates?.[npc.id];
        if (world.communication?.inPerson === false || source?.canSpeak === false
            || source?.communicationBlocked === true) return [];
        const recipients = (world.entities || []).filter(item => item.type === 'npc'
            && item.id !== npc.id && session.entityStates?.[item.id]?.location === locationId
            && !['dead', 'gone'].includes(session.entityStates[item.id].status)
            && session.entityStates[item.id].canHear !== false
            && session.entityStates[item.id].communicationBlocked !== true);
        const observations = (source?.observations || []).filter(item => item?.id
            && item.allowedToShare !== false && item.text
            && ['witnessed', 'told', 'suspected', 'believed', 'public']
                .includes(item.sourceType)).slice(-8);
        return recipients.slice(0, 8).flatMap(recipient => observations
            .filter(item => (session.entityStates[recipient.id].observations || [])
                .filter(known => known.sourceObservationId === item.id
                    && known.sourceNpcId === npc.id).length < 8)
            .slice(-4).map(item => ({
                label: `tell ${recipient.name || recipient.id}: ${item.text.slice(0, 90)}`,
                targetId: recipient.id,
                payload: { actor_id: npc.id, recipient_id: recipient.id,
                    observation_id: item.id },
                prerequisites: ['same_location', 'shareable_knowledge', 'can_speak', 'can_hear']
            })));
    },
    event: ({ step }) => ({ type: 'dialogue', action: 'report',
        target_id: step.effect.payload.recipient_id }),
    satisfied: ({ npc, step, session }) => (session.entityStates?.[
        step.effect.payload.recipient_id]?.observations || []).some(item =>
        item.sourceNpcId === npc.id
            && item.sourceObservationId === step.effect.payload.observation_id)
};
technicalEffects.get('knowledge_share').eventTypes = ['dialogue'];
const effectModules = Object.freeze({ item_transfer: 'inventory', item_consume: 'inventory',
    item_introduce: 'inventory',
    npc_goal_set: 'livingWorld',
    condition_change: 'conditions' });
function moduleVerdict(effect, modules) {
    const module = effectModules[effect];
    return !module || modules?.[module] !== false
        ? { ok: true } : { ok: false, reason: 'module_disabled', module };
}
// Shared relation policy for legacy relative updates and linked absolute sets.
// Callers resolve their supported reference syntax before invoking it.
function relationVerdict({ modules, subjectId, targetId, subjectType, targetType,
    currentScore = 0, change, value, events = [], actionId = '', requireWitness = true,
    requireActionId = false, requireEvidence = false, requireMagnitude = false }) {
    if (!subjectId || !targetId || !subjectType || !targetType)
        return { ok: false, reason: 'unknown_relation_target' };
    const module = subjectType === 'faction' && targetType === 'faction'
        ? 'livingWorld' : 'relationships';
    if (modules?.[module] === false) return { ok: false, reason: 'module_disabled', module };
    if (subjectType === 'player')
        return { ok: false, reason: 'player_feelings_not_engine_controlled' };
    if (subjectId === targetId || (subjectType === 'faction') !== (targetType === 'faction'))
        return { ok: false, reason: 'invalid_relation_target' };
    const nextScore = value === undefined ? Math.max(-100, Math.min(100,
        Number(currentScore || 0) + Number(change))) : Number(value);
    if (!Number.isFinite(nextScore) || nextScore < -100 || nextScore > 100)
        return { ok: false, reason: 'invalid_relation_value' };
    if (requireWitness) {
        if (requireActionId && !actionId) return { ok: false, reason: 'missing_relation_action_id' };
        const delta = nextScore - Number(currentScore || 0);
        const declaredChange = value === undefined ? Number(change) : delta;
        const witnessed = events.find(event => event?.type === 'relationship'
            && event.status === 'completed' && event.actor_id === subjectId
            && event.target_id === targetId && (!actionId || event.action_id === actionId)
            && (!requireEvidence || !!String(event.cause || event.evidence || '').trim())
            && (!requireMagnitude || event.change !== undefined || event.value !== undefined)
            && (event.change === undefined || Number(event.change) === declaredChange)
            && (event.value === undefined || Number(event.value) === nextScore));
        if (!witnessed) return { ok: false, reason: 'unwitnessed_relation_effect' };
        return { ok: true, value: nextScore, event: witnessed };
    }
    return { ok: true, value: nextScore };
}
const OMIT_LEGACY = new Set(['summary', 'scene', 'events', 'entity_updates',
    'state_updates', 'action_resolution', 'npc_observations', 'world_events']);
const legacyOperation = name => name === 'checks' ? 'requestPendingCheck' : 'applyLegacyEffect';
function capabilityError(code, { effect = '', protocol = '', executionMode = '',
    available = [], stage = '', actionId = '', cause = '' } = {}) {
    const error = new Error(code);
    Object.assign(error, { code, effect, protocol, executionMode, available,
        source: 'worlds/effect-registry.js', stage, action_id: actionId, cause });
    return error;
}
function defineTechnicalEffect(name, definition) {
    if (!/^[a-z][a-z0-9_]*$/.test(name) || technicalEffects.has(name)
        || !definition?.schema || typeof definition.validate !== 'function'
        || typeof definition.reduce !== 'function') throw new TypeError('invalid_effect_definition');
    technicalEffects.set(name, { name, protocols: ['scene_draft_v3'],
        executionModes: ['linked'], operation: name, ...definition });
    return () => technicalEffects.delete(name);
}
function bindTechnicalOperation(name, validate, reduce) {
    const descriptor = technicalEffects.get(name);
    if (!descriptor || typeof validate !== 'function' || typeof reduce !== 'function')
        throw new TypeError('invalid_effect_operation_binding');
    descriptor.validate = validate;
    descriptor.reduce = reduce;
}
function capabilities({ protocol = 'scene_draft_v3', executionMode = 'linked',
    legacySchemas = {}, intentionallyEffectFree = false, includeInternal = false } = {}) {
    const native = (intentionallyEffectFree ? [] : [...technicalEffects.values()]).filter(entry =>
        entry.protocols.includes(protocol) && entry.executionModes.includes(executionMode)
        && (includeInternal || !entry.internalOnly));
    const legacy = (intentionallyEffectFree ? [] : Object.entries(legacySchemas || {}))
        .filter(([name]) => !OMIT_LEGACY.has(name));
    const schemas = Object.fromEntries([...legacy.map(([name, schema]) => [name, clone(schema)]),
        ...native.map(entry => [entry.name, clone(entry.schema)])]);
    const names = Object.keys(schemas);
    if (!names.length && !intentionallyEffectFree) throw capabilityError('derived_from_empty_schema', {
        protocol, executionMode, available: names, stage: 'capability_derivation',
        cause: 'No effect definitions were derived and this mode is not declared effect-free.' });
    return { source: 'worlds/effect-registry.js', protocol, executionMode,
        status: intentionallyEffectFree ? 'intentionally_effect_free' : 'supported',
        schemas, names, nativeNames: native.map(entry => entry.name),
        legacyNames: legacy.map(([name]) => name),
        operations: Object.fromEntries([
            ...legacy.map(([name]) => [name, legacyOperation(name)]),
            ...native.map(entry => [entry.name, entry.operation])
        ]) };
}
function assertSupported(capability, effect, actionId = '', stage = 'execution') {
    if (!capability?.names?.includes(effect)) throw capabilityError('unsupported_capability', {
        effect, protocol: capability?.protocol, executionMode: capability?.executionMode,
        available: capability?.names || [], stage, actionId,
        cause: 'The requested effect is not enabled in this mode.' });
}
function matchesSchema(value, spec) {
    if (!spec || typeof spec !== 'object') return true;
    if (spec.type === 'array') {
        return Array.isArray(value)
            && (!Number.isInteger(spec.maxItems) || value.length <= spec.maxItems)
            && (!Number.isInteger(spec.minItems) || value.length >= spec.minItems)
            && value.every(item => matchesSchema(item, spec.items));
    }
    if (spec.type === 'object') {
        return value !== null && typeof value === 'object' && !Array.isArray(value)
            && (spec.required || []).every(key => Object.hasOwn(value, key))
            && Object.entries(value).every(([key, item]) =>
                spec.properties?.[key] ? matchesSchema(item, spec.properties[key])
                    : spec.additionalProperties !== false);
    }
    if (spec.type === 'string' && (typeof value !== 'string'
        || Number.isInteger(spec.maxLength) && value.length > spec.maxLength
        || Number.isInteger(spec.minLength) && value.length < spec.minLength)) return false;
    if (spec.type === 'integer' && !Number.isInteger(value)) return false;
    if (spec.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) return false;
    if (spec.type === 'boolean' && typeof value !== 'boolean') return false;
    if (spec.enum && !spec.enum.includes(value)) return false;
    if (typeof value === 'number' && (Number.isFinite(spec.minimum) && value < spec.minimum
        || Number.isFinite(spec.maximum) && value > spec.maximum)) return false;
    return true;
}
function createEffectRegistry() {
    const reducers = new Map();
    const register = (type, validate, reduce) => {
        if (!/^[a-z][a-z0-9_]*$/.test(type) || reducers.has(type)
            || typeof validate !== 'function' || typeof reduce !== 'function')
            throw new TypeError('invalid_effect_registration');
        reducers.set(type, { validate, reduce });
    };
    const run = (initial, workingState, context = {}) => {
        if (!Array.isArray(initial) || initial.length > 32) throw new Error('invalid_effect_queue');
        const queue = initial.map(effect => ({ effect, ancestry: [], parentIndex: null }));
        const applied = [];
        const changes = [];
        const parents = [];
        const seenFollowUps = new Set();
        let followUps = 0;
        while (queue.length) {
            const { effect, ancestry, parentIndex } = queue.shift();
            const entry = reducers.get(effect?.type);
            if (!entry) throw capabilityError('unknown_technical_effect', {
                effect: String(effect?.type || ''), protocol: context.protocol,
                executionMode: context.executionMode, available: [...reducers.keys()],
                stage: 'effect_dispatch', actionId: context.actionId,
                cause: 'No validating and executing operation is registered.' });
            if (context.capability) assertSupported(context.capability, effect.type,
                context.actionId, 'effect_dispatch');
            if (context.capability && technicalEffects.has(effect.type)
                && !matchesSchema(effect.payload, context.capability.schemas[effect.type]?.items))
                throw capabilityError('invalid_technical_effect', {
                    effect: effect.type, protocol: context.protocol,
                    executionMode: context.executionMode, available: context.capability.names,
                    stage: 'payload_validation', actionId: context.actionId,
                    cause: 'Payload does not match the registry schema.' });
            const signature = JSON.stringify(effect);
            if (ancestry.includes(signature)) throw new Error('cyclic_follow_up_effect');
            if (parentIndex !== null) {
                const followUpKey = JSON.stringify([parentIndex, signature]);
                if (seenFollowUps.has(followUpKey)) throw new Error('duplicate_follow_up_effect');
                seenFollowUps.add(followUpKey);
            }
            if (!entry.validate(effect.payload, workingState, context))
                throw new Error(`invalid_technical_effect:${effect.type}`);
            const before = workingState.prepare();
            const includedBefore = context.turnTimeBudget?.remaining;
            const emitted = entry.reduce(effect.payload, workingState, context) || [];
            if (!Array.isArray(emitted)) throw new Error(`invalid_follow_up_effects:${effect.type}`);
            applied.push(effect);
            parents.push(parentIndex);
            const after = workingState.prepare();
            changes.push(JSON.stringify(before.world) !== JSON.stringify(after.world)
                || JSON.stringify(before.session) !== JSON.stringify(after.session)
                || includedBefore !== context.turnTimeBudget?.remaining);
            for (const next of emitted) {
                followUps++;
                if (followUps > MAX_FOLLOW_UP_EFFECTS) throw new Error('follow_up_effect_budget_exceeded');
                queue.push({ effect: next, ancestry: [...ancestry, signature],
                    parentIndex: applied.length - 1 });
            }
        }
        return { applied, changes, parents, followUps };
    };
    return { register, run, has: type => reducers.has(type), types: () => [...reducers.keys()] };
}
const api = { createEffectRegistry, capabilities, assertSupported, capabilityError,
    defineTechnicalEffect, bindTechnicalOperation, technicalEffects, legacyOperation,
    relationVerdict,
    moduleVerdict,
    MAX_FOLLOW_UP_EFFECTS };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.HordeEffectRegistry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
