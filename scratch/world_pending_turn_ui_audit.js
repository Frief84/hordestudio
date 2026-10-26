// Delayed offline providers exercise presentation before a turn can commit.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');
(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext();
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.pathname === '/worlds/bind-turn') {
                const headers = { 'access-control-allow-origin': '*',
                    'access-control-allow-methods': 'POST, OPTIONS',
                    'access-control-allow-headers': 'content-type' };
                if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
                const result = spawnSync(process.execPath, [path.join(root, 'worlds/turn-binding-worker.js')],
                    { input: route.request().postData(), encoding: 'utf8' });
                return route.fulfill({ status: 200, contentType: 'application/json', headers,
                    body: result.stdout });
            }
            if (url.hostname !== 'pending-world.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
                return route.fulfill({ status: 404, body: '' });
            return route.fulfill({ body: fs.readFileSync(file), contentType:
                ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream' });
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('https://pending-world.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
        const results = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer);
            state.apiKey = 'offline'; state.globalSettings.apiProvider = 'openrouter';
            const realFetch = window.fetch, realMicroFrame = requestWorldMicroFrame, results = [];
            for (const scenario of ['success', 'repair', 'abort', 'error', 'reroll', 'reroll_invalid',
                'failed_retry', 'both_invalid', 'switch']) {
                const world = { id: `pending_${scenario}`, name: 'Office', model: 'offline/model',
                    contextSize: 32768, maxTokens: 2048, startLocationId: 'office',
                    locations: [{ id: 'office', name: 'Office', exits: [] }], entities: [],
                    kernel: { sceneDrafts: true }, gameRules: { profileId: 'adventure', modules: {} } };
                state.worlds = [world]; state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
                state.activeWorldId = world.id;
                let sess = prepareCurrentWorldSession(); sess.setupComplete = true;
                switchView('worldPlay'); renderWorldPlayState();
                let calls = 0, activeAttempt = 0;
                const stateProof = () => ({ history: sess.history.length, turn: Number(sess.turnCount || 0),
                    version: sess.worldStateVersion || 0, location: sess.playerLocation,
                    entityStates: JSON.stringify(sess.entityStates || {}),
                    inventory: JSON.stringify(sess.inventory || []),
                    receipts: sess.worldTurnReceipts?.length || 0,
                    events: sess.turnEvents?.length || 0 });
                const savedProof = saved => saved && ({ history: saved.history?.length || 0,
                    turn: Number(saved.turnCount || 0), version: saved.worldStateVersion || 0,
                    location: saved.playerLocation, entityStates: JSON.stringify(saved.entityStates || {}),
                    inventory: JSON.stringify(saved.inventory || []),
                    receipts: saved.worldTurnReceipts?.length || 0,
                    events: saved.turnEvents?.length || 0 });
                const before = stateProof();
                const probes = [];
                const probe = () => {
                    const container = document.getElementById('world-messages-container');
                    const users = [...container.querySelectorAll('.msg-user')].filter(node => node.textContent.includes('I wave.'));
                    const status = container.querySelector('[data-world-pending-status]');
                    return { users: users.length, status: !!status,
                        ordered: !!(users[0] && status && (users[0].compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING)),
                        label: status?.textContent, input: document.getElementById('world-user-input').value };
                };
                requestWorldMicroFrame = async (...args) => {
                    probes.push(probe());
                    if (calls === 0 && sess.history.length) throw Error('Pending presentation must not add a history entry before preparation');
                    await new Promise(resolve => setTimeout(resolve, 20));
                    return realMicroFrame(...args);
                };
                window.fetch = async (url, options = {}) => {
                    if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                    calls++;
                    probes.push(probe()); // No response headers or tokens yet.
                    renderWorldPlayState();
                    probes.push(probe()); // Reconciliation must not drop or duplicate pending UI.
                    await new Promise(resolve => setTimeout(resolve, 20));
                    if (scenario === 'switch') {
                        const other = { ...sess, id: 'other', history: [] };
                        state.worldInstances[world.id].sessions.push(other);
                        state.worldInstances[world.id].activeSessionId = other.id;
                        renderWorldPlayState();
                        const hidden = probe();
                        if (hidden.users || hidden.status) throw Error('Pending UI leaked to another timeline');
                        state.worldInstances[world.id].activeSessionId = sess.id;
                        renderWorldPlayState(); probes.push(probe());
                    }
                    if (scenario === 'abort') {
                        worldGenController.abort();
                        throw new DOMException('Stopped', 'AbortError');
                    }
                    if (scenario === 'error') return new Response('Offline test error', { status: 500 });
                    const body = JSON.parse(options.body);
                    const invalid = (scenario === 'repair' && calls === 1)
                        || (scenario === 'failed_retry' && activeAttempt === 0)
                        || (scenario === 'reroll_invalid' && activeAttempt === 1)
                        || scenario === 'both_invalid';
                    const draft = { protocol: 'scene_draft_v3', actions: [
                        { request: 'I wave.', kind: 'gesture', status: invalid ? 'invalid' : 'resolved',
                            effects: [], response: [{ text: 'You wave toward the empty doorway.' }] }
                    ] };
                    const message = body.tools ? { tool_calls: [{ id: 'draft', type: 'function',
                        function: { name: 'commit_world_turn', arguments: JSON.stringify(draft) } }] }
                        : { content: JSON.stringify(draft) };
                    return new Response(JSON.stringify({ choices: [{ message }] }), { headers: { 'Content-Type': 'application/json' } });
                };
                document.getElementById('world-user-input').value = 'I wave.';
                const task = executeWorldTurn();
                await task;
                const firstSavedInstance = await HordeDB.get(`worldInstance:${world.id}`);
                const first = { state: stateProof(), source: sess.history.at(-1)?.stateSource,
                    input: document.getElementById('world-user-input').value,
                    diagnostic: sess.worldCallDiagnostics?.at(-1),
                    saved: savedProof(firstSavedInstance?.sessions?.find(item => item.id === sess.id)) };
                if (['reroll', 'reroll_invalid', 'failed_retry', 'both_invalid'].includes(scenario)) {
                    state.worldInstances[world.id] = firstSavedInstance;
                    sess = getCurrentWorldSession();
                    renderWorldPlayState();
                }
                if (scenario === 'reroll' || scenario === 'reroll_invalid') {
                    activeAttempt++; await executeWorldTurn(true);
                }
                if (scenario === 'failed_retry' || scenario === 'both_invalid') {
                    activeAttempt++;
                    await executeWorldTurn(); // A rejected linked turn has no DM take to reroll.
                }
                results.push({ scenario, probes, calls, final: probe(),
                    users: sess.history.filter(m => m.role === 'user').length,
                    replies: sess.history.filter(m => m.role === 'dm').length,
                    source: sess.history.at(-1)?.stateSource, before, first,
                    after: stateProof(), diagnostics: sess.worldCallDiagnostics?.length || 0,
                    receipt: sess.worldTurnReceipts?.at(-1),
                    savedAfter: savedProof((await HordeDB.get(`worldInstance:${world.id}`))
                        ?.sessions?.find(item => item.id === sess.id)) });
            }
            window.fetch = realFetch;
            requestWorldMicroFrame = realMicroFrame;
            return results;
        });
        for (const result of results) {
            for (const probe of result.probes) {
                assert.equal(probe.users, 1, JSON.stringify(result));
                assert(probe.status && probe.ordered, JSON.stringify(result));
                assert.equal(probe.input, '');
            }
            assert.equal(result.final.status, false, JSON.stringify(result));
            const failed = ['abort', 'error', 'both_invalid'].includes(result.scenario);
            assert.equal(result.users, failed ? 0 : 1, JSON.stringify(result));
            assert.equal(result.replies, failed ? 0 : 1, JSON.stringify(result));
            assert.equal(result.final.users, failed ? 0 : 1, JSON.stringify(result));
            assert.equal(result.final.input, failed ? 'I wave.' : '', JSON.stringify(result));
            if (['failed_retry', 'both_invalid'].includes(result.scenario)) {
                assert.deepEqual(result.first.state, result.before, JSON.stringify(result));
                assert.equal(result.first.input, 'I wave.', JSON.stringify(result));
                assert.deepEqual(result.first.saved, result.before, JSON.stringify(result));
                assert.equal(result.first.diagnostic?.status, 'failed', JSON.stringify(result));
                assert(result.first.diagnostic?.failures?.length, JSON.stringify(result));
                assert(result.diagnostics >= 1, JSON.stringify(result));
            }
            if (result.scenario === 'both_invalid') assert.deepEqual(result.after, result.before, JSON.stringify(result));
            if (result.scenario === 'failed_retry') {
                assert.equal(result.after.receipts, 1, JSON.stringify(result));
                assert.equal(result.savedAfter?.history, 2, JSON.stringify(result));
                assert.notEqual(result.source, 'frozen_no_receipt');
            }
            if (['reroll', 'reroll_invalid'].includes(result.scenario))
                assert.equal(result.after.receipts, 1, JSON.stringify(result));
            if (result.scenario === 'reroll_invalid') {
                assert.deepEqual(result.after, result.first.state, JSON.stringify(result));
                assert.equal(result.source, result.first.source, JSON.stringify(result));
            }
            if (!['failed_retry', 'both_invalid', 'reroll_invalid'].includes(result.scenario))
                assert.equal(result.calls, ['repair', 'reroll'].includes(result.scenario) ? 2 : 1);
            assert.deepEqual(result.savedAfter, result.after, JSON.stringify(result));
            if (result.scenario === 'repair') assert(result.probes.some(p => /reconciling/.test(p.label)));
        }
        assert.deepEqual(errors, []);
        console.log('PASS pending UI, repair, abort, rejected retry, valid/failed reroll, reload and timeline switch');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
