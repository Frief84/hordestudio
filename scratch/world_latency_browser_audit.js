/** Real World turn pipeline, isolated browser storage and scripted HTTP only. */
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
            if (url.hostname !== 'world-latency.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
                return route.fulfill({ status: 404, body: '' });
            return route.fulfill({ contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
        });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('https://world-latency.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
        const results = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer);
            state.apiKey = 'offline'; state.globalSettings.apiProvider = 'openrouter';
            const realFetch = window.fetch, results = [];
            for (const scenario of ['show', 'approach', 'gesture', 'tap', 'smile', 'cosmetic_condition',
                'fenced_crlf', 'truncated_json_repair', 'truncated_json_bad', 'malformed_json_repair',
                'missing_item', 'absent_actor', 'give',
                'early_tool', 'early_content', 'bad_twice', 'stale', 'tagged', 'plain_json', 'no_tools', 'local', 'local_no_schema', 'legacy', 'old_memory', 'old_prose',
                'compound', 'compound_repair', 'compound_bad', 'two_actions_repair', 'two_actions_bad',
                'current_state', 'three_exits', 'commitment_repair', 'resolution_repair', 'invalid_proof_repair',
                'missing_condition_repair', 'missing_condition_bad', 'missing_condition_action_repair',
                'unknown_condition_repair',
                'drag_success', 'drag_escort_repair', 'door_lock_success', 'door_lock_compound_bad', 'door_lock_compound_repair', 'door_lock_aggregate_bad', 'door_lock_repair',
                'door_lock_oneway_repair', 'door_lock_reroll', 'door_lock_wrong_key']) {
                const world = { id: `latency_${scenario}`, name: 'Office', model: 'offline/model',
                    contextSize: 32768, maxTokens: 2048, dmPrompt: 'Linda waits in the office.',
                    startLocationId: 'office', locations: [{ id: 'office', name: 'Office', exits: [] }],
                    entities: [{ id: 'linda', name: 'Linda', type: 'npc', startLocation: 'office', persona: 'Archivist' }],
                    kernel: { sceneDrafts: true, ...(scenario === 'legacy' ? { sceneDraftProtocol: 'scene_draft_v2' } : {}) },
                    gameRules: { profileId: 'adventure', modules: { inventory: true } },
                    hudConfig: { startTimeHours: 9, startTimeMinutes: 0, timeStep: 5 } };
                if (scenario === 'three_exits') {
                    world.startLocationId = 'round';
                    world.locations = [
                        { id: 'round', name: 'Round Room', exits: [
                            { targetLocationId: 'ante', travelTime: 1 },
                            { targetLocationId: 'hall', travelTime: 1 },
                            { targetLocationId: 'stairs', travelTime: 1 }] },
                        { id: 'ante', name: 'Antechamber', exits: [{ targetLocationId: 'round', travelTime: 1 }] },
                        { id: 'hall', name: 'West Hall', exits: [{ targetLocationId: 'round', travelTime: 1 }] },
                        { id: 'stairs', name: 'Lower Stairs', exits: [{ targetLocationId: 'round', travelTime: 1 }] }
                    ];
                }
                if (scenario.startsWith('drag_')) world.locations = [
                    { id: 'office', name: 'Office', exits: [{ targetLocationId: 'hex', travelTime: 1 }] },
                    { id: 'hex', name: 'Hexagonal Room', exits: [{ targetLocationId: 'office', travelTime: 1 }] }
                ];
                if (scenario.startsWith('door_lock_')) world.locations = [
                    { id: 'office', name: 'Cell', exits: [{ targetLocationId: 'ante', lockState: 'locked',
                        requiredItem: 'Cell key', travelTime: 1 }] },
                    { id: 'ante', name: 'Antechamber', exits: [{ targetLocationId: 'office',
                        lockState: 'locked', requiredItem: 'Cell key', travelTime: 1 }] }
                ];
                state.worlds = [world]; state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
                state.activeWorldId = world.id;
                state.globalSettings.apiProvider = scenario.startsWith('local') || scenario.startsWith('truncated')
                    || scenario === 'malformed_json_repair' ? 'local' : 'openrouter';
                state.globalSettings.localBaseUrl = 'http://127.0.0.1:1234/v1';
                const sess = prepareCurrentWorldSession(); sess.setupComplete = true;
                const targetedRoutes = scenario === 'three_exits'
                    ? buildWorldMovementOptions(world, sess, ['linda'], 'I go to the Antechamber') : null;
                sess.entityStates.linda.location = scenario === 'absent_actor' ? 'elsewhere'
                    : scenario === 'three_exits' ? 'round' : 'office';
                sess.inventory = scenario === 'missing_item' ? [] : ['letter'];
                if (scenario.startsWith('door_lock_')) sess.inventory = ['Cell key'];
                if (scenario.startsWith('door_lock_')) {
                    const door = worldForSession(world, sess).locations[0].exits[0];
                    sess.unlockedExits = { [door.doorId]: true };
                }
                if (scenario.includes('_condition_')) {
                    sess.entityStates.linda.conditions = ['Restrained'];
                    sess.entityStates.linda.currentActivity = 'Cuffed overhead on a taut chain';
                }
                if (scenario === 'current_state') {
                    world.gameRules.modules.schedules = false;
                    sess.entityStates.linda.outfit = 'A green coat; the old red scarf has been removed.';
                    sess.entityStates.linda.conditions = [];
                    sess.entityStates.linda.currentActivity = 'Standing by the desk. '.repeat(12) + 'Her hands are now free.';
                }
                for (let i = 0; i < 8; i++) sess.history.push(
                    { id: `u${i}`, role: 'user', text: `Old question ${i}.`, location: 'office' },
                    { id: `d${i}`, role: 'dm', text: `Old answer ${i}.`, location: 'office',
                        sceneMemory: { receiptId: `r${i}`, location: 'office', turn: i,
                            records: [{ kind: 'event', text: `Old letter clue ${i}.` }] } });
                if (scenario === 'old_memory') {
                    sess.history[1].text = 'Linda promised to bring the silver compass after the festival.';
                    sess.history[1].sceneMemory = { receiptId: 'r0', location: 'garden', turn: 0,
                        records: [{ kind: 'testimony', actor: 'linda', listeners: ['player'], text: sess.history[1].text }] };
                }
                if (scenario === 'old_prose') {
                    sess.history[1].text = 'The festival password was marigold.';
                    sess.history[1].sceneMemory = { records: [] };
                    sess.history[1].witnesses = ['linda'];
                }
                switchView('worldPlay'); renderWorldPlayState();
                const input = scenario.startsWith('compound') ? 'I ask Linda her name and ask about the letter.'
                    : scenario.startsWith('two_actions') ? 'I knock on the desk and tap Linda on the shoulder.'
                    : scenario === 'old_memory' ? 'What had she promised?'
                    : scenario === 'old_prose' ? 'What was the festival password?'
                    : scenario === 'approach' ? 'I approach Linda.' : scenario === 'gesture' ? 'I wave.'
                    : ['smile', 'cosmetic_condition'].includes(scenario) ? 'I smile at Linda.'
                    : scenario === 'tap' ? 'I tap Linda on the shoulder.'
                    : scenario === 'give' ? 'I give Linda the letter.'
                    : scenario.startsWith('drag_') ? 'You take Linda by the arm and drag her to the Hexagonal Room'
                    : scenario === 'door_lock_wrong_key' ? 'You lock the door to the Antechamber with the Wooden key'
                    : ['door_lock_compound_bad', 'door_lock_aggregate_bad'].includes(scenario) ? 'You lock the door to the Antechamber with the Cell key and take the letter'
                    : scenario === 'door_lock_compound_repair' ? 'You lock the door to the Antechamber with the Cell key and tap Linda on the shoulder'
                    : scenario.startsWith('door_lock_') ? 'You lock the door to the Antechamber with the Cell key'
                    : ['commitment_repair', 'invalid_proof_repair'].includes(scenario)
                        ? 'I knock on the desk.'
                    : scenario.includes('_condition_')
                        ? "I loosen the chain above Linda's cuffs." : 'I show Linda the letter.';
                const narrative = scenario.startsWith('compound') ? 'Linda tells you her name and explains that the letter is addressed to her.'
                    : scenario.startsWith('two_actions') ? 'You knock on the desk; Linda looks up.'
                    : scenario === 'old_memory' ? 'Linda promised to bring the silver compass after the festival.'
                    : scenario === 'old_prose' ? 'The festival password was marigold.'
                    : scenario === 'approach' ? 'You approach Linda beside the desk.'
                    : ['smile', 'cosmetic_condition'].includes(scenario) ? 'You smile at Linda; she smiles back.'
                    : scenario === 'gesture' ? 'You wave; Linda smiles back.'
                    : scenario === 'tap' ? 'You tap Linda on the shoulder; she turns.'
                    : scenario === 'give' ? 'You give Linda the letter; she takes it from your hand.'
                    : scenario.startsWith('drag_') ? 'You take Linda by the arm and drag her into the Hexagonal Room.'
                    : scenario === 'door_lock_wrong_key' ? 'The Wooden key does not fit the Antechamber lock.'
                    : scenario.startsWith('door_lock_') ? 'The Cell key turns and locks the door to the Antechamber.'
                    : ['commitment_repair', 'invalid_proof_repair'].includes(scenario)
                        ? 'You knock on the desk; Linda looks up.'
                    : scenario.includes('_condition_')
                        ? 'You loosen the chain above Linda’s cuffs; the cuffs remain fastened overhead.'
                    : 'Linda studies the letter you hold up.';
                let calls = 0, cancelled = false, signalAborted = false, repairObservedCleanState = false;
                const inventoryNames = () => JSON.stringify(sess.inventory.map(item => typeof item === 'string' ? item : item.name));
                const requests = [], initialInventory = inventoryNames();
                const initialTurnEvents = JSON.stringify(sess.turnEvents || []);
                const initialVersion = sess.worldStateVersion || 0;
                const initialConditions = JSON.stringify(sess.entityStates.linda.conditions || []);
                window.fetch = async (url, options = {}) => {
                    if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                    calls++; if (calls > 3) throw Error('Unbounded correction');
                    const body = JSON.parse(options.body); requests.push(body);
                    if (scenario === 'old_memory' && !JSON.stringify(body.messages).includes('silver compass'))
                        throw Error('Old promise missing from actual provider prompt');
                    if (scenario === 'old_prose' && !JSON.stringify(body.messages).includes('marigold'))
                        throw Error('Old prose detail missing from actual provider prompt');
                    if (scenario === 'stale' && calls === 1) sess.worldStateVersion = (sess.worldStateVersion || 0) + 1;
                    if (scenario === 'no_tools' && calls === 1)
                        return new Response('{"error":{"message":"tools unsupported"}}', { status: 400 });
                    if (scenario === 'local_no_schema' && calls === 1)
                        return new Response('{"error":{"message":"response_format json_schema unsupported"}}', { status: 400 });
                    if (calls === 2) repairObservedCleanState = inventoryNames() === initialInventory
                        && JSON.stringify(sess.turnEvents || []) === initialTurnEvents
                        && (sess.worldStateVersion || 0) === initialVersion
                        && JSON.stringify(sess.entityStates.linda.conditions || []) === initialConditions
                        && !sess.history.some(m => m.text?.includes('UNVERIFIED'));
                    if ((scenario.startsWith('truncated_json_') && (calls === 1 || scenario === 'truncated_json_bad'))
                        || scenario === 'malformed_json_repair' && calls === 1) {
                        const content = scenario === 'malformed_json_repair' ? 'Here is some JSON:'
                            : '{"protocol":"scene_draft_v3","narrative":[';
                        return new Response(JSON.stringify({ choices: [{ message: { content },
                            finish_reason: scenario === 'malformed_json_repair' ? 'stop' : 'length' }] }),
                            { headers: { 'Content-Type': 'application/json' } });
                    }
                    const draft = { protocol: scenario === 'legacy' ? 'scene_draft_v2' : 'scene_draft_v3',
                        narrative: [{ id: 'p1', text: narrative }],
                        actions: [{ kind: scenario.startsWith('old_') || scenario.startsWith('compound') ? 'question' : 'physical',
                            status: scenario.startsWith('old_') || scenario.startsWith('compound') ? 'answered' : 'resolved', response_id: 'p1' }] };
                    if (scenario === 'door_lock_wrong_key') draft.actions[0].status = 'blocked';
                    if (['door_lock_compound_bad', 'door_lock_compound_repair'].includes(scenario)) {
                        draft.actions[0].request = 'You lock the door to the Antechamber with the Cell key ';
                        draft.narrative.push({ id: 'p2', text: scenario === 'door_lock_compound_repair'
                            ? 'You tap Linda on the shoulder; she turns.' : 'You take the letter from the desk.' });
                        draft.actions.push({ request: scenario === 'door_lock_compound_repair'
                            ? 'and tap Linda on the shoulder' : 'and take the letter', kind: 'physical', status: 'resolved', response_id: 'p2' });
                        if (scenario === 'door_lock_compound_repair' && calls === 2) draft.events = [{
                            type: 'interaction', actor_id: 'player', status: 'completed',
                            action: 'tap Linda on the shoulder', passage_id: 'p2' }];
                    }
                    if (scenario === 'door_lock_aggregate_bad') {
                        draft.actions[0].request = input;
                        draft.narrative[0].text += ' You take the letter from the desk.';
                    }
                    if (scenario === 'compound' || (scenario === 'compound_repair' && calls === 2))
                        draft.actions[0].request = input;
                    if (scenario.startsWith('two_actions')) {
                        draft.actions[0].request = 'I knock on the desk ';
                        draft.narrative.push({ id: 'p2', text: 'You tap Linda on the shoulder; she turns.' });
                        draft.actions.push({ request: 'and tap Linda on the shoulder.', kind: 'physical',
                            status: 'resolved', response_id: 'p2' });
                        draft.events = [{ type: 'interaction', actor_id: 'player', status: 'completed',
                            action: 'knock on the desk', passage_id: 'p1' }];
                        if (scenario === 'two_actions_repair' && calls === 2) draft.events.push({
                            type: 'interaction', actor_id: 'player', status: 'completed',
                            action: 'tap Linda on the shoulder', passage_id: 'p2' });
                    }
                    if (scenario === 'legacy') Object.assign(draft, { events: [], effects: {}, speech: [], commitments: [] });
                    if (scenario === 'legacy') draft.actions[0].request = input;
                    if (scenario === 'give') draft.events = [{ type: 'inventory', actor_id: 'player', status: 'completed', action: 'give', item: 'letter', passage_id: 'p1' }];
                    if (scenario === 'cosmetic_condition') draft.events = [{ type: 'condition', actor_id: 'linda',
                        status: 'completed', action: 'smile', passage_id: 'p1' }];
                    if (scenario === 'commitment_repair' && calls === 2) draft.events = [{ type: 'interaction',
                        actor_id: 'player', status: 'completed', action: 'knock on the desk', passage_id: 'p1' }];
                    if (scenario === 'invalid_proof_repair') draft.events = [{
                        type: calls === 1 ? 'inventory' : 'interaction', actor_id: 'player',
                        status: 'completed', action: calls === 1 ? 'give' : 'knock on the desk',
                        ...(calls === 1 ? { item: 'missing stone' } : {}), passage_id: 'p1' }];
                    if (scenario.startsWith('drag_')) {
                        draft.actions[0].request = input;
                        if (scenario === 'drag_escort_repair' && calls === 1) draft.events = [{ type: 'escort', actor_id: 'player',
                            status: 'completed', action: 'join', target_id: 'linda', passage_id: 'p1' }];
                    }
                    if (scenario === 'door_lock_repair' && calls === 1)
                        draft.narrative[0].text = 'The Cell key refuses to rotate; the bolt stays stationary and the door remains open.';
                    if (scenario === 'door_lock_oneway_repair' && calls === 1)
                        draft.narrative[0].text = 'The lock is a one-way mechanism, secured only from the Antechamber side.';
                    if (scenario.includes('_condition_')) {
                        draft.events = [{ type: 'interaction', actor_id: 'player', status: 'completed',
                            action: 'loosen the chain above Linda’s cuffs', passage_id: 'p1' },
                        scenario === 'missing_condition_action_repair' && calls === 1
                            ? { type: 'condition', actor_id: 'linda', status: 'completed',
                                condition: 'Restrained', passage_id: 'p1' }
                        : scenario.startsWith('missing_condition') && (calls === 1 || scenario === 'missing_condition_bad')
                            ? { type: 'condition', actor_id: 'linda', status: 'completed',
                                action: 'remove', passage_id: 'p1' }
                            : scenario === 'unknown_condition_repair' && calls === 1
                                ? { type: 'condition', actor_id: 'linda', status: 'completed',
                                    action: 'remove', condition: 'unrecorded cuffs', passage_id: 'p1' }
                            : { type: 'activity', actor_id: 'linda', status: 'completed',
                                activity: 'Cuffed overhead on a slack chain', passage_id: 'p1' }];
                    }
                    if (scenario === 'resolution_repair' && calls === 1) draft.resolutions = [{
                        id: 'invented_deadline', passage_id: 'p1', event_index: 0 }];
                    const failEarly = ['early_tool', 'early_content', 'bad_twice'].includes(scenario) && calls === 1;
                    if (failEarly) {
                        // A deliberately unfinished response: the closed invalid
                        // enum is enough to stop before the long narrative.
                        const raw = '{"protocol":"scene_draft_v3","actions":[{"kind":"physical","status":"impossible"';
                        const delta = scenario === 'early_content' ? { content: raw } : {
                            tool_calls: [{ index: 0, id: 'draft', type: 'function', function: { name: 'commit_world_turn', arguments: raw } }] };
                        options.signal.addEventListener('abort', () => { signalAborted = true; });
                        return new Response(new ReadableStream({
                            start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`)); },
                            cancel() { cancelled = true; }
                        }), { headers: { 'Content-Type': 'text/event-stream' } });
                    }
                    if (scenario === 'bad_twice') draft.actions[0].status = 'impossible';
                    const raw = JSON.stringify(draft);
                    const useContent = !body.tools || ['plain_json', 'tagged', 'early_content', 'local', 'fenced_crlf'].includes(scenario);
                    const message = useContent ? { content: scenario === 'tagged' || scenario === 'no_tools' ? `<world_turn_receipt>${raw}</world_turn_receipt>`
                        : scenario === 'fenced_crlf' ? `\`\`\`json\r\n${raw}\`\`\`` : raw }
                        : { tool_calls: [{ index: 0, id: 'draft', type: 'function', function: { name: 'commit_world_turn', arguments: raw } }] };
                    if (!body.stream || scenario === 'plain_json') return new Response(JSON.stringify({ choices: [{ message }],
                        usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 } }), { headers: { 'Content-Type': 'application/json' } });
                    // Split tool arguments/content into tiny SSE deltas, then
                    // split the UTF-8 response again at unrelated byte offsets.
                    const frames = [];
                    const value = useContent ? message.content : raw;
                    for (let i = 0; i < value.length; i += 7) frames.push(`data: ${JSON.stringify({ choices: [{ delta: useContent
                        ? { content: value.slice(i, i + 7) }
                        : { tool_calls: [{ index: 0, ...(i ? {} : { id: 'draft', type: 'function' }), function: { ...(i ? {} : { name: 'commit_world_turn' }), arguments: value.slice(i, i + 7) } }] } }] })}\n\n`);
                    frames.push('data: [DONE]\n\n');
                    const bytes = new TextEncoder().encode(frames.join(''));
                    return new Response(new ReadableStream({ start(controller) {
                        for (let i = 0; i < bytes.length; i += 31) controller.enqueue(bytes.slice(i, i + 31)); controller.close();
                    } }), { headers: { 'Content-Type': 'text/event-stream' } });
                };
                document.getElementById('world-user-input').value = input;
                await executeWorldTurn();
                if (scenario === 'door_lock_reroll') await executeWorldTurn(true);
                if (scenario === 'local_no_schema') {
                    document.getElementById('world-user-input').value = input;
                    await executeWorldTurn();
                }
                const last = sess.history.at(-1);
                const persisted = scenario.startsWith('door_lock_')
                    ? await HordeDB.get(`worldInstance:${world.id}`) : null;
                const savedSession = persisted?.sessions?.find(item => item.id === sess.id);
                results.push({ scenario, calls, cancelled, signalAborted, repairObservedCleanState,
                    text: last?.text, source: last?.stateSource, audit: safeJsonClone(last?.callAudit),
                    receipt: safeJsonClone(sess.lastTurnAudit), inventory: safeJsonClone(sess.inventory),
                    lindaConditions: safeJsonClone(sess.entityStates.linda.conditions || []),
                    lindaActivity: sess.entityStates.linda.currentActivity,
                    playerLocation: sess.playerLocation, lindaLocation: sess.entityStates.linda.location,
                    lindaFollowing: sess.entityStates.linda.followingPlayer === true,
                    doorKeys: safeJsonClone(sess.unlockedExits || {}),
                    savedDoorKeys: safeJsonClone(savedSession?.unlockedExits || {}),
                    targetedRoutes: safeJsonClone(targetedRoutes),
                    userMessageCount: sess.history.filter(message => message.role === 'user' && message.text === input).length,
                    firstMessages: requests[0]?.messages, repair: requests[1], finalRequest: requests.at(-1),
                    schema: requests[0]?.tools?.find(t => t.function.name === 'commit_world_turn')?.function.parameters
                        || requests[0]?.response_format?.json_schema?.schema });
            }
            window.fetch = realFetch;
            return results;
        });
        for (const result of results) {
            const { scenario } = result;
            assert(result.firstMessages.some(message => message.content.includes('[PLAYER WORDING AND INTENT]')
                && message.content.includes('If quoting them, preserve the original wording.')),
            `player wording fidelity must reach every provider transport: ${scenario}`);
            if (result.audit?.receiptRepair > 0) assert(result.repair.messages.some(message =>
                message.content.includes('[PLAYER WORDING AND INTENT]')),
            'correction must preserve player intent too');
            if (['missing_item', 'absent_actor', 'bad_twice', 'stale', 'compound_bad', 'two_actions_bad', 'door_lock_compound_bad', 'door_lock_aggregate_bad',
                'missing_condition_bad', 'truncated_json_bad'].includes(scenario)) {
                assert.equal(result.calls, 2, JSON.stringify(result));
                assert.equal(result.source, 'frozen_no_receipt', JSON.stringify(result));
                assert(!result.text.includes('Linda studies'));
            } else {
                assert.equal(result.calls, scenario === 'local_no_schema' ? 3 : ['early_tool', 'early_content', 'no_tools', 'compound_repair', 'commitment_repair', 'resolution_repair', 'two_actions_repair', 'invalid_proof_repair', 'missing_condition_repair', 'missing_condition_action_repair', 'unknown_condition_repair', 'drag_escort_repair', 'door_lock_compound_repair', 'door_lock_repair', 'door_lock_oneway_repair', 'door_lock_reroll', 'truncated_json_repair', 'malformed_json_repair'].includes(scenario) ? 2 : 1,
                    JSON.stringify({ ...result, firstMessages: undefined, schema: undefined, repair: undefined, finalRequest: undefined }));
                assert.notEqual(result.source, 'frozen_no_receipt', JSON.stringify(result));
                assert.equal(result.receipt.protocol, scenario === 'legacy' ? 'scene_draft_v2' : 'scene_draft_v3');
                assert(result.audit.metrics.acceptedDisplayMs >= 0);
                assert(result.audit.metrics.estimatedInputTokens > 0);
                assert(result.audit.metrics.outputCharacters > 0);
            }
            if (scenario.startsWith('early_') || scenario === 'bad_twice') {
                assert(result.cancelled && result.signalAborted, JSON.stringify(result));
                assert(result.repairObservedCleanState);
                assert.equal(result.audit.metrics.earlyAbortReason, 'invalid_stream_enum');
                assert.equal(result.audit.receiptRepair, 1);
            }
            if (scenario === 'give') assert.equal(result.inventory.length, 0);
            else if (scenario !== 'missing_item') assert.equal(result.inventory.length, 1);
            if (scenario === 'current_state') {
                const prompt = result.firstMessages.map(m => m.content).join('\n');
                assert(prompt.includes('CURRENT RECORDED STATE (overrides historical descriptions)'));
                assert(prompt.includes('A green coat; the old red scarf has been removed.'));
                assert(prompt.includes('Her hands are now free.'), 'preserve a state change beyond the frame truncation limit');
                assert(prompt.includes('"conditions":[]'), 'explicit cleared conditions must reach the provider');
            }
            if (scenario === 'three_exits') {
                const prompt = result.firstMessages.map(message => message.content).join('\n');
                assert(prompt.includes('to Antechamber') && prompt.includes('to West Hall')
                    && prompt.includes('to Lower Stairs'), 'all three current-room exits must reach the prompt');
                assert(/never infer that other exits do not exist/i.test(prompt));
                assert.deepEqual(result.targetedRoutes.find(route => route.actor_id === 'player')?.allowed_next.map(edge => edge.to), ['ante'],
                    'targeted movement may narrow allowed routes while all room exits stay visible');
            }
            if (scenario.startsWith('compound')) {
                assert(result.schema.properties.actions.items.required.includes('request'));
                if (scenario !== 'compound') {
                    assert(result.repairObservedCleanState);
                    assert.equal(result.audit.receiptRepair, 1);
                    assert(JSON.stringify(result.repair.messages).includes('REQUEST COVERAGE CORRECTION'));
                }
            }
            if (scenario === 'commitment_repair') {
                assert(result.repairObservedCleanState);
                const repairPrompt = result.repair.messages.map(m => m.content).join('\n');
                assert(repairPrompt.includes('PLAYER ACTION CORRECTION'));
                assert(repairPrompt.includes('I knock on the desk.'));
                assert(!repairPrompt.includes('DEADLINE CORRECTION'));
                assert.equal(result.audit.receiptRepair, 1);
            }
            if (scenario === 'resolution_repair') {
                assert(result.repairObservedCleanState);
                assert(!result.schema.properties.resolutions, 'the first v3 schema omits unreachable deadlines');
                const repairPrompt = result.repair.messages.map(m => m.content).join('\n');
                assert(repairPrompt.includes('DEADLINE CORRECTION'));
                assert(repairPrompt.includes('invented_deadline'));
                assert.equal(result.audit.receiptRepair, 1);
            }
            if (scenario.startsWith('two_actions')) {
                assert(result.repairObservedCleanState, 'rejected first attempt must not partly commit');
                const correction = result.audit?.correctionReasons?.find(item =>
                    item.reason === 'uncommitted_player_action');
                assert.equal(correction?.actionIndex, 1, JSON.stringify({scenario, audit:result.audit, receipt:result.receipt}));
                assert.equal(correction?.proofStatus, 'missing');
                assert(result.repair.messages.some(message => message.content.includes('Part 2')));
                assert.equal(result.audit.receiptRepair, 1);
            }
            if (scenario === 'invalid_proof_repair') {
                assert(result.repairObservedCleanState);
                assert(result.audit.correctionReasons.some(item =>
                    item.reason === 'uncommitted_player_action' && item.proofStatus === 'invalid'),
                JSON.stringify(result.audit.correctionReasons));
                assert.equal(result.audit.receiptRepair, 1);
            }
            if (scenario.startsWith('truncated_json_')) {
                assert(result.repairObservedCleanState);
                assert(result.audit.correctionReasons.some(item => item.reason === 'truncated_receipt'));
                assert.equal(result.audit.receiptRepair, 1);
            }
            if (scenario === 'malformed_json_repair') {
                assert(result.repairObservedCleanState);
                assert(result.audit.correctionReasons.some(item => item.reason === 'invalid_json_transport'));
                assert.equal(result.audit.receiptRepair, 1);
            }
            if (scenario === 'missing_condition_repair') {
                assert(result.repairObservedCleanState, 'the invalid condition cannot partially commit');
                assert(result.audit.correctionReasons.some(item => item.reason === 'missing_condition'));
                const repairPrompt = result.repair.messages.map(message => message.content).join('\n');
                assert(repairPrompt.includes('CONDITION CORRECTION'));
                assert(repairPrompt.includes('Restrained'));
                assert.deepEqual(result.lindaConditions, ['Restrained'], 'loosening the chain leaves cuffs in place');
                assert.match(result.lindaActivity, /slack chain/i);
                assert.equal(result.audit.receiptRepair, 1);
            }
            if (scenario === 'missing_condition_action_repair') {
                assert(result.repairObservedCleanState);
                assert(result.audit.correctionReasons.some(item => item.reason === 'missing_condition_action'));
                assert(result.repair.messages.some(message => message.content.includes('CONDITION CORRECTION')));
                assert.deepEqual(result.lindaConditions, ['Restrained']);
            }
            if (scenario === 'missing_condition_bad') {
                assert(result.repairObservedCleanState);
                assert.deepEqual(result.lindaConditions, ['Restrained']);
                assert.match(result.lindaActivity, /taut chain/i);
                assert.equal(result.audit.receiptRepair, 1, 'no second automatic correction');
            }
            if (scenario === 'unknown_condition_repair') {
                assert(result.repairObservedCleanState);
                assert(result.audit.correctionReasons.some(item => item.reason === 'unknown_condition'));
                assert(result.repair.messages.some(message => message.content.includes('CONDITION CORRECTION')));
                assert.deepEqual(result.lindaConditions, ['Restrained']);
                assert.match(result.lindaActivity, /slack chain/i);
            }
            if (scenario.startsWith('drag_')) {
                assert.equal(result.playerLocation, 'hex');
                assert.equal(result.lindaLocation, 'hex');
                assert.equal(result.lindaFollowing, false, 'one trip must not create a persistent follower');
                if (scenario === 'drag_escort_repair') {
                    assert(result.repairObservedCleanState);
                    assert(result.audit.correctionReasons.some(item => item.reason === 'invalid_escort_actor'));
                    assert(result.repair.messages.some(message => message.content.includes('ESCORT CORRECTION')));
                    assert.equal(result.audit.receiptRepair, 1);
                } else assert.equal(result.audit.receiptRepair, 0);
            }
            if (['door_lock_compound_bad', 'door_lock_aggregate_bad'].includes(scenario)) {
                assert.equal(result.audit?.correctionReasons?.find(item => item.reason === 'uncommitted_player_action')?.actionIndex,
                    scenario === 'door_lock_compound_bad' ? 1 : 0);
                assert(result.repairObservedCleanState);
                assert(!Object.values(result.doorKeys).includes(true));
            }
            if (scenario === 'door_lock_compound_repair') {
                assert(result.repairObservedCleanState);
                assert.equal(result.audit?.correctionReasons?.find(item => item.reason === 'uncommitted_player_action')?.actionIndex, 1);
                assert(!Object.values(result.doorKeys).includes(true));
            }
            if (scenario.startsWith('door_lock_') && !['door_lock_wrong_key', 'door_lock_compound_bad', 'door_lock_compound_repair', 'door_lock_aggregate_bad'].includes(scenario)) {
                assert(JSON.stringify(result.firstMessages).includes('Its shared lock is secured from both mapped sides'));
                if (scenario !== 'door_lock_success' && scenario !== 'door_lock_reroll') {
                    assert(result.repairObservedCleanState);
                    assert(result.audit.correctionReasons.some(item => item.reason === 'contradicted_precommitted_door'));
                    assert(result.repair.messages.some(message => message.content.includes('DOOR CORRECTION')));
                    assert.equal(result.audit.receiptRepair, 1);
                } else assert.equal(result.audit.receiptRepair, 0);
                assert(!Object.values(result.doorKeys).includes(true), 'the shared door must end locked');
                assert(!Object.values(result.savedDoorKeys).includes(true), 'the locked state must persist');
                if (scenario === 'door_lock_reroll') assert.equal(result.userMessageCount, 1);
                assert.match(result.text, /locks the door/i);
            }
            if (scenario === 'door_lock_wrong_key') {
                assert(Object.values(result.doorKeys).includes(true), 'wrong named key must leave the door unlocked');
                assert(Object.values(result.savedDoorKeys).includes(true));
                assert.match(result.text, /does not fit/i);
            }
            if (scenario === 'local_no_schema') assert.equal(result.finalRequest.response_format, undefined, 'remember unsupported schema capability');
            if (scenario.startsWith('old_')) {
                const oldSource = result.firstMessages.find(message => message.role === 'system' && message.content.includes('"sourceMessageId":"d0"'));
                assert(oldSource, 'old source must reach the real model input beyond the five-turn history');
                assert(oldSource.content.includes(scenario === 'old_memory' ? 'testimony' : 'narrative_excerpt'));
            }
            const history = result.firstMessages.filter(m => ['user', 'assistant'].includes(m.role));
            assert(!history.some(m => m.content.includes('Old answer 2.')));
            assert(history.some(m => m.content.includes('Old answer 3.')));
            assert(result.firstMessages[0].content.startsWith('[SCENE DRAFT V'));
            if (scenario !== 'legacy') assert.deepEqual(result.schema.required, ['protocol', 'narrative', 'actions']);
        }
        assert.deepEqual(errors, []);
        console.table(results.map(r => ({ scenario: r.scenario, requests: r.calls, result: r.source, earlyCancelled: r.cancelled })));
        console.log('PASS v3 actual turn path: local interaction guards, streaming early stop, single repair, tool/JSON/tag transport, v2 rollback, diagnostics and history');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
