/** Isolated real-model smoke test for the productive bound V3 turn. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');
const model = process.env.HORDE_LIVE_MODEL || 'gemma4:31b-it-q4_K_M';
const outputPath = process.env.HORDE_LIVE_OUTPUT
    ? path.resolve(process.env.HORDE_LIVE_OUTPUT)
    : path.join(root, 'scratch', 'world_linked_ollama_live_results.json');
const cases = [
    ['T03', 'I take the key from the table.'],
    ['T06', "I try to restrain Linda's hands."],
    ['T08', 'I take Linda to the Round Room.'],
    ['T09', 'I try to push Linda toward the door.'],
    ['F12', 'You restrain Linda with the handcuffs.'],
    ['F14', 'Come here Linda NOW!']
];
const output = [];
(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        for (const [id, input] of cases.filter(([id]) =>
            (!process.env.HORDE_LIVE_CASE || id === process.env.HORDE_LIVE_CASE)
            && id !== process.env.HORDE_LIVE_SKIP)) {
            console.log(`${id}: starting ${model}`);
            const context = await browser.newContext();
            const calls = [];
            await context.route('**/*', async route => {
                const request = route.request();
                const url = new URL(request.url());
                if (url.pathname === '/worlds/bind-turn') {
                    console.log(`${id}: binding draft`);
                    const headers = { 'access-control-allow-origin': '*',
                        'access-control-allow-methods': 'POST, OPTIONS',
                        'access-control-allow-headers': 'content-type' };
                    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
                    const result = spawnSync(process.execPath,
                        [path.join(root, 'worlds/turn-binding-worker.js')],
                        { input: request.postData(), encoding: 'utf8' });
                    return route.fulfill({ status: 200, contentType: 'application/json',
                        headers, body: result.stdout });
                }
                if (url.pathname === '/v1/chat/completions') {
                    console.log(`${id}: model request`);
                    const started = Date.now();
                    const body = JSON.parse(request.postData());
                    try {
                        const response = await fetch('http://127.0.0.1:11434/v1/chat/completions', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(body), signal: AbortSignal.timeout(300000)
                        });
                        const responseText = await response.text();
                        calls.push({ durationMs: Date.now() - started, status: response.status,
                            maxTokens: body.max_tokens, promptCharacters: JSON.stringify(body.messages).length,
                            prompt: JSON.stringify(body.messages).slice(0, 50000),
                            response: responseText.slice(0, 100000) });
                        return route.fulfill({ status: response.status,
                            contentType: response.headers.get('content-type') || 'application/json',
                            headers: { 'access-control-allow-origin': '*' }, body: responseText });
                    } catch (error) {
                        calls.push({ durationMs: Date.now() - started, error: String(error) });
                        return route.fulfill({ status: 502, body: String(error),
                            headers: { 'access-control-allow-origin': '*' } });
                    }
                }
                if (url.hostname !== 'gemma-live.test') return route.abort();
                const file = path.resolve(root, '.' + (url.pathname === '/'
                    ? '/index.html' : decodeURIComponent(url.pathname)));
                if (!file.startsWith(root + path.sep) || !fs.existsSync(file)
                    || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
                return route.fulfill({ contentType: { '.html': 'text/html', '.js': 'text/javascript',
                    '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream',
                    body: fs.readFileSync(file) });
            });
            const page = await context.newPage();
            const pageErrors = [];
            page.on('pageerror', error => pageErrors.push(error.message));
            await page.goto('https://gemma-live.test/');
            console.log(`${id}: page loaded`);
            await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
            console.log(`${id}: app ready`);
            let result;
            try {
                result = await page.evaluate(async ({ id, input, model }) => {
                    clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer);
                    await Promise.all([saveStateInFlight, worldSaveInFlight].filter(Boolean));
                    state.apiKey = 'offline'; state.globalSettings.apiProvider = 'local';
                    state.globalSettings.localBaseUrl = 'http://127.0.0.1:11434/v1';
                    const world = { id: `gemma_live_${id}`, name: 'Two Rooms', model,
                        contextSize: 32768, maxTokens: 4096, startLocationId: 'foyer',
                        dmPrompt: 'Respond to player actions in this small test world. Linda is independent and may agree or resist. Never invent an item or movement.',
                        locations: [
                            { id: 'foyer', name: 'Foyer', description: 'A bronze key lies on a table. Linda stands nearby. A door leads to the Round Room.',
                                exits: [{ targetLocationId: 'round', doorId: 'door', lockState: 'open' }] },
                            { id: 'round', name: 'Round Room', exits: [{ targetLocationId: 'foyer', doorId: 'door', lockState: 'open' }] }
                        ], entities: [
                            { id: 'key', type: 'item', name: 'Bronze key', startLocation: 'foyer' },
                            ...(id === 'F12' ? [{ id: 'cuffs', type: 'item',
                                name: 'Steel handcuffs' }] : []),
                            { id: 'linda', type: 'npc', name: 'Linda', startLocation: 'foyer',
                                persona: 'Independent, calm and direct. She does not automatically obey physical requests.' }
                        ], kernel: { enabled: true, memoryMode: 'ledger', sceneDrafts: true,
                            sceneDraftProtocol: 'scene_draft_v3', serverBindings: true },
                        hudConfig: { startTimeHours: 8, timeStep: 5 },
                        gameRules: { modules: { livingWorld: false } } };
                    state.worlds = [world];
                    state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
                    state.activeWorldId = world.id;
                    const sess = prepareCurrentWorldSession(); sess.setupComplete = true;
                    sess.entityStates.key = { ...sess.entityStates.key, location: 'foyer' };
                    sess.entityStates.linda = { ...sess.entityStates.linda, location: 'foyer' };
                    if (id === 'F12') {
                        sess.inventory = ['Steel handcuffs'];
                        sess.entityStates.cuffs = { location: 'player' };
                    }
                    if (id === 'T08' || id === 'F14') {
                        sess.placeDiscoveries ||= {};
                        sess.placeDiscoveries.linda = ['round'];
                    }
                    if (id === 'F14') sess.playerLocation = 'round';
                    switchView('worldPlay'); renderWorldPlayState();
                    document.getElementById('world-user-input').value = input;
                    await executeWorldTurn();
                    const active = getCurrentWorldSession();
                    const saved = (await HordeDB.get(`worldInstance:${world.id}`))?.sessions
                        ?.find(item => item.id === active.id);
                    return { input, error: document.getElementById('world-turn-error-text')?.textContent,
                        audit: active.lastTurnAudit, receipt: active.worldTurnReceipts?.at(-1),
                        callAudit: [...active.history].reverse().find(message => message.role === 'dm')?.callAudit,
                        narrative: active.history.at(-1)?.text,
                        live: { inventory: active.inventory, playerLocation: active.playerLocation,
                            entityStates: active.entityStates, historyLength: active.history.length },
                        saved: saved && { inventory: saved.inventory, playerLocation: saved.playerLocation,
                            entityStates: saved.entityStates, historyLength: saved.history.length } };
                }, { id, input, model });
            } catch (error) { result = { input, error: String(error) }; }
            output.push({ id, model, ...result, calls, pageErrors });
            await context.close();
            fs.writeFileSync(outputPath,
                JSON.stringify(output, null, 2));
            console.log(`${id}: ${JSON.stringify({ error: result.error, calls: calls.length,
                accepted: result.audit?.accepted, rejected: result.audit?.rejected?.map(x => x.reason),
                savedTurn: !!result.receipt && result.saved?.historyLength === result.live?.historyLength
                    && result.saved.historyLength > 0 })}`);
        }
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
