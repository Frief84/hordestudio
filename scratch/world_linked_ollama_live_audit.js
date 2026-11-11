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
    ,['CHAIR_A', 'du setzt dich auf einen stuhl']
    ,['CHAIR_B', 'ich setze mich auf einen stuhl "Ich bin der Weg und die Wahrheit und das Leben; niemand kommt zum Vater außer durch mich."']
    ,['CHAIR_C', 'Jesus sieht sie an, und für einen Moment liegt ein Anflug von einem müden, fast schmerzlichen Lächeln auf seinem Gesicht. Er bückt sich, greift nach den Stuhlbeinen und stellt den umgekippten Stuhl mit einer ruhigen, kontrollierten Bewegung wieder ordentlich an den Küchentisch. „Du hast recht“, sagt er leise und setzt sich darauf. Er legt die Hände flach auf die Tischplatte. „In dieser Küche wirkt es absurd. Du willst einfach nur den Alltag bewältigen, die Suppe kochen, den Tisch decken. Und ich breche hier herein und rede von Schwertern, Kreuzen und dem Sterben.“']
    ,['MULTI_NOVEL', 'I pirouette, then signal to Linda and murmur "Ready."']
    ,['PARTIAL_MISSING', 'I try to lift a missing crate, then signal to Linda and murmur "No crate here."']
    ,['MOVE_SPEECH', 'I move to the Round Room and say "Ready."']
    ,['BLOCKED_SPEECH', 'I try to enter the Round Room and tell Linda "The door is shut."']
    ,['REDUNDANT_SPEECH', 'I go to the Foyer and tell Linda "I am here."']
    ,['BLOCKED_TAKE', 'I try to enter the Round Room, then take the bronze key from the table.']
    ,['TAKE_MOVE_SPEECH', 'I take the bronze key from the table, enter the Round Room, and say "Ready."']
    ,['MULTILEG', 'I travel through the Round Room to the Garden.']
    ,['MULTILEG_EXACT', 'I go to the Garden.']
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
                result = await page.evaluate(async ({ id, input, model, lifecycle }) => {
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
                    if (['BLOCKED_SPEECH', 'BLOCKED_TAKE', 'TAKE_MOVE_SPEECH'].includes(id)) {
                        world.locations[0].exits[0].lockState = 'locked';
                        world.locations[0].exits[0].requiredItem = 'Bronze key';
                    }
                    if (['MULTILEG', 'MULTILEG_EXACT'].includes(id)) {
                        world.locations[1].exits.push({ targetLocationId: 'garden', travelTime: 3 });
                        world.locations.push({ id: 'garden', name: 'Garden',
                            description: 'A small garden beyond the Round Room.', exits: [] });
                    }
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
                    if (id.startsWith('CHAIR_')) {
                        world.locations[0].name = 'Kitchen';
                        world.locations[0].description = 'A furnished kitchen. Linda stands beside the table. A wooden chair is beside the table.';
                        world.entities.push({ id: 'chair', type: 'item', name: 'Wooden chair',
                            aliases: ['Stuhl'],
                            supportsActivities: ['sitting'],
                            ...(id === 'CHAIR_C' ? { interactable: { initialState: 'overturned',
                                transitions: [{ from: 'overturned', to: 'upright',
                                    triggers: ['stellt den umgekippten Stuhl', 'rights the overturned chair'] }] } } : {}),
                            locationId: 'foyer', description: id === 'CHAIR_C'
                                ? 'A wooden chair lies overturned beside the kitchen table.'
                                : 'A wooden chair stands ready beside the kitchen table.' });
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
                    if (id === 'CHAIR_C') {
                        sess.playerIdentity ||= {};
                        sess.playerIdentity.personaName = 'Jesus';
                    }
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
                            turnEvents: structuredClone(current.turnEvents || []),
                            inventory: structuredClone(current.inventory),
                            playerLocation: current.playerLocation,
                            npcObservations: Object.fromEntries(Object.entries(current.entityStates || {})
                                .filter(([key]) => world.entities.some(item => item.id === key && item.type === 'npc'))
                                .map(([key, value]) => [key, structuredClone(value.observations || [])])) });
                    }
                    const active = getCurrentWorldSession();
                    const saved = (await HordeDB.get(`worldInstance:${world.id}`))?.sessions
                        ?.find(item => item.id === active.id);
                    let lifecycleResult = null;
                    if (lifecycle && !Array.isArray(input) && active.worldTurnReceipts?.length) {
                        const firstReceipt = structuredClone(active.worldTurnReceipts.at(-1));
                        const firstEvents = structuredClone(active.turnEvents || []);
                        const firstVersion = active.worldStateVersion;
                        const firstDm = [...active.history].reverse().find(item => item.role === 'dm');
                        const before = firstDm?.turnSnapshot;
                        await executeWorldTurn(true);
                        const rerolled = getCurrentWorldSession();
                        const rerollReceipt = rerolled.worldTurnReceipts?.at(-1);
                        lifecycleResult = {
                            reloadedFirst: !!saved && JSON.stringify(saved.turnEvents || [])
                                === JSON.stringify(firstEvents)
                                && JSON.stringify(saved.worldTurnReceipts?.at(-1))
                                    === JSON.stringify(firstReceipt),
                            firstVersion,
                            rerollVersion: rerolled.worldStateVersion,
                            rerollReceiptId: rerollReceipt?.receipt?.turn_id || null,
                            firstReceiptId: firstReceipt.receipt?.turn_id || null,
                            rerollEventIds: (rerolled.turnEvents || []).map(item => item.id),
                            restored: !!before && restoreWorldTurnState(world, rerolled, before)
                        };
                        if (lifecycleResult.restored) {
                            await saveWorldsState({ worldId: world.id });
                            const rolled = (await HordeDB.get(`worldInstance:${world.id}`))
                                ?.sessions?.find(item => item.id === rerolled.id);
                            lifecycleResult.rollbackPersisted = !!rolled
                                && rolled.worldStateVersion === before.session.worldStateVersion
                                && JSON.stringify(rolled.turnEvents || [])
                                    === JSON.stringify(before.session.turnEvents || []);
                            lifecycleResult.rollbackReceiptCount = rolled?.worldTurnReceipts?.length;
                        }
                    }
                    return { input, background, turns, turnDurationMs: Math.round(performance.now() - started),
                        lifecycle: lifecycleResult,
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
                            historyLength: saved.history.length,
                            turnEvents: saved.turnEvents || [],
                            worldTurnReceipts: saved.worldTurnReceipts || [] } };
                }, { id, input, model,
                    lifecycle: process.env.HORDE_LIVE_LIFECYCLE === '1' });
            } catch (error) { result = { input, error: String(error) }; }
            const receipt = result.receipt?.receipt;
            const outcomes = new Map((receipt?.action_results || [])
                .map(item => [item.action_id, item.outcome]));
            const savedReceipt = result.saved?.worldTurnReceipts?.at(-1)?.receipt;
            const ids = (result.saved?.turnEvents || []).map(item => item.id).filter(Boolean);
            const focused = ['MULTI_NOVEL', 'PARTIAL_MISSING', 'MOVE_SPEECH',
                'BLOCKED_SPEECH', 'REDUNDANT_SPEECH', 'BLOCKED_TAKE',
                'TAKE_MOVE_SPEECH', 'MULTILEG', 'MULTILEG_EXACT'].includes(id);
            const boundDraft = bindingResponses.map(item => {
                try { return JSON.parse(item.response)?.draft; } catch { return null; }
            }).reverse().find(draft => draft?.actions?.some(action =>
                outcomes.has(action.action_id)));
            const successfulPhysical = (boundDraft?.actions || []).filter(action =>
                ['physical', 'travel'].includes(action.kind)
                && outcomes.get(action.action_id) === 'succeeded');
            const physicalWitnesses = successfulPhysical.every(action =>
                (receipt?.confirmed_effects || []).some(effect =>
                    effect.action_id === action.action_id)
                || (receipt?.events || []).some(event => event.action_id === action.action_id
                    && event.actor_id === 'player' && event.status === 'completed'
                    && (event.type === 'activity' && !!String(event.activity || '').trim()
                        || event.type === 'interaction' && !!String(event.action || '').trim())));
            const pass = id === 'MULTILEG_EXACT' && process.env.HORDE_LIVE_LIFECYCLE === '1'
                ? !result.error && result.saved?.playerLocation === 'garden'
                    && result.live?.playerLocation === 'foyer'
                    && result.lifecycle?.reloadedFirst === true
                    && result.lifecycle?.rollbackPersisted === true
                    && result.lifecycle?.firstVersion === result.lifecycle?.rerollVersion
                    && result.lifecycle?.firstReceiptId === result.lifecycle?.rerollReceiptId
                    && calls.length === 2 && calls.every(call => call.promptCharacters < 2500)
                : !focused || !!receipt && !!result.audit
                && !result.error && result.saved?.historyLength === result.live?.historyLength
                && JSON.stringify(savedReceipt?.action_results) === JSON.stringify(receipt.action_results)
                && new Set(ids).size === ids.length
                && (receipt.events || []).every(event => event.status !== 'completed'
                    || outcomes.get(event.action_id) === 'succeeded')
                && !!boundDraft && physicalWitnesses
                && (id !== 'MULTI_NOVEL' || boundDraft.actions
                    .filter(action => String(action.request || '').trim()).length >= 3)
                && (id !== 'PARTIAL_MISSING' || boundDraft.actions
                    .filter(action => String(action.request || '').trim()).length >= 3)
                && (id !== 'PARTIAL_MISSING' || [...outcomes.values()].includes('succeeded')
                    && [...outcomes.values()].some(value => value === 'unresolved'
                        || value === 'failed' || value === 'blocked'))
                && (id !== 'MOVE_SPEECH' || result.saved.playerLocation === 'round'
                    && receipt.confirmed_effects?.some(effect => effect.type === 'actor_move'))
                && (id !== 'BLOCKED_SPEECH' || result.saved.playerLocation === 'foyer'
                    && !receipt.confirmed_effects?.some(effect => effect.type === 'actor_move')
                    && [...outcomes.values()].includes('blocked')
                    && [...outcomes.values()].includes('succeeded'))
                && (id !== 'REDUNDANT_SPEECH' || result.saved.playerLocation === 'foyer'
                    && !receipt.confirmed_effects?.some(effect => effect.type === 'actor_move')
                    && [...outcomes.values()].includes('already_satisfied')
                    && [...outcomes.values()].includes('succeeded'))
                && (id !== 'BLOCKED_TAKE' || result.saved.playerLocation === 'foyer'
                    && !receipt.confirmed_effects?.some(effect => effect.type === 'actor_move')
                    && receipt.confirmed_effects?.some(effect => effect.type === 'item_transfer')
                    && [...outcomes.values()].includes('blocked'))
                && (id !== 'TAKE_MOVE_SPEECH' || result.saved.playerLocation === 'round'
                    && receipt.confirmed_effects?.some(effect => effect.type === 'item_transfer')
                    && receipt.confirmed_effects?.some(effect => effect.type === 'actor_move')
                    && receipt.speech_attributions?.some(item => item.speaker === 'player'
                        && item.statement === 'Ready.'))
                && (id !== 'MULTILEG' || result.saved.playerLocation === 'garden'
                    && receipt.confirmed_effects?.filter(effect => effect.type === 'actor_move').length === 2)
                && (id !== 'MULTILEG_EXACT' || result.saved.playerLocation === 'garden'
                    && receipt.confirmed_effects?.filter(effect => effect.type === 'actor_move').length === 2
                    && calls.length === 1 && calls[0].promptCharacters < 2500)
                && (process.env.HORDE_LIVE_LIFECYCLE !== '1'
                    || result.lifecycle?.reloadedFirst && result.lifecycle?.rollbackPersisted);
            output.push({ id, model, ...result, calls, bindingResponses, pageErrors, pass });
            if (!pass) process.exitCode = 1;
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
                    && result.saved.historyLength > 0, pass })}`);
        }
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
