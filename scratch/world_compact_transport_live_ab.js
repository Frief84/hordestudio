/* Opt-in, local-only A/B measurement. Proposals run on detached fixture copies. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const binding = require('../worlds/turn-binding');
const scene = require('../worlds/scene-draft');
const linked = require('../worlds/linked-world-actions');
const compactTransport = require('./world_compact_transport_probe');

const provider = process.env.HORDE_AB_PROVIDER || 'ollama';
assert(['ollama', 'openai_compatible'].includes(provider));
const endpoint = provider === 'ollama'
    ? process.env.HORDE_AB_OLLAMA || 'http://127.0.0.1:11434'
    : process.env.HORDE_AB_BASE_URL;
assert(endpoint && (provider !== 'ollama'
    || ['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname)),
    'Ollama comparison requires a local endpoint; compatible providers require HORDE_AB_BASE_URL');
const modelNames = (process.env.HORDE_AB_MODELS || process.env.HORDE_AB_MODEL
    || 'qwen2.5:14b-instruct-q4_K_M').split(',').map(name => name.trim()).filter(Boolean);
const names = (process.env.HORDE_AB_CASES || 'small').split(',').map(name => name.trim());
const variants = (process.env.HORDE_AB_VARIANTS || 'current,compact').split(',').map(name => name.trim());
assert(variants.every(name => ['current', 'compact', 'current_before', 'p1b5_before'].includes(name)));
const settings = Object.freeze({ temperature: Number(process.env.HORDE_AB_TEMPERATURE ?? 0),
    top_p: Number(process.env.HORDE_AB_TOP_P ?? 1),
    seed: Number(process.env.HORDE_AB_SEED ?? 42),
    num_ctx: Number(process.env.HORDE_AB_NUM_CTX ?? 32768),
    num_predict: Number(process.env.HORDE_AB_NUM_PREDICT ?? 1200) });
assert(Number.isFinite(settings.temperature) && settings.temperature >= 0
    && Number.isFinite(settings.top_p) && settings.top_p > 0 && settings.top_p <= 1
    && Number.isInteger(settings.seed) && Number.isInteger(settings.num_ctx)
    && settings.num_ctx > 0 && Number.isInteger(settings.num_predict)
    && settings.num_predict > 0, 'invalid comparable generation settings');
const clone = value => structuredClone(value);
// World/session/request snapshots come from world_context_budget_browser_audit.
// These entries add only player inputs and explicit fixture oracles.
const cases = Object.freeze({
    dialogue: { source: 'small', input: 'Hello, Linda.', invariants: ['no_world_effect'],
        knownFailures: ['player_echo'] },
    two_questions: { source: 'dense', input: 'Linda, what happened to the silver compass, and what does the third letter say about it?',
        invariants: ['known_compass_recall', 'no_player_move'],
        knownFailures: ['pending_action_requires_check', 'incomplete_answer'] },
    mixed_npc: { source: 'dense', input: 'I nod to Linda, ask what happened to the silver compass, and ask her to walk to room_2.',
        invariants: ['known_compass_recall', 'no_player_move', 'npc_walk_response'],
        knownFailures: ['request_coverage_mismatch', 'pending_action_requires_check', 'missing_npc_response'] },
    mixed_effects: { source: 'dense', input: 'I put on the red cloak, nod to Linda, and ask what happened to the silver compass.',
        invariants: ['player_red_cloak', 'known_compass_recall'],
        knownFailures: ['lost_independent_effect', 'missing_npc_response'] },
    blocked_chain: { source: 'dense', input: 'I open the locked way to room_1, walk into room_1, and give Linda the silver compass.',
        invariants: ['no_player_move', 'no_invented_compass'],
        knownFailures: ['unverified_blockage', 'dependent_action_executed'] },
    invalid_reference: { source: 'dense', input: 'I ask Linda to walk to void_archive, then bring back its map.',
        invariants: ['no_player_move', 'no_invented_location'],
        knownFailures: ['unknown_location', 'invented_effect'] },
    relation: { source: 'dense', input: 'I thank Linda warmly and ask whether our friendship has changed.',
        invariants: ['no_relationship_change'], knownFailures: ['module_disabled', 'unwitnessed_relation_effect'] },
    long_input: { source: 'dense', input: `I tell Linda, in one uninterrupted explanation, that I have been reading the office records carefully. ${
        'I mention the map cabinet, the numbered letters, the old routes, and the notes left by earlier visitors. '.repeat(9)
    }Then I ask what happened to the silver compass and whether she can check the record now.`,
    invariants: ['known_compass_recall'], knownFailures: ['context_loss', 'incomplete_answer'] },
    repair: { source: 'repair', invariants: ['no_relationship_change'],
        knownFailures: ['unsupported_relation_effect', 'gesture_has_world_effects'] },
    dense: { source: 'dense', invariants: ['known_compass_recall'],
        knownFailures: ['context_loss'] },
    small: { source: 'small', invariants: [], knownFailures: [] }
});
const engineAudits = Object.freeze([
    { file: 'world_server_binding_audit.js', covers: ['request ownership', 'checks', 'dependencies', 'NPC reactions'] },
    { file: 'world_gesture_effect_repro_audit.js', covers: ['mixed actions', 'invalid effects', 'rollback'] },
    { file: 'world_action_path_parity_audit.js', covers: ['references', 'modules', 'movement', 'WorldAgent'] },
    { file: 'world_linked_turn_browser_audit.js', covers: ['V3 save/reload', 'transaction', 'stale response'] }
]);
const compactHeader = `[COMPACT SERVER-BOUND SCENE DRAFT]
Return protocol:"scene_draft_v3" and ordered entries. An entry with scope:"action" is one player step: give its actual kind and status, response:[{text,events?,speech?,commitments?,resolutions?}], effects, and request excerpts for compound input. An entry with scope:"reaction" is one autonomous NPC/world act: use kind:"other", status:"resolved", exactly one response paragraph in response:[{text,events?,speech?,commitments?,resolutions?}], and its own effects. Put all action entries before reaction entries. The server creates action, response and passage IDs and attaches contained events; do not supply generated IDs. Cover the whole player message in order. For questions, answer or explicitly defer. Begin passages with a consequence or NPC response; never repeat or paraphrase the player input. Speech, questions and incidental gestures may share one action with ordered responses. Use effects:[] for no lasting change. Use kind gesture only for nonpersistent expressions, never travel, transfers, doors or lasting conditions. Match event fields to their stated type; real changes require supported typed effects, matching events where required, and consistent prose. depends_on names an earlier zero-based player action_index and succeeded/failed/blocked; stop before a pending check result. Preserve independent successful steps when another fails. An NPC answer belongs in the player's action response; only separate NPC decisions belong in reactions with their own evidence. Do not invent actors, items, routes, access, abilities or property names. Do not narrate an unrequested player decision. Quests and deadlines require actual player authorization, specific future time where applicable, and supporting source_quote.
Leave commitments empty unless the current player message or linked response expressly establishes a specific future deadline. Wishes, offers and open-ended plans are dialogue. A pause, expression or momentary reaction belongs in prose, not a completed status, time, condition or relationship event.
`;
function messagesFor(fixture, variant) {
    const messages = clone(fixture.request.messages);
    if (variant === 'current_before') for (const message of messages) {
        if (typeof message.content !== 'string') continue;
        message.content = message.content
            .replace('nonoverlapping contiguous request excerpts in order, with no omitted or repeated words',
                'contiguous request excerpts in order')
            .replace('For each question, give a relevant NPC answer, a clear refusal, or a specific reason it remains unanswered in that action response; keep multiple questions distinct. Use answered only for an actual answer, never for an echo of the question or a status label alone. An independent NPC decision belongs in reactions and must not replace the response to the player. Use pending_check only when an actual registered check effect is proposed; an NPC considering a request is not itself a check. ', '');
    }
    if (variant === 'compact') {
        const first = messages.find(item => item.content?.startsWith('[SERVER-BOUND SCENE DRAFT]'));
        assert(first && first.content.includes('[WORLD RULES]'), 'missing original World instruction boundary');
        first.content = first.content.replace(/^\[SERVER-BOUND SCENE DRAFT\][\s\S]*?(?=\[WORLD RULES\])/u,
            compactHeader);
    }
    return messages;
}
function captureFixtures() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'horde-world-live-ab-'));
    const file = path.join(directory, 'fixture.json');
    try {
        const audit = spawnSync(process.execPath,
            [path.join(__dirname, 'world_context_budget_browser_audit.js')],
            { encoding: 'utf8', env: { ...process.env, HORDE_AB_CAPTURE: file },
                maxBuffer: 4 * 1024 * 1024 });
        assert.equal(audit.status, 0, audit.stderr || audit.stdout);
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } finally {
        if (fs.existsSync(file)) fs.unlinkSync(file);
        fs.rmdirSync(directory);
    }
}
function deriveFixture(base, scenario) {
    const input = cases[scenario]?.input;
    assert(input, `unknown derived fixture ${scenario}`);
    const fixture = clone(base);
    fixture.scenario = scenario;
    fixture.input = input;
    const message = fixture.request.messages.findLast(item => item.role === 'user'
        && item.content === base.input);
    assert(message, 'current player message missing from captured request');
    message.content = input;
    const action = fixture.canonical.properties.actions.items;
    if (scenario !== 'dialogue') {
        if (!action.required.includes('request')) action.required.push('request');
        action.properties.request.description = 'Required for this compound input. Copy contiguous excerpts covering every step in order, including negations. Use separate actions for independently executable steps; do not omit or merge one.';
    }
    fixture.request.response_format.json_schema.schema = binding.schema(fixture.canonical,
        { allowCommitments: true });
    return fixture;
}
function fixtureQuality(fixture, saved, executed, narrative) {
    const expectations = cases[fixture.scenario]?.invariants || [];
    const flags = [];
    const hasEffect = (type, actor) => executed.confirmedEffects.some(effect =>
        effect.type === type && effect.result === 'changed'
            && (!actor || effect.payload?.actor_id === actor));
    for (const invariant of expectations) {
        if (invariant === 'no_world_effect' && executed.verifiedEffects.length)
            flags.push('unexpected_world_effect');
        if (invariant === 'no_player_move'
            && saved.session.playerLocation !== fixture.session.playerLocation)
            flags.push('unrequested_player_move');
        if (invariant === 'no_relationship_change'
            && JSON.stringify(saved.session.npcRelationships || {})
                !== JSON.stringify(fixture.session.npcRelationships || {}))
            flags.push('unjustified_relationship_change');
        if (invariant === 'no_invented_compass'
            && (JSON.stringify(saved.session.inventory || [])
                !== JSON.stringify(fixture.session.inventory || [])
                || hasEffect('item_transfer')))
            flags.push('unjustified_item_transfer');
        if (invariant === 'no_invented_location'
            && (saved.world.locations.some(location => location.id === 'void_archive')
                || saved.session.entityStates?.linda?.location === 'void_archive'))
            flags.push('invented_location');
        if (invariant === 'player_red_cloak'
            && (!/red cloak/iu.test(saved.session.outfit || '')
                || !hasEffect('outfit_set', 'player')))
            flags.push('missing_player_outfit');
        if (invariant === 'known_compass_recall'
            && (!/silver compass/iu.test(narrative)
                || !/letter\s*(?:3|three)|third\s+letter/iu.test(narrative)))
            flags.push('missing_known_compass_recall');
        if (invariant === 'npc_walk_response' && !/room_2/iu.test(narrative))
            flags.push('missing_npc_walk_response');
    }
    const firstParagraph = narrative.split(/\n\s*\n/u)[0].trim();
    if (firstParagraph && firstParagraph.toLocaleLowerCase() === fixture.input.trim().toLocaleLowerCase())
        flags.push('verbatim_player_echo');
    if (fixture.scenario === 'repair'
        && narrative.trim().toLocaleLowerCase() === fixture.input.trim()
            .replace(/^I\b/u, 'You').toLocaleLowerCase())
        flags.push('gesture_without_world_response');
    else if (fixture.input.length > 55) {
        const firstWords = value => (String(value).match(/[\p{L}\p{N}]+/gu) || [])
            .slice(0, 10).map(word => word.toLocaleLowerCase()).join(' ');
        if (firstWords(firstParagraph) && firstWords(firstParagraph) === firstWords(fixture.input))
            flags.push('player_echo_prefix');
    }
    const needsReview = ['two_questions', 'mixed_npc', 'mixed_effects',
        'blocked_chain', 'invalid_reference', 'relation', 'long_input', 'dense'].includes(fixture.scenario);
    return { status: flags.length ? 'fail' : needsReview ? 'unclear' : 'pass', flags };
}
async function validateProposal(fixture, variant, raw) {
    const boundSchema = fixture.request.response_format.json_schema.schema;
    const errors = [];
    let proposal = raw;
    if (variant === 'compact') {
        const decoded = compactTransport.decode(raw, boundSchema);
        if (!decoded.ok) return { ok: false, stage: 'adapter', errors: decoded.errors };
        proposal = decoded.proposal;
    } else {
        errors.push(...binding.validate(raw, boundSchema));
        if (errors.length) return { ok: false, stage: 'schema', errors };
    }
    const context = { turnId: `ab_${fixture.scenario}`, input: fixture.input,
        now: fixture.now, allowCommitments: true,
        questIds: (fixture.session.quests || []).map(item => item.id),
        commitmentIds: (fixture.session.scheduledEvents || []).map(item => item.id) };
    const bound = binding.bind(proposal, context, fixture.canonical);
    if (!bound.ok) return { ok: false, stage: 'binding', errors: bound.errors };
    if (process.env.HORDE_AB_DEBUG) console.log('AB_BOUND', JSON.stringify({
        scenario: fixture.scenario, variant, actions: bound.draft.actions,
        narrative: bound.draft.narrative, events: bound.draft.events,
        speech: bound.draft.speech }).slice(0, 6000));
    const present = (fixture.world.entities || []).filter(entity =>
        (fixture.session.entityStates?.[entity.id]?.location || entity.startLocation)
        === fixture.session.playerLocation).map(entity => entity.id);
    const compiled = scene.compile(bound.draft, { input: fixture.input,
        location: fixture.session.playerLocation, playerStart: fixture.session.playerLocation,
        present, locations: fixture.world.locations.map(location => location.id), now: fixture.now,
        commitments: fixture.session.scheduledEvents || [], linkedRequired: true,
        contract: fixture.canonical });
    if (!compiled.ok) return { ok: false, stage: 'compile', errors: compiled.errors };
    const world = clone(fixture.world), session = clone(fixture.session);
    const executed = linked.executeLinkedActions(compiled.linkedPlan, world, session,
        { worldActionIds: bound.binding.worldActionIds });
    if (!executed.ok) return { ok: false, stage: 'execution', errors: executed.errors || [] };
    let saved;
    try {
        await executed.working.commit(async candidate => {
            saved = JSON.parse(JSON.stringify({ world: candidate.world, session: candidate.session }));
        });
    } catch (error) {
        return { ok: false, stage: 'save', errors: [error.message] };
    }
    assert.deepEqual(saved, JSON.parse(JSON.stringify({ world, session })),
        'detached save must match the committed candidate');
    const spans = bound.binding.actionSpans || [];
    const coverage = spans.length && spans[0].start === 0
        && spans.at(-1).end === fixture.input.length
        && spans.every((span, index) => !index || span.start === spans[index - 1].end
            || !fixture.input.slice(spans[index - 1].end, span.start).trim());
    if (!coverage) return { ok: false, stage: 'intent_coverage', errors: [] };
    const narrative = String(executed.narrative || '');
    const quality = fixtureQuality(fixture, saved, executed, narrative);
    return { ok: true, stage: 'accepted', detachedCommitted: true,
        actionCount: bound.draft.actions.length,
        playerActionCount: spans.length, reactionCount: bound.binding.worldActionIds.length,
        verifiedEffects: executed.verifiedEffects.length,
        verifiedEvents: executed.verifiedEvents.length,
        eventTypes: executed.verifiedEvents.map(event => event.type),
        outcome: [...executed.outcomes], narrative, qualityStatus: quality.status,
        qualityFlags: quality.flags,
        repairs: bound.binding.repairs.length + (compiled.repairs?.length || 0) };
}
async function callModel(fixture, variant, feedback, model) {
    const boundSchema = fixture.request.response_format.json_schema.schema;
    const format = variant === 'compact' ? compactTransport.compactSchema(boundSchema) : clone(boundSchema);
    if (variant === 'current_before') format.properties.actions.description =
        format.properties.actions.description.replace(' without duplicated wording', '');
    if (variant === 'p1b5_before') {
        delete format.properties.actions.items.properties.status.description;
        format.properties.actions.items.properties.effects.description =
            'Only real lasting changes, using the supported typed operations. [] means no change.';
    }
    const messages = messagesFor(fixture, variant);
    if (feedback) messages.push({ role: 'system', content: `The previous proposal was not saved. Correct the complete JSON response under the same schema. Preserve valid independent player steps and NPC reactions. Validation feedback: ${JSON.stringify(feedback).slice(0, 2500)}` });
    const body = provider === 'ollama'
        ? { model, messages, stream: false, format, options: settings, keep_alive: '30m' }
        : { model, messages, stream: false,
            response_format: { type: 'json_schema', json_schema: {
                name: 'world_v3_regression', strict: true, schema: format } },
            temperature: settings.temperature, top_p: settings.top_p,
            seed: settings.seed, max_tokens: settings.num_predict };
    const started = performance.now();
    let response, result;
    try {
        response = await fetch(endpoint.replace(/\/$/u, '')
            + (provider === 'ollama' ? '/api/chat' : '/chat/completions'), { method: 'POST',
            headers: { 'content-type': 'application/json',
                ...(provider !== 'ollama' && process.env.HORDE_AB_API_KEY
                    ? { authorization: `Bearer ${process.env.HORDE_AB_API_KEY}` } : {}) },
            body: JSON.stringify(body), signal: AbortSignal.timeout(240000) });
        result = await response.json();
    } catch (error) {
        return { requestCharacters: JSON.stringify(body).length,
            elapsedMs: Math.round(performance.now() - started), promptTokens: null,
            outputTokens: null, error: error.message };
    }
    const elapsedMs = Math.round(performance.now() - started);
    if (!response.ok || result.error) return { requestCharacters: JSON.stringify(body).length,
        elapsedMs, promptTokens: null, outputTokens: null,
        error: result.error || `HTTP ${response.status}` };
    const text = provider === 'ollama' ? result.message?.content || ''
        : result.choices?.[0]?.message?.content || '';
    let proposal, parseError;
    try { proposal = JSON.parse(text); } catch (error) { parseError = error.message; }
    return { requestCharacters: JSON.stringify(body).length, elapsedMs,
        promptTokens: provider === 'ollama' ? result.prompt_eval_count ?? null
            : result.usage?.prompt_tokens ?? null,
        outputTokens: provider === 'ollama' ? result.eval_count ?? null
            : result.usage?.completion_tokens ?? null,
        totalDurationMs: provider === 'ollama' && result.total_duration
            ? Math.round(result.total_duration / 1e6) : null,
        proposal, parseError, outputCharacters: text.length };
}
async function runPair(fixture, model, reverse = false) {
    const pair = { scenario: fixture.scenario, model, settings, variants: {} };
    for (const variant of reverse ? [...variants].reverse() : variants) {
        const calls = [];
        let feedback = null;
        for (let attempt = 0; attempt < Number(process.env.HORDE_AB_ATTEMPTS || 2); attempt++) {
            const call = await callModel(fixture, variant, feedback, model);
            const validation = call.proposal ? await validateProposal(fixture, variant, call.proposal)
                : { ok: false, stage: call.error ? 'provider' : 'parse',
                    errors: [call.error || call.parseError || 'empty_response'] };
            if (process.env.HORDE_AB_DEBUG) console.log('AB_DEBUG', JSON.stringify({
                scenario: fixture.scenario, variant, attempt, proposal: call.proposal,
                stage: validation.stage, errors: validation.errors }).slice(0, 5000));
            calls.push({ ...call, proposal: undefined, validation });
            if (validation.ok) break;
            feedback = { stage: validation.stage, errors: validation.errors };
            if (call.error) break;
        }
        pair.variants[variant] = { calls,
            firstPassEngineAccepted: !!calls[0]?.validation.ok,
            firstPassFixtureAccepted: calls[0]?.validation.qualityStatus === 'pass',
            engineAccepted: !!calls.at(-1)?.validation.ok,
            detachedCommitted: !!calls.at(-1)?.validation.detachedCommitted,
            fixtureAccepted: calls.at(-1)?.validation.qualityStatus === 'pass',
            fixtureUnclear: calls.at(-1)?.validation.qualityStatus === 'unclear',
            totalInputTokens: calls.every(call => call.promptTokens != null)
                ? calls.reduce((sum, call) => sum + call.promptTokens, 0) : null,
            totalOutputTokens: calls.every(call => call.outputTokens != null)
                ? calls.reduce((sum, call) => sum + call.outputTokens, 0) : null,
            totalElapsedMs: calls.reduce((sum, call) => sum + call.elapsedMs, 0) };
        const final = calls.at(-1)?.validation;
        console.log('AB_VARIANT', JSON.stringify({ scenario: fixture.scenario, model, variant,
            firstPassEngineAccepted: pair.variants[variant].firstPassEngineAccepted,
            firstPassFixtureAccepted: pair.variants[variant].firstPassFixtureAccepted,
            engineAccepted: pair.variants[variant].engineAccepted,
            detachedCommitted: pair.variants[variant].detachedCommitted,
            fixtureAccepted: pair.variants[variant].fixtureAccepted,
            fixtureUnclear: pair.variants[variant].fixtureUnclear,
            calls: calls.length, inputTokens: pair.variants[variant].totalInputTokens,
            outputTokens: pair.variants[variant].totalOutputTokens,
            requestCharacters: calls.map(call => call.requestCharacters),
            elapsedMs: pair.variants[variant].totalElapsedMs,
            stages: calls.map(call => call.validation.stage),
            causes: calls.flatMap(call => call.validation.errors || []).map(error =>
                typeof error === 'object' ? `${error.reason}:${error.detail || ''}` : error).slice(0, 8),
            result: final?.ok ? { playerActions: final.playerActionCount,
                reactions: final.reactionCount, verifiedEffects: final.verifiedEffects,
                verifiedEvents: final.verifiedEvents, eventTypes: final.eventTypes,
                qualityStatus: final.qualityStatus, qualityFlags: final.qualityFlags,
                outcome: final.outcome,
                narrative: String(final.narrative || '').slice(0, 500) } : null }));
    }
    return pair;
}
async function modelsForRun() {
    if (provider !== 'ollama') return [...new Set(modelNames)].map(id => ({ id,
        digest: null, declaredContextWindow: null,
        structuredOutput: 'json_schema_requested_support_unverified' }));
    const response = await fetch(endpoint.replace(/\/$/u, '') + '/api/tags',
        { signal: AbortSignal.timeout(10000) });
    assert(response.ok, `Ollama model inventory failed: HTTP ${response.status}`);
    const tags = (await response.json()).models || [];
    const seen = new Set(), selected = [];
    for (const id of modelNames) {
        const tag = tags.find(item => item.name === id);
        assert(tag, `Ollama model unavailable: ${id}`);
        const identity = tag.digest || id;
        if (seen.has(identity)) {
            console.log('MODEL_ALIAS_SKIPPED', JSON.stringify({ id, digest: tag.digest || null }));
            continue;
        }
        seen.add(identity);
        let declaredContextWindow = null;
        try {
            const shown = await fetch(endpoint.replace(/\/$/u, '') + '/api/show', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ model: id }), signal: AbortSignal.timeout(10000) });
            if (shown.ok) {
                const info = (await shown.json()).model_info || {};
                declaredContextWindow = Object.entries(info).find(([key]) =>
                    key.endsWith('.context_length'))?.[1] || null;
            }
        } catch { /* model metadata is optional; the requested window is logged below */ }
        selected.push({ id, digest: tag.digest || null, declaredContextWindow,
            structuredOutput: 'ollama_json_schema_requested_support_unverified' });
    }
    return selected;
}
async function main() {
    if (process.env.HORDE_AB_ENGINE_ONLY === '1') {
        for (const audit of engineAudits) {
            const run = spawnSync(process.execPath, [path.join(__dirname, audit.file)], {
                encoding: 'utf8', env: process.env, maxBuffer: 2 * 1024 * 1024 });
            console.log('ENGINE_AUDIT', JSON.stringify({ ...audit, passed: run.status === 0,
                detail: (run.status === 0 ? run.stdout : run.stderr || run.stdout).trim().slice(0, 1200) }));
            assert.equal(run.status, 0, `${audit.file}: ${run.stderr || run.stdout}`);
        }
        return;
    }
    const captured = captureFixtures();
    const selected = [...new Set(names)].map(name => {
        const entry = cases[name];
        assert(entry, `fixture ${name} unavailable`);
        const base = captured.find(item => item.scenario === entry.source);
        assert(base, `source fixture ${entry.source} unavailable`);
        const fixture = entry.input ? deriveFixture(base, name) : clone(base);
        const fingerprint = createHash('sha256').update(JSON.stringify({
            world: fixture.world, session: fixture.session, input: fixture.input
        })).digest('hex');
        return { fixture, catalog: { name, source: entry.source,
            input: fixture.input, initialStateSha256: fingerprint,
            invariants: entry.invariants, knownFailures: entry.knownFailures } };
    });
    const models = await modelsForRun();
    console.log('FIXTURE_CATALOG', JSON.stringify(selected.map(item => item.catalog)));
    console.log('ENGINE_FIXTURES', JSON.stringify(engineAudits));
    models.forEach(model => console.log('MODEL_CONFIG', JSON.stringify({ ...model,
        provider, settings, effectiveContextSetting: provider === 'ollama'
            ? settings.num_ctx : 'provider_managed',
        structuredOutputRequested: provider === 'ollama' ? 'format_json_schema'
            : 'response_format_json_schema' })));
    const results = [];
    for (const [fixtureIndex, item] of selected.entries())
        for (const [modelIndex, model] of (fixtureIndex % 2 ? [...models].reverse() : models).entries())
            results.push(await runPair(item.fixture, model.id, (fixtureIndex + modelIndex) % 2 === 1));
    const summary = models.map(model => {
        const rows = results.filter(row => row.model === model.id).flatMap(row =>
            Object.entries(row.variants).map(([variant, result]) => ({ scenario: row.scenario,
                variant, ...result })));
        const sumKnown = key => rows.every(row => row[key] !== null)
            ? rows.reduce((total, row) => total + row[key], 0) : null;
        return { model: model.id, cases: rows.length,
            firstPass: rows.filter(row => row.firstPassEngineAccepted).length,
            finalAccepted: rows.filter(row => row.engineAccepted).length,
            fixturePass: rows.filter(row => row.fixtureAccepted).length,
            fixtureUnclear: rows.filter(row => row.fixtureUnclear).length,
            repairs: rows.reduce((total, row) => total + Math.max(0, row.calls.length - 1), 0),
            inputTokens: sumKnown('totalInputTokens'), outputTokens: sumKnown('totalOutputTokens'),
            elapsedMs: rows.reduce((total, row) => total + row.totalElapsedMs, 0),
            causes: [...new Set(rows.flatMap(row => row.calls.flatMap(call =>
                (call.validation.errors || []).map(error => typeof error === 'object'
                    ? error.reason || error.code : String(error)))))] };
    });
    console.log('MODEL_SUMMARY', JSON.stringify(summary));
    if (process.env.HORDE_AB_REPORT) fs.writeFileSync(path.resolve(process.env.HORDE_AB_REPORT),
        JSON.stringify({ provider, settings, models, fixtures: selected.map(item => item.catalog),
            results, summary }, null, 2));
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
