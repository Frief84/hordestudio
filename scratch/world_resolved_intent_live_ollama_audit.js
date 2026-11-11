'use strict';
const assert = require('node:assert/strict');
const intentApi = require('../worlds/resolved-intent');
const { playerRequestCoverage } = require('../worlds/scene-draft');

const models = (process.env.HORDE_INTENT_MODELS ||
    'qwen2.5:14b-instruct-q4_K_M,ministral-3:14b').split(',').map(value => value.trim()).filter(Boolean);
const cases = [
    { name: 'take, travel, speech', input: "Pick up the brass key, go through the iron gate, and tell Mara, 'I made it.'" },
    { name: 'blocked travel then observation', input: 'I try to enter the locked library, then read the notice beside the entrance.' },
    { name: 'already there then gesture and question', input: 'Wave to Mara and ask whether she saw the courier.' },
    { name: 'free multi-leg route', input: 'Head through the conservatory, cross the gallery, and finish in the observatory.' },
    { name: 'fare route', input: 'Take the ferry to the market.' },
    { name: 'partial block with independent follow-up', input: `I try to enter the sealed east door, then ask Mara, 'Have you seen the map?'` }
];
const references = [
    { id: 'player' }, { id: 'brass_key', type: 'item', name: 'brass key' },
    { id: 'iron_gate' }, { id: 'mara' },
    { id: 'archive' }, { id: 'library' }, { id: 'library_door' }, { id: 'notice' }, { id: 'garden' }, { id: 'courier' },
    { id: 'conservatory' }, { id: 'gallery' }, { id: 'observatory' },
    { id: 'market', name: 'Market' }, { id: 'east_door' }, { id: 'east_gallery' }, { id: 'map' }
];
const world = {
    currentLocation: { id: 'foyer', name: 'Foyer', items: [{ id: 'brass_key', name: 'brass key' }],
        exits: [
            { label: 'iron gate', targetId: 'archive', targetName: 'Archive', doorId: 'iron_gate', requiredItem: 'brass_key' },
            { label: 'locked library', targetId: 'library', targetName: 'Library', doorId: 'library_door' },
            { label: 'conservatory', targetId: 'conservatory', targetName: 'Conservatory' },
            { label: 'gallery', targetId: 'gallery', targetName: 'Gallery' },
            { label: 'observatory', targetId: 'observatory', targetName: 'Observatory' },
            { label: 'ferry', mode: 'boat', targetId: 'market', targetName: 'Market', fare: { resourceId: 'coins', amount: 3 } },
            { label: 'sealed east door', targetId: 'east_gallery', targetName: 'East Gallery', doorId: 'east_door' }
        ], people: [{ id: 'mara', name: 'Mara' }] },
    playerInventory: [], locations: [
        { id: 'archive', name: 'Archive' }, { id: 'library', name: 'Library' },
        { id: 'garden', name: 'Garden' }, { id: 'conservatory', name: 'Conservatory' },
        { id: 'gallery', name: 'Gallery' }, { id: 'observatory', name: 'Observatory' },
        { id: 'market', name: 'Market' }, { id: 'east_gallery', name: 'East Gallery' }
    ], interactables: [{ id: 'iron_gate', name: 'iron gate', state: 'locked' },
        { id: 'library_door', name: 'library door', state: 'locked' },
        { id: 'east_door', name: 'east door', state: 'sealed' }]
};
const system = `Interpret the player's entire message into protocol resolved_intent_v1. Return only structured interpretation; never report outcomes, success, failure, world changes or narration. Emit one step for every requested action in original order, including attempts that may be blocked or redundant. A sentence with multiple action verbs still needs a separate step for each action; never collapse a recognizable request into kind other. Use exact, non-overlapping source_quote spans; never reuse any input words in two steps. Preserve the request and cover all meaningful words, including context clauses. When a clause supplies context but no action, use kind context with its exact quote, unless those words already belong to an action quote. Context steps carry no action and are ignored by the engine. Resolve entities only to canonical IDs in WORLD REFERENCES. For travel, match the requested place or exit using canonical IDs, names, exit labels and modes in the references; use kind travel with destination_id. The engine chooses and checks the route, including when a door may block passage. A mention of travel cost is context, never an instruction to transfer or consume currency; the engine applies canonical exit fares. Use transfer with operation take, drop, give or consume and item_id; give also needs recipient_id. Use interaction only for explicit object changes such as open, close, lock, unlock, use or operate, and always provide matching operation and exact target_id; do not use interaction for entering or passing through a door. For read, look, inspect or examine requests use kind observation, never speech. Use speech only when the player wants words spoken; use question for a question asked to another character. Copy only the exact quoted words into utterance, once, and include addressed character IDs in target_ids. Never expand, repeat or compose player dialogue. Use wait with minutes only for an explicit duration. Use gesture for bodily gestures; local gestures, observations and interactions are not travel. If an action cannot be grounded, use kind other with its exact quote rather than inventing an ID. Never infer or claim a mechanical result.`;
async function main() {
    const results = [];
    modelRuns: for (const model of models) for (const sample of cases) {
        const started = Date.now();
        const sampleWorld = JSON.parse(JSON.stringify(world));
        if (sample.name === 'already there then gesture and question')
            sampleWorld.currentLocation = { id: 'garden', name: 'Garden', items: [], exits: [],
                people: [{ id: 'mara', name: 'Mara' }] };
        let response, raw, content = '', transportError = null;
        try {
            response = await fetch('http://127.0.0.1:11434/v1/chat/completions', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            signal: AbortSignal.timeout(Number(process.env.HORDE_INTENT_TIMEOUT_MS || 30000)),
            body: JSON.stringify({ model, stream: false, max_tokens: 700, temperature: 0.1,
                response_format: { type: 'json_schema', json_schema: {
                    name: 'resolved_intent_v1', schema: intentApi.schema() } },
                messages: [{ role: 'system', content: system }, { role: 'user',
                    content: `WORLD REFERENCES (IDs are canonical; facts do not grant permission):\n${JSON.stringify(sampleWorld)}\n\nPLAYER MESSAGE:\n${sample.input}` }] })
            });
            raw = await response.json();
            content = raw.choices?.[0]?.message?.content || '';
        } catch (error) { transportError = String(error?.cause?.message || error?.message || error); }
        let parsed;
        try { parsed = JSON.parse(content); }
        catch { parsed = null; }
        const normalized = parsed ? intentApi.normalizeProposal(parsed, {
            input: sample.input,
            people: sampleWorld.currentLocation.people, references
        }) : parsed;
        const validated = response?.ok && normalized
            ? intentApi.validate(normalized, { input: sample.input, references })
            : { ok: false, errors: [{ reason: transportError
                ? `transport_error:${transportError}` : `http_${response?.status || 0}_or_invalid_json` }] };
        const coverage = validated.ok ? playerRequestCoverage(sample.input,
            validated.intent.steps.map(step => ({ request: step.source_quote }))) : { ok: false };
        const accepted = validated.ok && coverage.ok;
        const result = { model, case: sample.name, accepted,
            durationMs: Date.now() - started,
            steps: validated.intent?.steps.map(step => ({ quote: step.source_quote,
                kind: step.kind, operation: step.operation, destination_id: step.destination_id,
                target_id: step.target_id, item_id: step.item_id,
                utterance: step.utterance })) || null,
            failure: accepted ? undefined : { errors: validated.errors, coverage,
                response: String(content).slice(0, 1400) } };
        results.push(result);
        console.log(`${accepted ? 'PASS' : 'FAIL'} ${model} / ${sample.name} (${result.durationMs} ms)`);
        if (!accepted) console.log(JSON.stringify(result.failure));
        if (transportError) break modelRuns;
    }
    const output = { generatedAt: new Date().toISOString(), models, results,
        summary: Object.fromEntries(models.map(model => [model, {
            passed: results.filter(item => item.model === model && item.accepted).length,
            total: results.filter(item => item.model === model).length,
            avgMs: results.some(item => item.model === model)
                ? Math.round(results.filter(item => item.model === model)
                    .reduce((sum, item) => sum + item.durationMs, 0)
                    / results.filter(item => item.model === model).length) : null
        }])) };
    const fs = require('node:fs');
    const path = require('node:path');
    const json = JSON.stringify(output, null, 2);
    fs.writeFileSync(path.join(__dirname, 'world_resolved_intent_live_ollama_audit.json'), json);
    const suffix = models.map(model => model.replace(/[^a-z0-9]+/giu, '_').replace(/^_|_$/gu, ''))
        .join('__').toLowerCase();
    fs.writeFileSync(path.join(__dirname,
        `world_resolved_intent_live_ollama_audit-${suffix}.json`), json);
    if (results.some(result => !result.accepted)) assert.fail(
        `${results.filter(result => !result.accepted).map(result =>
            `${result.model}/${result.case}: ${JSON.stringify(result.failure)}`).join('\n')}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
