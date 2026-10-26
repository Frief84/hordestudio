/** A real browser turn persists a rule-derived cost without another model call. */
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
            if (url.hostname !== 'p42-cost.test') return route.abort();
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
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('https://p42-cost.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
        const result = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            document.getElementById('modal-overlay')?.classList.add('hidden');
            state.apiKey = 'offline';
            state.globalSettings.apiProvider = 'local';
            state.globalSettings.localBaseUrl = 'http://127.0.0.1:1234/v1';
            const world = { id: 'p42_cost', name: 'P4.2', model: 'fixture/model',
                contextSize: 32768, maxTokens: 2048, dmPrompt: 'Be concise.', intro: '',
                startLocationId: 'room', locations: [{ id: 'room', name: 'Room', exits: [] }],
                entities: [], kernel: { enabled: true, memoryMode: 'ledger',
                    sceneDrafts: true, serverBindings: false, sceneDraftProtocol: 'scene_draft_v3' },
                gameRules: { profileId: 'custom', universalChecks: { enabled: true, rules: [{
                    id: 'focus', name: 'Focus', match: { kind: 'physical', requestIncludes: 'focus' },
                    values: [{ subject: 'actor', source: 'stat', key: 'focus' }], difficulty: 7,
                    results: [{ id: 'pass', kind: 'success', minMargin: 0, effects: [],
                        costs: [{ resourceId: 'energy', amount: 2 }] },
                        { id: 'fail', kind: 'failure', minMargin: -100, effects: [],
                            costs: [{ resourceId: 'energy', amount: 1 }] }]
                }] } }, hudConfig: { startTimeHours: 8, startTimeMinutes: 0, timeStep: 5,
                    stats: [{ id: 'focus', name: 'Focus', value: 9, min: 0, max: 20 },
                        { id: 'energy', name: 'Energy', value: 5, min: 0, max: 20 }] } };
            state.worlds = [world];
            state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            const sess = prepareCurrentWorldSession();
            sess.setupComplete = true;
            const imported = validateWorldData(JSON.parse(JSON.stringify(world)));
            normalizeAuthoredWorld(imported);
            const importedCost = imported.gameRules.universalChecks.rules[0]
                .results[0].costs[0].amount;
            switchView('worldPlay'); renderWorldPlayState();
            const draft = { protocol: 'scene_draft_v3', narrative: [
                { id: 'p1', action_id: 'focus_action', text: 'The inscription comes into focus.' }
            ], actions: [{ action_id: 'focus_action', request: 'I focus on the inscription',
                kind: 'physical', status: 'resolved', response_id: 'p1', action_effects: {} }],
            events: [{ id: 'e1', type: 'interaction', actor_id: 'player', status: 'completed',
                action_id: 'focus_action', passage_id: 'p1' }],
            effects: {}, speech: [], commitments: [] };
            const realFetch = window.fetch;
            let calls = 0;
            let modelSchemaContainsCost = false;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                calls++;
                modelSchemaContainsCost ||= String(options.body || '').includes('"resource_cost"');
                const payload = { choices: [{ delta: { content: JSON.stringify(draft) },
                    finish_reason: 'stop' }] };
                return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`,
                    { headers: { 'Content-Type': 'text/event-stream' } });
            };
            document.getElementById('world-user-input').value = 'I focus on the inscription';
            await executeWorldTurn();
            window.fetch = realFetch;
            const saved = (await HordeDB.get(`worldInstance:${world.id}`))?.sessions
                ?.find(item => item.id === sess.id);
            return { calls, modelSchemaContainsCost, importedCost, sessionId: sess.id,
                energy: sess.playerStats.energy, receipt: sess.worldTurnReceipts?.at(-1)?.receipt,
                savedEnergy: saved?.playerStats?.energy,
                savedReceipt: saved?.worldTurnReceipts?.at(-1)?.receipt,
                card: document.querySelector('.world-check-card')?.textContent || '' };
        });
        assert.deepEqual(errors, []);
        assert.equal(result.calls, 1, JSON.stringify(result));
        assert.equal(result.modelSchemaContainsCost, false);
        assert.equal(result.importedCost, 2);
        assert.equal(result.energy, 3);
        assert.equal(result.savedEnergy, 3);
        assert.equal(result.receipt?.check_results?.[0]?.cost_changes?.[0]?.amount, 2);
        const effect = result.receipt?.confirmed_effects?.find(item => item.type === 'resource_cost');
        assert.equal(effect?.payload?.actor_id, 'player');
        assert.equal(result.receipt?.events?.[effect.event_indices[0]]?.type, 'resource_cost');
        assert.equal(result.savedReceipt?.confirmed_effects?.find(item =>
            item.type === 'resource_cost')?.payload?.amount, 2);
        assert.match(result.card, /Focus/);
        const failedTurn = await page.evaluate(async () => {
            const sess = getCurrentWorldSession();
            sess.playerStats.focus = 3;
            const draft = { protocol: 'scene_draft_v3', narrative: [
                { id: 'p2', action_id: 'failed_focus', text: 'The inscription remains unclear.' }
            ], actions: [{ action_id: 'failed_focus', request: 'I focus on the inscription',
                kind: 'physical', status: 'attempted', response_id: 'p2', action_effects: {} }],
            events: [], effects: {}, speech: [], commitments: [] };
            const realFetch = window.fetch;
            let calls = 0;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                calls++;
                const payload = { choices: [{ delta: { content: JSON.stringify(draft) },
                    finish_reason: 'stop' }] };
                return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`,
                    { headers: { 'Content-Type': 'text/event-stream' } });
            };
            document.getElementById('world-user-input').value = 'I focus on the inscription';
            await executeWorldTurn();
            window.fetch = realFetch;
            const saved = (await HordeDB.get('worldInstance:p42_cost'))?.sessions
                ?.find(item => item.id === sess.id);
            return { calls, energy: sess.playerStats.energy,
                receipt: sess.worldTurnReceipts?.at(-1)?.receipt,
                savedEnergy: saved?.playerStats?.energy };
        });
        assert.equal(failedTurn.calls, 1, JSON.stringify(failedTurn));
        assert.equal(failedTurn.energy, 2);
        assert.equal(failedTurn.savedEnergy, 2);
        assert.equal(failedTurn.receipt?.check_results?.[0]?.kind, 'failure');
        assert.equal(failedTurn.receipt?.confirmed_effects?.find(item =>
            item.type === 'resource_cost')?.payload?.amount, 1);
        await page.reload();
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
        const reload = await page.evaluate(id => {
            const sess = state.worldInstances.p42_cost?.sessions?.find(item => item.id === id);
            return { energy: sess?.playerStats?.energy,
                configuredCost: state.worlds.find(item => item.id === 'p42_cost')
                    ?.gameRules?.universalChecks?.rules?.[0]?.results?.[0]?.costs?.[0]?.amount,
                costs: sess?.worldTurnReceipts?.at(-1)?.receipt?.confirmed_effects
                    ?.filter(item => item.type === 'resource_cost').length };
        }, result.sessionId);
        assert.equal(reload.energy, 2);
        assert.equal(reload.configuredCost, 2);
        assert.equal(reload.costs, 1);
        console.log('PASS P4.2 browser turns: success and failure costs, one call each, receipts and reload');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
