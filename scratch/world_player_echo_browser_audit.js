/** World Play player-action boundary, raw provider prose, transcript and echo guard. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');
const baseline = process.argv.includes('--baseline');
const baselineApp = baseline ? execFileSync('git', [
    '-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'show', 'HEAD:app.js'
], { cwd: root, maxBuffer: 32 * 1024 * 1024 }) : null;

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext();
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname !== 'world-echo.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/'
                ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file)
                || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
            return route.fulfill({ contentType: { '.html': 'text/html', '.js': 'text/javascript',
                '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream',
                body: baseline && url.pathname === '/app.js' ? baselineApp : fs.readFileSync(file) });
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('https://world-echo.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
        const result = await page.evaluate(async baselineMode => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            const world = { id: 'echo_fixture', name: 'Echo Fixture', model: 'fixture/model',
                contextSize: 32768, maxTokens: 1500, dmPrompt: 'A quiet archive.', intro: '',
                startLocationId: 'hall', locations: [{ id: 'hall', name: 'Hall',
                    description: 'An archive hall.', exits: [] }],
                entities: [{ id: 'gloria', name: 'Gloria Bell', type: 'npc',
                    startLocation: 'hall', persona: 'An attentive archivist.' }],
                kernel: { enabled: true, memoryMode: 'ledger', repairMode: 'adaptive',
                    resolveFirst: false, sceneDrafts: false },
                hudConfig: { showClock: false, showQuests: false, showLedger: false, stats: [] },
                gameRules: { profileId: 'adventure', modules: { stats: false, health: false,
                    conditions: false, inventory: false, checks: false, commerce: false,
                    quests: false, relationships: false, schedules: false, livingWorld: false } } };
            state.worlds = [world];
            state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            state.apiKey = 'offline-fixture';
            state.globalSettings.apiProvider = 'openrouter';
            const sess = prepareCurrentWorldSession();
            sess.setupComplete = true;
            sess.history.push({ id: 'opening', role: 'dm', text: 'Gloria Bell waits beside the archive desk.', location: 'hall' });
            switchView('worldPlay'); renderWorldPlayState();
            const scenarios = [
                { input: 'I spread the old map across the desk, trace the northern road with one finger, and ask Gloria Bell whether the bridge is still open before I choose a route.',
                    output: 'Gloria Bell: “The northern bridge is closed. The eastern pass is still open.”' },
                { input: '“Please tell me what happened at the bridge last night, who was on duty, and whether anyone sent a warning before the crossing failed.”',
                    output: 'Gloria Bell: “The watch sent a warning at dawn. I have no record of what happened overnight.”' },
                { input: 'I fold the map, set it beside the ledger, and say, “Keep the eastern pass marked until we hear from the watch.” Then I wait for Gloria Bell to answer.',
                    output: 'Gloria Bell: “The eastern pass stays marked. I will tell you when the watch reports back.”' },
                { input: 'I compare the two entries in the ledger, point to the mismatched dates, and ask Gloria Bell to read the witness note aloud before she closes the book.',
                    output: 'Gloria Bell turns the page. “The witness note gives the earlier date,” she says, keeping the book open.' }
            ];
            let active = null;
            const requests = [];
            const raw = [];
            const realFetch = window.fetch;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                const body = JSON.parse(options.body || '{}');
                requests.push(body);
                const receipt = { summary: 'The conversation continues.',
                    scene: { player_location_id: 'hall', player_location_changed: false,
                        present_character_ids: ['gloria'] },
                    events: [], entity_updates: [], state_updates: {} };
                const output = active.output;
                if (active.followUp) {
                    if (body.stream) {
                        receipt.action_resolution = { kind: 'question', status: 'answered',
                            outcome: 'Gloria Bell confirms that the crossing closed at dawn.' };
                        const delta = { content: '', tool_calls: [{ index: 0, id: 'answer-receipt',
                            type: 'function', function: { name: 'commit_world_turn',
                                arguments: JSON.stringify(receipt) } }] };
                        return new Response(`data: ${JSON.stringify({ choices: [{ delta,
                            finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`,
                            { headers: { 'Content-Type': 'text/event-stream' } });
                    }
                    raw.push(output);
                    return new Response(JSON.stringify({ choices: [{ message: { content: output },
                        finish_reason: 'stop' }], usage: { prompt_tokens: 120,
                        completion_tokens: Math.ceil(output.length / 4) } }),
                    { headers: { 'Content-Type': 'application/json' } });
                }
                raw.push(output);
                const delta = { content: output, tool_calls: [{ index: 0, id: `receipt-${raw.length}`,
                    type: 'function', function: { name: 'commit_world_turn',
                        arguments: JSON.stringify(receipt) } }] };
                return new Response(`data: ${JSON.stringify({ choices: [{ delta,
                    finish_reason: 'stop' }], usage: { prompt_tokens: 120,
                    completion_tokens: Math.ceil(output.length / 4) } })}\n\ndata: [DONE]\n\n`,
                    { headers: { 'Content-Type': 'text/event-stream' } });
            };
            const turns = [];
            for (const scenario of scenarios) {
                active = scenario;
                const before = sess.history.length;
                document.getElementById('world-user-input').value = scenario.input;
                await executeWorldTurn();
                const added = sess.history.slice(before);
                turns.push({ input: scenario.input, output: scenario.output,
                    user: added.find(message => message.role === 'user')?.text,
                    stored: added.find(message => message.role === 'dm')?.text,
                    rendered: document.querySelector('#world-messages-container .msg-dm:last-of-type .msg-text')?.innerText,
                    calls: requests.length, source: added.find(message => message.role === 'dm')?.stateSource });
            }
            let echoTurn = null;
            if (!baselineMode) {
                const echoedAction = 'I open the heavy archive ledger, compare every entry on this page with the map beside it, and ask Gloria Bell to identify the missing witness before I choose what to investigate next.';
                active = { input: echoedAction, output: `${echoedAction}\n\nGloria Bell: “The witness is missing.”` };
                const beforeEcho = sess.history.length;
                document.getElementById('world-user-input').value = echoedAction;
                await executeWorldTurn();
                echoTurn = { before: beforeEcho, after: sess.history.length,
                    calls: requests.length, composer: document.getElementById('world-user-input').value,
                    savedDm: sess.history.slice(beforeEcho).some(message => message.role === 'dm') };
            }
            let followUp = null;
            if (!baselineMode) {
                world.kernel.resolveFirst = true;
                const input = '“Before we leave this archive, can you tell me when the bridge closed, who first saw the damage, and whether the watch recorded a safe crossing?”';
                active = { input, output: 'Gloria Bell confirms that the crossing closed at dawn. “The watch has no safe route recorded,” she adds.',
                    followUp: true };
                const before = sess.history.length;
                const callsBefore = requests.length;
                document.getElementById('world-user-input').value = input;
                await executeWorldTurn();
                followUp = { input, raw: active.output, calls: requests.length - callsBefore,
                    messages: requests.slice(callsBefore).map(request => request.messages),
                    stored: sess.history.slice(before).find(message => message.role === 'dm')?.text,
                    rendered: document.querySelector('#world-messages-container .msg-dm:last-of-type .msg-text')?.innerText };
            }
            const echoInput = scenarios[0].input;
            const echoPrefix = `${echoInput}\n\nGloria Bell: “The bridge is closed.”`;
            const npcQuotation = `Gloria Bell: “${echoInput}” She points to the eastern road.`;
            const helpers = baselineMode ? null : {
                streamingEcho: worldStreamingPlayerEcho(echoPrefix.slice(0, 100), echoInput),
                stripped: stripWorldPlayerEchoPrefix(echoPrefix, echoInput),
                npcQuote: stripWorldPlayerEchoPrefix(npcQuotation, echoInput),
                localMessages: worldContinuationMessages([
                    { role: 'system', content: 'Continue the scene.' },
                    { role: 'assistant', content: 'Gloria waits.' },
                    { role: 'user', content: echoInput },
                    { role: 'system', content: 'Show the consequence.' }
                ], echoInput, 'local')
            };
            window.fetch = realFetch;
            return { turns, echoTurn, followUp, requests: requests.map(request => request.messages),
                requestSizes: requests.slice(0, scenarios.length).map(request => JSON.stringify({
                    messages: request.messages, tools: request.tools,
                    response_format: request.response_format }).length), raw, helpers,
                history: sess.history.map(message => ({ role: message.role, text: message.text })) };
        }, baseline);
        assert.deepEqual(errors, [], JSON.stringify(errors));
        if (baseline) {
            console.log(JSON.stringify({ version: 'HEAD', requestSizes: result.requestSizes,
                mockedCompletionTokens: result.raw.slice(0, 4).map(output => Math.ceil(output.length / 4)),
                rawCurrentActionCopiesInSystem: result.turns.map((turn, index) =>
                    result.requests[index].filter(message => message.role === 'system'
                        && String(message.content).includes(turn.input)).length) }));
            return;
        }
        assert.equal(result.turns.length, 4);
        result.turns.forEach((turn, index) => {
            assert.equal(turn.calls, index + 1, JSON.stringify(turn));
            assert.equal(turn.user, turn.input, JSON.stringify(turn));
            assert.equal(turn.stored, result.raw[index], JSON.stringify(turn));
            assert.equal(turn.rendered, turn.output, JSON.stringify(turn));
            assert.equal(turn.source, 'tool_call', JSON.stringify(turn));
            const messages = result.requests[index];
            assert.deepEqual(messages.at(-1), { role: 'user', content: turn.input });
            assert.equal(messages.filter(message => message.role === 'user'
                && message.content === turn.input).length, 1);
            const leaked = messages.slice(0, -1).filter(message => message.role === 'system'
                && String(message.content).includes(turn.input));
            assert.equal(leaked.length, 0, JSON.stringify(leaked.map(message => {
                const at = String(message.content).indexOf(turn.input);
                return String(message.content).slice(Math.max(0, at - 90), at + turn.input.length + 90);
            })));
        });
        assert.equal(result.helpers.streamingEcho, true);
        assert.equal(result.helpers.stripped, 'Gloria Bell: “The bridge is closed.”');
        assert.equal(result.helpers.npcQuote,
            `Gloria Bell: “${result.turns[0].input}” She points to the eastern road.`);
        assert.deepEqual(result.helpers.localMessages.at(-1),
            { role: 'user', content: result.turns[0].input });
        assert.equal(result.helpers.localMessages.at(-2).role, 'assistant');
        assert.equal(result.echoTurn.calls, 5, JSON.stringify(result.echoTurn));
        assert.equal(result.echoTurn.after, result.echoTurn.before, JSON.stringify(result.echoTurn));
        assert.equal(result.echoTurn.savedDm, false, JSON.stringify(result.echoTurn));
        assert.equal(result.echoTurn.composer,
            'I open the heavy archive ledger, compare every entry on this page with the map beside it, and ask Gloria Bell to identify the missing witness before I choose what to investigate next.');
        assert.equal(result.followUp.calls, 2, JSON.stringify(result.followUp));
        assert.equal(result.followUp.stored, result.followUp.raw, JSON.stringify(result.followUp));
        assert.equal(result.followUp.rendered, result.followUp.raw, JSON.stringify(result.followUp));
        for (const messages of result.followUp.messages) {
            assert.deepEqual(messages.at(-1), { role: 'user', content: result.followUp.input });
            assert(!messages.slice(0, -1).some(message => message.role === 'system'
                && String(message.content).includes(result.followUp.input)));
        }
        console.log('PASS World player echo: prompt boundary, raw provider response, saved/rendered transcript, NPC quote');
        console.log(JSON.stringify({ version: 'working', requestSizes: result.requestSizes,
            mockedCompletionTokens: result.raw.slice(0, 4).map(output => Math.ceil(output.length / 4)),
            rawCurrentActionCopiesInSystem: result.turns.map((turn, index) =>
                result.requests[index].filter(message => message.role === 'system'
                    && String(message.content).includes(turn.input)).length) }));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
