'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const receiptNarration = require('../worlds/receipt-narration');
const root = path.resolve(__dirname, '..');
(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext();
        let bindingCalls = 0;
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.pathname === '/worlds/bind-turn') {
                const headers = { 'access-control-allow-origin': '*',
                    'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
                if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
                bindingCalls++;
                const result = spawnSync(process.execPath, [path.join(root, 'worlds/turn-binding-worker.js')],
                    { input: route.request().postData(), encoding: 'utf8' });
                return route.fulfill({ status: 200, contentType: 'application/json', headers, body: result.stdout });
            }
            if (url.hostname !== 'bound-turn.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
                return route.fulfill({ status: 404, body: '' });
            return route.fulfill({ contentType: { '.html': 'text/html', '.js': 'text/javascript',
                '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        const errors = [], logs = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (['warning', 'error'].includes(message.type())) logs.push(message.text()); });
        await page.goto('https://bound-turn.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
        const result = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer);
            await Promise.all([saveStateInFlight, worldSaveInFlight].filter(Boolean));
            state.apiKey = 'offline'; state.globalSettings.apiProvider = 'openrouter';
            const world = { id: 'bound_test', name: 'Stone', model: 'offline/model', contextSize: 65536,
                maxTokens: 1024, startLocationId: 'stone',
                locations: [{ id: 'stone', name: 'Stone', exits: [{ targetLocationId: 'path' }] },
                    { id: 'path', name: 'Path', exits: [{ targetLocationId: 'stone' }] }],
                entities: [{ id: 'lorne', type: 'npc', name: 'Lorne', startLocation: 'stone',
                    persona: 'A thoughtful storycatcher with a dry sense of humour.' },
                    { id: 'aslan', type: 'npc', name: 'Aslan', startLocation: 'stone' },
                    { id: 'bronze_key', type: 'item', name: 'Bronze key', locationId: 'stone' }],
                kernel: { enabled: true, memoryMode: 'ledger', sceneDrafts: true },
                hudConfig: { startTimeHours: 8, timeStep: 5 }, gameRules: { modules: { livingWorld: false } } };
            state.worlds = [world]; state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            const sess = prepareCurrentWorldSession(); sess.setupComplete = true;
            sess.entityStates.lorne = { ...sess.entityStates.lorne, location: 'stone' };
            sess.entityStates.bronze_key = { location: 'stone' };
            sess.placeDiscoveries ||= {};
            sess.placeDiscoveries.lorne = ['path']; // the authored reaction uses a known adjacent place
            sess.placeDiscoveries.aslan = ['path', 'stone'];
            switchView('worldPlay'); renderWorldPlayState();
            const realFetch = window.fetch;
            const outcomes = [];
            const say = (text, kind = 'speech') => ({ protocol: 'scene_draft_v3', actions: [{
                kind, status: 'resolved', effects: [], response: [{ text }] }] });
            const run = async (input, proposals, finishes = [], failSave = false, streamMode = 'single') => {
                const startedAt = performance.now();
                const before = { history: sess.history.length, turn: sess.turnCount,
                    version: sess.worldStateVersion || 0, outfit: sess.outfit,
                    playerLocation: sess.playerLocation, aslanLocation: sess.entityStates.aslan.location,
                    time: getWorldTimeData(world, sess).currentTotalMinutes,
                    receipts: sess.worldTurnReceipts?.length || 0 };
                let calls = 0;
                const budgets = [];
                const prompts = [];
                window.fetch = async (url, options = {}) => {
                    if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                    const body = JSON.parse(options.body);
                    budgets.push(body.max_tokens);
                    prompts.push(JSON.stringify(body.messages || []).slice(0, 24000));
                    const schema = body.tools?.find(tool => tool.function?.name === 'commit_world_turn')?.function?.parameters
                        || body.response_format?.json_schema?.schema;
                    if (schema?.properties?.actions?.items?.properties?.action_id)
                        throw new Error('The model must not generate action IDs.');
                    const draft = proposals[Math.min(calls, proposals.length - 1)];
                    const finish_reason = finishes[calls] || 'stop'; calls++;
                    if (body.stream) {
                        const raw = JSON.stringify(draft);
                        const contents = streamMode === 'cumulative'
                            ? [raw.slice(0, Math.floor(raw.length / 3)),
                                raw.slice(0, Math.floor(raw.length * 2 / 3)), raw] : [raw];
                        return new Response(contents.map((content, index) => `data: ${JSON.stringify({
                            choices: [{ delta: { content },
                                finish_reason: index === contents.length - 1 ? finish_reason : null }] })}\n\n`)
                            .join('') + 'data: [DONE]\n\n',
                        { headers: { 'Content-Type': 'text/event-stream' } });
                    }
                    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(draft) }, finish_reason }] }),
                        { headers: { 'Content-Type': 'application/json' } });
                };
                const originalSet = HordeDB.setMultiple;
                if (failSave) HordeDB.setMultiple = async () => { throw Error('simulated atomic storage failure'); };
                document.getElementById('world-user-input').value = input;
                await executeWorldTurn();
                HordeDB.setMultiple = originalSet;
                const saved = (await HordeDB.get(`worldInstance:${world.id}`))?.sessions?.find(item => item.id === sess.id);
                const after = { history: sess.history.length, turn: sess.turnCount,
                    version: sess.worldStateVersion || 0, outfit: sess.outfit,
                    playerLocation: sess.playerLocation, aslanLocation: sess.entityStates.aslan.location,
                    time: getWorldTimeData(world, sess).currentTotalMinutes,
                    receipts: sess.worldTurnReceipts?.length || 0 };
                return { calls, durationMs: Math.round(performance.now() - startedAt),
                    budgets, prompts, before, after, saved: saved && { history: saved.history.length,
                    turn: saved.turnCount, outfit: saved.outfit, time: saved.worldClock?.absoluteMinutes,
                    playerLocation: saved.playerLocation, aslanLocation: saved.entityStates.aslan.location,
                    diagnostics: saved.worldCallDiagnostics?.length || 0,
                    diagnosticStatus: saved.worldCallDiagnostics?.at(-1)?.status,
                    receipts: saved.worldTurnReceipts?.length || 0 },
                    input: document.getElementById('world-user-input').value,
                    error: document.getElementById('world-turn-error-text')?.textContent,
                    receipt: sess.worldTurnReceipts?.at(-1), reply: sess.history.at(-1)?.text,
                    rendered: document.querySelector('#world-messages-container .msg-dm:last-of-type .msg-text')?.innerHTML || '',
                    sceneMemory: sess.history.at(-1)?.sceneMemory,
                    savedSceneMemory: saved?.history?.at(-1)?.sceneMemory };
            };
            const aslan = `Aslan slowly raises his head, his faintly glowing golden eyes settling on the traveller.
"How observant. And here I was, hoping to pass for a particularly handsome pebble."
He shifts slightly on his sun-warmed stone.
"Tell me, traveller, do you often stop to insult the local wildlife, or am I receiving special treatment?"`;
            const inferredSpeakerTurn = await run(aslan,
                [say('Lorne leans on his staff. "Special treatment, naturally. Most pebbles are less conversational."')]);
            sess.presentationMode = 'cinematic';
            renderWorldPlayState();
            inferredSpeakerTurn.renderedCinematic = document.querySelector(
                '#world-messages-container .msg-dm:last-of-type .msg-text')?.innerHTML || '';
            sess.presentationMode = 'classic';
            renderWorldPlayState();
            outcomes.push(inferredSpeakerTurn);
            const mixedVoices = say('Lorne says, "The road is open."');
            mixedVoices.actions[0].response[0].speech = [{ speaker: 'lorne',
                listeners: ['player', 'aslan'] }];
            mixedVoices.actions[0].response.push({ text: 'Aslan replies, "Then let us go."',
                speech: [{ speaker: 'aslan', listeners: ['player', 'lorne'] }] });
            const mixedSpeakerTurn = await run('What do you two think?', [mixedVoices]);
            sess.presentationMode = 'cinematic';
            renderWorldPlayState();
            mixedSpeakerTurn.renderedCinematic = document.querySelector(
                '#world-messages-container .msg-dm:last-of-type .msg-text')?.innerHTML || '';
            sess.presentationMode = 'classic';
            renderWorldPlayState();
            outcomes.push(await run('I nod.', [say('Lorne returns the nod.', 'gesture')]));
            outcomes.push(await run('Tell me your story. '.repeat(180), [say('Lorne settles against his staff and begins his tale.')]));
            const moved = say('Lorne tips his hat.');
            moved.reactions = [{ text: 'Lorne steps onto the path.', effects: { actor_move: [{ actor_id: 'lorne', to_location_id: 'path' }] },
                events: [{ type: 'movement', actor_id: 'lorne', status: 'completed', from_location_id: 'stone', to_location_id: 'path' }] }];
            outcomes.push(await run('Farewell.', [moved]));
            const outfit = say('The cloak settles around your shoulders.', 'physical');
            outfit.actions[0].effects = { outfit_set: [{ actor_id: 'player', outfit: 'red cloak' }] };
            outfit.actions[0].response[0].events = [{ type: 'outfit', actor_id: 'player',
                status: 'completed', outfit: 'red cloak' }];
            outcomes.push(await run('I put on the red cloak.', [outfit]));
            const repaired = structuredClone(outfit);
            repaired.actions[0].effects.outfit_set[0].outfit = 'blue coat';
            repaired.actions[0].response[0].text = 'The blue coat settles around your shoulders.';
            repaired.actions[0].response[0].events[0].outfit = 'blue coat';
            const past = structuredClone(repaired);
            world.gameRules.modules.livingWorld = true;
            past.actions[0].response[0].commitments = [{ title: 'A false appointment', day: 1, minute_of_day: 0,
                location_id: 'stone', status: 'scheduled', source_quote: 'I put on the blue coat at 08:30.' }];
            const lost = structuredClone(repaired); lost.actions[0].effects = [];
            outcomes.push(await run('I put on the blue coat at 08:30.', [past, lost, repaired]));
            outcomes.push(await run('Good day.', [say('INCOMPLETE PROSE MUST NOT SAVE'), say('ALSO INCOMPLETE'),
                say('A breeze passes over the stone.')], ['length', 'length', 'stop']));
            const failed = structuredClone(repaired);
            failed.actions[0].effects.outfit_set[0].outfit = 'violet coat';
            failed.actions[0].response[0].text = 'The violet coat settles around your shoulders.';
            failed.actions[0].response[0].events[0].outfit = 'violet coat';
            outcomes.push(await run('I put on the violet coat.', [failed], [], true));
            outcomes.push(await run('Anyone there?', [say('Lorne nods beside you.') ]));
            const wait = say('Ten minutes pass while the breeze moves across the stone.', 'wait');
            wait.actions[0].effects = { time_advance: [{ minutes: 10 }] };
            outcomes.push(await run('I wait ten minutes.', [wait]));
            const future = say('The meeting tomorrow at 08:30 is confirmed.');
            future.actions[0].response[0].commitments = [{ title: 'Agreed meeting', day: 2,
                minute_of_day: 510, location_id: 'stone', status: 'scheduled',
                source_quote: 'I agree to meet tomorrow at 08:30.' }];
            outcomes.push(await run('I agree to meet tomorrow at 08:30.', [future]));
            const guarded = structuredClone(past);
            guarded.actions[0].effects.outfit_set[0].outfit = 'green coat';
            guarded.actions[0].response[0].events[0].outfit = 'green coat';
            guarded.actions[0].response[0].commitments[0].source_quote = 'I put on the green coat at 08:30.';
            const droppedAfterLength = structuredClone(guarded);
            droppedAfterLength.actions[0].effects = [];
            delete droppedAfterLength.actions[0].response[0].commitments;
            outcomes.push(await run('I put on the green coat at 08:30.', [guarded, guarded, droppedAfterLength],
                ['stop', 'length', 'stop']));
            const conditional = { protocol: 'scene_draft_v3', actions: [
                { request: 'I try to read the inscription;', kind: 'physical', status: 'attempted', effects: [],
                    response: [{ text: 'The weathered letters remain unreadable.' }] },
                { request: 'if that succeeds, I put on the cloak.', kind: 'physical', status: 'resolved',
                    depends_on: [{ action_index: 0, outcome: 'succeeded' }],
                    effects: { outfit_set: [{ actor_id: 'player', outfit: 'black cloak' }] },
                    response: [{ text: 'Lorne arrives with a black cloak and confirms another appointment.',
                        commitments: [{ title: 'Skipped appointment', day: 2, minute_of_day: 510,
                            location_id: 'stone', status: 'scheduled', source_quote: 'if that succeeds, I put on the cloak.' }] }] }
            ] };
            outcomes.push(await run('I try to read the inscription; if that succeeds, I put on the cloak.', [conditional]));
            const failedFixture = { world: structuredClone(world), session: structuredClone(sess) };
            outcomes.push(await run('What do you see?', [say('A warm breeze stirs the leaves.')],
                [], false, 'cumulative'));
            outcomes.push(await run('Can you answer?', [say('"'), say('Lorne considers the question and answers plainly.') ]));
            const conversational = { protocol: 'scene_draft_v3', actions: [
                { request: 'I speak about the orchard', kind: 'speech', status: 'resolved', effects: [],
                    response: [{ text: 'The orchard has seen better years.' }] },
                { request: 'smile', kind: 'gesture', status: 'resolved', effects: [],
                    response: [{ text: 'A breeze stirs the leaves.' }] },
                { request: 'ask for a ride', kind: 'question', status: 'answered', effects: [],
                    response: [{ text: 'The road to Millbrook remains open.' }] }
            ] };
            outcomes.push(await run('I speak about the orchard, smile, and ask for a ride.',
                [conversational]));
            const offeredRide = say('The request hangs in the air beside the road to Millbrook.');
            offeredRide.actions[0].response[0].commitments = [{ title: 'Take Aslan to Millbrook',
                day: 2, minute_of_day: 480, location_id: 'stone', status: 'scheduled',
                source_quote: "Since you're heading to Millbrook anyway" }];
            outcomes.push(await run(`Aslan listens thoughtfully, his golden eyes brightening at the mention of the troubled orchards.

"Wilting orchards, you say? How unfortunate. Perhaps I'll have a look. I've always found that a little hope can work wonders, though admittedly, so can a competent gardener."

He glances down at his short legs, then back at Lorne.

"There's just one small difficulty. As you may have noticed, I wasn't exactly blessed with the anatomy of a long-distance traveller."

He gives a soft, amused croak.

"Since you're heading to Millbrook anyway, perhaps you wouldn't mind giving an elderly toad a lift? I promise to be excellent company, and I weigh considerably less than most travelling philosophers."`, [offeredRide]));
            const shoulderInput = `Aslan considers the options for a moment, his golden eyes gleaming with amusement.

"The shoulder, I think. I've spent quite enough time sitting on a stone, and exchanging a view of the road for the inside of a pocket seems a rather questionable improvement."

"Now then, my good fellow, would you mind lending me a hand? These legs of mine are better suited to dignified sitting than heroic climbing."`;
            const falseShoulderEffect = say('Lorne offers his hand to Aslan.', 'gesture');
            falseShoulderEffect.actions[0].effects = { relation_set: [{ subject_id: 'lorne',
                target_id: 'aslan', value: 50 }] };
            const safeShoulder = say('Lorne offers Aslan a hand and smiles.', 'gesture');
            outcomes.push(await run(shoulderInput, [falseShoulderEffect, safeShoulder]));
            const spokenWarning = say('You say: "The bridge is out." Aslan listens.');
            spokenWarning.actions[0].response[0].speech = [{ speaker: 'player', listeners: ['aslan'] }];
            outcomes.push(await run('"The bridge is out."', [spokenWarning]));
            const invitation = await run('Lorne, come here.',
                [say('Lorne hears you from the path but chooses not to come.', 'speech')]);
            const speakers = say('Aslan says, "The path is clear."');
            speakers.actions[0].response[0].speech = [{ speaker: 'aslan', listeners: ['player'] }];
            speakers.actions[0].response.push({ text: 'You say, "I will follow."',
                speech: [{ speaker: 'player', listeners: ['aslan'] }] });
            speakers.actions[0].response.push({ text: 'The leaves settle.' });
            const speakerTurn = await run('I ask Aslan about the path.', [speakers]);
            sess.presentationMode = 'cinematic';
            renderWorldPlayState();
            speakerTurn.renderedCinematic = document.querySelector(
                '#world-messages-container .msg-dm:last-of-type .msg-text')?.innerHTML || '';
            sess.presentationMode = 'classic';
            renderWorldPlayState();
            outcomes.push(speakerTurn);
            const finalFixture = { world: structuredClone(world), session: structuredClone(sess) };
            const recoverable = say('Aslan answers from the stone, "The path is clear."');
            recoverable.reactions = [{ text: 'Lorne reaches the path.', effects: [], events: [{
                type: 'movement', actor_id: 'lorne', status: 'completed',
                from_location_id: 'path', to_location_id: 'stone' }] }];
            const recovered = await run('Is the path clear?', [recoverable]);
            const recoverAttempt = say('Aslan braces against the stone; the attempt does not move him.', 'physical');
            recoverAttempt.actions[0].status = 'attempted';
            recoverAttempt.actions[0].effects = { actor_move: [{ actor_id: 'aslan',
                to_location_id: 'path' }] };
            const recoveredAttempt = await run('I try to push Aslan toward the path.', [recoverAttempt]);
            const falseArrival = say('You and Aslan reach the path together.', 'travel');
            falseArrival.actions[0].response[0].events = ['player', 'aslan'].map(actor_id => ({
                type: 'movement', actor_id, status: 'completed',
                from_location_id: 'stone', to_location_id: 'path' }));
            const movementFailure = await run('I take Aslan to the path.', [falseArrival]);
            const jointMove = say('Aslan agrees, and you both reach the path.', 'travel');
            jointMove.actions[0].effects = { actor_move: [{ actor_id: 'player',
                to_location_id: 'path', companion_ids: ['aslan'] }] };
            jointMove.actions[0].response[0].events = ['player', 'aslan'].map(actor_id => ({
                type: 'movement', actor_id, status: 'completed',
                from_location_id: 'stone', to_location_id: 'path' }));
            const positiveJoint = await run('I take Aslan to the path.', [jointMove]);
            const falseReturn = say('You and Aslan return to the stone together.', 'travel');
            falseReturn.actions[0].response[0].events = ['player', 'aslan'].map(actor_id => ({
                type: 'movement', actor_id, status: 'completed',
                from_location_id: 'path', to_location_id: 'stone' }));
            const validReturn = structuredClone(falseReturn);
            validReturn.actions[0].effects = { actor_move: [{ actor_id: 'player',
                to_location_id: 'stone', companion_ids: ['aslan'] }] };
            const movementRepaired = await run('I take Aslan back to the stone.',
                [falseReturn, validReturn]);
            const pickup = say('The bronze key rests in your hand.', 'physical');
            pickup.actions[0].effects = { item_transfer: [{ item_id: 'bronze_key',
                from_id: 'stone', to_id: 'player' }] };
            pickup.actions[0].response[0].events = [{ type: 'inventory', actor_id: 'player',
                status: 'completed', action: 'pickup', item: 'Bronze key' }];
            const itemPickup = await run('I take the bronze key.', [pickup]);
            const npcFollows = await run('Aslan, please wait here.',
                [say('Aslan nods and waits beside the stone.', 'speech')]);
            const npcRefuses = await run('Aslan, please give me your coat.',
                [say('Aslan shakes his head. "I would rather keep it."', 'speech')]);
            const npcOutfit = say('Aslan accepts the blue scarf and drapes it over his shoulders.', 'physical');
            npcOutfit.actions[0].effects = { outfit_set: [{ actor_id: 'aslan', outfit: 'blue scarf' }] };
            npcOutfit.actions[0].response[0].events = [{ type: 'outfit', actor_id: 'aslan',
                status: 'completed', outfit: 'blue scarf' }];
            const npcState = await run('I give Aslan a blue scarf to wear.', [npcOutfit]);
            const partial = { protocol: 'scene_draft_v3', actions: [
                { request: 'I put on a green coat.', kind: 'physical', status: 'resolved',
                    effects: { outfit_set: [{ actor_id: 'player', outfit: 'green coat' }] },
                    response: [{ text: 'The green coat settles on your shoulders.', events: [{
                        type: 'outfit', actor_id: 'player', status: 'completed', outfit: 'green coat' }] }] },
                { request: 'I try to push Aslan toward the path.', kind: 'physical', status: 'attempted',
                    effects: [], response: [{ text: 'Aslan braces against the stone and does not move.' }] }
            ] };
            const partialTurn = await run('I put on a green coat. I try to push Aslan toward the path.', [partial]);
            const sit = say('You settle onto the ground.', 'physical');
            sit.actions[0].response[0].events = [{ type: 'activity', actor_id: 'player',
                status: 'completed', activity: 'sitting' }];
            const localSit = await run('Ich setze mich hin.', [sit]);
            const stand = say('You stand again.', 'physical');
            stand.actions[0].response[0].events = [{ type: 'activity', actor_id: 'player',
                status: 'completed', activity: 'standing' }];
            const localStand = await run('I stand up.', [stand]);
            window.fetch = realFetch;
            return { outcomes, mixedSpeakerTurn, invitation, recovered, recoveredAttempt,
                movementFailure, positiveJoint, movementRepaired,
                itemPickup, npcFollows, npcRefuses, npcState, partialTurn, localSit, localStand,
                failedDiagnostics: sess.worldCallDiagnostics, npcLocation: sess.entityStates.lorne.location,
                scheduled: sess.scheduledEvents, history: sess.history.map(message => message.text),
                aslanObservations: sess.entityStates.aslan.observations,
                lorneObservations: sess.entityStates.lorne.observations,
                failedFixture,
                finalFixture };
        });
        assert.deepEqual(errors, [], JSON.stringify(errors));
        for (const [index, turn] of result.outcomes.entries()) {
            if (index === 7 || index === 8 || index === 11) {
                assert.deepEqual(turn.after, turn.before, JSON.stringify({ turn, logs }));
                assert.equal(turn.input, index === 7 ? 'I put on the violet coat.'
                    : index === 8 ? 'Anyone there?' : 'I put on the green coat at 08:30.');
                assert(!result.history.some(text => text.includes('violet coat')));
                continue;
            }
            assert.equal(turn.after.history, turn.before.history + 2, JSON.stringify({ index, turn, logs }));
            assert.equal(turn.after.receipts, turn.before.receipts + 1);
            assert.equal(turn.saved.receipts, turn.after.receipts);
            assert.equal(turn.saved.history, turn.after.history);
            assert.equal(turn.saved.time, turn.after.time);
            assert.equal(turn.after.time, turn.before.time + (index === 9 ? 10 : 5));
            assert.equal(turn.receipt.receipt.clock.absolute_minutes, turn.after.time);
            assert(turn.receipt.audit.binding.turnId);
            assert.equal(turn.sceneMemory.receiptId, turn.receipt.receipt.turn_id);
            assert.deepEqual(turn.savedSceneMemory, turn.sceneMemory);
        }
        assert.equal(result.outcomes[0].calls, 1);
        assert.match(result.outcomes[0].renderedCinematic, /<strong>Lorne<\/strong>/,
            'switching to cinematic mode must rerender an inferred NPC speaker');
        for (const field of ['rendered', 'renderedCinematic']) {
            assert.match(result.mixedSpeakerTurn[field], /<strong>Lorne<\/strong>/);
            assert.match(result.mixedSpeakerTurn[field], /<strong>Aslan<\/strong>/);
        }
        assert.equal(result.outcomes[0].receipt.audit.turnResolution.status, 'clean');
        assert.equal(result.outcomes[5].receipt.audit.turnResolution.status, 'repaired');
        assert(result.outcomes[5].prompts.some(prompt =>
            prompt.includes('Authoritative player inventory:')),
        'repair prompts must retain authoritative ownership context');
        assert(result.outcomes[5].receipt.audit.turnResolution.originalFailure);
        assert.equal(result.recovered.receipt.audit.turnResolution.status, 'recovered');
        assert.equal(result.recovered.saved.receipts, result.recovered.after.receipts);
        assert.equal(result.recovered.receipt.audit.turnResolution.discarded.reactions, 1);
        assert(!result.recovered.reply.includes('Lorne reaches the path'));
        assert.equal(result.recoveredAttempt.receipt.audit.turnResolution.status, 'recovered');
        assert.deepEqual(result.recoveredAttempt.receipt.receipt.confirmed_effects, []);
        assert.deepEqual(result.recoveredAttempt.receipt.audit.turnResolution.discarded.strippedAttemptEffects, [0]);
        assert.equal(result.recoveredAttempt.after.aslanLocation, result.recoveredAttempt.before.aslanLocation);
        assert.deepEqual(result.movementFailure.after, result.movementFailure.before);
        assert.equal(result.movementFailure.saved.diagnosticStatus, 'failed');
        assert(result.movementFailure.prompts[1].includes('MOVEMENT EFFECT CORRECTION'));
        assert(result.movementFailure.prompts[1].includes('companion_ids'));
        assert.equal(result.positiveJoint.receipt.audit.turnResolution.status, 'clean');
        assert.equal(result.positiveJoint.saved.history, result.positiveJoint.after.history);
        assert.equal(result.positiveJoint.saved.playerLocation, 'path');
        assert.equal(result.positiveJoint.saved.aslanLocation, 'path');
        assert(result.positiveJoint.receipt.receipt.confirmed_effects.some(item => item.type === 'actor_move'));
        assert.deepEqual(result.positiveJoint.receipt.receipt.events.filter(item => item.type === 'movement')
            .map(item => item.actor_id).sort(), ['aslan', 'player']);
        assert.equal(result.movementRepaired.receipt.audit.turnResolution.status, 'repaired');
        assert.equal(result.movementRepaired.saved.playerLocation, 'stone');
        assert.equal(result.movementRepaired.saved.aslanLocation, 'stone');
        assert(result.movementRepaired.prompts[1].includes('MOVEMENT EFFECT CORRECTION'));
        assert.equal(result.itemPickup.receipt.audit.turnResolution.status, 'clean');
        assert(result.itemPickup.receipt.receipt.confirmed_effects.some(item => item.type === 'item_transfer'));
        assert.equal(result.npcFollows.receipt.audit.turnResolution.status, 'clean');
        assert.equal(result.npcRefuses.receipt.audit.turnResolution.status, 'clean');
        assert.equal(result.npcState.receipt.audit.turnResolution.status, 'clean');
        assert(result.npcState.receipt.receipt.confirmed_effects.some(item => item.type === 'outfit_set'
            && item.payload.actor_id === 'aslan'));
        assert.equal(result.partialTurn.receipt.audit.turnResolution.status, 'clean');
        assert.deepEqual(result.partialTurn.receipt.audit.actions.map(item => item.outcome),
            ['succeeded', 'failed']);
        assert.equal(result.partialTurn.after.aslanLocation, result.partialTurn.before.aslanLocation);
        assert.equal(result.partialTurn.saved.outfit, 'green coat');
        for (const local of [result.localSit, result.localStand]) {
            assert.equal(local.receipt.audit.turnResolution.status, 'clean');
            assert.equal(local.saved.receipts, local.before.receipts + 1);
            assert.equal(local.saved.playerLocation, local.before.playerLocation);
            assert(local.receipt.receipt.events.some(event => event.type === 'activity'
                && event.actor_id === 'player' && event.status === 'completed'));
        }
        assert(result.failedDiagnostics.some(item => item.status === 'failed'
            && item.originalFailure && item.calls.length));
        const outfitTurn = result.outcomes[4];
        assert.equal(outfitTurn.receipt.audit.actions[0].outcome, 'succeeded');
        assert(outfitTurn.receipt.receipt.events.some(event => event.type === 'outfit'
            && event.actor_id === 'player' && event.outfit === 'red cloak'
            && event.action_id === outfitTurn.receipt.audit.actions[0].action_id));
        assert(outfitTurn.receipt.receipt.confirmed_effects.some(effect => effect.type === 'outfit_set'
            && effect.result === 'changed' && effect.payload.outfit === 'red cloak'
            && effect.event_indices.some(index => outfitTurn.receipt.receipt.events[index]?.type === 'outfit')));
        assert(outfitTurn.sceneMemory.records.some(record => record.kind === 'effect'
            && record.text.includes('red cloak')));
        assert.equal(outfitTurn.reply, outfitTurn.receipt.receipt.passages.map(passage => passage.text).join('\n\n'),
            'the published narration must match the committed linked passages');
        const autonomousTurn = result.outcomes[3];
        assert(autonomousTurn.receipt.receipt.events.some(event => event.type === 'movement'
            && event.actor_id === 'lorne' && event.to_location_id === 'path'
            && autonomousTurn.receipt.audit.actions.some(action => action.action_id === event.action_id
                && action.outcome === 'succeeded')),
        'the independent NPC movement needs its own committed action and event');
        assert.equal(result.outcomes[14].calls, 2,
            'an isolated quote must be repaired before the turn is saved');
        assert(!result.history.includes('"'), 'an isolated quote must not be saved as a reply');
        assert.equal(result.outcomes.at(-5).calls, 1,
            'a segmented conversation needs no model reconciliation call');
        assert(result.outcomes.at(-5).receipt.audit.binding.repairs.some(item =>
            item.type === 'merge_conversational_actions'));
        assert.equal(result.outcomes.at(-4).calls, 1,
            'an unsupported optional deadline needs no model reconciliation call');
        assert(result.outcomes.at(-4).receipt.audit.binding.repairs.some(item =>
            item.type === 'discard_unsupported_new_commitment'));
        assert.equal(result.outcomes[5].calls, 3, JSON.stringify(result.outcomes[5]));
        assert.equal(result.outcomes[5].after.outfit, 'blue coat');
        assert.deepEqual(result.outcomes[6].budgets, [4096, 8192, 16384]);
        assert(!result.history.some(text => /INCOMPLETE/.test(text)));
        assert.equal(result.npcLocation, 'path');
        assert.equal(result.invitation.calls, 1);
        assert.equal(result.invitation.receipt.receipt.confirmed_effects.length, 0,
            'an invitation cannot move an NPC without a matching effect and event');
        assert.equal(result.scheduled.length, 1);
        assert.equal(result.scheduled[0].title, 'Agreed meeting');
        assert.equal(result.scheduled[0].dueMinute, 1950);
        assert.equal(result.outcomes[11].calls, 3);
        assert.match(result.outcomes[11].error, /unverified_action_success/);
        assert.equal(result.outcomes[12].after.outfit, 'blue coat');
        assert(!result.history.some(text => text.includes('Lorne arrives with a black cloak')));
        assert.deepEqual(result.outcomes[12].receipt.audit.actions.map(action => action.outcome), ['failed', 'skipped']);
        assert.deepEqual(result.outcomes[12].receipt.receipt.confirmed_effects, []);
        assert(!result.outcomes[12].sceneMemory.records.some(record => record.kind === 'effect'));
        assert(!result.outcomes[12].receipt.receipt.passages.some(passage =>
            passage.text.includes('Lorne arrives with a black cloak')),
        'a skipped dependent action must have no published receipt passage');
        assert.equal(result.outcomes.at(-3).calls, 2,
            'an unsupported effect on a narrative gesture is removed by repair');
        assert(result.outcomes.at(-2).receipt.receipt.events.some(event =>
            event.type === 'observation' && event.actor_id === 'aslan'),
        'derived NPC knowledge must reach the persisted linked receipt');
        const finalReceipt = result.outcomes.at(-1).receipt.receipt;
        assert.deepEqual(finalReceipt.passage_speakers.map(item => item.speaker_id),
            ['aslan', 'player', null]);
        assert.deepEqual(finalReceipt.speech_attributions.map(item => item.speaker),
            ['aslan', 'player']);
        assert.match(result.outcomes.at(-1).rendered,
            /<strong>Aslan<\/strong>/, 'validated NPC speaker name must appear in the visible message');
        assert.match(result.outcomes.at(-1).renderedCinematic,
            /<strong>Aslan<\/strong>/, 'validated NPC speaker name must appear in cinematic mode');
        assert(result.aslanObservations.some(item => item.text === 'You say, "I will follow."'));
        assert(!result.lorneObservations.some(item => item.text === 'Aslan says, "The path is clear."'));
        assert(!result.lorneObservations.some(item => item.text === 'The leaves settle.'),
            'unattributed narration must not become personal NPC knowledge');
        const failedProjection = receiptNarration.project(result.failedFixture.world,
            result.failedFixture.session);
        assert(failedProjection.ok, JSON.stringify(failedProjection));
        assert.deepEqual(failedProjection.input.unconfirmed.map(item => item.outcome),
            ['failed', 'skipped']);
        assert.deepEqual(failedProjection.input.confirmed, []);
        const finalProjection = receiptNarration.project(result.finalFixture.world,
            result.finalFixture.session);
        assert(finalProjection.ok, JSON.stringify(finalProjection));
        assert.deepEqual(finalProjection.input.dialogue.map(item => item.speaker),
            ['aslan', 'player']);
        assert.equal(finalProjection.input.narrativeDetails.at(-1).speaker, null);
        assert(finalProjection.input.npcPerspectives.some(item => item.id === 'aslan'
            && item.memories.some(memory => memory.text === 'You say, "I will follow."')));
        assert(!finalProjection.input.npcPerspectives.some(item => item.id === 'lorne'));
        assert.equal(result.outcomes.at(-1).reply, finalProjection.input.narrativeDetails
            .map(item => item.text).join('\n\n'));
        assert(Object.isFrozen(finalProjection.input)
            && Object.isFrozen(finalProjection.input.confirmed));
        const staleFixture = structuredClone(result.finalFixture);
        staleFixture.session.worldStateVersion++;
        assert.equal(receiptNarration.project(staleFixture.world, staleFixture.session).reason,
            'stale_or_uncommitted_receipt');
        const missingMemory = structuredClone(result.finalFixture);
        delete missingMemory.session.history.at(-1).sceneMemory;
        assert.equal(receiptNarration.project(missingMemory.world, missingMemory.session).reason,
            'matching_scene_memory_required');
        const wrongSpeaker = structuredClone(result.finalFixture);
        wrongSpeaker.session.worldTurnReceipts.at(-1).receipt.passage_speakers[0].speaker_id = 'lorne';
        assert.equal(receiptNarration.project(wrongSpeaker.world, wrongSpeaker.session).reason,
            'speaker_evidence_mismatch');
        const inventedEffect = structuredClone(result.finalFixture);
        inventedEffect.session.worldTurnReceipts.at(-1).receipt.confirmed_effects.push({
            action_id: 'unexecuted', type: 'outfit_set', payload: { outfit: 'invented' },
            result: 'changed', event_indices: [] });
        assert.equal(receiptNarration.project(inventedEffect.world, inventedEffect.session).reason,
            'effect_trace_mismatch');
        const separateKnowledge = structuredClone(result.finalFixture);
        separateKnowledge.session.entityStates.lorne.location = 'stone';
        separateKnowledge.session.entityStates.lorne.observations = [{
            text: 'Lorne alone knows the cellar code.', sourceType: 'witnessed', visibility: 'private' }];
        const knowledgeProjection = receiptNarration.project(separateKnowledge.world,
            separateKnowledge.session);
        assert(knowledgeProjection.ok);
        assert(knowledgeProjection.input.npcPerspectives.find(item => item.id === 'lorne')
            .memories.some(item => item.text.includes('cellar code')));
        assert(!knowledgeProjection.input.npcPerspectives.find(item => item.id === 'aslan')
            .memories.some(item => item.text.includes('cellar code')));
        if (process.env.HORDE_NARRATION_CAPTURE) fs.writeFileSync(process.env.HORDE_NARRATION_CAPTURE,
            JSON.stringify({ cases: [
                { name: 'blocked_chain', baseline: result.outcomes[12].reply,
                    combinedCalls: result.outcomes[12].calls,
                    world: result.failedFixture.world, session: result.failedFixture.session },
                { name: 'multi_speaker', baseline: result.outcomes.at(-1).reply,
                    combinedCalls: result.outcomes.at(-1).calls,
                    world: result.finalFixture.world, session: result.finalFixture.session }
            ] }));
        assert.equal(bindingCalls, 46,
            'new repair proposals are bound; an identical rejected proposal is not retried');
        await page.reload();
        await page.waitForFunction(() => state.worldInstances?.bound_test?.sessions?.some(session => session.outfit === 'green coat'));
        const reloaded = await page.evaluate(() => {
            const session = state.worldInstances.bound_test.sessions.find(item => item.outfit === 'green coat');
            return { receipt: session.worldTurnReceipts?.at(-1)?.receipt,
                sceneMemory: session.history.at(-1)?.sceneMemory,
                aslanObservations: session.entityStates.aslan.observations };
        });
        assert.deepEqual(reloaded.receipt, result.localStand.receipt.receipt);
        assert.deepEqual(reloaded.sceneMemory, result.localStand.sceneMemory);
        assert(reloaded.aslanObservations.some(item => item.text === 'You say, "I will follow."'));
        console.log('P2.8 browser metrics:', JSON.stringify(Object.fromEntries([
            ['clean', result.outcomes[0]], ['repaired', result.outcomes[5]],
            ['recovered', result.recovered], ['recovered_attempt', result.recoveredAttempt],
            ['failed', result.movementFailure],
            ['joint_move', result.positiveJoint], ['joint_move_repaired', result.movementRepaired],
            ['pickup', result.itemPickup], ['npc_follows', result.npcFollows],
            ['npc_refuses', result.npcRefuses], ['npc_state', result.npcState],
            ['partial', result.partialTurn]
        ].map(([name, turn]) => [name, { calls: turn.calls, durationMs: turn.durationMs }]))));
        console.log('PASS browser: bound receipts, effect trace, speaker evidence, scoped NPC memory, rollback and reload');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
