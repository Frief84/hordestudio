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
    interactable_transition: list(shape({ target_id: field('Exact object or door ID.'),
        to_state: field('Authored target state.', 80) })),
    item_transfer: list(shape({ item_id: field('Exact item ID or owned item name.'),
        from_id: field('Exact actor or location ID.'), to_id: field('Exact actor or location ID.'),
        quantity: { type: 'integer', minimum: 1, maximum: 100 } },
    ['item_id', 'from_id', 'to_id'])),
    item_introduce: list(shape({ id: field('New stable item ID.'), name: field('Item name.', 160),
        location_id: field('Exact present location ID.'), description: field('Short description.', 500) },
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
    time_advance: list(shape({ minutes: { type: 'integer', minimum: 1, maximum: 10080 } })),
    outfit_set: list(shape({ actor_id: field('Exact actor ID.'),
        outfit: field('Complete resulting outfit.', 500) }))
}).map(([name, schema]) => [name, { name, schema, protocols: ['scene_draft_v3'],
    executionModes: ['linked'], operation: name }]));
const effectModules = Object.freeze({ item_transfer: 'inventory', item_introduce: 'inventory',
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
    legacySchemas = {}, intentionallyEffectFree = false } = {}) {
    const native = (intentionallyEffectFree ? [] : [...technicalEffects.values()]).filter(entry =>
        entry.protocols.includes(protocol) && entry.executionModes.includes(executionMode));
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
        const queue = initial.map(effect => ({ effect, ancestry: [] }));
        const applied = [];
        const changes = [];
        let followUps = 0;
        while (queue.length) {
            const { effect, ancestry } = queue.shift();
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
            if (!entry.validate(effect.payload, workingState, context))
                throw new Error(`invalid_technical_effect:${effect.type}`);
            const before = workingState.prepare();
            const includedBefore = context.turnTimeBudget?.remaining;
            const emitted = entry.reduce(effect.payload, workingState, context) || [];
            if (!Array.isArray(emitted)) throw new Error(`invalid_follow_up_effects:${effect.type}`);
            applied.push(effect);
            const after = workingState.prepare();
            changes.push(JSON.stringify(before.world) !== JSON.stringify(after.world)
                || JSON.stringify(before.session) !== JSON.stringify(after.session)
                || includedBefore !== context.turnTimeBudget?.remaining);
            for (const next of emitted) {
                followUps++;
                if (followUps > MAX_FOLLOW_UP_EFFECTS) throw new Error('follow_up_effect_budget_exceeded');
                queue.push({ effect: next, ancestry: [...ancestry, signature] });
            }
        }
        return { applied, changes, followUps };
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
