/** Linked V3 browser regression: no language-specific precommit, partial failure, durable reload. */
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
            if (url.hostname !== 'linked-chain.test') return route.abort();
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
        await page.goto('https://linked-chain.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
        const result = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            state.apiKey = 'offline';
            state.globalSettings.apiProvider = 'local';
            state.globalSettings.localBaseUrl = 'http://127.0.0.1:1234/v1';
            const world = { id: 'chain_fixture', name: 'Archive', model: 'fixture/model',
                contextSize: 32768, maxTokens: 2048, dmPrompt: 'Stay concise.', intro: '',
                startLocationId: 'foyer', locations: [
                    { id: 'foyer', name: 'Foyer', exits: [{ targetLocationId: 'archive',
                        doorId: 'archive_gate', requiredItem: 'Bronze key', lockState: 'locked' }] },
                    { id: 'archive', name: 'Archive', exits: [{ targetLocationId: 'foyer',
                        doorId: 'archive_gate', requiredItem: 'Bronze key', lockState: 'locked' }] }
                ], entities: [
                    { id: 'key_1', name: 'Bronze key', type: 'item', startLocation: 'foyer' },
                    { id: 'guide_1', name: 'Guide', type: 'npc', startLocation: 'foyer' }
                ], kernel: { enabled: true, memoryMode: 'ledger', sceneDrafts: true, serverBindings: false,
                    sceneDraftProtocol: 'scene_draft_v3' },
                gameRules: { dice: { resolution: 'player' } },
                hudConfig: { startTimeHours: 8, startTimeMinutes: 0, timeStep: 5 } };
            state.worlds = [world];
            state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            const sess = prepareCurrentWorldSession();
            sess.setupComplete = true;
            sess.entityStates.key_1 = { location: 'foyer' };
            sess.entityStates.guide_1 = { location: 'foyer', followingPlayer: true };
            switchView('worldPlay'); renderWorldPlayState();
            for (const name of ['extractUserMovementTarget', 'worldDraggedCompanionIntent',
                'worldPlayerWithCompanionIntent', 'detectPlayerOutfitIntent',
                'applyPlayerOutfitIntent', 'applyUserDirectedMovement']) {
                window[name] = () => { throw new Error(`legacy_parser_invoked:${name}`); };
            }
            const draft = { protocol: 'scene_draft_v3', narrative: [
                { id: 'p1', action_id: 'take_key', text: 'You pick up the Bronze key.' },
                { id: 'p2', action_id: 'open_gate', text: 'The archive gate opens.' },
                { id: 'p3', action_id: 'enter_room', text: 'You and the guide enter the Archive.' }
            ], actions: [
                { action_id: 'take_key', request: 'I pick up the Bronze key',
                    kind: 'physical', status: 'resolved', response_id: 'p1',
                    action_effects: { item_transfer: [{ item_id: 'key_1',
                        from_id: 'foyer', to_id: 'player' }] } },
                { action_id: 'open_gate', request: 'open the archive gate',
                    kind: 'physical', status: 'resolved', response_id: 'p2',
                    depends_on: [{ action_id: 'take_key', outcome: 'succeeded' }],
                    action_effects: { interactable_transition: [{ target_id: 'archive_gate',
                        to_state: 'open' }] } },
                { action_id: 'enter_room', request: 'enter the Archive',
                    kind: 'travel', status: 'resolved', response_id: 'p3',
                    depends_on: [{ action_id: 'open_gate', outcome: 'succeeded' }],
                    action_effects: { actor_move: [{ actor_id: 'player',
                        to_location_id: 'archive' }] } }
            ], events: [], effects: {}, speech: [], commitments: [] };
            const partialDraft = { protocol: 'scene_draft_v3', narrative: [
                { id: 'p1', action_id: 'wear', text: 'You put on the blue coat.' },
                { id: 'p2', action_id: 'vault', text: 'The vault is unreachable from here.' }
            ], actions: [
                { action_id: 'wear', request: 'I put on my coat', kind: 'physical',
                    status: 'resolved', response_id: 'p1', action_effects: {
                        outfit_set: [{ actor_id: 'player', outfit: 'blue coat' }] } },
                { action_id: 'vault', request: 'enter the vault', kind: 'travel',
                    status: 'blocked', response_id: 'p2', depends_on: [
                        { action_id: 'wear', outcome: 'succeeded' } ], action_effects: {
                        actor_move: [{ actor_id: 'player', to_location_id: 'vault' }] } }
            ], events: [], effects: {}, speech: [], commitments: [] };
            const checkDraft = { protocol: 'scene_draft_v3', narrative: [
                { id: 'p1', action_id: 'inspect', text: 'You begin inspecting the seal and await the check.' }
            ], actions: [{ action_id: 'inspect', kind: 'physical', status: 'pending_check',
                response_id: 'p1', action_effects: { checks: [{ label: 'Inspect seal',
                    difficulty: 10, on_success: {}, on_failure: {} }] } }],
            events: [], effects: {}, speech: [], commitments: [] };
            const realFetch = window.fetch;
            let calls = 0;
            let nextDraft = draft;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                calls++;
                const payload = { choices: [{ delta: { content: JSON.stringify(nextDraft) },
                    finish_reason: 'stop' }] };
                return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`,
                    { headers: { 'Content-Type': 'text/event-stream' } });
            };
            document.getElementById('world-user-input').value =
                'I pick up the Bronze key, open the archive gate and enter the Archive.';
            await executeWorldTurn();
            const firstAudit = structuredClone(sess.lastTurnAudit);
            nextDraft = partialDraft;
            document.getElementById('world-user-input').value =
                'I put on my coat and enter the vault.';
            await executeWorldTurn();
            const secondAudit = structuredClone(sess.lastTurnAudit);
            nextDraft = checkDraft;
            document.getElementById('world-user-input').value = 'I inspect the seal.';
            await executeWorldTurn();
            const checkRequestAudit = structuredClone(sess.lastTurnAudit);
            const pendingBeforeRoll = sess.pendingChecks?.length;
            const savedPendingBeforeRoll = (await HordeDB.get(`worldInstance:${world.id}`))?.sessions
                ?.find(item => item.id === sess.id)?.pendingChecks?.length;
            window.executeWorldTurn = async command => { window.__continuedAfterCheck = command; };
            await resolveWorldCheckFromModal();
            window.fetch = realFetch;
            const saved = (await HordeDB.get(`worldInstance:${world.id}`))?.sessions
                ?.find(item => item.id === sess.id);
            return { calls, location: sess.playerLocation, guide: sess.entityStates.guide_1?.location,
                inventory: sess.inventory, gate: sess.unlockedExits?.archive_gate,
                savedLocation: saved?.playerLocation, savedGuide: saved?.entityStates?.guide_1?.location,
                savedInventory: saved?.inventory, savedGate: saved?.unlockedExits?.archive_gate,
                firstAudit, secondAudit, checkRequestAudit, audit: sess.lastTurnAudit,
                pendingBeforeRoll, savedPendingBeforeRoll,
                pending: sess.pendingChecks?.length, savedPending: saved?.pendingChecks?.length,
                checkHistory: sess.checkHistory?.length, savedCheckHistory: saved?.checkHistory?.length,
                continuedAfterCheck: window.__continuedAfterCheck,
                outfit: sess.outfit,
                savedOutfit: saved?.outfit, history: sess.history.map(item => item.text) };
        });
        assert.deepEqual(errors, [], JSON.stringify(errors));
        assert.equal(result.calls, 3, JSON.stringify(result));
        assert.equal(result.location, 'archive', JSON.stringify(result));
        assert.equal(result.guide, 'archive', JSON.stringify(result));
        assert.equal(result.savedLocation, 'archive', JSON.stringify(result));
        assert.equal(result.savedGuide, 'archive', JSON.stringify(result));
        assert.equal(result.gate, true, JSON.stringify(result));
        assert.equal(result.savedGate, true, JSON.stringify(result));
        assert(result.inventory.some(item => /bronze key/i.test(item?.name || String(item))), JSON.stringify(result));
        assert(result.savedInventory.some(item => /bronze key/i.test(item?.name || String(item))), JSON.stringify(result));
        assert.deepEqual(result.firstAudit?.actions?.map(item => item.outcome),
            ['succeeded', 'succeeded', 'succeeded'], JSON.stringify(result));
        assert.deepEqual(result.secondAudit?.actions?.map(item => item.outcome),
            ['succeeded', 'blocked'], JSON.stringify(result));
        assert.deepEqual(result.checkRequestAudit?.actions?.map(item => item.outcome),
            ['pending'], JSON.stringify(result));
        assert.equal(result.pendingBeforeRoll, 1, JSON.stringify(result));
        assert.equal(result.savedPendingBeforeRoll, 1, JSON.stringify(result));
        assert.equal(result.pending, 0, JSON.stringify(result));
        assert.equal(result.savedPending, 0, JSON.stringify(result));
        assert.equal(result.checkHistory, 1, JSON.stringify(result));
        assert.equal(result.savedCheckHistory, 1, JSON.stringify(result));
        assert.equal(result.continuedAfterCheck, 'continue', JSON.stringify(result));
        assert.equal(result.outfit, 'blue coat', JSON.stringify(result));
        assert.equal(result.savedOutfit, 'blue coat', JSON.stringify(result));
        assert(result.history.some(text => text?.includes('vault is unreachable')), JSON.stringify(result));
        console.log('PASS linked chain and durable partial failure without legacy language parsers');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
