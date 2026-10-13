/** Real World turn pipeline, isolated browser storage and scripted HTTP only. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');
(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext();
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname !== 'world-latency.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
                return route.fulfill({ status: 404, body: '' });
            return route.fulfill({ contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
        });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('https://world-latency.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
        const results = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer);
            state.apiKey = 'offline'; state.globalSettings.apiProvider = 'openrouter';
            const realFetch = window.fetch, results = [];
            for (const scenario of ['show', 'approach', 'gesture', 'missing_item', 'absent_actor', 'give',
                'early_tool', 'early_content', 'bad_twice', 'stale', 'tagged', 'plain_json', 'no_tools', 'local', 'local_no_schema', 'legacy', 'old_memory', 'old_prose']) {
                const world = { id: `latency_${scenario}`, name: 'Office', model: 'offline/model',
                    contextSize: 32768, maxTokens: 2048, dmPrompt: 'Linda waits in the office.',
                    startLocationId: 'office', locations: [{ id: 'office', name: 'Office', exits: [] }],
                    entities: [{ id: 'linda', name: 'Linda', type: 'npc', startLocation: 'office', persona: 'Archivist' }],
                    kernel: { sceneDrafts: true, ...(scenario === 'legacy' ? { sceneDraftProtocol: 'scene_draft_v2' } : {}) },
                    gameRules: { profileId: 'adventure', modules: { inventory: true } },
                    hudConfig: { startTimeHours: 9, startTimeMinutes: 0, timeStep: 5 } };
                state.worlds = [world]; state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
                state.activeWorldId = world.id;
                state.globalSettings.apiProvider = scenario.startsWith('local') ? 'local' : 'openrouter';
                state.globalSettings.localBaseUrl = 'http://127.0.0.1:1234/v1';
                const sess = prepareCurrentWorldSession(); sess.setupComplete = true;
                sess.entityStates.linda.location = scenario === 'absent_actor' ? 'elsewhere' : 'office';
                sess.inventory = scenario === 'missing_item' ? [] : ['letter'];
                for (let i = 0; i < 8; i++) sess.history.push(
                    { id: `u${i}`, role: 'user', text: `Old question ${i}.`, location: 'office' },
                    { id: `d${i}`, role: 'dm', text: `Old answer ${i}.`, location: 'office',
                        sceneMemory: { receiptId: `r${i}`, location: 'office', turn: i,
                            records: [{ kind: 'event', text: `Old letter clue ${i}.` }] } });
                if (scenario === 'old_memory') {
                    sess.history[1].text = 'Linda promised to bring the silver compass after the festival.';
                    sess.history[1].sceneMemory = { receiptId: 'r0', location: 'garden', turn: 0,
                        records: [{ kind: 'testimony', actor: 'linda', listeners: ['player'], text: sess.history[1].text }] };
                }
                if (scenario === 'old_prose') {
                    sess.history[1].text = 'The festival password was marigold.';
                    sess.history[1].sceneMemory = { records: [] };
                    sess.history[1].witnesses = ['linda'];
                }
                switchView('worldPlay'); renderWorldPlayState();
                const input = scenario === 'old_memory' ? 'What had she promised?'
                    : scenario === 'old_prose' ? 'What was the festival password?'
                    : scenario === 'approach' ? 'I approach Linda.' : scenario === 'gesture' ? 'I wave.'
                    : scenario === 'give' ? 'I give Linda the letter.' : 'I show Linda the letter.';
                const narrative = scenario === 'old_memory' ? 'Linda promised to bring the silver compass after the festival.'
                    : scenario === 'old_prose' ? 'The festival password was marigold.'
                    : scenario === 'approach' ? 'You approach Linda beside the desk.'
                    : scenario === 'gesture' ? 'You wave; Linda smiles back.'
                    : scenario === 'give' ? 'You give Linda the letter; she takes it from your hand.'
                    : 'Linda studies the letter you hold up.';
                let calls = 0, cancelled = false, signalAborted = false, repairObservedCleanState = false;
                const inventoryNames = () => JSON.stringify(sess.inventory.map(item => typeof item === 'string' ? item : item.name));
                const requests = [], initialInventory = inventoryNames();
                window.fetch = async (url, options = {}) => {
                    if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                    calls++; if (calls > 3) throw Error('Unbounded correction');
                    const body = JSON.parse(options.body); requests.push(body);
                    if (scenario === 'old_memory' && !JSON.stringify(body.messages).includes('silver compass'))
                        throw Error('Old promise missing from actual provider prompt');
                    if (scenario === 'old_prose' && !JSON.stringify(body.messages).includes('marigold'))
                        throw Error('Old prose detail missing from actual provider prompt');
                    if (scenario === 'stale' && calls === 1) sess.worldStateVersion = (sess.worldStateVersion || 0) + 1;
                    if (scenario === 'no_tools' && calls === 1)
                        return new Response('{"error":{"message":"tools unsupported"}}', { status: 400 });
                    if (scenario === 'local_no_schema' && calls === 1)
                        return new Response('{"error":{"message":"response_format json_schema unsupported"}}', { status: 400 });
                    if (calls === 2) repairObservedCleanState = inventoryNames() === initialInventory
                        && !sess.history.some(m => m.text?.includes('UNVERIFIED'));
                    const draft = { protocol: scenario === 'legacy' ? 'scene_draft_v2' : 'scene_draft_v3',
                        narrative: [{ id: 'p1', text: narrative }],
                        actions: [{ kind: scenario.startsWith('old_') ? 'question' : 'physical',
                            status: scenario.startsWith('old_') ? 'answered' : 'resolved', response_id: 'p1' }] };
                    if (scenario === 'legacy') Object.assign(draft, { events: [], effects: {}, speech: [], commitments: [] });
                    if (scenario === 'legacy') draft.actions[0].request = input;
                    if (scenario === 'give') draft.events = [{ type: 'inventory', actor_id: 'player', status: 'completed', action: 'give', item: 'letter', passage_id: 'p1' }];
                    const failEarly = ['early_tool', 'early_content', 'bad_twice'].includes(scenario) && calls === 1;
                    if (failEarly) {
                        // A deliberately unfinished response: the closed invalid
                        // enum is enough to stop before the long narrative.
                        const raw = '{"protocol":"scene_draft_v3","actions":[{"kind":"physical","status":"impossible"';
                        const delta = scenario === 'early_content' ? { content: raw } : {
                            tool_calls: [{ index: 0, id: 'draft', type: 'function', function: { name: 'commit_world_turn', arguments: raw } }] };
                        options.signal.addEventListener('abort', () => { signalAborted = true; });
                        return new Response(new ReadableStream({
                            start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`)); },
                            cancel() { cancelled = true; }
                        }), { headers: { 'Content-Type': 'text/event-stream' } });
                    }
                    if (scenario === 'bad_twice') draft.actions[0].status = 'impossible';
                    const raw = JSON.stringify(draft);
                    const useContent = !body.tools || ['plain_json', 'tagged', 'early_content', 'local'].includes(scenario);
                    const message = useContent ? { content: scenario === 'tagged' || scenario === 'no_tools' ? `<world_turn_receipt>${raw}</world_turn_receipt>` : raw }
                        : { tool_calls: [{ index: 0, id: 'draft', type: 'function', function: { name: 'commit_world_turn', arguments: raw } }] };
                    if (!body.stream || scenario === 'plain_json') return new Response(JSON.stringify({ choices: [{ message }],
                        usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 } }), { headers: { 'Content-Type': 'application/json' } });
                    // Split tool arguments/content into tiny SSE deltas, then
                    // split the UTF-8 response again at unrelated byte offsets.
                    const frames = [];
                    const value = useContent ? message.content : raw;
                    for (let i = 0; i < value.length; i += 7) frames.push(`data: ${JSON.stringify({ choices: [{ delta: useContent
                        ? { content: value.slice(i, i + 7) }
                        : { tool_calls: [{ index: 0, ...(i ? {} : { id: 'draft', type: 'function' }), function: { ...(i ? {} : { name: 'commit_world_turn' }), arguments: value.slice(i, i + 7) } }] } }] })}\n\n`);
                    frames.push('data: [DONE]\n\n');
                    const bytes = new TextEncoder().encode(frames.join(''));
                    return new Response(new ReadableStream({ start(controller) {
                        for (let i = 0; i < bytes.length; i += 31) controller.enqueue(bytes.slice(i, i + 31)); controller.close();
                    } }), { headers: { 'Content-Type': 'text/event-stream' } });
                };
                document.getElementById('world-user-input').value = input;
                await executeWorldTurn();
                if (scenario === 'local_no_schema') {
                    document.getElementById('world-user-input').value = input;
                    await executeWorldTurn();
                }
                const last = sess.history.at(-1);
                results.push({ scenario, calls, cancelled, signalAborted, repairObservedCleanState,
                    text: last?.text, source: last?.stateSource, audit: safeJsonClone(last?.callAudit),
                    receipt: safeJsonClone(sess.lastTurnAudit), inventory: safeJsonClone(sess.inventory),
                    firstMessages: requests[0]?.messages, repair: requests[1], finalRequest: requests.at(-1),
                    schema: requests[0]?.tools?.find(t => t.function.name === 'commit_world_turn')?.function.parameters
                        || requests[0]?.response_format?.json_schema?.schema });
            }
            window.fetch = realFetch;
            return results;
        });
        for (const result of results) {
            const { scenario } = result;
            if (['missing_item', 'absent_actor', 'bad_twice', 'stale'].includes(scenario)) {
                assert.equal(result.calls, 2, JSON.stringify(result));
                assert.equal(result.source, 'frozen_no_receipt', JSON.stringify(result));
                assert(!result.text.includes('Linda studies'));
            } else {
                assert.equal(result.calls, scenario === 'local_no_schema' ? 3 : ['early_tool', 'early_content', 'no_tools'].includes(scenario) ? 2 : 1,
                    JSON.stringify({ ...result, firstMessages: undefined, schema: undefined, repair: undefined, finalRequest: undefined }));
                assert.notEqual(result.source, 'frozen_no_receipt', JSON.stringify(result));
                assert.equal(result.receipt.protocol, scenario === 'legacy' ? 'scene_draft_v2' : 'scene_draft_v3');
                assert(result.audit.metrics.acceptedDisplayMs >= 0);
                assert(result.audit.metrics.estimatedInputTokens > 0);
                assert(result.audit.metrics.outputCharacters > 0);
            }
            if (scenario.startsWith('early_') || scenario === 'bad_twice') {
                assert(result.cancelled && result.signalAborted, JSON.stringify(result));
                assert(result.repairObservedCleanState);
                assert.equal(result.audit.metrics.earlyAbortReason, 'invalid_stream_enum');
                assert.equal(result.audit.receiptRepair, 1);
            }
            if (scenario === 'give') assert.equal(result.inventory.length, 0);
            else if (scenario !== 'missing_item') assert.equal(result.inventory.length, 1);
            if (scenario === 'local_no_schema') assert.equal(result.finalRequest.response_format, undefined, 'remember unsupported schema capability');
            if (scenario.startsWith('old_')) {
                const oldSource = result.firstMessages.find(message => message.role === 'system' && message.content.includes('"sourceMessageId":"d0"'));
                assert(oldSource, 'old source must reach the real model input beyond the five-turn history');
                assert(oldSource.content.includes(scenario === 'old_memory' ? 'testimony' : 'narrative_excerpt'));
            }
            const history = result.firstMessages.filter(m => ['user', 'assistant'].includes(m.role));
            assert(!history.some(m => m.content.includes('Old answer 2.')));
            assert(history.some(m => m.content.includes('Old answer 3.')));
            assert(result.firstMessages[0].content.startsWith('[SCENE DRAFT V'));
            if (scenario !== 'legacy') assert.deepEqual(result.schema.required, ['protocol', 'narrative', 'actions']);
        }
        assert.deepEqual(errors, []);
        console.table(results.map(r => ({ scenario: r.scenario, requests: r.calls, result: r.source, earlyCancelled: r.cancelled })));
        console.log('PASS v3 actual turn path: local interaction guards, streaming early stop, single repair, tool/JSON/tag transport, v2 rollback, diagnostics and history');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
