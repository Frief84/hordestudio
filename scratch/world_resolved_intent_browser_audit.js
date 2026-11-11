'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');
const bound = process.env.HORDE_RESOLVED_BOUND === '1';
const liveModel = String(process.env.HORDE_RESOLVED_LIVE_MODEL || '').trim();
const skipLifecycle = process.env.HORDE_RESOLVED_SKIP_LIFECYCLE === '1';
const outputLanguage = String(process.env.HORDE_RESOLVED_LANGUAGE || 'de').trim();
const generalized = process.env.HORDE_GENERALIZED_INTENT === '1';

const intents = {
    keyGateSpeech: { protocol: 'resolved_intent_v1', steps: [
        { source_quote: 'Take the brass key', kind: 'transfer', operation: 'take', item_id: 'brass_key' },
        { source_quote: 'pass through the iron gate', kind: 'travel', destination_id: 'archive' },
        { source_quote: 'then tell Mara "I made it."', kind: 'speech', target_ids: ['mara'], utterance: 'I made it.' }
    ] },
    blockedThenSpeech: { protocol: 'resolved_intent_v1', steps: [
        { source_quote: 'Try to enter the sealed east gallery', kind: 'travel', destination_id: 'east_gallery' },
        { source_quote: 'then ask Mara about the map', kind: 'question', target_ids: ['mara'], utterance: 'ask Mara about the map' }
    ] },
    alreadyThereThenSpeech: { protocol: 'resolved_intent_v1', steps: [
        { source_quote: 'I am already in the garden', kind: 'travel', destination_id: 'garden' },
        { source_quote: 'then wave to Mara', kind: 'gesture' }
    ] },
    invalidFallback: { protocol: 'resolved_intent_v1', steps: [
        { source_quote: 'Break the moon', kind: 'travel', destination_id: 'missing_place' }
    ] },
    freeRoute: { protocol: 'resolved_intent_v1', steps: [
        { source_quote: 'Go through the hall', kind: 'travel', destination_id: 'hall' },
        { source_quote: 'to the garden', kind: 'travel', destination_id: 'garden' }
    ] },
    paidRoute: { protocol: 'resolved_intent_v1', steps: [
        { source_quote: 'Take the ferry to the market', kind: 'travel', destination_id: 'market' }
    ] },
    gesture: { protocol: 'resolved_intent_v1', steps: [
        { source_quote: 'Wave once', kind: 'gesture' }
    ] },
    appearanceActivity: { protocol: 'resolved_intent_v1', steps: [
        { source_quote: 'I put on the red cloak', kind: 'appearance', outfit: 'red cloak' },
        { source_quote: 'then sit by the fire', kind: 'activity', activity: 'sit by the fire' }
    ] },
    conditionalBlock: { protocol: 'resolved_intent_v1', steps: [
        { source_quote: 'Try to enter the sealed east gallery', kind: 'travel',
            destination_id: 'east_gallery' },
        { source_quote: 'if that succeeds', kind: 'context' },
        { source_quote: 'take the brass key', kind: 'transfer', operation: 'take',
            item_id: 'brass_key', depends_on: [{ step_index: 0, outcome: 'succeeded' }] }
    ] }
};

const snippets = [
    ['index.html', 'text/html'], ['app.js', 'text/javascript'],
    ['worlds/resolved-intent.js', 'text/javascript'],
    ['worlds/scene-draft.js', 'text/javascript'],
    ['worlds/turn-context.js', 'text/javascript'],
    ['worlds/turn-binding.js', 'text/javascript'],
    ['worlds/working-state.js', 'text/javascript'],
    ['worlds/linked-world-actions.js', 'text/javascript'],
    ['worlds/effect-registry.js', 'text/javascript'],
    ['worlds/model-client.js', 'text/javascript'],
    ['worlds/world-kernel.js', 'text/javascript']
];

(async () => {
    if (liveModel) await require('../worlds/model-client').prepareLocalModel({
        url: 'http://127.0.0.1:11434/v1/chat/completions', model: liveModel,
        signal: AbortSignal.timeout(180000), onLoading: () => console.log(`Loading ${liveModel}`)
    });
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext();
        await context.route('**/*', async route => {
            const url = new URL(route.request().url());
            if ((url.hostname === 'resolved-intent.test' && url.pathname === '/ollama-proxy')
                || (liveModel && url.pathname.includes('/chat/completions'))) {
                try {
                    const response = await fetch('http://127.0.0.1:11434/v1/chat/completions', {
                        method: 'POST', headers: { 'content-type': 'application/json' },
                        signal: AbortSignal.timeout(60000), body: route.request().postData()
                    });
                    return route.fulfill({ status: response.status,
                        contentType: 'application/json', body: await response.text() });
                } catch (error) {
                    return route.fulfill({ status: 504, contentType: 'application/json',
                        body: JSON.stringify({ error: String(error?.message || error) }) });
                }
            }
            if (bound && url.pathname === '/worlds/bind-turn') {
                const headers = { 'access-control-allow-origin': '*',
                    'access-control-allow-methods': 'POST, OPTIONS',
                    'access-control-allow-headers': 'content-type' };
                if (route.request().method() === 'OPTIONS')
                    return route.fulfill({ status: 204, headers });
                const result = spawnSync(process.execPath,
                    [path.join(root, 'worlds/turn-binding-worker.js')],
                    { input: route.request().postData(), encoding: 'utf8' });
                return route.fulfill({ status: 200, contentType: 'application/json', headers,
                    body: result.stdout || JSON.stringify({ error: String(result.error || 'worker_failed') }) });
            }
            if (url.hostname !== 'resolved-intent.test') return route.abort();
            const rel = decodeURIComponent(url.pathname.slice(1) || 'index.html');
            const file = path.resolve(root, rel);
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file)
                || !fs.statSync(file).isFile())
                return route.fulfill({ status: 404, body: '' });
            const contentType = snippets.find(([name]) => name === rel)?.[1]
                || ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
                    [path.extname(file)] || 'application/octet-stream');
            return route.fulfill({ contentType, body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => {
            if (message.type() === 'log' && /^__resolved_turn_(?:start|done)__/.test(message.text()))
                console.log(message.text());
        });
        await page.goto('https://resolved-intent.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined'
            && !!companionAgencyTimer);
        const result = await page.evaluate(async ({ bound, intents, liveModel, skipLifecycle, outputLanguage, generalized }) => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            localStorage.setItem('horde_world_debug_enabled_v1', 'true');
            state.apiKey = 'offline';
            state.globalSettings.apiProvider = 'local';
            state.globalSettings.localBaseUrl = 'http://127.0.0.1:1234/v1';
            let world = { id: 'resolved_intent_fixture', name: 'Resolved Intent Fixture',
                outputLanguage, model: 'fixture/model', contextSize: 32768,
                maxTokens: 2048, dmPrompt: '', intro: '', startLocationId: 'foyer',
                locations: [
                    { id: 'foyer', name: 'Foyer', description: 'Ein heller Vorraum.',
                        exits: [{ targetLocationId: 'archive', doorId: 'iron_gate',
                            requiredItem: 'brass_key', lockState: 'locked' }] },
                    { id: 'archive', name: 'Archiv', description: 'Staubige Regale.', exits: [] },
                    { id: 'hall', name: 'Flur', description: 'Ein langer Flur.', exits: [] },
                    { id: 'garden', name: 'Garten', description: 'Ein stiller Garten.', exits: [] },
                    { id: 'east_gallery', name: 'Ostgalerie', description: 'Eine versiegelte Galerie.', exits: [] },
                    { id: 'dock', name: 'Kai', description: 'Ein windiger Kai.',
                        exits: [{ targetLocationId: 'market', label: 'ferry', mode: 'boat',
                            fare: { resourceId: 'coins', amount: 3 },
                            mode: 'boat', travelTime: 8 }] },
                    { id: 'market', name: 'Markt', description: 'Ein belebter Markt.', exits: [] }
                ],
                entities: [
                    { id: 'brass_key', name: 'Brass key', type: 'item', startLocation: 'foyer' },
                    { id: 'mara', name: 'Mara', type: 'npc', startLocation: 'foyer' }
                ],
                kernel: { enabled: true, memoryMode: 'ledger', sceneDrafts: true,
                    serverBindings: bound, sceneDraftProtocol: 'scene_draft_v3' },
                hudConfig: { startTimeHours: 8, startTimeMinutes: 0, timeStep: 5 } };
            state.worlds = [world];
            state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            let session = prepareCurrentWorldSession();
            session.setupComplete = true;
            session.playerLocation = 'foyer';
            session.entityStates ||= {};
            session.entityStates.mara = { location: 'foyer' };
            session.playerStats = { coins: 5 };
            const setLocation = id => {
                session.playerLocation = id;
                session.entityStates.player = { ...(session.entityStates.player || {}), location: id };
            };
            switchView('worldPlay'); renderWorldPlayState();
            const calls = [];
            const queue = [];
            window.__resolvedIntentQueue = queue;
            const realFetch = window.fetch;
            window.fetch = async (url, options = {}) => {
                if (String(url).includes('/chat/completions')) {
                    const body = JSON.parse(options.body || '{}');
                    calls.push(body);
                    if (body.response_format?.json_schema?.name === 'resolved_intent_v1'
                        || body.messages?.[0]?.content?.startsWith('Return one JSON object matching this schema:')) {
                        if (window.__rejectStructuredFormat && body.response_format) {
                            window.__rejectStructuredFormat = false;
                            return new Response(JSON.stringify({ error: {
                                message: 'response_format json_schema is not supported' } }), { status: 400 });
                        }
                        if (liveModel && window.__forceInvalidIntent) {
                            window.__forceInvalidIntent = false;
                            return new Response(JSON.stringify({ choices: [{ message: {
                                content: JSON.stringify(intents.invalidFallback) } }] }),
                            { status: 200, headers: { 'Content-Type': 'application/json' } });
                        }
                        if (liveModel) {
                            body.model = liveModel;
                            const response = await realFetch('https://resolved-intent.test/ollama-proxy', {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(body)
                            });
                            const clone = response.clone();
                            try { calls[calls.length - 1].resolvedIntentResponse = await clone.json(); }
                            catch { calls[calls.length - 1].resolvedIntentResponse = { status: response.status }; }
                            return response;
                        }
                        const next = queue.shift();
                        if (next === undefined) throw new Error('missing_fixture_resolved_intent');
                        const fault = window.__intentTransportFault;
                        if (fault === 'network') throw new TypeError('Failed to fetch');
                        if (fault === 'timeout') return new Promise(() => {});
                        if (fault === 'http') return new Response(JSON.stringify({error: {message: 'model fixture/model not found'}}), {status: 404});
                        if (fault === 'invalid_json') return new Response('{broken', {status: 200});
                        if (fault === 'invalid_intent_json') return new Response(JSON.stringify({choices:[{message:{content:'{broken'}}]}), {status:200});
                        if (fault === 'truncated') return new Response(JSON.stringify({choices:[{message:{content:''},finish_reason:'length'}]}), {status:200});
                        if (window.__delayNextIntent) {
                            window.__delayNextIntent = false;
                            await new Promise(resolve => setTimeout(resolve, 200));
                        }
                        const json = JSON.stringify(next);
                        const message = window.__intentEnvelope === 'blocks'
                            ? { content: [{ type: 'text', text: json }] }
                            : window.__intentEnvelope === 'fence' ? { content: '```json\n' + json + '\n```' }
                            : window.__intentEnvelope === 'tool' ? { content: 'Result follows.',
                                tool_calls: [{ function: { name: 'resolved_intent_v1', arguments: json } }] }
                            : window.__intentEnvelope === 'legacy' ? { content: null, function_call: { arguments: json } }
                            : { content: json };
                        return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200,
                            headers: { 'Content-Type': 'application/json' } });
                    }
                    if (liveModel) {
                        body.model = liveModel;
                        return realFetch('https://resolved-intent.test/ollama-proxy', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(body)
                        });
                    }
                    const speech = window.__narrativeReply || (body.messages?.[1]?.content?.includes('I made it.')
                        ? '„I made it.“ Im Archiv klingt deine Stimme zwischen den alten Regalen nach.'
                        : 'Die Stille des Ortes legt sich für einen Moment um deine Worte.');
                    return new Response(JSON.stringify({ choices: [{ message: { content: speech } }] }),
                        { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                return realFetch(url, options);
            };
            const doTurn = async (name, input, intent, before = () => {}) => {
                const setup = before();
                if (liveModel && name === 'invalid_intent_fail_closed')
                    window.__forceInvalidIntent = true;
                if (!liveModel) queue.push(intent);
                const version = session.worldStateVersion || 0;
                const historyLength = session.history.length;
                const callStart = calls.length;
                console.log(`__resolved_turn_start__${name}`);
                document.getElementById('world-user-input').value = input;
                await executeWorldTurn();
                world = state.worlds.find(item => item.id === 'resolved_intent_fixture');
                session = getCurrentWorldSession();
                const msg = session.history.at(-1);
                console.log(`__resolved_turn_done__${name}`);
                return { name, location: session.playerLocation,
                    setup,
                    outfit: session.outfit,
                    versionDelta: (session.worldStateVersion || 0) - version,
                    historyDelta: session.history.length - historyLength,
                    inputValue: document.getElementById('world-user-input').value,
                    error: document.getElementById('world-turn-error')?.classList.contains('hidden')
                        ? '' : document.getElementById('world-turn-error-text')?.textContent || '',
                    status: msg?.actionOutcomes?.map(item => item.status),
                    outcomes: msg?.actionOutcomes,
                    text: msg?.text, inventory: safeJsonClone(session.inventory || []),
                    coins: session.playerStats?.coins,
                    fareLedger: safeJsonClone(session.resourceCostLedger || []),
                    receipt: safeJsonClone(session.worldTurnReceipts?.at(-1)?.receipt || null),
                    debug: worldDebugEntries(world, session)[0],
                    callKinds: calls.slice(callStart).map(body => body.response_format?.json_schema?.name
                        || (body.max_tokens === 240 ? 'narration' : 'other')),
                    intentResponses: calls.slice(callStart)
                        .filter(body => body.resolvedIntentResponse)
                        .map(body => body.resolvedIntentResponse?.choices?.[0]?.message?.content || null) };
            };
            if (!liveModel) {
                const savedTimeout = state.globalSettings.localGenerationTimeoutSeconds;
                for (const fault of ['network', 'timeout', 'http', 'invalid_json', 'invalid_intent_json', 'truncated']) {
                    window.__intentTransportFault = fault;
                    state.globalSettings.localGenerationTimeoutSeconds = 0.03;
                    const failed = await doTurn(fault, 'Wave once.', intents.gesture);
                    if (failed.versionDelta !== 0 || failed.historyDelta !== 0
                        || failed.inputValue !== 'Wave once.' || failed.callKinds.length !== 1
                        || !failed.error || /nicht sicher auflösen|rephrase|reliably interpret/i.test(failed.error))
                        throw new Error('Transport rollback contract: ' + JSON.stringify(failed));
                    if (fault === 'timeout' && session.worldCallDiagnostics.at(-1).calls.at(-1).outcome !== 'timeout')
                        throw new Error('Timeout was not classified as timeout');
                }
                delete window.__intentTransportFault;
                state.globalSettings.localGenerationTimeoutSeconds = savedTimeout;
            }
            if (generalized) {
                const requireCheck = (condition, detail) => { if (!condition) throw new Error(detail); };
                const baseWorld = safeJsonClone(world), baseSession = safeJsonClone(session);
                const reset = language => {
                    world = safeJsonClone(baseWorld); session = safeJsonClone(baseSession);
                    world.outputLanguage = language;
                    world.entities.push({ id: 'apple', name: 'Apfel', type: 'item', startLocation: 'garden' },
                        { id: 'jonas', name: 'Jonas', type: 'npc', startLocation: 'garden',
                            persona: 'Friendly gardener. Speaks German and English.', goal: 'Care for the garden' });
                    world.locations.find(item => item.id === 'garden').description = 'An apple tree grows here.';
                    session.playerLocation = 'garden';
                    session.entityStates.player = { location: 'garden' };
                    session.entityStates.apple = { location: 'garden' };
                    session.entityStates.jonas = { location: 'garden', observations: ['We spoke about a red scarf.'] };
                    session.inventory = [];
                    state.worlds = [world];
                    state.worldInstances[world.id] = { sessions: [session], activeSessionId: session.id };
                };
                const results = [], dialogues = [];
                const phrases = {
                    de: ['Ich pflücke einen Apfel vom Baum.', 'Ich lege den Apfel auf den Boden.',
                        "Ich warte auf Jonas' Antwort.", 'Ich frage Jonas, was er heute vorhat.'],
                    en: ['I pick an apple from the tree.', 'I put the apple on the ground.',
                        'I wait for Jonas to answer.', 'I ask Jonas what he plans to do today.']
                };
                for (const language of ['de', 'en']) {
                    reset(language);
                    window.__narrativeReply = language === 'de' ? 'Jonas antwortet: „Heute bleibe ich hier im Garten.“'
                        : 'Jonas replies, “Today I am staying here in the garden.”';
                    const steps = [
                        { kind: 'transfer', operation: 'take', item_id: 'apple' },
                        { kind: 'transfer', operation: 'drop', item_id: 'apple' },
                        { kind: 'wait', target_ids: ['jonas'] },
                        { kind: 'question', target_ids: ['jonas'] }
                    ];
                    for (let i = 0; i < steps.length; i++) {
                        window.__intentEnvelope = ['blocks', 'fence', 'legacy', 'tool'][i];
                        const input = phrases[language][i];
                        const step = { source_quote: input, ...steps[i], ...(i === 3 ? { utterance: input } : {}) };
                        const result = await doTurn(`${language}_${i}`, input,
                            { protocol: 'resolved_intent_v1', steps: [step] });
                        requireCheck(result.versionDelta === 1 && result.historyDelta === 2 && !result.error,
                            'Equivalent action failed: ' + JSON.stringify(result));
                        requireCheck(result.status.every(status => ['succeeded', 'already_satisfied'].includes(status)),
                            'Action not executed: ' + JSON.stringify(result));
                        if (i === 0) requireCheck(result.inventory.some(item => item === 'Apfel' || item.name === 'Apfel'), 'Apple pickup missing');
                        if (i === 1) requireCheck(result.inventory.length === 0, 'Apple drop missing');
                        if (i === 3) requireCheck(liveModel ? result.debug?.audit?.turnResolution?.status !== 'failed'
                            && result.text !== input && !/^You say,|^Du sagst:/u.test(result.text)
                            : result.text === window.__narrativeReply, 'NPC reply was replaced by player echo: ' + result.text);
                        results.push({ language, action: i, effects: result.receipt?.confirmed_effects,
                            location: result.location, inventory: result.inventory, narrative: result.text,
                            time: getWorldTimeData(world, session).currentTotalMinutes });
                    }
                    // Sustained conversation, mixed-language replies and indirect speech.
                    let previousReply = '';
                    for (let turn = 0; turn < 6; turn++) {
                        const input = turn % 2 === 0 ? 'Ich frage Jonas: „Do you remember our red scarf?“'
                            : 'I ask Jonas: “Erinnerst du dich an unseren roten Schal?”';
                        const utterance = turn % 2 === 0 ? 'Do you remember our red scarf?'
                            : 'Erinnerst du dich an unseren roten Schal?';
                        window.__narrativeReply = language === 'de' ? 'Jonas nickt: „Ja, ich erinnere mich an den roten Schal.“'
                            : 'Jonas nods. “Yes, I remember the red scarf.”';
                        const result = await doTurn(`${language}_conversation_${turn}`, input,
                            { protocol: 'resolved_intent_v1', steps: [{ source_quote: input,
                                kind: 'question', target_ids: ['jonas'], utterance }] });
                        requireCheck(!result.error && result.versionDelta === 1
                            && (liveModel ? result.text !== input && !/^You say,|^Du sagst:/u.test(result.text)
                                : result.text === window.__narrativeReply),
                            'Conversation failed: ' + JSON.stringify(result));
                        const evidence = JSON.parse(calls.at(-1).messages[1].content);
                        const npc = evidence.presentPeople.find(person => person.id === 'jonas');
                        requireCheck(npc?.knowledge.some(item => item.text?.includes('red scarf')), 'Legacy NPC memory lost');
                        requireCheck(evidence.playerSpeech.some(item => item.quote === utterance && item.listeners.includes('jonas')),
                            'Speech or listeners lost in narration');
                        requireCheck(npc.conversation.length > 0, 'Witnessed conversation missing');
                        if (turn > 0) requireCheck(npc.conversation.some(item => item.text === previousReply), 'NPC reply continuity lost');
                        previousReply = result.text;
                        dialogues.push({ language, input, reply: result.text });
                    }
                }
                const semantic = row => JSON.stringify({ effects: (row.effects || []).map(effect => ({ type: effect.type,
                    payload: effect.payload })), location: row.location, inventory: row.inventory, time: row.time });
                for (let i = 0; i < 4; i++) requireCheck(semantic(results[i]) === semantic(results[i + 4]),
                    'German/English state mismatch: ' + JSON.stringify([results[i], results[i + 4]]));
                reset('de');
                window.__rejectStructuredFormat = !liveModel;
                const compoundInput = 'Ich nehme den Apfel, then I put it on the ground.';
                const compound = await doTurn('mixed_compound_capability_fallback', compoundInput,
                    { protocol: 'resolved_intent_v1', steps: [
                        { source_quote: 'Ich nehme den Apfel', kind: 'transfer', operation: 'take', item_id: 'apple' },
                        { source_quote: 'then I put it on the ground.', kind: 'transfer', operation: 'drop', item_id: 'apple' }
                    ] });
                requireCheck(compound.versionDelta === 1 && compound.inventory.length === 0
                    && compound.status.length === 2 && compound.status.every(status => status === 'succeeded'),
                    'Mixed compound failed: ' + JSON.stringify(compound));
                requireCheck(compound.callKinds.length === (liveModel ? 2 : 3), 'Unexpected intent/narration call count');
                const longSpeech = liveModel
                    ? 'Jonas, ich möchte noch einmal auf unser Gespräch über den roten Schal zurückkommen. '
                        + 'Mir ist wichtig, dass wir beide dieselbe Erinnerung meinen, bevor wir weiter über unsere Pläne sprechen. '
                        + 'Ich habe heute Zeit, dir zuzuhören, und du musst nicht sofort eine endgültige Entscheidung treffen. '
                        + 'Wenn du gerade lieber über den Garten reden möchtest, können wir damit anfangen. '
                        + 'Mich interessiert besonders, welcher Teil deiner Arbeit dir Freude macht und was dich daran manchmal ermüdet. '
                        + 'You can answer in whichever language feels natural to you; I am interested in what you mean, not in a perfect translation. '
                        + 'Perhaps we could first talk about this morning and then about tomorrow, without making promises we cannot keep. '
                        + 'Ich möchte auch nicht, dass du glaubst, ich hätte bereits einen bestimmten Plan für uns beschlossen. '
                        + 'Bisher habe ich nur Fragen gestellt und meine Gedanken erklärt; alles Weitere können wir gemeinsam besprechen. '
                        + 'Falls ich vorhin etwas unklar formuliert habe, sag es bitte offen, damit ich es mit anderen Worten erklären kann. '
                        + 'Was hältst du davon, und worüber würdest du jetzt am liebsten sprechen?'
                    : 'Wir sprechen über unsere Pläne für morgen. '.repeat(35) + 'What do you think?';
                const longInput = `Ich frage Jonas: „${longSpeech}“`;
                const longResult = await doTurn('long_mixed_dialogue', longInput,
                    { protocol: 'resolved_intent_v1', steps: [{ source_quote: longInput,
                        kind: 'question', target_ids: ['jonas'], utterance: longSpeech }] });
                requireCheck(longResult.versionDelta === 1 && longResult.historyDelta === 2
                    && longResult.receipt?.speech_attributions?.some(item => item.statement === longSpeech),
                    'Long dialogue was rejected or truncated: ' + JSON.stringify({ error: longResult.error,
                        failures: longResult.debug?.failures?.map(item => item.reasons) }));
                if (!liveModel) for (const [name, proposal] of [['null', null], ['array', []], ['steps', { protocol: 'resolved_intent_v1', steps: [null] }],
                    ['unknown', { protocol: 'resolved_intent_v1', steps: [{ source_quote: 'Wave once.', kind: 'speech',
                        utterance: 'Wave once.', target_ids: ['invented'] }] }]]) {
                    const invalid = await doTurn('invalid_' + name, 'Wave once.', proposal);
                    requireCheck(invalid.versionDelta === 0 && invalid.historyDelta === 0 && invalid.inputValue === 'Wave once.'
                        && /World intent (schema|semantic) validation failed/.test(invalid.error), 'Invalid response contract: ' + JSON.stringify(invalid));
                }
                if (!liveModel) {
                    const incomplete = await doTurn('omitted_action', 'Wave once, then take the apple.',
                        { protocol: 'resolved_intent_v1', steps: [{ source_quote: 'Wave once', kind: 'gesture' }] });
                    requireCheck(incomplete.versionDelta === 0 && incomplete.historyDelta === 0
                        && incomplete.inputValue === 'Wave once, then take the apple.'
                        && incomplete.error.includes('intent_source_coverage_failed'), 'Omitted action was silently accepted');
                }
                return { generalized: true, results, dialogues, cases: liveModel ? 22 : 27, calls: calls.length };
            }
            const key = await doTurn('key_gate_speech',
                'Take the brass key, pass through the iron gate, then tell Mara "I made it."',
                intents.keyGateSpeech, () => { setLocation('foyer'); session.inventory = [];
                    session.entityStates.mara.location = 'foyer';
                    world.locations[0].exits = [{ targetLocationId: 'archive', doorId: 'iron_gate',
                        requiredItem: 'brass_key', lockState: 'locked' }]; });
            const keyProjectFixture = { world: safeJsonClone(world), session: safeJsonClone(session) };
            const blocked = await doTurn('blocked_then_speech',
                'Try to enter the sealed east gallery, then ask Mara about the map.',
                intents.blockedThenSpeech, () => { setLocation('foyer'); session.inventory = [];
                    session.entityStates.mara.location = 'foyer';
                    world.locations[0].exits = [{ targetLocationId: 'east_gallery',
                        requiredItem: 'sealed_pass', lockState: 'locked' }];
                    return { route: findWorldTravelPath(world, 'foyer', 'east_gallery',
                        { session }), inventory: session.inventory,
                        unlockedExits: session.unlockedExits }; });
            const blockedProjectFixture = { world: safeJsonClone(world), session: safeJsonClone(session) };
            const already = await doTurn('already_there_then_action',
                'I am already in the garden, then wave to Mara.', intents.alreadyThereThenSpeech,
                () => { setLocation('garden'); session.entityStates.mara.location = 'garden'; });
            const invalid = await doTurn('invalid_intent_fail_closed', 'Break the moon.',
                intents.invalidFallback, () => { setLocation('garden'); });
            const conditionalBlock = await doTurn('conditional_block_skips_dependent_action',
                'Try to enter the sealed east gallery; if that succeeds, take the brass key.',
                intents.conditionalBlock, () => { setLocation('foyer'); session.inventory = [];
                    session.entityStates.brass_key ||= {};
                    session.entityStates.brass_key.location = 'foyer';
                    world.locations.find(place => place.id === 'foyer').exits = [{
                        targetLocationId: 'east_gallery', requiredItem: 'sealed_pass', lockState: 'locked' }]; });
            const route = await doTurn('free_multi_leg_route',
                'Go through the hall to the garden.', intents.freeRoute, () => {
                    setLocation('foyer');
                    world.locations.find(place => place.id === 'foyer').exits = [
                        { targetLocationId: 'hall', travelTime: 3 }];
                    world.locations.find(place => place.id === 'hall').exits = [
                        { targetLocationId: 'garden', travelTime: 4 }];
                });
            const fare = await doTurn('typed_fare', 'Take the ferry to the market.',
                intents.paidRoute, () => { setLocation('dock');
                    session.playerStats.coins = 5; });
            const appearance = await doTurn('appearance_and_activity',
                'I put on the red cloak, then sit by the fire.', intents.appearanceActivity,
                () => { setLocation('market'); session.outfit = ''; });
            if (skipLifecycle) return { results: [key, blocked, already, invalid,
                route, fare, appearance, conditionalBlock], calls: calls.length,
                projectorFixtures: { key: keyProjectFixture, blocked: blockedProjectFixture },
                pageErrors: [] };
            const beforeReroll = { location: session.playerLocation,
                version: session.worldStateVersion, coins: session.playerStats.coins,
                history: session.history.length, receipts: session.worldTurnReceipts.length,
                text: session.history.at(-1)?.text, calls: calls.length };
            await executeWorldTurn(true);
            world = state.worlds.find(item => item.id === 'resolved_intent_fixture');
            session = getCurrentWorldSession();
            const reroll = { before: beforeReroll, location: session.playerLocation,
                version: session.worldStateVersion, coins: session.playerStats.coins,
                history: session.history.length, receipts: session.worldTurnReceipts.length,
                text: session.history.at(-1)?.text,
                isReroll: session.history.at(-1)?.isReroll,
                latestCall: calls.at(-1)?.response_format?.json_schema?.name || 'narration',
                calls: calls.length };
            const parallelBefore = { version: session.worldStateVersion,
                history: session.history.length, receipts: session.worldTurnReceipts.length };
            if (!liveModel) queue.push(intents.gesture);
            window.__delayNextIntent = true;
            document.getElementById('world-user-input').value = 'Wave once.';
            const firstParallel = executeWorldTurn();
            await new Promise(resolve => setTimeout(resolve, 20));
            const secondParallel = executeWorldTurn();
            await Promise.all([firstParallel, secondParallel]);
            world = state.worlds.find(item => item.id === 'resolved_intent_fixture');
            session = getCurrentWorldSession();
            const parallel = { before: parallelBefore,
                version: session.worldStateVersion, history: session.history.length,
                receipts: session.worldTurnReceipts.length,
                outcomes: session.history.at(-1)?.actionOutcomes?.map(item => item.status),
                calls: calls.length };
            const beforeRollback = { version: session.worldStateVersion,
                history: session.history.length, receipts: session.worldTurnReceipts.length,
                location: session.playerLocation, coins: session.playerStats?.coins };
            const originalCommit = commitWorldMigrationAware;
            commitWorldMigrationAware = async () => { throw new Error('resolved_intent_test_storage_failure'); };
            try {
                if (!liveModel) queue.push(intents.gesture);
                document.getElementById('world-user-input').value = 'Wave once.';
                await executeWorldTurn();
            } finally { commitWorldMigrationAware = originalCommit; }
            world = state.worlds.find(item => item.id === 'resolved_intent_fixture');
            session = getCurrentWorldSession();
            const rollback = { before: beforeRollback,
                after: { version: session.worldStateVersion, history: session.history.length,
                    receipts: session.worldTurnReceipts.length,
                    location: session.playerLocation, coins: session.playerStats?.coins } };
            return { results: [key, blocked, already, invalid, route, fare, appearance, conditionalBlock], reroll,
                parallel, rollback, calls: calls.length,
                projectorFixtures: { key: keyProjectFixture, blocked: blockedProjectFixture },
                pageErrors: [] };
        }, { bound, intents, liveModel, skipLifecycle, outputLanguage, generalized });
        if (process.env.HORDE_RESOLVED_RESULT_PATH)
            fs.writeFileSync(path.resolve(process.env.HORDE_RESOLVED_RESULT_PATH),
                JSON.stringify({ model: liveModel || null, bound, result }, null, 2));
        if (liveModel) {
            const suffix = `${liveModel.replace(/[^a-z0-9]+/giu, '_').toLowerCase()}-${bound ? 'server_bound' : 'local_bind'}`;
            fs.writeFileSync(path.join(__dirname,
                `world_resolved_intent_browser_live-${suffix}.json`),
            JSON.stringify({ model: liveModel, bound, result }, null, 2));
        }
        assert.deepEqual(errors, []);
        if (generalized) {
            assert.equal(result.generalized, true);
            assert.equal(result.results.length, 8);
            console.log(`PASS generalized multilingual browser workflows (${bound ? 'server binding' : 'local binding'}): ${result.cases} cases`);
            return;
        }
        assert.equal(result.results.length, 8);
        const [key, blocked, already, invalid, route, fare, appearance, conditionalBlock] = result.results;
        assert.equal(key.location, 'archive', JSON.stringify(key));
        assert(key.inventory.some(item => item === 'Brass key'
            || item?.id === 'brass_key' || item?.name === 'Brass key'),
            JSON.stringify(key.inventory));
        assert(key.status.includes('succeeded'));
        assert.equal(key.callKinds.filter(kind => kind === 'resolved_intent_v1').length, 1);
        assert.equal(key.callKinds.filter(kind => kind === 'narration').length, 1);
        assert(key.receipt?.events?.some(event => event.type === 'inventory'));
        assert(key.receipt?.confirmed_effects?.some(effect => effect.type === 'actor_move'));
        assert(key.receipt?.speech_attributions?.some(item =>
            item.speaker === 'player' && item.listeners?.includes('mara')),
        JSON.stringify(key.receipt?.speech_attributions));
        assert(blocked.status.includes('blocked') && blocked.status.includes('succeeded'),
            JSON.stringify(blocked));
        assert.equal(blocked.location, 'foyer');
        assert(liveModel ? already.status.includes('succeeded')
            : already.status.includes('already_satisfied') && already.status.includes('succeeded'),
        JSON.stringify(already));
        assert.equal(already.location, 'garden');
        assert.equal(invalid.versionDelta, 0, JSON.stringify(invalid));
        assert.equal(invalid.historyDelta, 0, JSON.stringify(invalid));
        assert.equal(invalid.inputValue, 'Break the moon.', JSON.stringify(invalid));
        assert.match(invalid.error, /World intent semantic validation failed: unknown_intent_destination/u,
            JSON.stringify(invalid));
        assert.equal(invalid.location, 'garden');
        assert.equal(invalid.callKinds.length, 1);
        assert.equal(invalid.debug.intentValidation.accepted, false);
        assert.equal(route.location, 'garden', JSON.stringify(route));
        assert(route.receipt?.confirmed_effects?.filter(effect => effect.type === 'actor_move').length >= 2,
            JSON.stringify(route.receipt?.confirmed_effects));
        assert.equal(fare.location, 'market', JSON.stringify(fare));
        assert.equal(fare.coins, 2, JSON.stringify(fare));
        assert.equal(fare.fareLedger.length, 1, JSON.stringify(fare));
        assert.equal(appearance.outfit, 'red cloak', JSON.stringify(appearance));
        assert(appearance.receipt?.events?.some(event => event.type === 'outfit'
            && event.outfit === 'red cloak' && event.status === 'completed'),
        JSON.stringify(appearance.receipt?.events));
        assert(appearance.receipt?.events?.some(event => event.type === 'activity'
            && event.activity === 'sit by the fire' && event.status === 'completed'),
        JSON.stringify(appearance.receipt?.events));
        if (outputLanguage === 'en') assert.match(appearance.text, /\bYou\b/u,
            'the World narrative must use its configured English language');
        assert.deepEqual(conditionalBlock.status, ['blocked', 'skipped'],
            JSON.stringify(conditionalBlock));
        assert.equal(conditionalBlock.inventory.length, 0, JSON.stringify(conditionalBlock));
        if (skipLifecycle) {
            if (liveModel) fs.writeFileSync(path.join(__dirname,
                `world_resolved_intent_browser_live-${liveModel.replace(/[^a-z0-9]+/giu, '_').toLowerCase()}-${bound ? 'server_bound' : 'local_bind'}-${outputLanguage}-actions.json`),
            JSON.stringify({ model: liveModel, bound, passed: true,
                calls: result.calls, results: result.results }, null, 2));
            console.log(`PASS live ResolvedIntent action matrix (${bound ? 'server-bound' : 'local-bind'}, ${liveModel || 'fixture'}): eight compound actions`);
            await context.close();
            return;
        }
        assert.equal(result.reroll.location, result.reroll.before.location);
        assert.equal(result.reroll.version, result.reroll.before.version);
        assert.equal(result.reroll.coins, result.reroll.before.coins);
        assert.equal(result.reroll.history, result.reroll.before.history);
        assert.equal(result.reroll.receipts, result.reroll.before.receipts);
        assert.equal(result.reroll.isReroll, true);
        assert.equal(result.reroll.latestCall, 'narration');
        assert.equal(result.parallel.version, result.parallel.before.version + 1);
        assert.equal(result.parallel.history, result.parallel.before.history + 2);
        assert.equal(result.parallel.receipts, result.parallel.before.receipts + 1);
        assert.deepEqual(result.parallel.outcomes, ['succeeded']);
        assert.equal(result.rollback.after.version, result.rollback.before.version);
        assert.equal(result.rollback.after.history, result.rollback.before.history);
        assert.equal(result.rollback.after.receipts, result.rollback.before.receipts);
        assert.equal(result.rollback.after.location, result.rollback.before.location);
        assert.equal(result.rollback.after.coins, result.rollback.before.coins);
        assert(result.calls >= (liveModel ? 19 : 20),
            `Expected lifecycle calls after eight scenario turns, got ${result.calls}`);
        const committed = await page.evaluate(() => {
            const session = getCurrentWorldSession();
            return { location: session.playerLocation, coins: session.playerStats?.coins,
                version: session.worldStateVersion, receipts: session.worldTurnReceipts.length };
        });
        console.log(`Save/reload check starting (${liveModel || 'fixture'}, ${bound ? 'server-bound' : 'local-bind'})`);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => getCurrentWorldSession()?.playerLocation === 'market',
            null, { timeout: 30000 });
        const reloaded = await page.evaluate(() => {
            const session = getCurrentWorldSession();
            return { location: session.playerLocation, coins: session.playerStats?.coins,
                version: session.worldStateVersion,
                receipts: session.worldTurnReceipts?.length || 0,
                rerolled: session.history.some(item => item.isReroll === true) };
        });
        assert.deepEqual(reloaded, { ...committed, rerolled: true });
        if (liveModel) {
            const suffix = `${liveModel.replace(/[^a-z0-9]+/giu, '_').toLowerCase()}-${bound ? 'server_bound' : 'local_bind'}${outputLanguage === 'de' ? '' : `-${outputLanguage}`}`;
            fs.writeFileSync(path.join(__dirname,
                `world_resolved_intent_browser_live-${suffix}.json`),
            JSON.stringify({ model: liveModel, bound, passed: true,
                saveReload: { committed, reloaded }, result }, null, 2));
            console.log(`PASS live ResolvedIntent World flow (${bound ? 'server-bound' : 'local-bind'}, ${liveModel}): eight actions plus reroll, parallel input, rollback, save/reload`);
            await context.close();
            return;
        }
        console.log(`PASS ResolvedIntent browser integration (${bound ? 'server-bound' : 'local-bind'}${liveModel ? `, ${liveModel}` : ''}): eight compound action scenarios plus lifecycle and persistence`);
        await context.close();
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
