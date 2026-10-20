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
                // This suite replays the legacy flat V3 transport; server binding has its own browser audit.
                entities: [], kernel: { enabled: true, memoryMode: 'ledger', sceneDrafts: true, serverBindings: false,
                    sceneDraftProtocol: 'scene_draft_v3' },
                hudConfig: { startTimeHours: 8, startTimeMinutes: 0, timeStep: 5 } };
            state.worlds = [world];
            state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            const sess = prepareCurrentWorldSession();
            sess.setupComplete = true;
            sess.outfit = 'plain shirt';
            switchView('worldPlay'); renderWorldPlayState();
            let calls = 0, beforeCommit = false, providerNames = [], hasNotation = false;
            let nextOutfit = 'red coat';
            const realFetch = window.fetch;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                calls++;
                const outgoing = JSON.parse(options.body);
                hasNotation ||= outgoing.messages?.some(message =>
                    String(message.content || '').includes('[OPTIONAL PLAYER NOTATION]')) || false;
                const providerSchema = outgoing.response_format?.json_schema?.schema
                    || outgoing.tools?.find(tool => tool.function?.name === 'commit_world_turn')
                        ?.function?.parameters;
                if (providerSchema?.properties?.actions?.items?.properties?.action_effects)
                    providerNames = Object.keys(providerSchema.properties.actions.items.properties
                        .action_effects.properties || {});
                beforeCommit = sess.outfit === 'plain shirt'
                    && !sess.history.some(message => message.role === 'user'
                        && message.text === 'I put on the red coat.');
                const draft = { protocol: 'scene_draft_v3',
                    narrative: [{ id: 'p1', action_id: 'wear_coat', text: `You put on the ${nextOutfit}.` }],
                    actions: [{ action_id: 'wear_coat', kind: 'physical', status: 'resolved',
                        response_id: 'p1', action_effects: { outfit_set: [
                            { actor_id: 'player', outfit: nextOutfit }] } }],
                    events: [{ type: 'outfit', actor_id: 'player', status: 'completed',
                        outfit: nextOutfit, passage_id: 'p1' }],
                    effects: {}, speech: [], commitments: [] };
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
            return { calls, providerNames, hasNotation,
                nativeNames: [...HordeEffectRegistry.technicalEffects.keys()],
                beforeCommit: firstBeforeCommit, firstState,
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
        assert.equal(result.hasNotation, true, JSON.stringify(result));
        assert(result.nativeNames.every(name => result.providerNames.includes(name)),
            JSON.stringify({ providerNames: result.providerNames, nativeNames: result.nativeNames }));
        assert(result.providerNames.includes('npc_relationship_updates'),
            JSON.stringify(result.providerNames));
        assert(result.beforeCommit, JSON.stringify(result));
        assert.equal(result.outfit, 'red coat', JSON.stringify({ result, logs }));
        assert.equal(result.savedOutfit, 'red coat', JSON.stringify(result));
        assert.equal(result.savedAfterFailure, 'red coat', JSON.stringify(result));
        assert.equal(result.historyAfterFailure, result.historyBeforeFailure, JSON.stringify(result));
        assert.equal(result.leakedNarrative, false, JSON.stringify(result));
        assert(result.history.some(message => message.role === 'dm'
            && message.text.includes('red coat')), JSON.stringify(result));
        assert.equal(result.audit?.protocol, 'scene_draft_v3', JSON.stringify(result));
        assert.equal(result.audit?.repairCount, 1, JSON.stringify(result));
        assert.equal(result.audit?.compilerRepairs?.[0]?.action_id, 'wear_coat', JSON.stringify(result));
        assert.equal(result.callAudit?.main, 1, JSON.stringify(result));
        assert.equal(result.callAudit?.receiptRepair, 0, JSON.stringify(result));
        await page.reload();
        await page.waitForFunction(() => state.worldInstances?.linked_fixture?.sessions
            ?.some(session => session.outfit === 'red coat'));
        const continued = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            state.apiKey = 'offline';
            state.globalSettings.apiProvider = 'local';
            state.globalSettings.localBaseUrl = 'http://127.0.0.1:1234/v1';
            state.activeWorldId = 'linked_fixture';
            switchView('worldPlay'); renderWorldPlayState();
            const session = state.worldInstances.linked_fixture.sessions.find(item =>
                item.outfit === 'red coat');
            const previousReceipts = session.worldTurnReceipts?.length || 0;
            const realFetch = window.fetch;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                const draft = { protocol: 'scene_draft_v3', narrative: [{ id: 'p2',
                    action_id: 'wear_green', text: 'You put on the green coat.' }],
                    actions: [{ action_id: 'wear_green', kind: 'physical', status: 'resolved',
                        response_id: 'p2', action_effects: { outfit_set: [
                            { actor_id: 'player', outfit: 'green coat' }] } }],
                    events: [{ type: 'outfit', actor_id: 'player', status: 'completed',
                        outfit: 'green coat', passage_id: 'p2' }],
                    effects: {}, speech: [], commitments: [] };
                const payload = { choices: [{ delta: { content: JSON.stringify(draft) },
                    finish_reason: 'stop' }] };
                return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`,
                    { headers: { 'Content-Type': 'text/event-stream' } });
            };
            document.getElementById('world-user-input').value = 'I put on the green coat.';
            await executeWorldTurn();
            window.fetch = realFetch;
            const saved = (await HordeDB.get('worldInstance:linked_fixture'))?.sessions
                ?.find(item => item.id === session.id);
            return { outfit: session.outfit, savedOutfit: saved?.outfit,
                previousReceipts, receipts: session.worldTurnReceipts?.length || 0 };
        });
        assert.deepEqual(errors, [], JSON.stringify(errors));
        assert.equal(continued.outfit, 'green coat', JSON.stringify(continued));
        assert.equal(continued.savedOutfit, 'green coat', JSON.stringify(continued));
        assert.equal(continued.receipts, continued.previousReceipts + 1,
            JSON.stringify(continued));
        const spoken = await page.evaluate(async () => {
            const session = state.worldInstances.linked_fixture.sessions.find(item =>
                item.outfit === 'green coat');
            const before = session.worldTurnReceipts?.length || 0;
            const realFetch = window.fetch;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                const draft = { protocol: 'scene_draft_v3', narrative: [{ id: 'reply',
                    action_id: 'spoken_correction', text: 'Your words are heard. The answer is reconsidered.' }],
                    actions: [{ action_id: 'spoken_correction', kind: 'speech',
                        status: 'resolved', request: 'That is the wrong answer; do not forget your purpose.',
                        response_id: 'reply', action_effects: {} }],
                    events: [], effects: {}, speech: [], commitments: [] };
                const payload = { choices: [{ delta: { content: JSON.stringify(draft) },
                    finish_reason: 'stop' }] };
                return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`,
                    { headers: { 'Content-Type': 'text/event-stream' } });
            };
            document.getElementById('world-user-input').value =
                'That is the wrong answer; do not forget your purpose.';
            await executeWorldTurn();
            window.fetch = realFetch;
            const saved = (await HordeDB.get('worldInstance:linked_fixture'))?.sessions
                ?.find(item => item.id === session.id);
            return { before, receipts: session.worldTurnReceipts?.length || 0,
                savedReceipts: saved?.worldTurnReceipts?.length || 0,
                outcome: session.lastTurnAudit?.actions?.at(-1)?.outcome,
                input: document.getElementById('world-user-input').value };
        });
        assert.deepEqual(errors, [], JSON.stringify(errors));
        assert.equal(spoken.receipts, spoken.before + 1, JSON.stringify(spoken));
        assert.equal(spoken.savedReceipts, spoken.receipts, JSON.stringify(spoken));
        assert.equal(spoken.outcome, 'succeeded', JSON.stringify(spoken));
        assert.equal(spoken.input, '', JSON.stringify(spoken));
        const compound = await page.evaluate(async () => {
            const session = state.worldInstances.linked_fixture.sessions.find(item =>
                item.outfit === 'green coat');
            const before = session.worldTurnReceipts?.length || 0;
            let requestRequired = false;
            const realFetch = window.fetch;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                const outgoing = JSON.parse(options.body);
                const schema = outgoing.response_format?.json_schema?.schema
                    || outgoing.tools?.find(tool => tool.function?.name === 'commit_world_turn')
                        ?.function?.parameters;
                requestRequired ||= schema?.properties?.actions?.items?.required?.includes('request') || false;
                const draft = { protocol: 'scene_draft_v3', narrative: [
                    { id: 'tap_text', action_id: 'tap', text: 'You tap the desk.' },
                    { id: 'wave_text', action_id: 'wave', text: 'You wave.' }],
                    actions: [
                        { action_id: 'tap', kind: 'physical', status: 'resolved',
                            request: 'I tap the desk', response_id: 'tap_text', action_effects: {} },
                        { action_id: 'wave', kind: 'physical', status: 'resolved',
                            request: 'and wave.', response_id: 'wave_text', action_effects: {} }
                    ], events: [
                        { type: 'interaction', actor_id: 'player', status: 'completed',
                            action_id: 'tap', passage_id: 'tap_text' },
                        { type: 'interaction', actor_id: 'player', status: 'completed',
                            action_id: 'wave', passage_id: 'wave_text' }
                    ], effects: {}, speech: [], commitments: [] };
                const payload = { choices: [{ delta: { content: JSON.stringify(draft) },
                    finish_reason: 'stop' }] };
                return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`,
                    { headers: { 'Content-Type': 'text/event-stream' } });
            };
            document.getElementById('world-user-input').value = 'I tap the desk and wave.';
            await executeWorldTurn();
            window.fetch = realFetch;
            const saved = (await HordeDB.get('worldInstance:linked_fixture'))?.sessions
                ?.find(item => item.id === session.id);
            return { requestRequired, before, receipts: session.worldTurnReceipts?.length || 0,
                savedReceipts: saved?.worldTurnReceipts?.length || 0,
                outcomes: session.lastTurnAudit?.actions?.map(item => item.outcome),
                input: document.getElementById('world-user-input').value };
        });
        assert.deepEqual(errors, [], JSON.stringify(errors));
        assert.equal(compound.requestRequired, true, JSON.stringify(compound));
        assert.equal(compound.receipts, compound.before + 1, JSON.stringify(compound));
        assert.equal(compound.savedReceipts, compound.receipts, JSON.stringify(compound));
        assert.deepEqual(compound.outcomes, ['succeeded', 'succeeded'], JSON.stringify(compound));
        assert.equal(compound.input, '', JSON.stringify(compound));
        const quotedSpeech = await page.evaluate(async () => {
            const input = '"Well, really! What exactly is that supposed to mean, peculiar? Hmph. Ahem... Is there something we can help you with?"';
            const session = state.worldInstances.linked_fixture.sessions.find(item =>
                item.outfit === 'green coat');
            const before = session.worldTurnReceipts?.length || 0;
            const realFetch = window.fetch;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                const draft = { protocol: 'scene_draft_v3', narrative: [{ id: 'spoken_reply',
                    action_id: 'quote', text: 'The words are heard, and the exchange continues.' }],
                    actions: [{ action_id: 'quote', kind: 'speech', status: 'resolved',
                        request: input, response_id: 'spoken_reply', action_effects: {} }],
                    events: [{ type: 'status', status: 'completed', actor_id: 'player',
                        action_id: 'quote', passage_id: 'spoken_reply' }],
                    effects: {}, speech: [], commitments: [] };
                const payload = { choices: [{ delta: { content: JSON.stringify(draft) },
                    finish_reason: 'stop' }] };
                return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`,
                    { headers: { 'Content-Type': 'text/event-stream' } });
            };
            document.getElementById('world-user-input').value = input;
            await executeWorldTurn();
            window.fetch = realFetch;
            const saved = (await HordeDB.get('worldInstance:linked_fixture'))?.sessions
                ?.find(item => item.id === session.id);
            return { before, receipts: session.worldTurnReceipts?.length || 0,
                savedReceipts: saved?.worldTurnReceipts?.length || 0,
                repair: session.lastTurnAudit?.compilerRepairs?.[0]?.type,
                outcome: session.lastTurnAudit?.actions?.[0]?.outcome,
                input: document.getElementById('world-user-input').value };
        });
        assert.deepEqual(errors, [], JSON.stringify(errors));
        assert.equal(quotedSpeech.receipts, quotedSpeech.before + 1, JSON.stringify(quotedSpeech));
        assert.equal(quotedSpeech.savedReceipts, quotedSpeech.receipts, JSON.stringify(quotedSpeech));
        assert.equal(quotedSpeech.repair, 'discard_uncommitted_speech_event',
            JSON.stringify(quotedSpeech));
        assert.equal(quotedSpeech.outcome, 'succeeded', JSON.stringify(quotedSpeech));
        assert.equal(quotedSpeech.input, '', JSON.stringify(quotedSpeech));
        const echoedDraft = await page.evaluate(async () => {
            const input = '“I need a careful answer about the earlier date, the missing witness, and the closed passage before I can decide which lead is worth following.”';
            const session = state.worldInstances.linked_fixture.sessions.find(item =>
                item.outfit === 'green coat');
            const before = session.worldTurnReceipts?.length || 0;
            let calls = 0, outgoing = null;
            const realFetch = window.fetch;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                calls++;
                outgoing = JSON.parse(options.body);
                const draft = { protocol: 'scene_draft_v3', narrative: [{ id: 'reply',
                    action_id: 'ask', text: `${input}\n\nThe clock ticks; no answer comes yet.` }],
                    actions: [{ action_id: 'ask', kind: 'speech', status: 'resolved',
                        request: input, response_id: 'reply', action_effects: {} }],
                    events: [], effects: {}, speech: [], commitments: [] };
                return new Response(`data: ${JSON.stringify({ choices: [{ delta: {
                    content: JSON.stringify(draft) }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
                    { headers: { 'Content-Type': 'text/event-stream' } });
            };
            document.getElementById('world-user-input').value = input;
            await executeWorldTurn();
            window.fetch = realFetch;
            const saved = (await HordeDB.get('worldInstance:linked_fixture'))?.sessions
                ?.find(item => item.id === session.id);
            return { input, calls, before, receipts: session.worldTurnReceipts?.length || 0,
                userMessage: outgoing?.messages?.at(-1),
                systemEcho: outgoing?.messages?.some(message => message.role === 'system'
                    && String(message.content).includes(input)),
                stored: session.history.at(-1)?.text, saved: saved?.history?.at(-1)?.text,
                rendered: document.querySelector('#world-messages-container .msg-dm:last-of-type .msg-text')?.innerText };
        });
        assert.deepEqual(errors, [], JSON.stringify(errors));
        assert.equal(echoedDraft.calls, 1, JSON.stringify(echoedDraft));
        assert.equal(echoedDraft.receipts, echoedDraft.before + 1, JSON.stringify(echoedDraft));
        assert.deepEqual(echoedDraft.userMessage, { role: 'user', content: echoedDraft.input });
        assert.equal(echoedDraft.systemEcho, false, JSON.stringify(echoedDraft));
        assert.equal(echoedDraft.stored, 'The clock ticks; no answer comes yet.', JSON.stringify(echoedDraft));
        assert.equal(echoedDraft.saved, echoedDraft.stored, JSON.stringify(echoedDraft));
        assert.equal(echoedDraft.rendered, echoedDraft.stored, JSON.stringify(echoedDraft));
        const untimedAslan = await page.evaluate(async () => {
            const input = 'I ask Aslan what he wants from me.';
            const providerText = 'Aslan raises one brow ridge. "I provide you with stories no library possesses, and you share them with the world. Truthfully, mind you. And with proper attribution. I should rather like to remind the rest that I exist."';
            const session = state.worldInstances.linked_fixture.sessions.find(item =>
                item.outfit === 'green coat');
            const before = session.worldTurnReceipts?.length || 0;
            const deadlinesBefore = session.scheduledEvents?.length || 0;
            let calls = 0;
            const realFetch = window.fetch;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                calls++;
                const draft = { protocol: 'scene_draft_v3',
                    narrative: [{ id: 'aslan_reply', action_id: 'ask_aslan', text: providerText }],
                    actions: [{ action_id: 'ask_aslan', kind: 'question', status: 'answered',
                        response_id: 'aslan_reply', action_effects: {} }],
                    events: [], effects: {}, speech: [], commitments: [] };
                return new Response(`data: ${JSON.stringify({ choices: [{ delta: {
                    content: JSON.stringify(draft) }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
                    { headers: { 'Content-Type': 'text/event-stream' } });
            };
            document.getElementById('world-user-input').value = input;
            await executeWorldTurn();
            window.fetch = realFetch;
            const saved = (await HordeDB.get('worldInstance:linked_fixture'))?.sessions
                ?.find(item => item.id === session.id);
            return { input, providerText, calls, before,
                receipts: session.worldTurnReceipts?.length || 0,
                deadlinesBefore, deadlinesAfter: session.scheduledEvents?.length || 0,
                savedDeadlines: saved?.scheduledEvents?.length || 0,
                user: session.history.at(-2), stored: session.history.at(-1)?.text,
                savedText: saved?.history?.at(-1)?.text,
                rendered: document.querySelector('#world-messages-container .msg-dm:last-of-type .msg-text')?.innerText };
        });
        assert.deepEqual(errors, [], JSON.stringify(errors));
        assert.equal(untimedAslan.calls, 1, JSON.stringify(untimedAslan));
        assert.equal(untimedAslan.receipts, untimedAslan.before + 1, JSON.stringify(untimedAslan));
        assert.equal(untimedAslan.deadlinesAfter, untimedAslan.deadlinesBefore, JSON.stringify(untimedAslan));
        assert.equal(untimedAslan.savedDeadlines, untimedAslan.deadlinesBefore, JSON.stringify(untimedAslan));
        assert.equal(untimedAslan.user?.role, 'user', JSON.stringify(untimedAslan));
        assert.equal(untimedAslan.user?.text, untimedAslan.input, JSON.stringify(untimedAslan));
        assert.equal(untimedAslan.stored, untimedAslan.providerText, JSON.stringify(untimedAslan));
        assert.equal(untimedAslan.savedText, untimedAslan.providerText, JSON.stringify(untimedAslan));
        assert.equal(untimedAslan.rendered, untimedAslan.providerText, JSON.stringify(untimedAslan));
        const repairedPast = await page.evaluate(async () => {
            const session = state.worldInstances.linked_fixture.sessions.find(item =>
                item.outfit === 'green coat');
            const before = session.worldTurnReceipts?.length || 0;
            let calls = 0, beforeRepair = false;
            const input = 'I ask Aslan about his old admiration for Lorne Kael.';
            const realFetch = window.fetch;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                calls++;
                const body = JSON.parse(options.body);
                if (!body.stream) beforeRepair = (session.worldTurnReceipts?.length || 0) === before;
                const draft = { protocol: 'scene_draft_v3',
                    narrative: [{ id: 'reply', action_id: 'ask', text: 'Aslan laughs at the memory.' }],
                    actions: [{ action_id: 'ask', kind: 'question', status: 'answered',
                        request: input, response_id: 'reply', action_effects: {} }],
                    events: [], effects: {}, speech: [], commitments: body.stream ? [{
                        id: 'invented_date', title: 'Remember Aslan', description: 'A false appointment.',
                        day: 1, minute_of_day: 1, location_id: 'room', status: 'scheduled',
                        reschedule: false, passage_id: 'reply', action_id: 'ask' }] : [] };
                if (!body.stream) return new Response(JSON.stringify({ choices: [{
                    message: { content: JSON.stringify(draft) }, finish_reason: 'stop' }] }),
                    { headers: { 'Content-Type': 'application/json' } });
                return new Response(`data: ${JSON.stringify({ choices: [{ delta: {
                    content: JSON.stringify(draft) }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
                    { headers: { 'Content-Type': 'text/event-stream' } });
            };
            document.getElementById('world-user-input').value = input;
            await executeWorldTurn();
            window.fetch = realFetch;
            return { calls, beforeRepair, before,
                receipts: session.worldTurnReceipts?.length || 0,
                deadlines: session.scheduledEvents?.length || 0,
                stored: session.history.at(-1)?.text };
        });
        assert.equal(repairedPast.calls, 2, JSON.stringify(repairedPast));
        assert(repairedPast.beforeRepair, JSON.stringify(repairedPast));
        assert.equal(repairedPast.receipts, repairedPast.before + 1, JSON.stringify(repairedPast));
        assert.equal(repairedPast.deadlines, 0, JSON.stringify(repairedPast));
        assert.equal(repairedPast.stored, 'Aslan laughs at the memory.', JSON.stringify(repairedPast));
        const interrupted = await page.evaluate(async () => {
            const session = state.worldInstances.linked_fixture.sessions.find(item =>
                item.outfit === 'green coat');
            const before = session.worldTurnReceipts?.length || 0;
            const historyBefore = session.history.length;
            const realFetch = window.fetch;
            let phase = 'quote', calls = 0;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                calls++;
                const body = JSON.parse(options.body);
                if (!body.stream) return new Response(JSON.stringify({ choices: [{
                    message: { content: '"' }, finish_reason: 'stop' }] }),
                    { headers: { 'Content-Type': 'application/json' } });
                const draft = { protocol: 'scene_draft_v3',
                    narrative: [{ id: 'reply', action_id: 'ask', text: 'Aslan begins a story.' }],
                    actions: [{ action_id: 'ask', kind: 'question', status: 'answered',
                        request: 'I ask Aslan for a story.', response_id: 'reply', action_effects: {} }],
                    events: [], effects: {}, speech: [], commitments: [] };
                const content = phase === 'quote' ? '"' : JSON.stringify(draft);
                const finish_reason = phase === 'quote' ? 'stop'
                    : phase === 'length' ? 'length' : null;
                const malformedPrefix = phase === 'malformed' ? 'data: not-json\n\n' : '';
                return new Response(`${malformedPrefix}data: ${JSON.stringify({ choices: [{ delta: { content },
                    finish_reason }] })}\n\ndata: [DONE]\n\n`,
                    { headers: { 'Content-Type': 'text/event-stream' } });
            };
            const run = async (name, input) => {
                phase = name;
                document.getElementById('world-user-input').value = input;
                await executeWorldTurn();
                return { input: document.getElementById('world-user-input').value,
                    receipts: session.worldTurnReceipts?.length || 0,
                    history: session.history.length,
                    saved: (await HordeDB.get('worldInstance:linked_fixture'))?.sessions
                        ?.find(item => item.id === session.id)?.worldTurnReceipts?.length || 0 };
            };
            const quote = await run('quote', 'I ask Aslan for a story.');
            const length = await run('length', 'I ask Aslan for a story.');
            const missingFinish = await run('missing', 'I ask Aslan for a story.');
            const malformed = await run('malformed', 'I ask Aslan for a story.');
            window.fetch = realFetch;
            return { before, historyBefore, calls, quote, length, missingFinish, malformed };
        });
        for (const item of [interrupted.quote, interrupted.length,
            interrupted.missingFinish, interrupted.malformed]) {
            assert.equal(item.receipts, interrupted.before, JSON.stringify(interrupted));
            assert.equal(item.saved, interrupted.before, JSON.stringify(interrupted));
            assert.equal(item.history, interrupted.historyBefore, JSON.stringify(interrupted));
            assert.equal(item.input, 'I ask Aslan for a story.', JSON.stringify(interrupted));
        }
        console.log('PASS linked V3 turn, rollback, reload, compound actions, Aslan dialogue and interrupted provider responses');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
