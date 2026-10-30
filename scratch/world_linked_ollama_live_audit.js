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
    ['F14', 'Come here Linda NOW!'],
    ['P41', 'I focus on the inscription on the table.'],
    ['P42', 'I focus on the inscription on the table.'],
    ['A2', 'I tell Linda to wait here, then I try to hold her hands.'],
    ['A3', 'I walk through the open door to the Round Room.'],
    ['A5', 'I take the bronze key, then I walk to the Round Room.'],
    ['P43F_MULTI', 'I ask Linda to come with me, take the bronze key from the table, and walk with her into the Round Room if she agrees.'],
    ['P43F_DANCE', 'I ask Linda to dance with me, then I dance beside her.'],
    ['P43F_CONTACT', "I try to hold Linda's hands, then let go and ask whether she wants to dance."]
    ,['P43H_MODERN', 'I search the drawer for a flashlight.']
    ,['P43H_MEDIEVAL', 'I search the dungeon chest for a flashlight.']
    ,['P43H_DIALOG_OFF', 'I ask Linda how she is.']
    ,['P43H_DIALOG_ON', 'I ask Linda how she is.']
    ,['P43H_CHAIR', 'I take the chair.']
];
if (process.env.HORDE_LIVE_GARDEN_RECALL) cases.push(['P43G_GARDEN',
    'Linda, what happened in the garden with Cass?']);
if (process.env.HORDE_LIVE_SEQUENCE) cases.push(['P43G_SEQUENCE',
    JSON.parse(process.env.HORDE_LIVE_SEQUENCE)]);
const output = [];
(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        for (const [id, input] of cases.filter(([id]) =>
            (!process.env.HORDE_LIVE_CASE || id === process.env.HORDE_LIVE_CASE)
            && (id !== 'P42' || process.env.HORDE_LIVE_CASE === 'P42')
            && id !== process.env.HORDE_LIVE_SKIP)) {
            console.log(`${id}: starting ${model}`);
            const context = await browser.newContext();
            const calls = [];
            const bindingResponses = [];
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
                    bindingResponses.push({ request: request.postData(), response: result.stdout,
                        error: result.stderr, status: result.status });
                    return route.fulfill({ status: 200, contentType: 'application/json',
                        headers, body: result.stdout });
                }
                if (url.pathname === '/v1/chat/completions') {
                    if (calls.length >= Number(process.env.HORDE_LIVE_MAX_REQUESTS || 6))
                        return route.fulfill({ status: 429, body: '{"error":"live request budget exhausted"}',
                            headers: { 'access-control-allow-origin': '*' } });
                    console.log(`${id}: model request`);
                    const started = Date.now();
                    const body = JSON.parse(request.postData());
                    if (process.env.HORDE_LIVE_MAX_OUTPUT_TOKENS)
                        body.max_tokens = Math.min(Number(body.max_tokens || Infinity),
                            Number(process.env.HORDE_LIVE_MAX_OUTPUT_TOKENS));
                    try {
                        const response = await fetch('http://127.0.0.1:11434/v1/chat/completions', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(body), signal: AbortSignal.timeout(
                                Number(process.env.HORDE_LIVE_REQUEST_TIMEOUT_MS || 300000))
                        });
                        const responseText = await response.text();
                        const events = responseText.split(/\r?\n/).filter(line => line.startsWith('data: '))
                            .map(line => { try { return JSON.parse(line.slice(6)); } catch { return null; } })
                            .filter(Boolean);
                        const usage = [...events].reverse().find(event => event.usage)?.usage || null;
                        const timing = [...events].reverse().find(event =>
                            event.load_duration != null || event.prompt_eval_duration != null
                            || event.eval_duration != null) || null;
                        const contentCharacters = events.reduce((sum, event) => sum
                            + String(event.choices?.[0]?.delta?.content || '').length
                            + (event.choices?.[0]?.delta?.tool_calls || []).reduce((n, call) =>
                                n + String(call.function?.arguments || '').length, 0), 0);
                        const reasoningCharacters = events.reduce((sum, event) => sum
                            + String(event.choices?.[0]?.delta?.reasoning ||
                                event.choices?.[0]?.delta?.thought || '').length, 0);
                        calls.push({ durationMs: Date.now() - started, status: response.status,
                            maxTokens: body.max_tokens, promptCharacters: JSON.stringify(body.messages).length,
                            contextCharacters: body.messages.slice(0, -1)
                                .reduce((sum, message) => sum + String(message.content || '').length, 0),
                            schemaCharacters: JSON.stringify(body.tools || body.response_format || {}).length,
                            reasoningEffort: body.reasoning_effort || null,
                            responseCharacters: responseText.length, contentCharacters,
                            reasoningCharacters, usage,
                            rawResponse: responseText,
                            providerTiming: timing && { load_duration: timing.load_duration ?? null,
                                prompt_eval_duration: timing.prompt_eval_duration ?? null,
                                eval_duration: timing.eval_duration ?? null,
                                prompt_eval_count: timing.prompt_eval_count ?? null,
                                eval_count: timing.eval_count ?? null } });
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
                    if (id === 'P43G_GARDEN') {
                        world.gameRules.modules.livingWorld = true;
                        world.locations[0].exits.push({ targetLocationId: 'garden', travelTime: 5 });
                        world.locations.push({ id: 'garden', name: 'Garden',
                            description: 'A quiet garden behind the house.',
                            exits: [{ targetLocationId: 'foyer', travelTime: 5 }] });
                        const pickup = (actor, item) => ({ label: `takes ${item}`,
                            effect: { type: 'item_transfer', payload: { actor_id: actor,
                                item_id: item, from_id: 'garden', to_id: actor } } });
                        const linda = world.entities.find(item => item.id === 'linda');
                        linda.startLocation = 'garden';
                        linda.goal = 'Take the watering can and return to the foyer';
                        linda.goalActionSteps = [pickup('linda', 'can'), { label: 'goes to the foyer',
                            effect: { type: 'actor_move', payload: { actor_id: 'linda',
                                to_location_id: 'foyer' } } }];
                        world.entities.push({ id: 'cass', type: 'npc', name: 'Cass',
                            startLocation: 'garden', goal: 'Take the gloves',
                            goalActionSteps: [pickup('cass', 'gloves')] },
                            { id: 'remote', type: 'npc', name: 'Remote',
                                startLocation: 'round' },
                            { id: 'can', type: 'item', name: 'Watering can',
                                locationId: 'garden' },
                            { id: 'gloves', type: 'item', name: 'Gloves',
                                locationId: 'garden' });
                    }
                    if (id.startsWith('P43H_')) {
                        const medieval = id === 'P43H_MEDIEVAL';
                        world.description = medieval ? 'An ordinary medieval dungeon without modern technology.'
                            : 'A modern household with electrical technology.';
                        world.locations[0].name = medieval ? 'Dungeon' : 'Kitchen';
                        world.locations[0].description = medieval
                            ? 'An old medieval dungeon with a chest of unspecified contents.'
                            : 'A furnished modern kitchen with a household drawer of unspecified contents.';
                        if (id === 'P43H_CHAIR')
                            world.locations[0].description += ' Two chairs stand beside the table.';
                        world.entities.push({ id: medieval ? 'chest' : 'drawer', type: 'item',
                            name: medieval ? 'dungeon chest' : 'drawer', startLocation: 'foyer',
                            description: medieval ? 'An old chest.' : 'A household drawer.',
                            contentsMode: 'unspecified', interactable: { initialState: 'open' } });
                        world.gameRules.dynamicObjectDiscovery = {
                            enabled: id !== 'P43H_DIALOG_OFF' };
                        world.gameRules.universalChecks = { enabled: id !== 'P43H_DIALOG_OFF',
                            rules: [HordeDynamicObjectDiscovery.defaultRule(1)] };
                    }
                    if (id === 'P41' || id === 'P42') {
                        world.locations[0].description += ' A short inscription is carved into the table.';
                        world.hudConfig.stats = [
                            { id: 'focus', name: 'Focus', value: 9, min: 0, max: 20 },
                            { id: 'energy', name: 'Energy', value: 5, min: 0, max: 20 }
                        ];
                        world.gameRules.universalChecks = { enabled: true, rules: [{
                            id: 'inscription', name: 'Read the inscription',
                            match: { kind: 'physical', requestIncludes: 'inscription' },
                            values: [{ subject: 'actor', source: 'stat', key: 'focus' }],
                            difficulty: 7, results: [
                                { id: 'pass', kind: 'success', minMargin: 0, effects: [],
                                    ...(id === 'P42' ? { costs: [{ resourceId: 'energy', amount: 2 }] } : {}) },
                                { id: 'fail', kind: 'failure', minMargin: -100, effects: [],
                                    ...(id === 'P42' ? { costs: [{ resourceId: 'energy', amount: 1 }] } : {}) }
                            ]
                        }] };
                    }
                    state.worlds = [world];
                    state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
                    state.activeWorldId = world.id;
                    const sess = prepareCurrentWorldSession(); sess.setupComplete = true;
                    sess.entityStates.key = { ...sess.entityStates.key, location: 'foyer' };
                    sess.entityStates.linda = { ...sess.entityStates.linda, location: 'foyer' };
                    if (id === 'F12') {
                        sess.inventory = ['Steel handcuffs'];
                        sess.entityStates.cuffs = { location: '' };
                    }
                    if (id === 'T08' || id === 'F14') {
                        sess.placeDiscoveries ||= {};
                        sess.placeDiscoveries.linda = ['round'];
                    }
                    if (id === 'F14') sess.playerLocation = 'round';
                    let background = null;
                    if (id === 'P43G_GARDEN') {
                        sess.playerLocation = 'foyer';
                        sess.entityStates.linda.location = 'garden';
                        sess.entityStates.cass.location = 'garden';
                        sess.entityStates.remote.location = 'round';
                        sess.entityStates.can = { location: 'garden' };
                        sess.entityStates.gloves = { location: 'garden' };
                        sess.placeDiscoveries ||= {};
                        sess.placeDiscoveries.linda = ['garden', 'foyer'];
                        normalizeLivingWorldState(world, sess);
                        runLivingWorldTick(world, sess);
                        sess.bonusTimeMinutes = (sess.bonusTimeMinutes || 0) + 20;
                        runLivingWorldTick(world, sess, { clockOnly: true });
                        background = { minute: sess.lastNpcSimulationMinute,
                            lindaLocation: sess.entityStates.linda.location,
                            cassLocation: sess.entityStates.cass.location,
                            remoteObservations: structuredClone(sess.entityStates.remote.observations || []),
                            lindaObservations: structuredClone(sess.entityStates.linda.observations || []),
                            cassObservations: structuredClone(sess.entityStates.cass.observations || []),
                            events: structuredClone(sess.turnEvents || []) };
                    }
                    switchView('worldPlay'); renderWorldPlayState();
                    const turns = [];
                    const started = performance.now();
                    for (const [index, request] of (Array.isArray(input) ? input : [input]).entries()) {
                        document.getElementById('world-user-input').value = request;
                        const turnStarted = performance.now();
                        await executeWorldTurn();
                        const current = getCurrentWorldSession();
                        turns.push({ index: index + 1, input: request,
                            durationMs: Math.round(performance.now() - turnStarted),
                            error: document.getElementById('world-turn-error-text')?.textContent,
                            audit: current.lastTurnAudit,
                            receipt: current.worldTurnReceipts?.at(-1),
                            inventory: structuredClone(current.inventory),
                            playerLocation: current.playerLocation,
                            npcObservations: Object.fromEntries(Object.entries(current.entityStates || {})
                                .filter(([key]) => world.entities.some(item => item.id === key && item.type === 'npc'))
                                .map(([key, value]) => [key, structuredClone(value.observations || [])])) });
                    }
                    const active = getCurrentWorldSession();
                    const saved = (await HordeDB.get(`worldInstance:${world.id}`))?.sessions
                        ?.find(item => item.id === active.id);
                    return { input, background, turns, turnDurationMs: Math.round(performance.now() - started),
                        error: turns.at(-1)?.error,
                        audit: active.lastTurnAudit, receipt: active.worldTurnReceipts?.at(-1),
                        callAudit: [...active.history].reverse().find(message => message.role === 'dm')?.callAudit,
                        narrative: active.history.at(-1)?.text,
                        live: { inventory: active.inventory, playerLocation: active.playerLocation,
                            playerStats: active.playerStats,
                            entityStates: active.entityStates,
                            discoveryDecisions: active.discoveryDecisions,
                            itemIds: world.entities.filter(item => item.type === 'item').map(item => item.id),
                            historyLength: active.history.length },
                        saved: saved && { inventory: saved.inventory, playerLocation: saved.playerLocation,
                            playerStats: saved.playerStats,
                            entityStates: saved.entityStates,
                            discoveryDecisions: saved.discoveryDecisions,
                            historyLength: saved.history.length } };
                }, { id, input, model });
            } catch (error) { result = { input, error: String(error) }; }
            output.push({ id, model, ...result, calls, bindingResponses, pageErrors });
            await context.close();
            try { fs.writeFileSync(outputPath, JSON.stringify(output, null, 2)); }
            catch (error) { console.warn(`Diagnostic file unavailable: ${error.code || error.message}`); }
            console.log(`${id}: summary ${JSON.stringify({ turnDurationMs: result.turnDurationMs,
                calls: calls.map(({ rawResponse, ...call }) => call),
                error: result.error, accepted: result.audit?.accepted,
                rejected: result.audit?.rejected?.map(item => item.reason),
                checkResults: result.receipt?.receipt?.check_results,
                liveStats: result.live?.playerStats, savedStats: result.saved?.playerStats,
                savedHistoryLength: result.saved?.historyLength })}`);
            console.log(`${id}: ${JSON.stringify({ error: result.error, calls: calls.length,
                accepted: result.audit?.accepted, rejected: result.audit?.rejected?.map(x => x.reason),
                savedTurn: !!result.receipt && result.saved?.historyLength === result.live?.historyLength
                    && result.saved.historyLength > 0 })}`);
        }
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
