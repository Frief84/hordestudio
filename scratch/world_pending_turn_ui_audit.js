// Delayed offline providers exercise presentation before a turn can commit.
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
            for (const scenario of ['success', 'repair', 'abort', 'error', 'reroll', 'reroll_rejected', 'switch']) {
                const world = { id: `pending_${scenario}`, name: 'Office', model: 'offline/model',
                    contextSize: 32768, maxTokens: 2048, startLocationId: 'office',
                    locations: [{ id: 'office', name: 'Office', exits: [] }], entities: [],
                    kernel: { sceneDrafts: true }, gameRules: { profileId: 'adventure', modules: {} } };
                state.worlds = [world]; state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
                state.activeWorldId = world.id;
                const sess = prepareCurrentWorldSession(); sess.setupComplete = true;
                switchView('worldPlay'); renderWorldPlayState();
                let calls = 0;
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
                    const draft = { protocol: 'scene_draft_v3', narrative: [{ id: 'p', text: 'You wave toward the empty doorway.' }],
                        actions: [{ kind: 'physical', status: (scenario === 'repair' && calls === 1)
                            || (scenario === 'reroll_rejected' && calls <= 2) ? 'invalid' : 'resolved', response_id: 'p' }] };
                    const message = body.tools ? { tool_calls: [{ id: 'draft', type: 'function',
                        function: { name: 'commit_world_turn', arguments: JSON.stringify(draft) } }] }
                        : { content: JSON.stringify(draft) };
                    return new Response(JSON.stringify({ choices: [{ message }] }), { headers: { 'Content-Type': 'application/json' } });
                };
                document.getElementById('world-user-input').value = 'I wave.';
                const task = executeWorldTurn();
                await task;
                if (scenario === 'reroll_rejected' && sess.history.at(-1)?.stateSource !== 'frozen_no_receipt')
                    throw Error('Fixture must reject the first turn before rerolling');
                if (scenario === 'reroll' || scenario === 'reroll_rejected') await executeWorldTurn(true);
                results.push({ scenario, probes, calls, final: probe(),
                    users: sess.history.filter(m => m.role === 'user').length,
                    replies: sess.history.filter(m => m.role === 'dm').length,
                    source: sess.history.at(-1)?.stateSource });
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
            const failed = ['abort', 'error'].includes(result.scenario);
            assert.equal(result.users, failed ? 0 : 1, JSON.stringify(result));
            assert.equal(result.replies, failed ? 0 : 1, JSON.stringify(result));
            assert.equal(result.final.users, failed ? 0 : 1, JSON.stringify(result));
            assert.equal(result.final.input, failed ? 'I wave.' : '', JSON.stringify(result));
            assert.equal(result.calls, result.scenario === 'reroll_rejected' ? 3 : ['repair', 'reroll'].includes(result.scenario) ? 2 : 1);
            if (result.scenario === 'reroll_rejected') assert.notEqual(result.source, 'frozen_no_receipt');
            if (result.scenario === 'repair') assert(result.probes.some(p => /reconciling/.test(p.label)));
        }
        assert.deepEqual(errors, []);
        console.log('PASS pending input and status: delayed response, rerender, repair, abort, error, reroll and timeline switch');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
