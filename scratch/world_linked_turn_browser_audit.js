/** Browser-level linked V3 turn: model transport, commit gate and reload. */
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
            if (url.hostname !== 'linked-turn.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/'
                ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file)
                || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
            return route.fulfill({ contentType: { '.html': 'text/html', '.js': 'text/javascript',
                '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream',
                body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        const errors = [];
        const logs = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning')
            logs.push(message.text()); });
        await page.goto('https://linked-turn.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
        const result = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            state.apiKey = 'offline';
            state.globalSettings.apiProvider = 'local';
            state.globalSettings.localBaseUrl = 'http://127.0.0.1:1234/v1';
            const world = { id: 'linked_fixture', name: 'Wardrobe', model: 'fixture/model',
                contextSize: 32768, maxTokens: 2048, dmPrompt: 'A coat lies on a chair.', intro: '',
                startLocationId: 'room', locations: [{ id: 'room', name: 'Room', exits: [] }],
                entities: [], kernel: { enabled: true, memoryMode: 'ledger', sceneDrafts: true,
                    sceneDraftProtocol: 'scene_draft_v3' },
                hudConfig: { startTimeHours: 8, startTimeMinutes: 0, timeStep: 5 } };
            state.worlds = [world];
            state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            const sess = prepareCurrentWorldSession();
            sess.setupComplete = true;
            sess.outfit = 'plain shirt';
            switchView('worldPlay'); renderWorldPlayState();
            let calls = 0, beforeCommit = false;
            let nextOutfit = 'red coat';
            const realFetch = window.fetch;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                calls++;
                beforeCommit = sess.outfit === 'plain shirt'
                    && !sess.history.some(message => message.role === 'user'
                        && message.text === 'I put on the red coat.');
                const draft = { protocol: 'scene_draft_v3',
                    narrative: [{ id: 'p1', action_id: 'wear_coat', text: `You put on the ${nextOutfit}.` }],
                    actions: [{ action_id: 'wear_coat', kind: 'physical', status: 'resolved',
                        response_id: 'p1', action_effects: { outfit_set: [
                            { actor_id: 'player', outfit: nextOutfit }] } }],
                    events: [], effects: {}, speech: [], commitments: [] };
                const payload = nextOutfit === 'red coat'
                    ? { choices: [{ delta: { tool_calls: [{ index: 0,
                        id: 'call_linked_1', type: 'function', function: {
                            name: 'commit_world_turn', arguments: JSON.stringify(draft) } }] },
                        finish_reason: 'tool_calls' }] }
                    : { choices: [{ delta: { content: JSON.stringify(draft) },
                        finish_reason: 'stop' }] };
                return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`,
                    { headers: { 'Content-Type': 'text/event-stream' } });
            };
            document.getElementById('world-user-input').value = 'I put on the red coat.';
            await executeWorldTurn();
            const firstBeforeCommit = beforeCommit;
            const firstState = { outfit: sess.outfit, history: sess.history.length,
                kernel: world.kernel, visible: document.getElementById('world-messages-container').innerText };
            const saved = (await HordeDB.get(`worldInstance:${world.id}`))?.sessions
                ?.find(item => item.id === sess.id);
            const historyBeforeFailure = sess.history.length;
            nextOutfit = 'violet cloak';
            const realSetMultiple = HordeDB.setMultiple;
            HordeDB.setMultiple = async () => { throw new Error('simulated_storage_failure'); };
            document.getElementById('world-user-input').value = 'I put on the violet cloak.';
            await executeWorldTurn();
            HordeDB.setMultiple = realSetMultiple;
            const savedAfterFailure = (await HordeDB.get(`worldInstance:${world.id}`))?.sessions
                ?.find(item => item.id === sess.id);
            const visibleAfterFailure = document.getElementById('world-messages-container').innerText;
            window.fetch = realFetch;
            return { calls, beforeCommit: firstBeforeCommit, firstState,
                outfit: sess.outfit, savedOutfit: saved?.outfit,
                savedAfterFailure: savedAfterFailure?.outfit,
                historyBeforeFailure, historyAfterFailure: sess.history.length,
                leakedNarrative: visibleAfterFailure.includes('You put on the violet cloak.'),
                history: sess.history.map(message => ({ role: message.role, text: message.text })),
                audit: sess.lastTurnAudit,
                callAudit: [...sess.history].reverse().find(message => message.role === 'dm')?.callAudit };
        });
        assert.deepEqual(errors, [], JSON.stringify(errors));
        assert(result.calls >= 2 && result.calls <= 4, JSON.stringify(result));
        assert(result.beforeCommit, JSON.stringify(result));
        assert.equal(result.outfit, 'red coat', JSON.stringify({ result, logs }));
        assert.equal(result.savedOutfit, 'red coat', JSON.stringify(result));
        assert.equal(result.savedAfterFailure, 'red coat', JSON.stringify(result));
        assert.equal(result.historyAfterFailure, result.historyBeforeFailure, JSON.stringify(result));
        assert.equal(result.leakedNarrative, false, JSON.stringify(result));
        assert(result.history.some(message => message.role === 'dm'
            && message.text.includes('red coat')), JSON.stringify(result));
        assert.equal(result.audit?.protocol, 'scene_draft_v3', JSON.stringify(result));
        assert.equal(result.callAudit?.main, 1, JSON.stringify(result));
        assert.equal(result.callAudit?.receiptRepair, 0, JSON.stringify(result));
        console.log('PASS linked V3 browser turn committed only after storage');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
