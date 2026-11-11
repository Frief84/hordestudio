'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');
const liveNarration = process.env.HORDE_P0_LIVE_NARRATION === '1';
const liveLanguage = process.env.HORDE_P0_LIVE_LANGUAGE || 'de';
const bound = process.env.HORDE_P0_BOUND === '1';
const liveModel = process.env.HORDE_P0_LIVE_MODEL || 'qwen2.5:14b-instruct-q4_K_M';

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext();
        await context.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (bound && url.pathname === '/worlds/bind-turn') {
                const headers = { 'access-control-allow-origin': '*',
                    'access-control-allow-methods': 'POST, OPTIONS',
                    'access-control-allow-headers': 'content-type' };
                if (route.request().method() === 'OPTIONS')
                    return route.fulfill({ status: 204, headers });
                const result = spawnSync(process.execPath,
                    [path.join(root, 'worlds/turn-binding-worker.js')],
                    { input: route.request().postData(), encoding: 'utf8' });
                return route.fulfill({ status: 200, contentType: 'application/json',
                    headers, body: result.stdout });
            }
            if (liveNarration && url.hostname === '127.0.0.1'
                && url.pathname === '/v1/chat/completions') {
                const response = await fetch('http://127.0.0.1:11434/v1/chat/completions', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: route.request().postData(),
                    signal: AbortSignal.timeout(180000)
                });
                const body = await response.text();
                const generated = JSON.parse(body).choices?.[0]?.message?.content;
                console.log(`LIVE short narration (${liveLanguage}): ${JSON.stringify(generated)}`);
                return route.fulfill({ status: response.status, contentType: 'application/json',
                    headers: { 'access-control-allow-origin': '*' }, body });
            }
            if (url.hostname !== 'p0-preflight.test') return route.abort();
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
        await page.goto('https://p0-preflight.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
        const result = await page.evaluate(async ({ liveNarration, liveModel, liveLanguage, bound }) => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            localStorage.setItem('horde_world_debug_enabled_v1', 'true');
            state.apiKey = 'offline';
            state.globalSettings.apiProvider = 'local';
            state.globalSettings.localBaseUrl = 'http://127.0.0.1:1234/v1';
            const world = { id: 'p0_preflight_fixture', name: 'P0 Fixture',
                outputLanguage: liveNarration ? liveLanguage : 'de',
                model: liveNarration ? liveModel : 'fixture/model',
                contextSize: 32768, maxTokens: 2048, dmPrompt: '', intro: '',
                startLocationId: 'kitchen', locations: [
                    { id: 'kitchen', name: 'Küche',
                        description: 'Ein warmer Lichtschein fällt auf den Tisch.',
                        exits: [{ targetLocationId: 'hall' }] },
                    { id: 'hall', name: 'Flur',
                        description: 'Der Flur liegt im gedämpften Licht.',
                        exits: [{ targetLocationId: 'kitchen' }] }
                ], entities: [], kernel: { enabled: true, memoryMode: 'ledger',
                    sceneDrafts: true, serverBindings: bound, sceneDraftProtocol: 'scene_draft_v3' },
                hudConfig: { startTimeHours: 8, startTimeMinutes: 0, timeStep: 5 } };
            state.worlds = [world];
            state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            const sess = prepareCurrentWorldSession();
            sess.setupComplete = true;
            sess.playerLocation = 'kitchen';
            switchView('worldPlay'); renderWorldPlayState();
            const modelRequests = [];
            window.__p0ModelRequests = modelRequests;
            const realFetch = window.fetch;
            window.fetch = async (url, options = {}) => {
                if (String(url).includes('/chat/completions')) {
                    const body = JSON.parse(options.body);
                    modelRequests.push(body);
                    if (liveNarration && modelRequests.length === 1)
                        return realFetch(url, options);
                    if (modelRequests.length === 4)
                        throw new Error('simulated narrative provider outage');
                    if (modelRequests.length === 6 || modelRequests.length === 7) {
                        const falseClaim = modelRequests.length === 6
                            ? 'Die Tür öffnet sich. Frieder erreicht die Küche.'
                            : 'Frieder findet einen Schlüssel und betritt die Küche.';
                        return new Response(JSON.stringify({ choices: [{ message: {
                            content: falseClaim } }] }), { status: 200,
                            headers: { 'Content-Type': 'application/json' } });
                    }
                    const samples = [
                        'Frieder bleibt einen Moment verwundert stehen. Erst jetzt fällt ihm auf, dass er sich längst in der Küche befindet.',
                        '{"actor_move":"hall"}',
                        'Mit wenigen Schritten gelangt Frieder in den Flur. Das Licht wirkt hier gedämpft.',
                        ''
                    ];
                    return new Response(JSON.stringify({ choices: [{
                        message: { content: samples[modelRequests.length - 1] || '' }
                    }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                return realFetch(url, options);
            };
            const beforeVersion = sess.worldStateVersion || 0;
            document.getElementById('world-user-input').value = 'Ich gehe in die Küche.';
            await executeWorldTurn();
            const first = { location: sess.playerLocation,
                versionDelta: (sess.worldStateVersion || 0) - beforeVersion,
                last: sess.history.at(-1)?.text,
                prompt: modelRequests[0]?.messages?.[0]?.content,
                outcome: sess.history.at(-1)?.actionOutcomes?.[0],
                debug: worldDebugEntries(world, sess)[0] };
            world.outputLanguage = 'de';
            world.locations[0].exits = [];
            const secondBefore = sess.worldStateVersion;
            document.getElementById('world-user-input').value = 'Ich gehe in den Flur.';
            await executeWorldTurn();
            const blocked = { location: sess.playerLocation,
                    versionDelta: sess.worldStateVersion - secondBefore,
                    outcome: sess.history.at(-1)?.actionOutcomes?.[0],
                    last: sess.history.at(-1)?.text,
                    debug: worldDebugEntries(world, sess)[0] };
            world.locations[0].exits = [{ targetLocationId: 'hall' }];
            const thirdBefore = sess.worldStateVersion;
            document.getElementById('world-user-input').value = 'Ich bewege mich in den Flur.';
            await executeWorldTurn();
            const moved = { location: sess.playerLocation,
                    versionDelta: sess.worldStateVersion - thirdBefore,
                    outcome: sess.history.at(-1)?.actionOutcomes?.[0],
                    debug: worldDebugEntries(world, sess)[0],
                    last: sess.history.at(-1)?.text };
            const fourthBefore = sess.worldStateVersion;
            document.getElementById('world-user-input').value = 'Ich gehe zurück in die Küche.';
            await executeWorldTurn();
            const returned = { location: sess.playerLocation,
                    versionDelta: sess.worldStateVersion - fourthBefore,
                    outcome: sess.history.at(-1)?.actionOutcomes?.[0],
                    last: sess.history.at(-1)?.text,
                    debug: worldDebugEntries(world, sess)[0] };
            world.locations[0].exits = [{ targetLocationId: 'hall', travelTime: 12 }];
            const fifthBefore = sess.worldStateVersion;
            const beforeMinute = getWorldTimeData(world, sess).currentTotalMinutes;
            document.getElementById('world-user-input').value = 'Ich gehe in den Flur.';
            await executeWorldTurn();
            const timed = { location: sess.playerLocation,
                versionDelta: sess.worldStateVersion - fifthBefore,
                minutes: getWorldTimeData(world, sess).currentTotalMinutes - beforeMinute,
                outcome: sess.history.at(-1)?.actionOutcomes?.[0],
                debug: worldDebugEntries(world, sess)[0] };
            world.locations[1].exits = [{ targetLocationId: 'kitchen',
                requiredItem: 'Bronze key', lockState: 'locked' }];
            const sixthBefore = sess.worldStateVersion;
            document.getElementById('world-user-input').value = 'Ich gehe zurück in die Küche.';
            await executeWorldTurn();
            const locked = { location: sess.playerLocation,
                versionDelta: sess.worldStateVersion - sixthBefore,
                last: sess.history.at(-1)?.text,
                outcome: sess.history.at(-1)?.actionOutcomes?.[0],
                debug: worldDebugEntries(world, sess)[0] };
            sess.inventory = [{ name: 'Bronze key', quantity: 0 }];
            document.getElementById('world-user-input').value = 'Ich gehe zurück in die Küche.';
            await executeWorldTurn();
            const emptyKey = { location: sess.playerLocation,
                last: sess.history.at(-1)?.text,
                outcome: sess.history.at(-1)?.actionOutcomes?.[0],
                debug: worldDebugEntries(world, sess)[0] };
            sess.inventory = ['Bronze key'];
            const seventhBefore = sess.worldStateVersion;
            document.getElementById('world-user-input').value = 'Ich gehe zurück in die Küche.';
            await executeWorldTurn();
            const keyed = { location: sess.playerLocation,
                versionDelta: sess.worldStateVersion - seventhBefore,
                outcome: sess.history.at(-1)?.actionOutcomes?.[0],
                debug: worldDebugEntries(world, sess)[0] };
            world.locations[0].exits = [];
            const eighthBefore = sess.worldStateVersion;
            document.getElementById('world-user-input').value = 'Ich gehe in den Flur.';
            await executeWorldTurn();
            const missing = { location: sess.playerLocation,
                versionDelta: sess.worldStateVersion - eighthBefore,
                outcome: sess.history.at(-1)?.actionOutcomes?.[0],
                debug: worldDebugEntries(world, sess)[0] };
            world.locations[0].exits = [{ targetLocationId: 'hall' }];
            world.locations[1].exits = [];
            const ninthBefore = sess.worldStateVersion;
            document.getElementById('world-user-input').value = 'Ich gehe in den Flur.';
            await executeWorldTurn();
            const oneWayOut = { location: sess.playerLocation,
                versionDelta: sess.worldStateVersion - ninthBefore,
                outcome: sess.history.at(-1)?.actionOutcomes?.[0],
                debug: worldDebugEntries(world, sess)[0] };
            const tenthBefore = sess.worldStateVersion;
            document.getElementById('world-user-input').value = 'Ich gehe zurück in die Küche.';
            await executeWorldTurn();
            world.locations[1].exits = [{ targetLocationId: 'kitchen', cost: '2 coins' }];
            const pricedIntent = resolveWorldTurnIntentP0(world, sess,
                'Ich gehe zurück in die Küche.');
            const pricedDraft = buildWorldDeterministicMoveDraft(world, sess, pricedIntent,
                'Ich gehe zurück in die Küche.', bound);
            const blockedPreflight = { status: 'blocked', intent: { targetId: 'kitchen' } };
            const atKitchen = { ...sess, playerLocation: 'kitchen' };
            const alreadyKitchen = { status: 'already_satisfied',
                intent: { targetId: 'kitchen' } };
            const narrativeChecks = {
                frenchTable: worldConfirmedMovementNarrativeConflicts(world,
                    atKitchen, atKitchen, alreadyKitchen,
                    'Vous êtes déjà dans la cuisine. La lumière tombe sur la table.').length,
                spanishTable: worldConfirmedMovementNarrativeConflicts(world,
                    atKitchen, atKitchen, alreadyKitchen,
                    'Ya estás en la cocina. La luz cae sobre la mesa.').length,
                frenchLamp: worldConfirmedMovementNarrativeConflicts(world,
                    atKitchen, atKitchen, alreadyKitchen,
                    'Vous êtes déjà dans la cuisine. La lampe éclaire la table.')
                    .map(item => item.reason),
                gesture: worldConfirmedMovementNarrativeConflicts(world, sess, sess,
                    blockedPreflight, 'Frieder bleibt einen Moment verwundert stehen. Die Tür bleibt verschlossen.').length,
                falseArrival: worldConfirmedMovementNarrativeConflicts(world, sess, sess,
                    blockedPreflight, 'Frieder erreicht die Küche.').map(item => item.reason),
                falseDoor: worldConfirmedMovementNarrativeConflicts(world, sess, sess,
                    blockedPreflight, 'Die Tür öffnet sich.').map(item => item.reason),
                falseKey: worldConfirmedMovementNarrativeConflicts(world, sess, sess,
                    blockedPreflight, 'Frieder findet einen Schlüssel.').map(item => item.reason)
            };
            return { modelRequests: modelRequests.map(body => ({
                maxTokens: body.max_tokens, promptCharacters: JSON.stringify(body.messages).length,
                hasTools: !!body.tools
            })), first, blocked, moved, returned, timed, locked, emptyKey, keyed, missing, oneWayOut,
                pricedDraft, narrativeChecks, oneWayReturn: { location: sess.playerLocation,
                    versionDelta: sess.worldStateVersion - tenthBefore,
                    outcome: sess.history.at(-1)?.actionOutcomes?.[0],
                    debug: worldDebugEntries(world, sess)[0] } };
        }, { liveNarration, liveModel, liveLanguage, bound });
        assert.deepEqual(errors, []);
        assert.equal(result.modelRequests.length, 11);
        assert(result.modelRequests.every(request => request.maxTokens <= 140
            && request.promptCharacters < 2200 && !request.hasTools));
        assert.equal(result.first.location, 'kitchen');
        assert.equal(result.first.versionDelta, 1);
        assert.equal(result.first.outcome?.status, 'already_satisfied');
        if (liveNarration) {
            assert(result.first.last && result.first.outcome?.status === 'already_satisfied');
            assert(!/actor_move|state_updates|receipt/i.test(result.first.last));
            assert.match(result.first.prompt, new RegExp(`in ${
                { de: 'German', en: 'English', fr: 'French', es: 'Spanish' }[liveLanguage]}`));
            if (liveLanguage === 'fr') assert.match(result.first.last,
                /\b(?:vous|déjà|cuisine|êtes|restez|ici)\b/i);
            if (liveLanguage === 'es') assert.match(result.first.last,
                /\b(?:ya|estás|aquí|cocina|quedas|encuentras)\b/i);
        } else assert.equal(result.first.last,
            'Frieder bleibt einen Moment verwundert stehen. Erst jetzt fällt ihm auf, dass er sich längst in der Küche befindet.');
        assert.equal(result.moved.last,
            'Mit wenigen Schritten gelangt Frieder in den Flur. Das Licht wirkt hier gedämpft.');
        assert.equal(result.first.debug?.processingPath, 'deterministic');
        assert.equal(result.first.debug?.calls?.length, 1);
        assert.equal(result.blocked.location, 'kitchen');
        assert.equal(result.blocked.versionDelta, 1);
        assert.equal(result.blocked.outcome?.status, 'blocked');
        assert.equal(result.blocked.last, 'Der Weg nach Flur ist derzeit nicht zugänglich.');
        assert.equal(result.blocked.debug?.calls?.length, 1);
        assert.match(result.blocked.debug?.calls?.[0]?.kind || '', /deterministicNarration/);
        assert.equal(result.moved.location, 'hall', JSON.stringify(result.moved));
        assert.equal(result.moved.versionDelta, 1);
        assert.equal(result.moved.outcome?.status, 'succeeded');
        assert.equal(result.moved.debug?.calls?.length, 1);
        assert.equal(result.moved.debug?.processingPath, 'deterministic');
        assert.equal(result.returned.location, 'kitchen');
        assert.equal(result.returned.versionDelta, 1);
        assert.equal(result.returned.outcome?.status, 'succeeded');
        assert.equal(result.returned.last, 'Du erreichst Küche.');
        assert.equal(result.returned.debug?.calls?.length, 1);
        assert.equal(result.timed.location, 'hall');
        assert.equal(result.timed.versionDelta, 1);
        assert.equal(result.timed.outcome?.status, 'succeeded');
        assert(result.timed.minutes >= 12, JSON.stringify(result.timed));
        assert.equal(result.timed.debug?.calls?.length, 1);
        assert.equal(result.locked.location, 'hall');
        assert.equal(result.locked.versionDelta, 1);
        assert.equal(result.locked.outcome?.status, 'blocked');
        assert.equal(result.locked.debug?.calls?.length, 1);
        assert.equal(result.locked.last, 'Der Weg nach Küche ist derzeit nicht zugänglich.');
        assert.equal(result.emptyKey.location, 'hall');
        assert.equal(result.emptyKey.outcome?.status, 'blocked');
        assert.equal(result.emptyKey.debug?.calls?.length, 1);
        assert.equal(result.emptyKey.last, 'Der Weg nach Küche ist derzeit nicht zugänglich.');
        assert.equal(result.keyed.location, 'kitchen', JSON.stringify(result.keyed));
        assert.equal(result.keyed.versionDelta, 1);
        assert.equal(result.keyed.outcome?.status, 'succeeded');
        assert.equal(result.keyed.debug?.calls?.length, 1);
        assert.equal(result.missing.location, 'kitchen');
        assert.equal(result.missing.outcome?.status, 'blocked');
        assert.equal(result.oneWayOut.location, 'hall');
        assert.equal(result.oneWayOut.outcome?.status, 'succeeded');
        assert.equal(result.oneWayReturn.location, 'hall');
        assert.equal(result.oneWayReturn.outcome?.status, 'blocked');
        assert.equal(result.pricedDraft, null,
            'a priced route has no canonical debit and must use the model path');
        assert.equal(result.narrativeChecks.gesture, 0);
        assert.equal(result.narrativeChecks.frenchTable, 0);
        assert.equal(result.narrativeChecks.spanishTable, 0);
        assert(result.narrativeChecks.frenchLamp.includes('unsupported_scene_object'));
        assert(result.narrativeChecks.falseArrival.includes('contradicted_blocked_move'));
        assert(result.narrativeChecks.falseDoor.includes('uncommitted_door_opening'));
        assert(result.narrativeChecks.falseKey.includes('uncommitted_item_change'));
        const rollback = await page.evaluate(async () => {
            const world = state.worlds[0];
            const sess = state.worldInstances[world.id].sessions[0];
            world.locations[1].exits = [{ targetLocationId: 'kitchen' }];
            const before = { location: sess.playerLocation, version: sess.worldStateVersion,
                history: sess.history.length, receipts: sess.worldTurnReceipts?.length || 0 };
            const originalCommit = commitWorldMigrationAware;
            commitWorldMigrationAware = async () => { throw new Error('p0_test_storage_failure'); };
            try {
                document.getElementById('world-user-input').value = 'Ich gehe zurück in die Küche.';
                await executeWorldTurn();
            } finally { commitWorldMigrationAware = originalCommit; }
            const after = { location: sess.playerLocation, version: sess.worldStateVersion,
                history: sess.history.length, receipts: sess.worldTurnReceipts?.length || 0 };
            return { before, after };
        });
        assert.deepEqual(rollback.after, rollback.before,
            'failed atomic persistence must roll back the deterministic move');
        await page.reload();
        await page.waitForFunction(() => state.worldInstances?.p0_preflight_fixture?.sessions
            ?.some(session => session.history?.at(-1)?.actionOutcomes?.[0]?.status === 'blocked'));
        const reloaded = await page.evaluate(() => {
            const session = state.worldInstances.p0_preflight_fixture.sessions[0];
            return { location: session.playerLocation,
                statuses: session.history.filter(message => message.role === 'dm')
                    .map(message => message.actionOutcomes?.[0]?.status),
                receipts: session.worldTurnReceipts?.length || 0 };
        });
        assert.equal(reloaded.location, 'hall');
        assert.deepEqual(reloaded.statuses.slice(-11),
            ['already_satisfied', 'blocked', 'succeeded', 'succeeded', 'succeeded',
                'blocked', 'blocked', 'succeeded', 'blocked', 'succeeded', 'blocked']);
        assert(reloaded.receipts >= 11);
        const languages = await page.evaluate(async () => {
            const world = state.worlds.find(item => item.id === 'p0_preflight_fixture');
            const sess = getCurrentWorldSession();
            state.apiKey = 'offline';
            state.globalSettings.apiProvider = 'local';
            state.globalSettings.localBaseUrl = 'http://127.0.0.1:1234/v1';
            const realFetch = window.fetch, calls = [];
            window.__languageCalls = calls;
            window.fetch = async (url, options = {}) => {
                if (String(url).includes('/chat/completions')) {
                    const body = JSON.parse(options.body);
                    if (String(body.messages?.[0]?.content || '').startsWith(
                        'The World has already decided this movement.')) calls.push(body);
                    return new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }),
                        { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                return realFetch(url, options);
            };
            const before = { id: sess.playerLocation, version: sess.worldStateVersion };
            const turns = [];
            for (const [language, input] of [
                ['fr', 'Ich gehe in den Flur.'],
                ['en', 'Ich gehe in den Flur.'],
                ['de', 'I go to the Flur.'],
                ['es', 'Ich gehe in den Flur.']
            ]) {
                world.outputLanguage = language;
                document.getElementById('world-user-input').value = input;
                await executeWorldTurn();
                turns.push({ language, text: sess.history.at(-1)?.text,
                    status: sess.history.at(-1)?.actionOutcomes?.[0]?.status,
                    unverified: worldUnverifiedTurnNotice(world),
                    conflict: worldConflictingNarrativeNotice(world),
                    noScene: worldMovementFallback('no_readable_scene', '', world),
                    debugCalls: worldDebugEntries(world, sess)[0]?.calls?.length,
                    prompt: calls.at(-1)?.messages?.[0]?.content,
                    packet: JSON.parse(calls.at(-1)?.messages?.[1]?.content || '{}'),
                    id: sess.playerLocation });
            }
            return { before, after: { id: sess.playerLocation,
                version: sess.worldStateVersion }, turns, calls: calls.length,
                clarification: worldMovementFallback('needs_clarification', '', world),
                unresolved: worldMovementFallback('unresolved', '', world),
                compound: resolveWorldTurnIntentP0(world, sess,
                    'Ich gehe in den Flur und frage Linda.').path };
        });
        assert.equal(languages.calls, 4);
        assert.equal(languages.after.id, languages.before.id);
        assert.equal(languages.after.version, languages.before.version + 4);
        assert.deepEqual(languages.turns.map(turn => turn.status),
            ['already_satisfied', 'already_satisfied', 'already_satisfied', 'already_satisfied']);
        assert.deepEqual(languages.turns.map(turn => turn.text),
            ['Vous êtes déjà ici : Flur.', 'You are already here: Flur.',
                'Du bist bereits hier: Flur.', 'Ya estás aquí: Flur.']);
        assert.match(languages.turns[0].unverified, /^La réponse/);
        assert.match(languages.turns[0].conflict, /^La scène/);
        assert.match(languages.turns[1].noScene, /^The world state/);
        assert.match(languages.turns[2].unverified, /^Die Antwort/);
        assert.match(languages.turns[2].noScene, /^Der Weltzustand/);
        assert.match(languages.turns[3].unverified, /^No se pudo/);
        assert.match(languages.turns[3].conflict, /^La escena/);
        assert(languages.turns.every(turn => turn.debugCalls === 1
            && turn.id === 'hall' && turn.packet.outputLanguage === turn.language));
        assert.match(languages.turns[0].prompt, /in French/);
        assert.match(languages.turns[1].prompt, /in English/);
        assert.match(languages.turns[2].prompt, /in German/);
        assert.match(languages.turns[3].prompt, /in Spanish/);
        assert.equal(languages.compound, 'needs_model');
        assert.equal(languages.clarification, 'Aclara a qué lugar quieres ir.');
        assert.equal(languages.unresolved, 'No se pudo confirmar tu movimiento.');
        const uiBefore = await page.evaluate(() => {
            const world = state.worlds.find(item => item.id === 'p0_preflight_fixture');
            world.locations[1].exits = [{ targetLocationId: 'kitchen', text: 'to Küche' }];
            world.outputLanguage = 'de';
            renderWorldPlayState();
            const sess = getCurrentWorldSession();
            return { version: sess.worldStateVersion,
                calls: window.__languageCalls.length, history: sess.history.length };
        });
        await page.evaluate(() => document.querySelector('#world-exits-list button').click());
        await page.waitForFunction(() => getCurrentWorldSession()?.playerLocation === 'kitchen');
        const uiAfter = await page.evaluate(() => {
            const sess = getCurrentWorldSession();
            const world = state.worlds.find(item => item.id === 'p0_preflight_fixture');
            return { version: sess.worldStateVersion,
                calls: window.__languageCalls.length, history: sess.history.length,
                location: sess.playerLocation,
                outcome: sess.history.at(-1)?.actionOutcomes?.[0],
                debug: worldDebugEntries(world, sess)[0] };
        });
        assert.equal(uiAfter.version, uiBefore.version + 1);
        assert.equal(uiAfter.calls, uiBefore.calls + 1);
        assert.equal(uiAfter.history, uiBefore.history + 2);
        assert.equal(uiAfter.location, 'kitchen');
        assert.equal(uiAfter.outcome?.status, 'succeeded');
        assert.equal(uiAfter.debug?.processingPath, 'deterministic');
        assert.equal(uiAfter.debug?.intent?.provenance, 'structured_world_exit');
        const blockedUi = await page.evaluate(async () => {
            const world = state.worlds.find(item => item.id === 'p0_preflight_fixture');
            const sess = getCurrentWorldSession();
            world.locations[0].exits = [{ targetLocationId: 'hall',
                requiredItem: 'Bronze key', lockState: 'locked' }];
            sess.inventory = [];
            const before = { version: sess.worldStateVersion,
                calls: window.__languageCalls.length };
            const result = await travelThroughWorldExit(world, sess,
                world.locations[0].exits[0]);
            return { result, before, after: { version: sess.worldStateVersion,
                calls: window.__languageCalls.length, location: sess.playerLocation,
                outcome: sess.history.at(-1)?.actionOutcomes?.[0] } };
        });
        assert.equal(blockedUi.result.ok, false);
        assert.equal(blockedUi.result.linkedTurn, true);
        assert.equal(blockedUi.after.location, 'kitchen');
        assert.equal(blockedUi.after.version, blockedUi.before.version + 1);
        assert.equal(blockedUi.after.calls, blockedUi.before.calls + 1);
        assert.equal(blockedUi.after.outcome?.status, 'blocked');
        await page.reload();
        await page.waitForFunction(() => getCurrentWorldSession()?.playerLocation === 'kitchen');
        const uiReload = await page.evaluate(() => {
            const sess = getCurrentWorldSession();
            return { location: sess.playerLocation,
                outcome: sess.history.at(-1)?.actionOutcomes?.[0]?.status,
                version: sess.worldStateVersion };
        });
        assert.deepEqual(uiReload, { location: 'kitchen', outcome: 'blocked',
            version: blockedUi.after.version });
        const npcNarrative = await page.evaluate(() => {
            const world = safeJsonClone(state.worlds.find(item =>
                item.id === 'p0_preflight_fixture'));
            world.entities.push({ id: 'linda', name: 'Linda', type: 'npc',
                startLocation: 'hall' });
            const after = safeJsonClone(getCurrentWorldSession());
            after.entityStates ||= {};
            after.entityStates.linda = { location: 'hall' };
            const before = safeJsonClone(after);
            before.playerLocation = 'hall';
            const hintWorld = { ...world, locations: [
                { id: 'hall', name: 'Flur', exits: [{ targetLocationId: 'kitchen' }] },
                { id: 'kitchen', name: 'Küche', exits: [{ targetLocationId: 'hall' }] }
            ] };
            const hintSession = { ...before, playerLocation: 'hall',
                locationStates: {}, unlockedExits: {}, blockedExits: {} };
            return {
                compoundHint: worldCompoundMoveSpeechHint(hintWorld, hintSession,
                    'Ich bewege mich in die Küche und sage "Bereit."'),
                compoundClauses: HordeWorldTurnContext.requestClauses(
                    'Ich bewege mich in die Küche und sage "Bereit."'),
                compoundPreflight: resolveWorldTurnIntentP0(hintWorld, hintSession,
                    'Ich bewege mich in die Küche'),
                npc: worldFinalNarrativeConflicts(world, before, after,
                    'Du trittst in die Küche. Linda folgt dir hinein und sieht dich an.',
                    'I move to the kitchen and say "Ready."').map(item => item.reason),
                npcBeside: worldFinalNarrativeConflicts(world, before, after,
                    'Linda steht plötzlich neben dir – sie muss der Tür gefolgt sein.',
                    'I move to the kitchen and say "Ready."').map(item => item.reason),
                objects: worldFinalNarrativeConflicts(world, before, after,
                    'Der Vorhang bewegt sich. Der Schatten des Kamins zuckt.',
                    'I move to the kitchen.').map(item => item.reason),
                simile: worldFinalNarrativeConflicts(world, before, after,
                    'Das Wort klingt wie ein Schlüssel in einem Schloss.',
                    'I say Ready.').map(item => item.reason)
            };
        });
        assert(npcNarrative.npc.includes('uncommitted_npc_escort'));
        assert(npcNarrative.npcBeside.includes('uncommitted_npc_escort'));
        assert(npcNarrative.compoundHint.includes('Return exactly two player actions'),
            JSON.stringify({ clauses: npcNarrative.compoundClauses,
                preflight: npcNarrative.compoundPreflight }));
        assert(npcNarrative.objects.includes('unsupported_scene_object'));
        assert(!npcNarrative.simile.includes('unsupported_scene_object'));
        const concurrent = await page.evaluate(async () => {
            const world = state.worlds.find(item => item.id === 'p0_preflight_fixture');
            const sess = getCurrentWorldSession();
            world.outputLanguage = 'de';
            state.apiKey = 'offline';
            state.globalSettings.apiProvider = 'local';
            state.globalSettings.localBaseUrl = 'http://127.0.0.1:1234/v1';
            let calls = 0;
            window.__p0AuditFetchCalls = 0;
            const originalFetch = window.fetch;
            window.fetch = async (url, options) => {
                if (!String(url).includes('/chat/completions'))
                    return originalFetch(url, options);
                calls++;
                window.__p0AuditFetchCalls++;
                await new Promise(resolve => setTimeout(resolve, 80));
                const content = calls === 2
                    ? 'Du hältst kurz inne und merkst, dass du schon in der Küche bist.' : '';
                return new Response(JSON.stringify({ choices: [{ message: { content } }] }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } });
            };
            const before = { version: sess.worldStateVersion,
                history: sess.history.length };
            document.getElementById('world-user-input').value = 'Ich gehe in die Küche.';
            const first = executeWorldTurn();
            const second = executeWorldTurn();
            await Promise.all([first, second]);
            return { before, after: { version: sess.worldStateVersion,
                history: sess.history.length, outcome: sess.history.at(-1)?.actionOutcomes?.[0]?.status },
                calls };
        });
        assert.equal(concurrent.calls, 1);
        assert.equal(concurrent.after.version, concurrent.before.version + 1);
        assert.equal(concurrent.after.history, concurrent.before.history + 2);
        assert.equal(concurrent.after.outcome, 'already_satisfied');
        const reroll = await page.evaluate(async () => {
            const sess = getCurrentWorldSession();
            const before = { version: sess.worldStateVersion,
                history: sess.history.map(message => ({ role: message.role, text: message.text })),
                calls: window.__p0AuditFetchCalls,
                snapshot: !!sess.history.at(-1)?.turnSnapshot };
            await executeWorldTurn(true);
            return { before, after: { version: sess.worldStateVersion,
                history: sess.history.map(message => ({ role: message.role, text: message.text })),
                outcome: sess.history.at(-1)?.actionOutcomes?.[0]?.status },
                input: document.getElementById('world-user-input').value,
                calls: window.__p0AuditFetchCalls,
                error: document.getElementById('world-turn-error-text')?.textContent };
        });
        assert.equal(reroll.before.snapshot, true);
        assert.equal(reroll.calls, reroll.before.calls + 1);
        assert.equal(reroll.after.version, reroll.before.version);
        assert.equal(reroll.after.history.length, reroll.before.history.length);
        assert.deepEqual(reroll.after.history.slice(0, -1), reroll.before.history.slice(0, -1));
        assert.equal(reroll.after.history.at(-1)?.text,
            'Du hältst kurz inne und merkst, dass du schon in der Küche bist.');
        assert.equal(reroll.after.outcome, 'already_satisfied');
        assert.equal(reroll.error, '');
        const movedReroll = await page.evaluate(async () => {
            const world = state.worlds.find(item => item.id === 'p0_preflight_fixture');
            const sess = getCurrentWorldSession();
            world.locations[0].exits = [{ targetLocationId: 'hall' }];
            world.locations[1].exits = [{ targetLocationId: 'kitchen' }];
            document.getElementById('world-user-input').value = 'Ich gehe in den Flur.';
            await executeWorldTurn();
            const before = { location: sess.playerLocation, version: sess.worldStateVersion,
                history: sess.history.length, receipts: sess.worldTurnReceipts.length,
                calls: window.__p0AuditFetchCalls,
                stateSource: sess.history.at(-1)?.stateSource,
                outcome: sess.history.at(-1)?.actionOutcomes?.[0],
                exit: world.locations[0].exits[0] };
            await executeWorldTurn(true);
            return { before, after: { location: sess.playerLocation,
                version: sess.worldStateVersion, history: sess.history.length,
                receipts: sess.worldTurnReceipts.length,
                outcome: sess.history.at(-1)?.actionOutcomes?.[0]?.status,
                text: sess.history.at(-1)?.text },
                calls: window.__p0AuditFetchCalls,
                error: document.getElementById('world-turn-error-text')?.textContent };
        });
        assert.equal(movedReroll.before.stateSource, 'engine_preflight_linked',
            JSON.stringify(movedReroll.before));
        assert.equal(movedReroll.before.location, 'hall');
        assert.equal(movedReroll.calls, movedReroll.before.calls + 1);
        assert.equal(movedReroll.after.location, 'hall');
        assert.equal(movedReroll.after.version, movedReroll.before.version);
        assert.equal(movedReroll.after.history, movedReroll.before.history);
        assert.equal(movedReroll.after.receipts, movedReroll.before.receipts);
        assert.equal(movedReroll.after.outcome, 'succeeded');
        assert.equal(movedReroll.error, '');
        await page.reload();
        await page.waitForFunction(() => getCurrentWorldSession()?.playerLocation === 'hall');
        const movedRerollReload = await page.evaluate(() => {
            const sess = getCurrentWorldSession();
            return { location: sess.playerLocation, version: sess.worldStateVersion,
                text: sess.history.at(-1)?.text };
        });
        assert.deepEqual(movedRerollReload, { location: 'hall',
            version: movedReroll.before.version, text: movedReroll.after.text });
        const compoundMove = await page.evaluate(async () => {
            const world = state.worlds.find(item => item.id === 'p0_preflight_fixture');
            const sess = getCurrentWorldSession();
            world.outputLanguage = 'de';
            state.apiKey = 'offline';
            state.globalSettings.apiProvider = 'local';
            state.globalSettings.localBaseUrl = 'http://127.0.0.1:1234/v1';
            let calls = 0, request = null;
            const originalFetch = window.fetch;
            window.fetch = async (url, options) => {
                if (!String(url).includes('/chat/completions'))
                    return originalFetch(url, options);
                calls++;
                request = JSON.parse(options.body);
                return new Response(JSON.stringify({ choices: [{ message: {
                    content: 'Du betrittst die Küche und sagst: „Ready.“' } }] }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } });
            };
            const before = { version: sess.worldStateVersion,
                history: sess.history.length, receipts: sess.worldTurnReceipts.length };
            document.getElementById('world-user-input').value =
                'I move to the Küche and say "Ready."';
            await executeWorldTurn();
            const receipt = sess.worldTurnReceipts.at(-1)?.receipt;
            return { before, after: { version: sess.worldStateVersion,
                history: sess.history.length, receipts: sess.worldTurnReceipts.length,
                location: sess.playerLocation, text: sess.history.at(-1)?.text,
                outcomes: sess.history.at(-1)?.actionOutcomes?.map(item => item.status),
                debug: worldDebugEntries(world, sess)[0] },
                calls, maxTokens: request?.max_tokens,
                promptCharacters: JSON.stringify(request?.messages || []).length,
                effects: receipt?.confirmed_effects?.map(item => item.type),
                speech: receipt?.speech_attributions?.map(item => item.statement),
                speechAttributions: sess.history.at(-1)?.speechAttributions };
        });
        assert.equal(compoundMove.calls, 1);
        assert(compoundMove.maxTokens <= 140);
        assert(compoundMove.promptCharacters < 2500);
        assert.equal(compoundMove.after.version, compoundMove.before.version + 1);
        assert.equal(compoundMove.after.history, compoundMove.before.history + 2);
        assert.equal(compoundMove.after.receipts, compoundMove.before.receipts + 1);
        assert.equal(compoundMove.after.location, 'kitchen');
        assert.deepEqual(compoundMove.after.outcomes, ['succeeded', 'succeeded']);
        assert(compoundMove.effects.includes('actor_move'));
        assert.deepEqual(compoundMove.speech, ['Ready.']);
        assert.deepEqual(compoundMove.speechAttributions?.map(item => item.statement), ['Ready.']);
        assert.equal(compoundMove.after.text, 'Du betrittst die Küche und sagst: „Ready.“');
        assert.equal(compoundMove.after.debug?.processingPath, 'deterministic');
        const compoundFallback = await page.evaluate(async () => {
            const world = state.worlds.find(item => item.id === 'p0_preflight_fixture');
            const sess = getCurrentWorldSession();
            let calls = 0;
            const originalFetch = window.fetch;
            window.fetch = async (url, options) => {
                if (!String(url).includes('/chat/completions'))
                    return originalFetch(url, options);
                calls++;
                return new Response(JSON.stringify({ choices: [{ message: {
                    content: 'Du erreichst den Flur.' } }] }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } });
            };
            const before = { version: sess.worldStateVersion,
                receipts: sess.worldTurnReceipts.length };
            document.getElementById('world-user-input').value =
                'Ich bewege mich in den Flur und sage "Weiter."';
            await executeWorldTurn();
            return { before, location: sess.playerLocation,
                version: sess.worldStateVersion,
                receipts: sess.worldTurnReceipts.length,
                outcomes: sess.history.at(-1)?.actionOutcomes?.map(item => item.status),
                text: sess.history.at(-1)?.text,
                speech: sess.worldTurnReceipts.at(-1)?.receipt?.speech_attributions
                    ?.map(item => item.statement),
                calls, repairs: worldDebugEntries(world, sess)[0]?.repairCount };
        });
        assert.equal(compoundFallback.calls, 1);
        assert.equal(compoundFallback.location, 'hall');
        assert.equal(compoundFallback.version, compoundFallback.before.version + 1);
        assert.equal(compoundFallback.receipts, compoundFallback.before.receipts + 1);
        assert.deepEqual(compoundFallback.outcomes, ['succeeded', 'succeeded']);
        assert.deepEqual(compoundFallback.speech, ['Weiter.']);
        assert.equal(compoundFallback.text, 'Du erreichst Flur.\n\nDu sagst: „Weiter.“');
        assert.equal(compoundFallback.repairs || 0, 0);
        const compoundReroll = await page.evaluate(async () => {
            const sess = getCurrentWorldSession();
            const before = { version: sess.worldStateVersion,
                receipts: sess.worldTurnReceipts.length,
                history: sess.history.length };
            await executeWorldTurn(true);
            return { before, after: { version: sess.worldStateVersion,
                receipts: sess.worldTurnReceipts.length,
                history: sess.history.length, location: sess.playerLocation,
                text: sess.history.at(-1)?.text,
                speech: sess.history.at(-1)?.speechAttributions?.map(item => item.statement) } };
        });
        assert.equal(compoundReroll.after.version, compoundReroll.before.version);
        assert.equal(compoundReroll.after.receipts, compoundReroll.before.receipts);
        assert.equal(compoundReroll.after.history, compoundReroll.before.history);
        assert.equal(compoundReroll.after.location, 'hall');
        assert.equal(compoundReroll.after.text, 'Du erreichst Flur.\n\nDu sagst: „Weiter.“');
        assert.deepEqual(compoundReroll.after.speech, ['Weiter.']);
        const compoundLanguages = await page.evaluate(async () => {
            const world = state.worlds.find(item => item.id === 'p0_preflight_fixture');
            const sess = getCurrentWorldSession();
            const requests = [];
            const originalFetch = window.fetch;
            window.fetch = async (url, options) => {
                if (!String(url).includes('/chat/completions'))
                    return originalFetch(url, options);
                requests.push(JSON.parse(options.body));
                return new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } });
            };
            const turns = [];
            for (const [language, input] of [
                ['fr', 'I move to the Küche and say "Ready."'],
                ['es', 'Ich bewege mich in den Flur und sage "Vamos."'],
                ['en', 'Ich bewege mich in die Küche und sage "Los."']
            ]) {
                world.outputLanguage = language;
                document.getElementById('world-user-input').value = input;
                await executeWorldTurn();
                turns.push({ language, location: sess.playerLocation,
                    text: sess.history.at(-1)?.text,
                    outcomes: sess.history.at(-1)?.actionOutcomes?.map(item => item.status),
                    speech: sess.worldTurnReceipts.at(-1)?.receipt?.speech_attributions
                        ?.map(item => item.statement),
                    prompt: requests.at(-1)?.messages?.[0]?.content,
                    packet: JSON.parse(requests.at(-1)?.messages?.[1]?.content || '{}') });
            }
            return { turns, calls: requests.length };
        });
        assert.equal(compoundLanguages.calls, 3);
        assert.deepEqual(compoundLanguages.turns.map(turn => turn.location),
            ['kitchen', 'hall', 'kitchen']);
        assert.deepEqual(compoundLanguages.turns.map(turn => turn.text), [
            'Vous arrivez à Küche.\n\nVous dites : « Ready. »',
            'Llegas a Flur.\n\nDices: «Vamos.»',
            'You reach Küche.\n\nYou say, “Los.”'
        ]);
        assert(compoundLanguages.turns.every(turn =>
            turn.outcomes?.join(',') === 'succeeded,succeeded'
            && turn.packet?.outputLanguage === turn.language
            && turn.packet?.confirmedSpeech === turn.speech?.[0]));
        assert.match(compoundLanguages.turns[0].prompt, /in French/);
        assert.match(compoundLanguages.turns[1].prompt, /in Spanish/);
        assert.match(compoundLanguages.turns[2].prompt, /in English/);
        const compoundRollback = await page.evaluate(async () => {
            const sess = getCurrentWorldSession();
            const before = { location: sess.playerLocation,
                version: sess.worldStateVersion, history: sess.history.length,
                receipts: sess.worldTurnReceipts.length,
                speech: sess.history.at(-1)?.speechAttributions?.map(item => item.statement) };
            const originalCommit = commitWorldMigrationAware;
            commitWorldMigrationAware = async () => {
                throw new Error('p0_compound_storage_failure');
            };
            try {
                document.getElementById('world-user-input').value =
                    'I move to the Flur and say "Stop."';
                await executeWorldTurn();
            } finally { commitWorldMigrationAware = originalCommit; }
            return { before, after: { location: sess.playerLocation,
                version: sess.worldStateVersion, history: sess.history.length,
                receipts: sess.worldTurnReceipts.length,
                speech: sess.history.at(-1)?.speechAttributions?.map(item => item.statement) } };
        });
        assert.deepEqual(compoundRollback.after, compoundRollback.before,
            'failed compound persistence must roll back movement and speech together');
        await page.reload();
        await page.waitForFunction(() => getCurrentWorldSession()?.playerLocation === 'kitchen');
        const compoundReload = await page.evaluate(() => {
            const sess = getCurrentWorldSession();
            return { location: sess.playerLocation,
                text: sess.history.at(-1)?.text,
                speech: sess.history.at(-1)?.speechAttributions?.map(item => item.statement) };
        });
        assert.deepEqual(compoundReload, { location: 'kitchen',
            text: 'You reach Küche.\n\nYou say, “Los.”', speech: ['Los.'] });
        const falseNpcNarration = await page.evaluate(async () => {
            const world = state.worlds.find(item => item.id === 'p0_preflight_fixture');
            const sess = getCurrentWorldSession();
            world.outputLanguage = 'de';
            world.entities.push({ id: 'linda', name: 'Linda', type: 'npc',
                startLocation: 'kitchen' });
            sess.entityStates ||= {};
            sess.entityStates.linda = { location: 'kitchen', status: 'alive' };
            state.apiKey = 'offline';
            state.globalSettings.apiProvider = 'local';
            state.globalSettings.localBaseUrl = 'http://127.0.0.1:1234/v1';
            const originalFetch = window.fetch;
            let calls = 0;
            window.fetch = async (url, options) => {
                if (!String(url).includes('/chat/completions'))
                    return originalFetch(url, options);
                calls++;
                return new Response(JSON.stringify({ choices: [{ message: {
                    content: 'Du betrittst den Flur. Linda steht plötzlich neben dir.' } }] }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } });
            };
            document.getElementById('world-user-input').value = 'Ich gehe in den Flur.';
            await executeWorldTurn();
            return { calls, player: sess.playerLocation,
                npc: sess.entityStates.linda.location,
                text: sess.history.at(-1)?.text,
                outcome: sess.history.at(-1)?.actionOutcomes?.[0]?.status,
                receiptEffects: sess.worldTurnReceipts.at(-1)?.receipt?.confirmed_effects
                    ?.map(item => item.type) };
        });
        assert.equal(falseNpcNarration.calls, 1);
        assert.equal(falseNpcNarration.player, 'hall');
        assert.equal(falseNpcNarration.npc, 'kitchen');
        assert.equal(falseNpcNarration.outcome, 'succeeded');
        assert.deepEqual(falseNpcNarration.receiptEffects, ['actor_move']);
        assert.equal(falseNpcNarration.text, 'Du erreichst Flur.');
        const parallelExit = await page.evaluate(async () => {
            const world = state.worlds.find(item => item.id === 'p0_preflight_fixture');
            const sess = getCurrentWorldSession();
            world.locations.find(place => place.id === 'hall').exits = [
                { targetLocationId: 'kitchen', text: 'long passage', travelTime: 12 },
                { targetLocationId: 'kitchen', text: 'short passage', travelTime: 2 }
            ];
            const beforeMinute = getWorldTimeData(world, sess).currentTotalMinutes;
            const beforeVersion = sess.worldStateVersion;
            renderWorldPlayState();
            const labels = [...document.querySelectorAll('#world-exits-list button')]
                .map(button => button.textContent);
            document.querySelectorAll('#world-exits-list button')[0].click();
            await new Promise((resolve, reject) => {
                const started = Date.now();
                const poll = () => sess.worldStateVersion > beforeVersion ? resolve()
                    : Date.now() - started > 10000 ? reject(new Error('parallel_exit_timeout'))
                        : setTimeout(poll, 25);
                poll();
            });
            return { labels, location: sess.playerLocation,
                minutes: getWorldTimeData(world, sess).currentTotalMinutes - beforeMinute,
                status: sess.history.at(-1)?.actionOutcomes?.[0]?.status,
                effects: sess.worldTurnReceipts.at(-1)?.receipt?.confirmed_effects || [] };
        });
        assert.equal(parallelExit.location, 'kitchen');
        assert.equal(parallelExit.status, 'succeeded');
        assert(parallelExit.minutes >= 12, JSON.stringify(parallelExit));
        assert(parallelExit.labels[0].includes('long passage'));
        assert(parallelExit.labels[1].includes('short passage'));
        assert(parallelExit.effects.some(effect => effect.type === 'actor_move'
            && effect.payload?.exit_index === 0), JSON.stringify(parallelExit.effects));
        const modelTravelPreflight = await page.evaluate(() => {
            const world = safeJsonClone(state.worlds.find(item =>
                item.id === 'p0_preflight_fixture'));
            const sess = safeJsonClone(getCurrentWorldSession());
            world.locations.find(place => place.id === 'kitchen').exits = [{
                targetLocationId: 'hall', requiredItem: 'Bronze key', lockState: 'locked' }];
            sess.inventory = [];
            const step = request => ({ kind: 'travel', request, action_effects: {} });
            const blocked = worldLinkedTravelPreflight(world, sess,
                step('I head toward the Flur.'));
            const redundant = worldLinkedTravelPreflight(world, sess,
                step('Je retourne à la Küche.'));
            sess.inventory = [{ name: 'Bronze key', quantity: 1 }];
            const allowed = worldLinkedTravelPreflight(world, sess,
                step('I head toward the Flur.'));
            world.locations.push({ id: 'cellar', name: 'Cellar', exits: [] });
            const ambiguous = worldLinkedTravelPreflight(world, sess,
                step('I consider the Flur and the Cellar.'));
            return { blocked: blocked?.status, redundant: redundant?.status,
                allowed: allowed?.status, ambiguous: ambiguous?.status || null };
        });
        assert.deepEqual(modelTravelPreflight, { blocked: 'blocked',
            redundant: 'already_satisfied', allowed: 'succeeded', ambiguous: null });
        const costSafety = await page.evaluate(() => {
            const world = safeJsonClone(state.worlds.find(item =>
                item.id === 'p0_preflight_fixture'));
            const sess = safeJsonClone(getCurrentWorldSession());
            const source = world.locations.find(place => place.id === 'kitchen');
            const target = world.locations.find(place => place.id === 'hall');
            source.exits = [{ targetLocationId: 'hall', cost: '2 coins', travelTime: 1 }];
            const verdict = worldLinkedMovementVerdict(world, sess, 'player',
                'kitchen', 'hall');
            const clicked = movePlayerAlongWorldPath(world, sess, target,
                { exit: source.exits[0], showTravelToast: false });
            source.exits.push({ targetLocationId: 'hall', travelTime: 9 });
            const freeLeg = getWorldTravelLeg(world, 'kitchen', 'hall', sess);
            return { verdict: verdict.reason, clicked: clicked.reason,
                location: sess.playerLocation, freeTime: freeLeg?.travelTime,
                freeCost: freeLeg?.cost };
        });
        assert.deepEqual(costSafety, { verdict: 'unpriced_route_cost',
            clicked: 'unpriced_route_cost', location: 'kitchen', freeTime: 9,
            freeCost: '' });
        const multiLeg = await page.evaluate(async () => {
            const world = state.worlds.find(item => item.id === 'p0_preflight_fixture');
            const sess = getCurrentWorldSession();
            world.locations.find(place => place.id === 'kitchen').exits = [
                { targetLocationId: 'hall', travelTime: 3 }];
            world.locations.find(place => place.id === 'hall').exits = [
                { targetLocationId: 'garden', travelTime: 4 }];
            world.locations.push({ id: 'garden', name: 'Garten',
                description: 'Ein stiller Garten.', exits: [] });
            const before = { location: sess.playerLocation,
                version: sess.worldStateVersion,
                minute: getWorldTimeData(world, sess).currentTotalMinutes };
            const beforeSession = safeJsonClone(sess);
            const preflight = resolveWorldTurnIntentP0(world, sess,
                'Ich gehe in den Garten.');
            const preparedDraft = buildWorldDeterministicMoveDraft(world, sess,
                preflight, 'Ich gehe in den Garten.', !!world.kernel?.serverBindings);
            document.getElementById('world-user-input').value = 'Ich gehe in den Garten.';
            await executeWorldTurn();
            const receipt = sess.worldTurnReceipts.at(-1)?.receipt;
            return { before, preflightStatus: preflight.status,
                preparedDraft: !!preparedDraft,
                location: sess.playerLocation,
                version: sess.worldStateVersion,
                minutes: getWorldTimeData(world, sess).currentTotalMinutes - before.minute,
                calls: worldDebugEntries(world, sess)[0]?.calls?.length,
                outcomes: sess.history.at(-1)?.actionOutcomes?.map(item => item.status),
                moves: receipt?.confirmed_effects?.filter(item => item.type === 'actor_move')
                    .map(item => item.payload?.to_location_id),
                freeConflicts: worldConfirmedMovementNarrativeConflicts(world,
                    beforeSession, sess, { ...preflight, status: 'succeeded' },
                    'Du läufst durch den Rundraum und trittst in den kleinen Garten hinaus. Die Luft duftet frisch und grüne Blätter rascheln leise im Wind.')
                    .map(item => item.reason),
                routeConflicts: worldConfirmedMovementNarrativeConflicts(world,
                    beforeSession, sess, { ...preflight, status: 'succeeded' },
                    'Du gehst durch die Küche und den Flur und erreichst den Garten.')
                    .map(item => item.reason),
                falseReturnConflicts: worldConfirmedMovementNarrativeConflicts(world,
                    beforeSession, sess, { ...preflight, status: 'succeeded' },
                    'Du erreichst den Garten und kehrst danach in die Küche zurück.')
                    .map(item => item.reason),
                error: document.getElementById('world-turn-error-text')?.textContent };
        });
        assert.equal(multiLeg.location, 'garden', JSON.stringify(multiLeg));
        assert.equal(multiLeg.preflightStatus, 'executable');
        assert.equal(multiLeg.preparedDraft, true);
        assert.equal(multiLeg.version, multiLeg.before.version + 1);
        assert.equal(multiLeg.minutes, 7);
        assert.equal(multiLeg.calls, 1);
        assert.deepEqual(multiLeg.moves, ['hall', 'garden']);
        assert.deepEqual(multiLeg.outcomes, ['succeeded']);
        assert.deepEqual(multiLeg.freeConflicts, []);
        assert.deepEqual(multiLeg.routeConflicts, []);
        assert(multiLeg.falseReturnConflicts.includes('uncommitted_player_location_claim'));
        console.log(`PASS P0 no-op, keyed, timed, missing and one-way browser turns: one short narrative call each, no receipt repair; reload stable; durations ${[result.first, result.blocked, result.moved, result.returned, result.timed, result.locked, result.emptyKey, result.keyed, result.missing, result.oneWayOut, result.oneWayReturn].map(item => item.debug.durationMs).join(' / ')} ms; timed minutes ${result.timed.minutes}; first narrative ${JSON.stringify(result.first.last)}`);
        await context.close();
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
