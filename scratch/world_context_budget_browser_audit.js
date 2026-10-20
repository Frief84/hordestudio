/* Scripted Worlds turns in isolated browser storage; no live model requests. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(process.env.HORDE_APP_ROOT || path.resolve(__dirname, '..'));

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext();
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.pathname === '/worlds/bind-turn') {
                const headers = { 'access-control-allow-origin': '*',
                    'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
                if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
                const result = spawnSync(process.execPath, [path.join(root, 'worlds/turn-binding-worker.js')],
                    { input: route.request().postData(), encoding: 'utf8' });
                return route.fulfill({ status: 200, contentType: 'application/json', headers, body: result.stdout });
            }
            if (url.hostname !== 'world-context-budget.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
                return route.fulfill({ status: 404, body: '' });
            return route.fulfill({ contentType: { '.html': 'text/html', '.js': 'text/javascript',
                '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
        });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('https://world-context-budget.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
        const results = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer);
            await Promise.all([saveStateInFlight, worldSaveInFlight].filter(Boolean));
            state.apiKey = 'offline'; state.globalSettings.apiProvider = 'openrouter';
            const realFetch = window.fetch, rows = [];
            for (const scenario of ['small', 'dense', 'shifted', 'repair', 'mixed']) {
                const dense = scenario !== 'small';
                const locations = dense ? Array.from({ length: 18 }, (_, index) => ({
                    id: index ? `room_${index}` : 'office', name: index ? `Room ${index}` : 'Office',
                    description: index ? `Authored room ${index} with its own ledger.`
                        : 'An old office lined with maps and ledgers. '.repeat(14),
                    exits: index ? [{ targetLocationId: 'office' }]
                        : Array.from({ length: 17 }, (_, edge) => ({ targetLocationId: `room_${edge + 1}`,
                            ...(edge === 0 ? { lockState: 'locked' } : {}) }))
                })) : [{ id: 'office', name: 'Office', description: 'A small office.', exits: [] }];
                const world = { id: `context_${scenario}`, name: 'Context Fixture', model: 'offline/model',
                    contextSize: 65536, maxTokens: 1024, startLocationId: 'office', locations,
                    entities: [{ id: 'linda', name: 'Linda', type: 'npc', startLocation: 'office', persona: 'Archivist' }],
                    kernel: { enabled: true, memoryMode: 'ledger', sceneDrafts: true },
                    gameRules: { modules: { livingWorld: true, relationships: false } },
                    hudConfig: { startTimeHours: 9, startTimeMinutes: 0, timeStep: 5 } };
                if (scenario === 'mixed') world.kernel.sceneDraftProtocol = 'scene_draft_v2';
                if (dense) {
                    world.entities.push(...Array.from({ length: 7 }, (_, index) => ({
                        id: `witness_${index}`, name: `Witness ${index}`, type: 'npc', startLocation: 'office',
                        persona: `Keeps independent notes ${index}. `.repeat(8) })));
                    world.lorebook = Array.from({ length: 12 }, (_, index) => ({
                        keyword: `Ledger clue ${index}`,
                        text: `The office records route ${index} and its owner.`,
                        knowledge: { visibility: 'public' }, about: [{ kind: 'location', id: 'office' }]
                    }));
                }
                state.worlds = [world]; state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
                state.activeWorldId = world.id;
                const sess = prepareCurrentWorldSession(); sess.setupComplete = true;
                if (scenario === 'mixed') {
                    sess.history.push({ id: 'old_v2_story', role: 'dm', text: 'Linda remembers the old map.',
                        location: 'office', sceneMemory: { receiptId: 'old_v2', location: 'office', turn: 1,
                            records: [{ kind: 'testimony', actor: 'linda', text: 'The old map is intact.' }] } });
                    sess.ledger = 'The old map is intact.';
                    sess.entityStates.linda.observations = [{ text: 'Linda saw the old map.', sourceType: 'witnessed' }];
                    sess.npcRelationships = { 'linda|player': { score: 42 } };
                }
                for (let index = 0; dense && index < 7; index++)
                    sess.entityStates[`witness_${index}`].location = 'office';
                if (scenario === 'shifted') {
                    sess.playerLocation = 'room_1'; sess.entityStates.linda.location = 'room_1';
                }
                if (dense) {
                    sess.ledger = Array.from({ length: 18 }, (_, index) =>
                        `Ledger line ${index}: Linda keeps the letter under review.`).join('\n');
                    sess.ledgerArchive = [{ lines: sess.ledger.split('\n').slice(0, 10) }];
                    sess.scheduledEvents = [{ id: 'open_meeting', title: 'Open meeting', status: 'scheduled',
                        dueMinute: 2100, locationId: sess.playerLocation, sourceReceiptId: 'old_receipt' }];
                    for (let index = 0; index < 26; index++) sess.history.push(
                        { id: `u${index}`, role: 'user', text: `Who remembers letter ${index}?`,
                            location: index < 20 ? 'office' : sess.playerLocation },
                        { id: `d${index}`, role: 'dm', text: `Linda catalogued letter ${index}.`,
                            location: index < 20 ? 'office' : sess.playerLocation,
                            sceneMemory: { receiptId: `r${index}`, location: 'office', turn: index,
                                records: [{ kind: 'event', actor: 'linda', text: index === 3
                                    ? 'The silver compass was catalogued with letter 3.'
                                    : `Letter ${index} was catalogued.` }] } });
                    sess.entityStates.linda.observations = [{ text: 'Linda promised to bring the silver compass.',
                        sourceType: 'witnessed', confidence: 1 }];
                }
                switchView('worldPlay'); renderWorldPlayState();
                const input = scenario === 'repair' ? 'I nod to Linda.' : scenario === 'mixed'
                    ? 'What does the old map show?' : 'What happened to the silver compass?';
                const good = { protocol: 'scene_draft_v3', actions: [{ kind: 'question', status: 'answered',
                    effects: [], response: [{ text: 'Linda answers from her records.' }] }] };
                const bad = { protocol: 'scene_draft_v3', actions: [{ kind: 'gesture', status: 'resolved',
                    effects: { relation_set: [{ subject_id: 'linda', target_id: 'player', value: 70 }] },
                    response: [{ text: 'Linda nods back.' }] }] };
                const v2 = { protocol: 'scene_draft_v2',
                    narrative: [{ id: 'p1', text: 'Linda explains the old map.' }],
                    actions: [{ request: input, kind: 'question', status: 'answered', response_id: 'p1' }],
                    events: [], effects: {}, speech: [], commitments: [] };
                const v3 = { protocol: 'scene_draft_v3', actions: [{ kind: 'physical', status: 'resolved',
                    effects: { outfit_set: [{ actor_id: 'player', outfit: 'red cloak' }] },
                    response: [{ text: 'You put on the red cloak.', events: [{ type: 'outfit',
                        actor_id: 'player', status: 'completed', outfit: 'red cloak' }] }] }],
                    reactions: [{ text: 'Linda puts on a blue coat.',
                        effects: { outfit_set: [{ actor_id: 'linda', outfit: 'blue coat' }] },
                        events: [{ type: 'outfit', actor_id: 'linda', status: 'completed', outfit: 'blue coat' }] }] };
                let calls = 0;
                const bodies = [];
                window.fetch = async (url, options = {}) => {
                    if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                    const body = JSON.parse(options.body); bodies.push(body); calls++;
                    const draft = scenario === 'mixed' ? (calls === 1 ? v2 : v3)
                        : scenario === 'repair' && calls === 1 ? bad : good;
                    const raw = JSON.stringify(draft);
                    if (body.stream) return new Response(`data: ${JSON.stringify({ choices: [{
                        delta: { content: raw }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
                    { headers: { 'Content-Type': 'text/event-stream' } });
                    return new Response(JSON.stringify({ choices: [{ message: { content: raw } }],
                        usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 } }),
                    { headers: { 'Content-Type': 'application/json' } });
                };
                document.getElementById('world-user-input').value = input;
                await executeWorldTurn();
                const firstTurn = scenario === 'mixed' ? { calls, audit: safeJsonClone(sess.history.at(-1)?.callAudit),
                    error: document.getElementById('world-turn-error-text')?.textContent,
                    latest: sess.history.at(-1)?.text } : null;
                if (scenario === 'mixed') {
                    world.kernel.sceneDraftProtocol = 'scene_draft_v3';
                    document.getElementById('world-user-input').value = 'I put on the red cloak.';
                    await executeWorldTurn();
                }
                const last = sess.history.at(-1), prompt = bodies[0]?.messages?.map(message => message.content).join('\n') || '';
                rows.push({ scenario, calls, accepted: last?.role === 'dm' && last?.stateSource !== 'frozen_no_receipt',
                    audit: safeJsonClone(last?.callAudit), inputRetained: document.getElementById('world-user-input').value === input,
                    prompt, requestCharacters: bodies.map(body => JSON.stringify({ messages: body.messages,
                        tools: body.tools, response_format: body.response_format }).length),
                    saved: !!(await HordeDB.get(`worldInstance:${world.id}`))?.sessions?.some(item => item.id === sess.id),
                    sessionId: sess.id, worldId: world.id, historyCount: sess.history.length,
                    protocols: (sess.worldTurnReceipts || []).map(item => item.audit?.protocol || item.receipt?.protocol),
                    firstTurn,
                    state: { location: sess.playerLocation, ledger: sess.ledger || '',
                        commitments: safeJsonClone(sess.scheduledEvents || []), observations: safeJsonClone(sess.entityStates.linda.observations || []),
                        relationship: safeJsonClone(sess.npcRelationships || {}), playerOutfit: sess.outfit,
                        npcOutfit: sess.entityStates.linda.outfit } });
            }
            window.fetch = realFetch;
            return rows;
        });
        if (process.env.HORDE_CONTEXT_DUMP)
            fs.writeFileSync(process.env.HORDE_CONTEXT_DUMP,
                results.find(row => row.scenario === 'shifted').prompt);
        assert.deepEqual(errors, []);
        for (const row of results) {
            assert(row.accepted && row.saved, JSON.stringify({ scenario: row.scenario, calls: row.calls,
                inputRetained: row.inputRetained }));
            assert.equal(row.calls, ['repair', 'mixed'].includes(row.scenario) ? 2 : 1,
                `${row.scenario} ${JSON.stringify({ protocols: row.protocols, firstTurn: row.firstTurn,
                    audit: row.audit }).slice(0, 2000)}`);
            if (!['small', 'mixed'].includes(row.scenario)) {
                assert(row.prompt.includes('Open meeting'), 'open commitment reaches the model');
                assert(row.prompt.includes('silver compass'), 'NPC memory reaches the model');
                assert(row.prompt.includes('The office records route 0 and its owner.'), 'relevant lore reaches the model');
                assert(row.prompt.includes('room_1'), 'spatial access reaches the model');
                assert(row.prompt.includes('allowed_next'), 'actor-specific access reaches the model');
                if (row.scenario !== 'shifted') assert(row.prompt.includes('"currentState":"locked"'),
                    'locked route state reaches the model');
                if (row.scenario !== 'repair') assert(row.prompt.includes(
                    'The silver compass was catalogued with letter 3.'), 'old scene recall reaches the model');
            }
        }
        const mixed = results.find(row => row.scenario === 'mixed');
        assert.equal(mixed.state.playerOutfit, 'red cloak');
        assert.equal(mixed.state.npcOutfit, 'blue coat');
        assert(mixed.protocols.includes('scene_draft_v2') && mixed.protocols.includes('scene_draft_v3'),
            `mixed V2/V3 receipts retained: ${JSON.stringify(mixed.protocols)}`);
        await page.reload();
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
        const reloaded = await page.evaluate(async ({ worldId, sessionId }) => {
            clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer);
            const world = state.worlds.find(item => item.id === worldId);
            const session = state.worldInstances?.[worldId]?.sessions?.find(item => item.id === sessionId);
            const saved = (await HordeDB.get(`worldInstance:${worldId}`))?.sessions?.find(item => item.id === sessionId);
            return { world: !!world, session: !!session, saved: !!saved,
                oldHistory: session?.history?.some(item => item.id === 'old_v2_story'),
                protocols: (session?.worldTurnReceipts || []).map(item => item.audit?.protocol || item.receipt?.protocol),
                state: { ledger: session?.ledger, observations: session?.entityStates?.linda?.observations,
                    relationship: session?.npcRelationships, playerOutfit: session?.outfit,
                    npcOutfit: session?.entityStates?.linda?.outfit },
                historyCount: session?.history?.length };
        }, { worldId: mixed.worldId, sessionId: mixed.sessionId });
        assert(reloaded.world && reloaded.session && reloaded.saved && reloaded.oldHistory);
        assert.deepEqual(reloaded.protocols, mixed.protocols);
        assert.equal(reloaded.historyCount, mixed.historyCount);
        for (const key of ['ledger', 'observations', 'relationship', 'playerOutfit', 'npcOutfit'])
            assert.deepEqual(reloaded.state[key], mixed.state[key], `reload changed ${key}`);
        console.log('CONTEXT_METRICS', JSON.stringify(results.map(row => ({ scenario: row.scenario,
            calls: row.calls, repairs: row.audit?.receiptRepair || 0,
            mainCharacters: row.requestCharacters[0],
            repairCharacters: row.scenario === 'repair' ? row.requestCharacters[1] : null,
            sources: row.audit?.metrics?.contextSources || null }))));
        console.log('PASS Worlds context budget fixtures, first pass, repair and memory reachability');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
