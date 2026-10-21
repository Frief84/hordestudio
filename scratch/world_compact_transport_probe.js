/* Experimental V3 wire shape. Never used by the World turn pipeline. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const binding = require('../worlds/turn-binding');
const scene = require('../worlds/scene-draft');
const linked = require('../worlds/linked-world-actions');

const clone = value => structuredClone(value);
const shape = (properties, required) => ({ type: 'object', properties, required,
    additionalProperties: false });
function compactSchema(bound) {
    const action = bound.properties.actions.items;
    const reaction = bound.properties.reactions.items;
    const paragraph = action.properties.response.items;
    assert.deepEqual(action.properties.effects, reaction.properties.effects);
    assert.deepEqual(paragraph.required, reaction.required);
    for (const [key, spec] of Object.entries(paragraph.properties))
        assert.deepEqual(spec, reaction.properties[key], `reaction paragraph differs at ${key}`);
    assert.deepEqual(Object.keys(reaction.properties), [...Object.keys(paragraph.properties), 'effects']);
    return shape({ protocol: clone(bound.properties.protocol),
        entries: { type: 'array', maxItems: bound.properties.actions.maxItems
            + bound.properties.reactions.maxItems,
        items: shape({ scope: { type: 'string', enum: ['action', 'reaction'],
            description: 'Action includes the NPC answer; reaction is a separate autonomous NPC/world act.' },
        ...clone(action.properties) }, ['scope', 'kind', 'status', 'response']) } }, ['protocol', 'entries']);
}
function schemaKeywords(spec, result = new Set()) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return result;
    for (const [key, value] of Object.entries(spec)) {
        result.add(key);
        if (key === 'properties') Object.values(value).forEach(child => schemaKeywords(child, result));
        else if (key === 'items') schemaKeywords(value, result);
        else if (key === 'anyOf') value.forEach(child => schemaKeywords(child, result));
    }
    return result;
}
function encode(boundProposal) {
    return { protocol: boundProposal.protocol, entries: [
        ...boundProposal.actions.map(action => ({ scope: 'action', ...clone(action) })),
        ...(boundProposal.reactions || []).map(reaction => {
            const { effects, ...paragraph } = clone(reaction);
            return { scope: 'reaction', kind: 'other', status: 'resolved', response: [paragraph],
                ...(effects === undefined ? {} : { effects }) };
        })] };
}
function decode(wire, bound) {
    const errors = binding.validate(wire, compactSchema(bound));
    if (errors.length) return { ok: false, errors };
    const result = { protocol: wire.protocol, actions: [], reactions: [] };
    let reactionsStarted = false;
    for (const [index, entry] of wire.entries.entries()) {
        const { scope, kind, status, ...fields } = entry;
        if (scope === 'action') {
            if (reactionsStarted) errors.push({ reason: 'action_after_reaction', detail: `entries.${index}` });
            result.actions.push({ kind, status, ...clone(fields) });
        } else {
            reactionsStarted = true;
            if (kind !== 'other' || status !== 'resolved')
                errors.push({ reason: 'invalid_reaction_host_fields', detail: `entries.${index}` });
            const forbidden = ['request', 'authorization_quote',
                'depends_on', 'state_conditions'].find(key => Object.hasOwn(fields, key));
            if (forbidden) errors.push({ reason: 'reaction_action_field', detail: `entries.${index}.${forbidden}` });
            if (fields.response.length !== 1)
                errors.push({ reason: 'reaction_response_count', detail: `entries.${index}.response` });
            if (fields.response.length === 1) result.reactions.push({ ...clone(fields.response[0]),
                ...(fields.effects === undefined ? {} : { effects: clone(fields.effects) }) });
        }
    }
    if (errors.length) return { ok: false, errors };
    errors.push(...binding.validate(result, bound));
    return errors.length ? { ok: false, errors } : { ok: true, proposal: result };
}
function boundResult(proposal, canonical, context) {
    const bound = binding.bind(proposal, context, canonical);
    if (!bound.ok) return { bound };
    const compiled = scene.compile(bound.draft, { input: context.input, location: 'office',
        playerStart: 'office', present: ['linda'], locations: ['office'], now: 540,
        commitments: [], linkedRequired: true, contract: canonical });
    if (!compiled.ok) return { bound, compiled };
    const world = { id: 'probe', locations: [{ id: 'office', exits: [] }],
        entities: [{ id: 'linda', type: 'npc', name: 'Linda' }] };
    const session = { id: 'probe_session', playerLocation: 'office', turnCount: 0,
        inventory: [], entityStates: { linda: { location: 'office' } },
        locationStates: {}, npcRelationships: {}, engineEvents: [], worldStateVersion: 1,
        worldClock: { absoluteMinutes: 540, turnCount: 0, bonusTimeMinutes: 0 } };
    const executed = linked.executeLinkedActions(compiled.linkedPlan, world, session,
        { worldActionIds: bound.binding.worldActionIds });
    return { bound, compiled, executed, session };
}
function resultSnapshot(result) {
    return { bound: result.bound, compiled: result.compiled,
        executed: result.executed && { ok: result.executed.ok, errors: result.executed.errors,
            events: result.executed.events, verifiedEffects: result.executed.verifiedEffects,
            verifiedEvents: result.executed.verifiedEvents, narrative: result.executed.narrative,
            skipped: result.executed.skipped,
            outcomes: [...(result.executed.outcomes || new Map())] },
        session: result.session };
}
function fixtureChecks(boundSchema) {
    const canonical = scene.schema({ events: { type: 'array', items: { type: 'object',
        properties: Object.fromEntries(['type', 'actor_id', 'status', 'action', 'outfit', 'target_id',
            'cause', 'change', 'activity', 'next_status'].map(key => [key, key === 'change' ? { type: 'integer' }
                : { type: 'string', maxLength: 1000 }])),
        required: ['type', 'actor_id', 'status'] } } }, 'scene_draft_v3', { linkedRequired: true });
    const bound = binding.schema(canonical);
    const simple = { protocol: 'scene_draft_v3', actions: [{ kind: 'physical', status: 'resolved',
        effects: { outfit_set: [{ actor_id: 'player', outfit: 'red cloak' }] },
        response: [{ text: 'You put on a red cloak.', events: [{ type: 'outfit',
            actor_id: 'player', status: 'completed', outfit: 'red cloak' }] }] }],
        reactions: [{ text: 'Linda puts on a blue coat.',
            effects: { outfit_set: [{ actor_id: 'linda', outfit: 'blue coat' }] },
            events: [{ type: 'outfit', actor_id: 'linda', status: 'completed', outfit: 'blue coat' }] }] };
    const mixed = { protocol: 'scene_draft_v3', actions: [
        { request: 'I ask Linda for help ', kind: 'speech', status: 'resolved', effects: [],
            response: [{ text: 'Linda agrees to help.' }] },
        { request: 'and put on a red cloak.', kind: 'physical', status: 'resolved',
            depends_on: [{ action_index: 0, outcome: 'succeeded' }],
            effects: { outfit_set: [{ actor_id: 'player', outfit: 'red cloak' }] },
            response: [{ text: 'You put on a red cloak.', events: [{ type: 'outfit',
                actor_id: 'player', status: 'completed', outfit: 'red cloak' }] }] }],
        reactions: clone(simple.reactions) };
    const cases = [
        { name: 'player and NPC effects', proposal: simple, input: 'I put on a red cloak.',
            expected: 'executed' },
        { name: 'mixed and dependent actions', proposal: mixed,
            input: 'I ask Linda for help and put on a red cloak.', expected: 'executed' },
        { name: 'unwitnessed relationship effect with independent NPC', proposal: (() => { const p = clone(simple);
            p.actions[0].kind = 'speech'; p.actions[0].effects = { relation_set: [{ subject_id: 'linda',
                target_id: 'player', value: 50 }] };
            p.actions[0].response = [{ text: 'Linda hears your praise.' }]; return p; })(),
            input: 'I praise Linda.', expected: 'independent_only' },
        { name: 'unknown effect', proposal: (() => { const p = clone(simple);
            p.actions[0].effects = { invented_power: [{}] }; return p; })(), input: 'I put on a red cloak.',
            expected: 'schema_invalid' },
        { name: 'invalid effect arguments', proposal: (() => { const p = clone(simple);
            p.actions[0].effects.outfit_set[0].actor_id = 7; return p; })(), input: 'I put on a red cloak.',
            expected: 'schema_invalid' },
        { name: 'broken dependency', proposal: (() => { const p = clone(mixed);
            p.actions[1].depends_on[0].action_index = 9; return p; })(),
        input: 'I ask Linda for help and put on a red cloak.', expected: 'rejected' },
        { name: 'missing request coverage', proposal: (() => { const p = clone(mixed);
            p.actions[1].request = 'put on a red cloak.'; return p; })(),
        input: 'I ask Linda for help and put on a red cloak.', expected: 'rejected' },
        { name: 'unknown NPC reference', proposal: (() => { const p = clone(simple);
            p.reactions[0].effects.outfit_set[0].actor_id = 'unknown_npc'; return p; })(),
        input: 'I put on a red cloak.', expected: 'rejected' }
    ];
    const outputCharacters = {};
    for (const { name, proposal, input, expected } of cases) {
        const wire = encode(proposal);
        const decoded = decode(wire, bound);
        if (binding.validate(proposal, bound).length) {
            assert.equal(expected, 'schema_invalid', name);
            assert(!decoded.ok, `${name}: schema-invalid proposal accepted`);
            assert(!binding.bind(proposal, { turnId: 'turn_probe', input, now: 540 }, canonical).ok,
                `${name}: canonical binder accepted invalid proposal`);
            continue;
        }
        assert(decoded.ok, `${name}: ${JSON.stringify(decoded.errors)}`);
        assert.deepEqual(decoded.proposal, proposal, `${name}: transport lost information`);
        const context = { turnId: 'turn_probe', input, now: 540 };
        const original = boundResult(proposal, canonical, context);
        const roundTrip = boundResult(decoded.proposal, canonical, context);
        assert.deepEqual(resultSnapshot(roundTrip), resultSnapshot(original),
            `${name}: engine result changed`);
        const accepted = original.bound.ok && original.compiled?.ok && original.executed?.ok;
        if (expected === 'executed' || expected === 'rejected')
            assert.equal(accepted, expected === 'executed', `${name}: unexpected engine verdict`);
        if (expected === 'independent_only') {
            assert(original.executed?.ok, `${name}: independent NPC effect lost`);
            assert(!original.executed.verifiedEffects.some(item => item.action_id === 'turn_probe_action_0'),
                `${name}: unwitnessed player effect was verified`);
            assert(original.executed.verifiedEffects.some(item => item.action_id === 'turn_probe_world_0'),
                `${name}: independent NPC effect was not preserved`);
        }
        if (expected === 'executed') outputCharacters[name] = {
            current: JSON.stringify(proposal).length, compact: JSON.stringify(wire).length };
    }
    const wire = encode(simple);
    const rejects = [
        w => { delete w.entries[0].scope; },
        w => { w.entries.push(w.entries.shift()); },
        w => { w.entries[1].kind = 'physical'; },
        w => { w.entries[1].response.push(clone(w.entries[1].response[0])); },
        w => { w.entries[1].depends_on = [{ action_index: 0, outcome: 'succeeded' }]; }
    ];
    for (const change of rejects) {
        const altered = clone(wire); change(altered);
        assert(!decode(altered, bound).ok, 'ambiguous or malformed wire entry was accepted');
    }
    const conflicting = clone(simple);
    conflicting.reactions[0].effects = [];
    conflicting.reactions[0].events = [{ type: 'activity', actor_id: 'linda',
        status: 'completed', activity: 'working', next_status: 'dead' }];
    const conflictWire = decode(encode(conflicting), bound);
    assert(conflictWire.ok);
    assert.deepEqual(conflictWire.proposal, conflicting, 'adapter discarded a conflicting field');
    for (const candidate of [conflicting, conflictWire.proposal]) {
        const result = boundResult(candidate, canonical,
            { turnId: 'turn_probe', input: 'I put on a red cloak.', now: 540 });
        assert(result.bound.ok);
        assert(result.compiled.errors.some(error => error.reason === 'event_field_type_conflict'),
            'canonical and compact proposals must reject the same mismatched event payload');
    }
    const missingReaction = clone(simple);
    missingReaction.reactions = [];
    const completeResult = boundResult(simple, canonical,
        { turnId: 'turn_probe', input: 'I put on a red cloak.', now: 540 });
    const missingResult = boundResult(decode(encode(missingReaction), bound).proposal, canonical,
        { turnId: 'turn_probe', input: 'I put on a red cloak.', now: 540 });
    assert(completeResult.executed?.ok);
    assert.equal(completeResult.executed.verifiedEffects.length, 2,
        'the full fixture confirms independent player and NPC effects');
    assert(missingResult.executed?.ok, 'engine cannot infer an omitted independent NPC choice');
    assert.equal(missingResult.executed.verifiedEffects.length, 1,
        'fixture oracle must detect the absent second confirmed effect');
    const echo = { protocol: 'scene_draft_v3', actions: [{ kind: 'gesture', status: 'resolved',
        effects: [], response: [{ text: 'You nod to Linda.' }] }] };
    const echoResult = boundResult(echo, canonical,
        { turnId: 'turn_probe', input: 'I nod to Linda.', now: 540 });
    assert(echoResult.executed?.ok, `prose quality cannot be proven by effect validation: ${JSON.stringify(resultSnapshot(echoResult))}`);
    assert.equal(echoResult.executed.narrative, 'You nod to Linda.',
        'fixture oracle identifies a reply that only repeats the player gesture');
    assert.deepEqual(compactSchema(boundSchema).properties.entries.items.properties.effects,
        boundSchema.properties.actions.items.properties.effects,
        'all active operation arguments and constraints must remain in the wire schema');
    return { cases: cases.length + rejects.length + 4, outputCharacters };
}
function denseFixture() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'horde-compact-probe-'));
    const file = path.join(directory, 'dense-schema.json');
    try {
        const audit = spawnSync(process.execPath,
            [path.join(__dirname, 'world_context_budget_browser_audit.js')],
            { encoding: 'utf8', env: { ...process.env, HORDE_COMPACT_SCHEMA_DUMP: file } });
        assert.equal(audit.status, 0, audit.stderr || audit.stdout);
        const metricsLine = audit.stdout.split(/\r?\n/u).find(line => line.startsWith('CONTEXT_METRICS '));
        assert(metricsLine, 'context audit did not report request sizes');
        const metrics = JSON.parse(metricsLine.slice('CONTEXT_METRICS '.length));
        return { schemas: JSON.parse(fs.readFileSync(file, 'utf8')),
            dense: metrics.find(row => row.scenario === 'dense'),
            repair: metrics.find(row => row.scenario === 'repair') };
    } finally {
        if (fs.existsSync(file)) fs.unlinkSync(file);
        fs.rmdirSync(directory);
    }
}
function main() {
    const { schemas, dense, repair } = denseFixture();
    const original = schemas.dense;
    const compact = compactSchema(original);
    const repairCompact = compactSchema(schemas.repair);
    const baselineKeywords = schemaKeywords(original);
    assert([...schemaKeywords(compact)].every(keyword => baselineKeywords.has(keyword)),
        'prototype adds a JSON Schema keyword absent from the working provider contract');
    const originalSize = JSON.stringify(original).length;
    const compactSize = JSON.stringify(compact).length;
    const repairDelta = JSON.stringify(repairCompact).length - JSON.stringify(schemas.repair).length;
    const checked = fixtureChecks(original);
    console.log('COMPACT_TRANSPORT_METRICS', JSON.stringify({
        schemaCharacters: { current: originalSize, prototype: compactSize,
            delta: compactSize - originalSize },
        denseSchemaEnvelopeCharacters: { current: dense.mainSchemaCharacters,
            projected: dense.mainSchemaCharacters + compactSize - originalSize },
        denseRequestCharacters: { current: dense.mainCharacters,
            projectedWithSameMessages: dense.mainCharacters + compactSize - originalSize },
        repairSchemaEnvelopeCharacters: { current: repair.repairSchemaCharacters,
            projected: repair.repairSchemaCharacters + repairDelta },
        repairRequestCharacters: { current: repair.repairCharacters,
            projectedWithSameMessages: repair.repairCharacters + repairDelta },
        activeEffectTypes: Object.keys(original.properties.actions.items.properties.effects.anyOf[0].properties).length,
        deterministicCases: checked.cases, outputCharacters: checked.outputCharacters,
        currentCalls: { dense: dense.calls, repair: repair.calls },
        currentRepairs: { dense: dense.repairs, repair: repair.repairs } }));
    console.log('PASS isolated compact V3 transport round-trip and existing engine parity');
}
if (require.main === module) main();
module.exports = { compactSchema, encode, decode };
