// Opt-in local integration test. No saved worlds or remote paid providers.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const client = require('../worlds/model-client');
const intent = require('../worlds/resolved-intent');
const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const start = app.indexOf('const body = { model:', app.indexOf('const interpretWorldAction ='));
const end = app.indexOf('turnCallAudit.intentInterpretationCalls', start);
const build = new Function('canonicalWorld', 'state', 'HordeResolvedIntent', 'references', 'input',
    app.slice(start, end) + 'return body;');
const models = (process.env.HORDE_INTENT_MODELS || 'qwen2.5:14b,ministral-3:14b').split(',');
const refs = { currentLocation: { id: 'garden', name: 'Garten',
    items: [{ id: 'apple', name: 'Apfel' }], exits: [], people: [{ id: 'jonas', name: 'Jonas' }] },
    locations: [{ id: 'garden', name: 'Garten' }],
    items: [{ id: 'apple', name: 'Apfel' }], playerInventory: [], interactables: [] };
const references = [{ id: 'garden' }, { id: 'jonas', name: 'Jonas' }, { id: 'apple', name: 'Apfel', type: 'item' }];
const cases = [
    ['Ich pflücke einen Apfel vom Baum.', 'transfer', 'take'],
    ['I pick an apple from the tree.', 'transfer', 'take'],
    ['Ich lege den Apfel auf den Boden.', 'transfer', 'drop'],
    ['I put the apple on the ground.', 'transfer', 'drop'],
    ["Ich warte auf Jonas' Antwort.", 'wait'],
    ['I wait for Jonas to answer.', 'wait'],
    ['Ich frage Jonas, was er heute vorhat.', 'question'],
    ['I ask Jonas what he plans to do today.', 'question'],
    ['Ich frage Jonas: „What are your plans? Und morgen?“', 'question'],
    ['Ich nehme den Apfel, then I put it on the ground.', 'transfer', 'take', 'drop']
];
(async () => {
    const results = [];
    for (const model of models) {
        await client.prepareLocalModel({ url: 'http://127.0.0.1:11434/v1/chat/completions', model,
            signal: AbortSignal.timeout(180000), onLoading: () => console.log(`Loading ${model}`) });
        for (const [input, kind, operation, secondOperation] of cases) {
            const worldRefs = JSON.parse(JSON.stringify(refs));
            if (operation === 'drop') { worldRefs.playerInventory = worldRefs.items; worldRefs.currentLocation.items = []; }
            const body = build({ model }, {}, intent, worldRefs, input);
            const started = Date.now();
            let result;
            try {
                const { response, data } = await client.json({ url: 'http://127.0.0.1:11434/v1/chat/completions', body,
                    init: { method: 'POST', headers: { 'Content-Type': 'application/json' } }, timeoutMs: 120000 });
                if (!response.ok) throw client.responseError(response, data);
                const parsed = client.structuredCompletion(data);
                const normalized = intent.normalizeProposal(parsed, { input, references, people: refs.currentLocation.people });
                const checked = intent.validate(normalized, { input, references });
                const actions = checked.intent?.steps.filter(step => step.kind !== 'context') || [];
                const accepted = checked.ok && actions[0]?.kind === kind
                    && (!operation || actions[0]?.operation === operation)
                    && (!secondOperation || actions[1]?.operation === secondOperation)
                    && (kind !== 'wait' || actions[0]?.minutes === undefined)
                    && (kind !== 'question' || actions[0]?.target_ids?.includes('jonas'));
                result = { model, input, status: response.status, accepted, raw: data,
                    normalized, errors: checked.errors, durationMs: Date.now() - started };
            } catch (error) { result = { model, input, accepted: false, error: error.message, code: error.code }; }
            results.push(result);
            console.log(`${result.accepted ? 'PASS' : 'FAIL'} ${model}: ${input}`);
            fs.writeFileSync(path.join(__dirname, 'world-generalized-live-results.json'), JSON.stringify(results, null, 2));
        }
    }
    if (results.some(result => !result.accepted)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
