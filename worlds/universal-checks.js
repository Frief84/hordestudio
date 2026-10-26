/* Optional, world-authored checks. This module reads the existing Working State;
 * it never writes state or executes effects. */
(function (root) {
'use strict';
const id = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,119}$/.test(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const operators = new Set(['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'exists']);
const outcomes = new Set(['success', 'partial', 'failure', 'blocked']);
const validCosts = costs => Array.isArray(costs) && costs.length <= 8
    && costs.every(cost => object(cost) && id(cost.resourceId)
        && finite(cost.amount) && cost.amount > 0 && cost.amount <= 1e6
        && Object.keys(cost).every(key => ['resourceId', 'amount'].includes(key)))
    && new Set(costs.map(cost => cost.resourceId)).size === costs.length;
function assertCondition(value, depth = 0) {
    if (!object(value) || depth > 4) throw new Error('invalid_check_condition');
    if (value.all || value.any) {
        const list = value.all || value.any;
        if (!Array.isArray(list) || !list.length || list.length > 8 || !!value.all === !!value.any)
            throw new Error('invalid_check_condition_group');
        list.forEach(item => assertCondition(item, depth + 1));
        return;
    }
    if (!['actor', 'target'].includes(value.subject) || !['stat', 'skill', 'property', 'condition'].includes(value.source)
        || !id(value.key) || !operators.has(value.operator)
        || value.operator !== 'exists' && !['string', 'number', 'boolean'].includes(typeof value.value))
        throw new Error('invalid_check_condition');
}
function validateRules(config, effectTypes = null) {
    if (config === undefined) return;
    if (!object(config) || typeof config.enabled !== 'boolean' || !Array.isArray(config.rules)
        || config.rules.length > 32) throw new Error('invalid_universal_checks');
    const seen = new Set();
    for (const rule of config.rules) {
        if (!object(rule) || !id(rule.id) || seen.has(rule.id) || typeof rule.name !== 'string'
            || !rule.name.trim() || rule.name.length > 120 || !object(rule.match)
            || !['physical', 'speech', 'question', 'observation', 'travel', 'wait', 'other'].includes(rule.match.kind)
            || rule.match.requestIncludes !== undefined && (typeof rule.match.requestIncludes !== 'string'
                || !rule.match.requestIncludes.trim() || rule.match.requestIncludes.length > 120)
            || rule.actor !== undefined && rule.actor !== 'player' && rule.actor !== 'event_actor'
            || rule.target !== undefined && rule.target !== 'event_target'
                && !id(rule.target)
            || !Array.isArray(rule.values) || rule.values.length > 8
            || rule.values.some(value => !object(value) || !['actor', 'target'].includes(value.subject)
                || !['stat', 'skill', 'property'].includes(value.source) || !id(value.key)
                || value.weight !== undefined && (!finite(value.weight) || Math.abs(value.weight) > 100))
            || !finite(rule.difficulty) || Math.abs(rule.difficulty) > 1e6
            || rule.random !== undefined && (!object(rule.random) || !Number.isInteger(rule.random.min)
                || !Number.isInteger(rule.random.max) || rule.random.max < rule.random.min
                || rule.random.max - rule.random.min > 10000)
            || rule.modifiers !== undefined && (!Array.isArray(rule.modifiers) || rule.modifiers.length > 16
                || rule.modifiers.some(mod => !object(mod) || !id(mod.id) || !finite(mod.value)
                    || Math.abs(mod.value) > 1e6 || mod.when && (assertCondition(mod.when), false)))
            || !Array.isArray(rule.results) || !rule.results.length || rule.results.length > 12
            || rule.results.some(result => !object(result) || !id(result.id)
                || !outcomes.has(result.kind) && result.kind !== 'custom'
                || !finite(result.minMargin) || Math.abs(result.minMargin) > 1e6
                || result.costs !== undefined && (!['success', 'partial', 'failure'].includes(result.kind)
                    || !validCosts(result.costs))
                || result.effects !== undefined && (!Array.isArray(result.effects)
                    || result.effects.some(effect => !id(effect) || effectTypes && !effectTypes.has(effect))))
            || !rule.results.some(result => result.kind === 'failure'))
            throw new Error('invalid_universal_check_rule');
        if (rule.when) assertCondition(rule.when);
        seen.add(rule.id);
    }
}
function actorId(rule, action, events) {
    if (rule.actor !== 'event_actor') return 'player';
    return events.find(event => event.action_id === action.action_id && id(event.actor_id))?.actor_id || '';
}
function readValue(working, actor, source, key) {
    if (!actor) return undefined;
    if (actor === 'player') {
        if (source === 'stat') return working.getSession('playerStats')?.[key];
        if (source === 'skill') {
            const identity = working.getSession('playerIdentity');
            const selected = identity?.skills;
            const entry = Array.isArray(selected) ? selected.find(item => item === key || item?.id === key) : null;
            if (!entry) return undefined;
            const rank = identity?.capabilityRanks?.[key];
            return finite(rank) ? rank : typeof entry === 'object'
                ? entry.rank ?? entry.value ?? 1 : 1;
        }
        if (source === 'condition') return (working.getSession('playerSceneConditions') || []).includes(key);
        return working.getSession('playerIdentity')?.[key];
    }
    const entity = working.getEntity(actor);
    if (!entity?.definition) return undefined;
    if (source === 'stat') return entity.state?.stats?.[key] ?? entity.definition.stats?.[key];
    if (source === 'skill') {
        const skills = entity.state?.skills ?? entity.definition.skills;
        if (object(skills)) return skills[key];
        const entry = Array.isArray(skills) ? skills.find(item => item === key || item?.id === key) : null;
        return typeof entry === 'object' ? entry.rank ?? entry.value ?? 1 : entry ? 1 : undefined;
    }
    if (source === 'condition') return (entity.state?.conditions || []).includes(key);
    return entity.state?.properties?.[key] ?? entity.definition.properties?.[key];
}
function conditionPasses(condition, working, actor, target) {
    if (condition.all) return condition.all.every(item => conditionPasses(item, working, actor, target));
    if (condition.any) return condition.any.some(item => conditionPasses(item, working, actor, target));
    const actual = readValue(working, condition.subject === 'actor' ? actor : target,
        condition.source, condition.key);
    if (condition.operator === 'exists') return actual !== undefined && actual !== null && actual !== false;
    if (condition.operator === 'equals') return actual === condition.value;
    if (condition.operator === 'not_equals') return actual !== condition.value;
    if (!finite(actual) || !finite(condition.value)) return false;
    return condition.operator === 'gt' ? actual > condition.value
        : condition.operator === 'gte' ? actual >= condition.value
        : condition.operator === 'lt' ? actual < condition.value : actual <= condition.value;
}
function matches(rule, action) {
    return action.kind === rule.match.kind && (!rule.match.requestIncludes
        || String(action.request || '').toLocaleLowerCase().includes(rule.match.requestIncludes.toLocaleLowerCase()));
}
function evaluate(rule, action, events, working, roll) {
    const actor = actorId(rule, action, events);
    const target = rule.target === 'event_target'
        ? events.find(event => event.action_id === action.action_id && id(event.target_id))?.target_id || ''
        : rule.target || '';
    const values = rule.values.map(value => ({ ...value,
        actual: readValue(working, value.subject === 'actor' ? actor : target, value.source, value.key) }));
    const missing = values.some(value => !finite(value.actual));
    const prereq = !rule.when || conditionPasses(rule.when, working, actor, target);
    const modifiers = (rule.modifiers || []).filter(mod => !mod.when
        || conditionPasses(mod.when, working, actor, target)).map(mod => ({ id: mod.id, value: mod.value }));
    const random = rule.random ? roll(rule.random.min, rule.random.max, rule.id) : null;
    if (random !== null && (!Number.isInteger(random) || random < rule.random.min || random > rule.random.max))
        throw new Error('invalid_check_random');
    const total = missing ? null : values.reduce((sum, value) => sum + value.actual * (value.weight ?? 1), 0)
        + modifiers.reduce((sum, mod) => sum + mod.value, 0) + (random ?? 0);
    const margin = total === null ? null : total - rule.difficulty;
    const result = !prereq || missing
        ? { id: 'blocked', kind: 'blocked', effects: [] }
        : [...rule.results].sort((a, b) => b.minMargin - a.minMargin)
            .find(item => margin >= item.minMargin) || { id: 'failure', kind: 'failure', effects: [] };
    return { rule_id: rule.id, name: rule.name, action_id: action.action_id, actor_id: actor,
        target_id: target || null, values, modifiers, difficulty: rule.difficulty, random,
        total, margin, result_id: result.id, kind: result.kind, allowed_effects: result.effects || [],
        ...(result.costs?.length ? { costs: result.costs.map(cost => ({ ...cost })) } : {}),
        reason: !prereq ? 'prerequisite_not_met' : missing ? 'missing_value' : '' };
}
const api = { validateRules, matches, evaluate };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.HordeUniversalChecks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
