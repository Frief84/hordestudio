/** Browser-level linked V3 turn: model transport, commit gate and reload. */
'use strict';
const assert = require('node:assert/strict');
const receiptNarration = require('../worlds/receipt-narration');
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
                receipt: sess.worldTurnReceipts?.at(-1)?.receipt,
                savedReceipt: saved?.worldTurnReceipts?.at(-1)?.receipt,
                savedReceiptAfterFailure: savedAfterFailure?.worldTurnReceipts?.at(-1)?.receipt,
                sceneMemory: sess.history.at(-1)?.sceneMemory,
                savedSceneMemory: saved?.history?.at(-1)?.sceneMemory,
                savedSceneMemoryAfterFailure: savedAfterFailure?.history?.at(-1)?.sceneMemory,
                legacyFixture: { world: structuredClone(world), session: structuredClone(saved) },
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
        assert.deepEqual(result.receipt, result.savedReceipt);
        assert.deepEqual(result.savedReceiptAfterFailure, result.savedReceipt);
        assert.deepEqual(result.sceneMemory, result.savedSceneMemory);
        assert.deepEqual(result.savedSceneMemoryAfterFailure, result.savedSceneMemory);
        const legacyProjection = receiptNarration.project(result.legacyFixture.world,
            result.legacyFixture.session);
        assert(legacyProjection.ok, JSON.stringify(legacyProjection));
        assert(legacyProjection.input.confirmed.some(action => action.effects.some(effect =>
            effect.type === 'outfit_set' && effect.payload.outfit === 'red coat')));
        assert(result.receipt.confirmed_effects.some(effect => effect.type === 'outfit_set'
            && effect.result === 'changed' && effect.payload.outfit === 'red coat'));
        assert(result.sceneMemory.records.some(record => record.kind === 'effect'
            && record.text.includes('red coat')));
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
        const reloaded = await page.evaluate(() => {
            const session = state.worldInstances.linked_fixture.sessions.find(item => item.outfit === 'red coat');
            return { receipt: session.worldTurnReceipts?.at(-1)?.receipt,
                sceneMemory: session.history.at(-1)?.sceneMemory };
        });
        assert.deepEqual(reloaded.receipt, result.savedReceipt);
        assert.deepEqual(reloaded.sceneMemory, result.savedSceneMemory);
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
        const invalidStat = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            state.apiKey = 'offline';
            state.globalSettings.apiProvider = 'local';
            state.globalSettings.localBaseUrl = 'http://127.0.0.1:1234/v1';
            state.activeWorldId = 'linked_fixture';
            const world = state.worlds.find(item => item.id === 'linked_fixture');
            world.hudConfig.stats = [{ id: 'energy', name: 'Energy', value: 10, min: 0, max: 100 }];
            const sess = getCurrentWorldSession();
            const direct = processStructuredActions({ stat_changes: { energy: 2000000000 } },
                world, structuredClone(sess), { deferFeedback: true });
            const before = sess.history.length;
            const realFetch = window.fetch;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                const draft = { protocol: 'scene_draft_v3',
                    narrative: [{ id: 'p_bad', action_id: 'bad_stat', text: 'Your energy surges.' }],
                    actions: [{ action_id: 'bad_stat', kind: 'other', status: 'resolved',
                        request: 'I focus.', response_id: 'p_bad',
                        action_effects: { stat_changes: { energy: 2000000000 } } }],
                    events: [], effects: {}, speech: [], commitments: [] };
                return new Response(`data: ${JSON.stringify({ choices: [{
                    delta: { content: JSON.stringify(draft) }, finish_reason: 'stop'
                }] })}\n\ndata: [DONE]\n\n`,
                { headers: { 'Content-Type': 'text/event-stream' } });
            };
            document.getElementById('world-user-input').value = 'I focus.';
            await executeWorldTurn();
            window.fetch = realFetch;
            return { directReason: direct.statResult?.rejected?.[0]?.reason,
                committed: sess.history.length > before,
                falseSuccess: sess.history.some(message => message.role === 'dm'
                    && message.text?.includes('Your energy surges.')) };
        });
        assert.equal(invalidStat.directReason, 'invalid_amount', JSON.stringify(invalidStat));
        assert.equal(invalidStat.committed, false, JSON.stringify(invalidStat));
        assert.equal(invalidStat.falseSuccess, false, JSON.stringify(invalidStat));
        const eventBridge = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            state.apiKey = 'offline';
            state.globalSettings.apiProvider = 'local';
            state.globalSettings.localBaseUrl = 'http://127.0.0.1:1234/v1';
            state.activeWorldId = 'linked_fixture';
            const world = state.worlds.find(item => item.id === 'linked_fixture');
            const sess = getCurrentWorldSession();
            world.locations.push({ id: 'elsewhere', name: 'Elsewhere', exits: [] });
            for (const id of ['actor', 'witness', 'listener', 'remote']) {
                world.entities.push({ id, name: id, type: 'npc', startLocation: 'room' });
                sess.entityStates[id] = { location: id === 'remote' ? 'elsewhere' : 'room',
                    observations: [], goal: 'Continue existing work', goalStatus: 'active',
                    goalAutonomy: 'paused', goalProgress: 12 };
            }
            const realFetch = window.fetch;
            let eventCalls = 0;
            let nextCondition = 'bandaged';
            let nextEvidence = 'Actor applies a fresh bandage.';
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                eventCalls++;
                const draft = { protocol: 'scene_draft_v3', narrative: [
                    { id: 'coat', action_id: 'wear', text: 'You put on the green coat.' },
                    { id: 'care', action_id: 'treat', text: nextEvidence }
                ], actions: [
                    { action_id: 'wear', request: 'I put on the green coat.', kind: 'physical',
                        status: 'resolved', response_id: 'coat', action_effects: {
                            outfit_set: [{ actor_id: 'player', outfit: 'green coat' }] } },
                    { action_id: 'treat', request: 'I ask Actor to treat themselves.',
                        kind: 'physical', status: 'resolved',
                        response_id: 'care', action_effects: { condition_change: [
                            { target_id: 'actor', condition: nextCondition, action: 'add' }] } }
                ], events: [{ action_id: 'treat', type: 'condition', actor_id: 'actor',
                    status: 'completed', condition: nextCondition, action: 'add',
                    passage_id: 'care', witnessed_by: ['witness'] }],
                effects: {}, speech: [], commitments: [] };
                return new Response(`data: ${JSON.stringify({ choices: [{
                    delta: { content: JSON.stringify(draft) }, finish_reason: 'stop'
                }] })}\n\ndata: [DONE]\n\n`,
                { headers: { 'Content-Type': 'text/event-stream' } });
            };
            document.getElementById('world-user-input').value =
                'I put on the green coat. I ask Actor to treat themselves.';
            await executeWorldTurn();
            const beforeFailure = { receipts: sess.worldTurnReceipts.length,
                news: sess.worldNews.length, observations: sess.entityStates.actor.observations.length };
            nextCondition = 'rested';
            nextEvidence = 'Actor settles to rest.';
            const realSetMultiple = HordeDB.setMultiple;
            HordeDB.setMultiple = async () => { throw new Error('simulated_storage_failure'); };
            document.getElementById('world-user-input').value =
                'I put on the green coat. I ask Actor to treat themselves.';
            await executeWorldTurn();
            HordeDB.setMultiple = realSetMultiple;
            const rollback = { receipts: sess.worldTurnReceipts.length === beforeFailure.receipts,
                news: sess.worldNews.length === beforeFailure.news,
                observations: sess.entityStates.actor.observations.length === beforeFailure.observations,
                condition: !sess.entityStates.actor.conditions?.includes('rested'),
                input: document.getElementById('world-user-input').value };
            window.fetch = realFetch;
            const saved = (await HordeDB.get('worldInstance:linked_fixture'))?.sessions
                ?.find(item => item.id === sess.id);
            const news = sess.worldNews?.find(item => item.text === 'Actor applies a fresh bandage.');
            const beforeGossip = Object.fromEntries(['actor', 'witness', 'listener', 'remote']
                .map(id => [id, (sess.entityStates[id].observations || []).map(item => item.text)]));
            const digest = buildWorldAgentDigest(world, sess);
            const index = new Map([['room', ['actor', 'witness', 'listener']]]);
            for (let turn = 1; turn <= 20 && !news?.knownBy.includes('listener'); turn++)
                spreadWorldKnowledge(world, index, sess, turn);
            return { audit: sess.lastTurnAudit, news, beforeGossip, eventCalls, rollback,
                savedNews: saved?.worldNews?.find(item => item.text === news?.text),
                savedActor: saved?.entityStates?.actor?.observations,
                savedGoal: saved?.entityStates?.actor?.goal,
                condition: sess.entityStates.actor.conditions,
                digestHasEvent: digest.includes('Actor applies a fresh bandage.'),
                digestHasAudience: digest.includes('known by actor, witness'),
                listener: sess.entityStates.listener.observations,
                remote: sess.entityStates.remote.observations,
                sceneWitnesses: sess.history.at(-1)?.sceneMemory?.records
                    ?.find(item => item.kind === 'event' && item.actor === 'actor')?.witnesses };
        });
        assert(eventBridge.audit?.actions?.some(item => item.action_id === 'treat'
            && item.outcome === 'succeeded'), JSON.stringify({ eventBridge, logs: logs.slice(-8) }));
        assert.equal(eventBridge.eventCalls, 2, JSON.stringify(eventBridge));
        assert.deepEqual(eventBridge.rollback, { receipts: true, news: true,
            observations: true, condition: true,
            input: 'I put on the green coat. I ask Actor to treat themselves.' },
        JSON.stringify(eventBridge));
        assert(eventBridge.condition?.includes('bandaged'), JSON.stringify(eventBridge));
        assert.deepEqual(eventBridge.sceneWitnesses, ['actor', 'witness'], JSON.stringify(eventBridge));
        assert.deepEqual(eventBridge.news?.knownBy?.sort(), ['actor', 'listener', 'witness'], JSON.stringify(eventBridge));
        assert(eventBridge.beforeGossip.actor.includes('Actor applies a fresh bandage.'), JSON.stringify(eventBridge));
        assert(eventBridge.beforeGossip.witness.includes('Actor applies a fresh bandage.'), JSON.stringify(eventBridge));
        assert(!eventBridge.beforeGossip.listener.includes('Actor applies a fresh bandage.'),
            JSON.stringify(eventBridge));
        assert.deepEqual(eventBridge.beforeGossip.remote, [], JSON.stringify(eventBridge));
        assert(eventBridge.listener?.some(item => item.sourceType === 'told'
            && item.sourceNpcId), JSON.stringify(eventBridge));
        assert.deepEqual(eventBridge.remote, [], JSON.stringify(eventBridge));
        assert(eventBridge.digestHasEvent, JSON.stringify(eventBridge));
        assert(eventBridge.digestHasAudience, JSON.stringify(eventBridge));
        assert.deepEqual(eventBridge.savedNews?.knownBy?.sort(), ['actor', 'witness'], JSON.stringify(eventBridge));
        assert(eventBridge.savedActor?.some(item => item.eventId === eventBridge.news.id),
            JSON.stringify(eventBridge));
        assert.equal(eventBridge.savedGoal, 'Continue existing work', JSON.stringify(eventBridge));
        await page.reload();
        await page.waitForFunction(() => state.worldInstances?.linked_fixture?.sessions?.length);
        const eventReload = await page.evaluate(() => {
            const session = state.worldInstances.linked_fixture.sessions.at(-1);
            return { actor: session.entityStates?.actor?.observations,
                witness: session.entityStates?.witness?.observations,
                listener: session.entityStates?.listener?.observations,
                remote: session.entityStates?.remote?.observations,
                news: session.worldNews?.find(item => item.text === 'Actor applies a fresh bandage.'),
                condition: session.entityStates?.actor?.conditions,
                goal: session.entityStates?.actor?.goal };
        });
        assert(eventReload.actor?.some(item => item.eventId === eventBridge.news.id),
            JSON.stringify(eventReload));
        assert(eventReload.witness?.some(item => item.eventId === eventBridge.news.id),
            JSON.stringify(eventReload));
        assert(!eventReload.listener?.some(item => item.eventId === eventBridge.news.id),
            JSON.stringify(eventReload));
        assert(!eventReload.remote?.some(item => item.eventId === eventBridge.news.id),
            JSON.stringify(eventReload));
        assert.deepEqual(eventReload.news?.knownBy?.sort(), ['actor', 'witness'],
            JSON.stringify(eventReload));
        assert(eventReload.condition?.includes('bandaged'), JSON.stringify(eventReload));
        assert.equal(eventReload.goal, 'Continue existing work', JSON.stringify(eventReload));
        const authoredRuleTurn = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            state.apiKey = 'offline';
            state.globalSettings.apiProvider = 'local';
            state.globalSettings.localBaseUrl = 'http://127.0.0.1:1234/v1';
            const world = { id: 'event_rule_fixture', name: 'Signal sash',
                model: 'fixture/model', contextSize: 32768, maxTokens: 2048,
                dmPrompt: 'Two guards stand in a room.', intro: '',
                startLocationId: 'room', locations: [{ id: 'room', name: 'Room', exits: [] }],
                entities: [{ id: 'guide_1', name: 'Guide', type: 'npc', startLocation: 'room' },
                    { id: 'watcher_1', name: 'Watcher', type: 'npc', startLocation: 'room' }],
                eventRules: [{ id: 'raise_alert', on: { type: 'outfit', outfit: 'signal sash' },
                    when: [{ fact: 'actor_at', subject_id: 'player',
                        operator: 'equals', value: 'room' }],
                    effect: { type: 'condition_change', payload: {
                        target_id: { event_field: 'actor_id' }, condition: 'alerted', action: 'add' } },
                    result_event: { type: 'condition', actor_id: { event_field: 'actor_id' },
                        condition: 'alerted', action: 'add' } }],
                kernel: { enabled: true, memoryMode: 'ledger', sceneDrafts: true,
                    serverBindings: false, sceneDraftProtocol: 'scene_draft_v3' },
                hudConfig: { startTimeHours: 8, startTimeMinutes: 0, timeStep: 5 } };
            state.worlds.push(world);
            state.worldInstances[world.id] = { sessions: [], activeSessionId: null };
            state.activeWorldId = world.id;
            const sess = prepareCurrentWorldSession();
            sess.setupComplete = true;
            sess.entityStates.guide_1 ||= { location: 'room', observations: [] };
            sess.entityStates.watcher_1 ||= { location: 'room', observations: [] };
            switchView('worldPlay'); renderWorldPlayState();
            await saveWorldsState({ worldId: world.id });
            const realFetch = window.fetch;
            let calls = 0;
            let eventDescriptionSupported = false;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                calls++;
                const outgoing = JSON.parse(options.body);
                const contract = outgoing.response_format?.json_schema?.schema
                    || outgoing.tools?.find(tool => tool.function?.name === 'commit_world_turn')
                        ?.function?.parameters;
                eventDescriptionSupported ||= !!contract?.properties?.actions?.items?.properties
                    ?.action_effects?.properties?.event_emit?.items?.properties?.description;
                const draft = { protocol: 'scene_draft_v3', narrative: [{ id: 'signal_passage',
                    action_id: 'signal', text: 'Guide puts on the signal sash.' }],
                    actions: [{ action_id: 'signal', request: 'I ask Guide to put on the signal sash.',
                        kind: 'physical', status: 'resolved', response_id: 'signal_passage',
                        action_effects: { outfit_set: [{ actor_id: 'guide_1', outfit: 'signal sash' }] } }],
                    events: [{ id: 'notice_1', action_id: 'signal', type: 'outfit',
                        actor_id: 'guide_1', outfit: 'signal sash', status: 'completed',
                        passage_id: 'signal_passage' }],
                    effects: {}, speech: [], commitments: [] };
                return new Response(`data: ${JSON.stringify({ choices: [{ delta: {
                    content: JSON.stringify(draft) }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
                { headers: { 'Content-Type': 'text/event-stream' } });
            };
            document.getElementById('world-user-input').value =
                'I ask Guide to put on the signal sash.';
            await executeWorldTurn();
            window.fetch = realFetch;
            const saved = (await HordeDB.get(`worldInstance:${world.id}`))?.sessions
                ?.find(item => item.id === sess.id);
            const receipt = sess.worldTurnReceipts?.at(-1)?.receipt;
            return { calls, eventDescriptionSupported, audit: sess.lastTurnAudit,
                guide: sess.entityStates.guide_1,
                watcher: sess.entityStates.watcher_1,
                effect: receipt?.confirmed_effects?.find(item => item.type === 'condition_change'),
                proofEvent: receipt?.events?.find(item => item.id === 'notice_1_raise_alert'),
                emittedByModel: receipt?.confirmed_effects?.some(item => item.type === 'event_emit'),
                savedGuide: saved?.entityStates?.guide_1,
                worldRules: state.worlds.find(item => item.id === world.id)?.eventRules?.length };
        });
        assert(authoredRuleTurn.audit?.actions?.some(item => item.action_id === 'signal'
            && item.outcome === 'succeeded'), JSON.stringify({ authoredRuleTurn, logs: logs.slice(-8) }));
        assert(authoredRuleTurn.calls <= 2 && authoredRuleTurn.audit.repairCount === 0,
            JSON.stringify(authoredRuleTurn));
        assert(authoredRuleTurn.eventDescriptionSupported, JSON.stringify(authoredRuleTurn));
        assert(authoredRuleTurn.guide?.conditions?.includes('alerted'), JSON.stringify(authoredRuleTurn));
        assert(!authoredRuleTurn.watcher?.conditions?.includes('alerted'), JSON.stringify(authoredRuleTurn));
        assert.equal(authoredRuleTurn.effect?.cause_event_id, 'notice_1',
            JSON.stringify(authoredRuleTurn));
        assert.equal(authoredRuleTurn.proofEvent?.type, 'condition',
            JSON.stringify(authoredRuleTurn));
        assert.equal(authoredRuleTurn.emittedByModel, false, JSON.stringify(authoredRuleTurn));
        assert(authoredRuleTurn.savedGuide?.conditions?.includes('alerted'),
            JSON.stringify(authoredRuleTurn));
        assert.equal(authoredRuleTurn.worldRules, 1, JSON.stringify(authoredRuleTurn));
        const secondRuleTurn = await page.evaluate(async () => {
            const sess = state.worldInstances.event_rule_fixture.sessions.at(-1);
            const realFetch = window.fetch;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                const draft = { protocol: 'scene_draft_v3', narrative: [{ id: 'watcher_passage',
                    action_id: 'watcher_signal', text: 'Watcher puts on the signal sash.' }],
                    actions: [{ action_id: 'watcher_signal',
                        request: 'I ask Watcher to put on the signal sash.',
                        kind: 'physical', status: 'resolved', response_id: 'watcher_passage',
                        action_effects: { outfit_set: [{ actor_id: 'watcher_1', outfit: 'signal sash' }] } }],
                    events: [{ id: 'notice_2', action_id: 'watcher_signal', type: 'outfit',
                        actor_id: 'watcher_1', outfit: 'signal sash', status: 'completed',
                        passage_id: 'watcher_passage' }],
                    effects: {}, speech: [], commitments: [] };
                return new Response(`data: ${JSON.stringify({ choices: [{ delta: {
                    content: JSON.stringify(draft) }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
                    { headers: { 'Content-Type': 'text/event-stream' } });
            };
            document.getElementById('world-user-input').value =
                'I ask Watcher to put on the signal sash.';
            await executeWorldTurn();
            window.fetch = realFetch;
            const saved = (await HordeDB.get('worldInstance:event_rule_fixture'))?.sessions
                ?.find(item => item.id === sess.id);
            const receipts = sess.worldTurnReceipts?.slice(-2).map(item => item.receipt);
            return { audit: sess.lastTurnAudit,
                causes: receipts?.map(receipt => receipt.confirmed_effects
                    ?.find(item => item.type === 'condition_change')?.cause_event_id),
                proofs: receipts?.map(receipt => receipt.events
                    ?.find(event => String(event.id || '').endsWith('_raise_alert'))?.id),
                guide: sess.entityStates.guide_1?.conditions,
                watcher: sess.entityStates.watcher_1?.conditions,
                savedWatcher: saved?.entityStates?.watcher_1?.conditions };
        });
        assert(secondRuleTurn.audit?.actions?.some(item => item.action_id === 'watcher_signal'
            && item.outcome === 'succeeded'), JSON.stringify(secondRuleTurn));
        assert.deepEqual(secondRuleTurn.causes, ['notice_1', 'notice_2'],
            JSON.stringify(secondRuleTurn));
        assert.deepEqual(secondRuleTurn.proofs, ['notice_1_raise_alert', 'notice_2_raise_alert'],
            JSON.stringify(secondRuleTurn));
        assert(secondRuleTurn.guide?.includes('alerted') && secondRuleTurn.watcher?.includes('alerted')
            && secondRuleTurn.savedWatcher?.includes('alerted'), JSON.stringify(secondRuleTurn));
        await page.reload();
        await page.waitForFunction(() => state.worldInstances?.event_rule_fixture?.sessions?.length);
        const authoredRuleReload = await page.evaluate(() => ({
            guide: state.worldInstances.event_rule_fixture.sessions.at(-1)
                ?.entityStates?.guide_1?.conditions,
            watcher: state.worldInstances.event_rule_fixture.sessions.at(-1)
                ?.entityStates?.watcher_1?.conditions,
            rules: state.worlds.find(item => item.id === 'event_rule_fixture')?.eventRules?.length }));
        assert(authoredRuleReload.guide?.includes('alerted'), JSON.stringify(authoredRuleReload));
        assert(authoredRuleReload.watcher?.includes('alerted'), JSON.stringify(authoredRuleReload));
        assert.equal(authoredRuleReload.rules, 1, JSON.stringify(authoredRuleReload));
        console.log('PASS linked V3 receipt, two NPC event-rule turns, scene memory, rollback and reload');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
