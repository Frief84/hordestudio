/** Continue exported live campaigns only inside isolated browser contexts. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');
const inputs = process.argv.slice(2);
assert(inputs.length, 'Pass copied .horde_campaign archives as arguments');

function serve(context) {
    return context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname !== 'real-save-audit.test') return route.abort();
        const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
            return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ contentType: { '.html': 'text/html', '.js': 'text/javascript',
            '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream',
            body: fs.readFileSync(file) });
    });
}

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        for (const input of inputs) {
            console.log('START', path.basename(input));
            const bytes = fs.readFileSync(input);
            const context = await browser.newContext({ acceptDownloads: true });
            await serve(context);
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto('https://real-save-audit.test/');
            await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
            console.log('READY', path.basename(input));
            await page.evaluate(() => {
                clearInterval(companionAgencyTimer);
                clearInterval(companionAlwaysOnTimer);
            });
            const [chooser] = await Promise.all([
                page.waitForEvent('filechooser'),
                page.evaluate(() => document.getElementById('import-world-btn').click())
            ]);
            const importStarted = Date.now();
            await chooser.setFiles({ name: path.basename(input), mimeType: 'application/zip', buffer: bytes });
            console.log('IMPORTING', path.basename(input));
            await page.waitForFunction(() => state.worlds.some(world => state.worldInstances[world.id]?.sessions?.length),
                null, { timeout: 120000 });
            const importMs = Date.now() - importStarted;
            console.log('IMPORTED', path.basename(input));
            const before = await page.evaluate(async () => {
                const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest(
                    'SHA-256', new TextEncoder().encode(JSON.stringify(value)))))
                    .map(byte => byte.toString(16).padStart(2, '0')).join('');
                const world = state.worlds.find(item => state.worldInstances[item.id]?.sessions?.length);
                const sess = state.worldInstances[world.id].sessions[0];
                window.__auditBaseline = {
                    entityStates: structuredClone(sess.entityStates),
                    locationStates: structuredClone(sess.locationStates)
                };
                state.activeWorldId = world.id;
                state.apiKey = 'offline';
                state.globalSettings.apiProvider = 'local';
                state.globalSettings.localBaseUrl = 'http://127.0.0.1:1234/v1';
                sess.setupComplete = true;
                switchView('worldPlay');
                renderWorldPlayState();
                const fields = ['inventory', 'entityStates', 'npcRelationships',
                    'locationStates', 'pendingChecks', 'pendingCheck', 'checkHistory',
                    'unlockedExits', 'dynamicExits', 'playerStats', 'playerState', 'equipment'];
                return { worldId: world.id, sessionId: sess.id, name: world.name,
                    worldEntities: await digest(world.entities), entityCount: world.entities.length,
                    worldLocations: await digest(world.locations), locationCount: world.locations.length,
                    history: await digest(sess.history), historyCount: sess.history.length,
                    turnEvents: await digest(sess.turnEvents), eventCount: sess.turnEvents.length,
                    receipts: await digest(sess.worldTurnReceipts), receiptCount: sess.worldTurnReceipts.length,
                    fields: Object.fromEntries(await Promise.all(fields.map(async key => [key, await digest(sess[key])]))),
                    worldStateVersion: sess.worldStateVersion };
            });
            console.log('BASELINE', path.basename(input), before.historyCount, before.eventCount);
            const run = await page.evaluate(async () => {
                let calls = 0;
                let payloadSizes = null;
                const originalFetch = window.fetch;
                window.fetch = async (url, options = {}) => {
                    if (!String(url).includes('/chat/completions')) return originalFetch(url, options);
                    calls++;
                    if (!payloadSizes) {
                        const outgoing = JSON.parse(options.body);
                        payloadSizes = { tools: JSON.stringify(outgoing.tools || outgoing.response_format || '').length,
                            messages: outgoing.messages.map(message => ({ role: message.role,
                                length: String(message.content || '').length })) };
                        const schema = outgoing.response_format?.json_schema?.schema
                            || outgoing.tools?.find(tool => tool.function?.name === 'commit_world_turn')?.function?.parameters;
                        if (schema) payloadSizes.schemaParts = Object.fromEntries(Object.entries(schema.properties || {})
                            .map(([key, value]) => [key, JSON.stringify(value).length]));
                    }
                    const outfit = `audit cloak ${calls}`;
                    const draft = { protocol: 'scene_draft_v3', narrative: [
                        { id: `p${calls}`, action_id: `wear_${calls}`, text: `You put on ${outfit}.` }
                    ], actions: [{ action_id: `wear_${calls}`, kind: 'physical', status: 'resolved',
                        response_id: `p${calls}`, action_effects: { outfit_set: [
                            { actor_id: 'player', outfit } ] } }],
                    events: [], effects: {}, speech: [], commitments: [] };
                    const payload = { choices: [{ delta: { content: JSON.stringify(draft) },
                        finish_reason: 'stop' }] };
                    return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`,
                        { headers: { 'Content-Type': 'text/event-stream' } });
                };
                const audits = [];
                for (let index = 1; index <= 3; index++) {
                    document.getElementById('world-user-input').value = `I put on audit cloak ${index}.`;
                    const started = performance.now();
                    await executeWorldTurn();
                    const world = state.worlds.find(item => item.id === state.activeWorldId);
                    const sess = state.worldInstances[world.id].sessions[0];
                    audits.push({ outcome: sess.lastTurnAudit?.actions?.[0]?.outcome,
                        outfit: sess.outfit, history: sess.history.length,
                        elapsedMs: Math.round(performance.now() - started) });
                }
                window.fetch = originalFetch;
                return { calls, audits, payloadSizes,
                    toast: document.getElementById('toast-container')?.innerText,
                    model: state.worlds.find(item => item.id === state.activeWorldId)?.model,
                    pending: state.worldInstances[state.activeWorldId]?.sessions?.[0]?.pendingChecks?.length };
            });
            console.log('TURNS', path.basename(input), JSON.stringify({ calls: run.calls,
                elapsedMs: run.audits.map(item => item.elapsedMs),
                outcomes: run.audits.map(item => item.outcome),
                schemaBytes: run.payloadSizes?.tools,
                messageCharacters: run.payloadSizes?.messages?.reduce((sum, item) => sum + item.length, 0) }));
            assert.equal(run.calls, 3, JSON.stringify({ name: before.name, run }));
            assert.deepEqual(run.audits.map(item => item.outcome), ['succeeded', 'succeeded', 'succeeded'],
                JSON.stringify({ name: before.name, run }));
            console.log('READING DURABLE', path.basename(input));
            const committed = await page.evaluate(async ({ worldId, sessionId }) => {
                const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest(
                    'SHA-256', new TextEncoder().encode(JSON.stringify(value)))))
                    .map(byte => byte.toString(16).padStart(2, '0')).join('');
                const sess = state.worldInstances[worldId].sessions.find(item => item.id === sessionId);
                const savedWorlds = await HordeDB.get('worlds');
                const saved = (await HordeDB.get(`worldInstance:${worldId}`))?.sessions
                    ?.find(item => item.id === sessionId);
                const differences = [];
                const visit = (left, right, key) => {
                    if (JSON.stringify(left) === JSON.stringify(right)) return;
                    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
                        differences.push(key); return;
                    }
                    for (const child of new Set([...Object.keys(left), ...Object.keys(right)])) {
                        if (differences.length >= 80) return;
                        visit(left[child], right[child], `${key}.${child}`);
                    }
                };
                visit(window.__auditBaseline.entityStates, sess.entityStates, 'entityStates');
                visit(window.__auditBaseline.locationStates, sess.locationStates, 'locationStates');
                const lostObservationIds = [];
                let lostObservationText = 0;
                const removedEntityKeys = [];
                for (const [id, oldState] of Object.entries(window.__auditBaseline.entityStates || {})) {
                    const currentState = sess.entityStates?.[id];
                    if (!currentState) { removedEntityKeys.push(id); continue; }
                    const currentIds = new Set((currentState.observations || []).map(item => item.id));
                    for (const observation of oldState.observations || []) {
                        if (observation.id && !currentIds.has(observation.id)) {
                            lostObservationIds.push(`${id}:${observation.id}`);
                            if (!(currentState.observations || []).some(item => item.text === observation.text))
                                lostObservationText++;
                        }
                    }
                }
                const removedLocationKeys = Object.keys(window.__auditBaseline.locationStates || {})
                    .filter(id => !Object.hasOwn(sess.locationStates || {}, id));
                return { savedWorld: !!savedWorlds.find(item => item.id === worldId),
                    saved: !!saved, liveHistory: await digest(sess.history),
                    savedHistory: await digest(saved?.history), differences,
                    lostObservationIds, lostObservationText, removedEntityKeys, removedLocationKeys,
                    entityStates: await digest(sess.entityStates),
                    locationStates: await digest(sess.locationStates) };
            }, before);
            assert(committed.saved && committed.savedWorld, `Missing durable state for ${before.name}`);
            assert.equal(committed.savedHistory, committed.liveHistory, `${before.name}: history not durable`);
            console.log('STATE SUMMARY', path.basename(input), JSON.stringify({
                changedPaths: committed.differences.length,
                lostObservations: committed.lostObservationIds.length,
                lostObservationText: committed.lostObservationText,
                removedEntities: committed.removedEntityKeys.length,
                removedLocations: committed.removedLocationKeys.length }));
            assert.equal(committed.lostObservationIds.length, 0, `${before.name}: old NPC observations lost`);
            assert.equal(committed.removedEntityKeys.length, 0, `${before.name}: old entity state lost`);
            assert.equal(committed.removedLocationKeys.length, 0, `${before.name}: old location state lost`);
            console.log('RELOADING', path.basename(input));
            await page.reload();
            await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
            console.log('RELOADED', path.basename(input));
            const reloaded = await page.evaluate(async ({ worldId, sessionId, historyCount, eventCount, receiptCount }) => {
                const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest(
                    'SHA-256', new TextEncoder().encode(JSON.stringify(value)))))
                    .map(byte => byte.toString(16).padStart(2, '0')).join('');
                const world = state.worlds.find(item => item.id === worldId);
                const sess = state.worldInstances[worldId]?.sessions?.find(item => item.id === sessionId);
                if (!world || !sess) return null;
                const fields = ['inventory', 'entityStates', 'npcRelationships',
                    'locationStates', 'pendingChecks', 'pendingCheck', 'checkHistory',
                    'unlockedExits', 'dynamicExits', 'playerStats', 'playerState', 'equipment'];
                return { worldEntities: await digest(world.entities), worldLocations: await digest(world.locations),
                    history: await digest(sess.history), oldHistory: await digest(sess.history.slice(0, historyCount)),
                    oldEvents: await digest(sess.turnEvents.slice(0, eventCount)),
                    oldReceipts: await digest(sess.worldTurnReceipts.slice(0, receiptCount)),
                    fields: Object.fromEntries(await Promise.all(fields.map(async key => [key, await digest(sess[key])]))),
                    historyCount: sess.history.length, eventCount: sess.turnEvents.length,
                    outfit: sess.outfit };
            }, before);
            assert(reloaded, `${before.name}: missing after reload`);
            assert.equal(reloaded.history, committed.liveHistory, `${before.name}: reload history changed`);
            assert.equal(reloaded.worldEntities, before.worldEntities, `${before.name}: entities changed`);
            assert.equal(reloaded.worldLocations, before.worldLocations, `${before.name}: locations changed`);
            assert.equal(reloaded.oldHistory, before.history, `${before.name}: historical messages changed`);
            const expectedFields = { ...before.fields, entityStates: committed.entityStates,
                locationStates: committed.locationStates };
            assert.deepEqual(reloaded.fields, expectedFields, `${before.name}: original session fields changed`);
            assert.equal(reloaded.oldEvents, before.turnEvents, `${before.name}: historical events changed`);
            assert.equal(reloaded.oldReceipts, before.receipts, `${before.name}: historical receipts changed`);
            assert.equal(reloaded.outfit, 'audit cloak 3', `${before.name}: new turn result lost`);
            assert.deepEqual(errors, [], `${before.name}: browser errors`);
            let pendingContinuation = null;
            if (/Submission Vault/.test(before.name)) {
                pendingContinuation = await page.evaluate(async ({ worldId, sessionId }) => {
                    state.activeWorldId = worldId;
                    const world = state.worlds.find(item => item.id === worldId);
                    const sess = state.worldInstances[worldId].sessions.find(item => item.id === sessionId);
                    world.gameRules.dice.resolution = 'player';
                    world.gameRules.modules.checks = true;
                    state.apiKey = 'offline';
                    state.globalSettings.apiProvider = 'local';
                    state.globalSettings.localBaseUrl = 'http://127.0.0.1:1234/v1';
                    switchView('worldPlay'); renderWorldPlayState();
                    const originalFetch = window.fetch;
                    let calls = 0;
                    window.fetch = async (url, options = {}) => {
                        if (!String(url).includes('/chat/completions')) return originalFetch(url, options);
                        calls++;
                        const draft = { protocol: 'scene_draft_v3',
                            narrative: [{ id: 'p1', action_id: 'inspect',
                                text: 'You begin inspecting the seal and await the check.' }],
                            actions: [{ action_id: 'inspect', kind: 'physical', status: 'pending_check',
                                response_id: 'p1', action_effects: { checks: [{ label: 'Inspect seal',
                                    difficulty: 10, on_success: {}, on_failure: {} }] } }],
                            events: [], effects: {}, speech: [], commitments: [] };
                        const payload = { choices: [{ delta: { content: JSON.stringify(draft) },
                            finish_reason: 'stop' }] };
                        return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`,
                            { headers: { 'Content-Type': 'text/event-stream' } });
                    };
                    document.getElementById('world-user-input').value = 'I inspect the seal.';
                    await executeWorldTurn();
                    window.fetch = originalFetch;
                    const stored = (await HordeDB.get(`worldInstance:${worldId}`))?.sessions
                        ?.find(item => item.id === sessionId);
                    return { calls, pending: sess.pendingChecks?.length,
                        storedPending: stored?.pendingChecks?.length,
                        checkHistory: sess.checkHistory?.length,
                        outcome: sess.lastTurnAudit?.actions?.[0]?.outcome,
                        dice: world.gameRules?.dice?.resolution,
                        toast: document.getElementById('toast-container')?.innerText?.slice(-1000) };
                }, before);
                console.log('PENDING RESULT', JSON.stringify(pendingContinuation));
                assert.deepEqual({ calls: pendingContinuation.calls, pending: pendingContinuation.pending,
                    storedPending: pendingContinuation.storedPending, outcome: pendingContinuation.outcome },
                { calls: 1, pending: 1, storedPending: 1, outcome: 'pending' },
                `${before.name}: pending check not durable`);
                await page.reload();
                await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
                const continued = await page.evaluate(async ({ worldId, sessionId }) => {
                    clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer);
                    state.activeWorldId = worldId;
                    const sess = state.worldInstances[worldId].sessions.find(item => item.id === sessionId);
                    const loadedPending = sess.pendingChecks?.length;
                    window.executeWorldTurn = async () => {};
                    await resolveWorldCheckFromModal();
                    const stored = (await HordeDB.get(`worldInstance:${worldId}`))?.sessions
                        ?.find(item => item.id === sessionId);
                    return { loadedPending, pending: sess.pendingChecks?.length,
                        storedPending: stored?.pendingChecks?.length,
                        checkHistory: sess.checkHistory?.length,
                        storedCheckHistory: stored?.checkHistory?.length };
                }, before);
                assert.equal(continued.loadedPending, 1, `${before.name}: pending check lost on reload`);
                assert.equal(continued.pending, 0, `${before.name}: pending check not resolved`);
                assert.equal(continued.storedPending, 0, `${before.name}: resolution not durable`);
                assert.equal(continued.checkHistory, pendingContinuation.checkHistory + 1,
                    `${before.name}: check result not recorded`);
                assert.equal(continued.storedCheckHistory, continued.checkHistory,
                    `${before.name}: check result not saved`);
                await page.reload();
                await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
                const checkReload = await page.evaluate(({ worldId, sessionId }) => {
                    const sess = state.worldInstances[worldId]?.sessions
                        ?.find(item => item.id === sessionId);
                    return { pending: sess?.pendingChecks?.length,
                        checkHistory: sess?.checkHistory?.length };
                }, before);
                assert.deepEqual(checkReload, { pending: 0, checkHistory: continued.checkHistory },
                    `${before.name}: resolved check changed after reload`);
                console.log('PENDING CONTINUATION PASS', before.name);
            }
            console.log(JSON.stringify({ result: 'PASS', name: before.name,
                oldHistory: before.historyCount, newHistory: reloaded.historyCount,
                oldEvents: before.eventCount, newEvents: reloaded.eventCount,
                preservedEntities: before.entityCount, preservedLocations: before.locationCount,
                modelCalls: run.calls, turns: run.audits.length,
                pendingContinuation: !!pendingContinuation, importMs,
                turnMs: run.audits.map(item => item.elapsedMs) }));
            await context.close();
        }
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
