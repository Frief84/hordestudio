'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
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
                    { id: 'aslan', type: 'npc', name: 'Aslan', startLocation: 'stone' }],
                kernel: { enabled: true, memoryMode: 'ledger', sceneDrafts: true },
                hudConfig: { startTimeHours: 8, timeStep: 5 }, gameRules: { modules: { livingWorld: false } } };
            state.worlds = [world]; state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            const sess = prepareCurrentWorldSession(); sess.setupComplete = true;
            sess.entityStates.lorne = { ...sess.entityStates.lorne, location: 'stone' };
            switchView('worldPlay'); renderWorldPlayState();
            const realFetch = window.fetch;
            const outcomes = [];
            const say = (text, kind = 'speech') => ({ protocol: 'scene_draft_v3', actions: [{
                kind, status: 'resolved', effects: [], response: [{ text }] }] });
            const run = async (input, proposals, finishes = [], failSave = false, streamMode = 'single') => {
                const before = { history: sess.history.length, turn: sess.turnCount,
                    version: sess.worldStateVersion || 0, outfit: sess.outfit,
                    time: getWorldTimeData(world, sess).currentTotalMinutes };
                let calls = 0;
                const budgets = [];
                window.fetch = async (url, options = {}) => {
                    if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                    const body = JSON.parse(options.body);
                    budgets.push(body.max_tokens);
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
                    time: getWorldTimeData(world, sess).currentTotalMinutes };
                return { calls, budgets, before, after, saved: saved && { history: saved.history.length,
                    turn: saved.turnCount, outfit: saved.outfit, time: saved.worldClock?.absoluteMinutes },
                    input: document.getElementById('world-user-input').value,
                    error: document.getElementById('world-turn-error-text')?.textContent,
                    receipt: sess.worldTurnReceipts?.at(-1), reply: sess.history.at(-1)?.text };
            };
            const aslan = `Aslan slowly raises his head, his faintly glowing golden eyes settling on the traveller.
"How observant. And here I was, hoping to pass for a particularly handsome pebble."
He shifts slightly on his sun-warmed stone.
"Tell me, traveller, do you often stop to insult the local wildlife, or am I receiving special treatment?"`;
            outcomes.push(await run(aslan, [say('Lorne leans on his staff. "Special treatment, naturally. Most pebbles are less conversational."')]));
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
            window.fetch = realFetch;
            return { outcomes, npcLocation: sess.entityStates.lorne.location,
                scheduled: sess.scheduledEvents, history: sess.history.map(message => message.text) };
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
            assert.equal(turn.saved.history, turn.after.history);
            assert.equal(turn.saved.time, turn.after.time);
            assert.equal(turn.after.time, turn.before.time + (index === 9 ? 10 : 5));
            assert.equal(turn.receipt.receipt.clock.absolute_minutes, turn.after.time);
            assert(turn.receipt.audit.binding.turnId);
        }
        assert.equal(result.outcomes[0].calls, 1);
        assert.equal(result.outcomes[14].calls, 2,
            'an isolated quote must be repaired before the turn is saved');
        assert(!result.history.includes('"'), 'an isolated quote must not be saved as a reply');
        assert.equal(result.outcomes.at(-4).calls, 1,
            'a segmented conversation needs no model reconciliation call');
        assert(result.outcomes.at(-4).receipt.audit.binding.repairs.some(item =>
            item.type === 'merge_conversational_actions'));
        assert.equal(result.outcomes.at(-3).calls, 1,
            'an unsupported optional deadline needs no model reconciliation call');
        assert(result.outcomes.at(-3).receipt.audit.binding.repairs.some(item =>
            item.type === 'discard_unsupported_new_commitment'));
        assert.equal(result.outcomes[5].calls, 3, JSON.stringify(result.outcomes[5]));
        assert.equal(result.outcomes[5].after.outfit, 'blue coat');
        assert.deepEqual(result.outcomes[6].budgets, [4096, 8192, 16384]);
        assert(!result.history.some(text => /INCOMPLETE/.test(text)));
        assert.equal(result.npcLocation, 'path');
        assert.equal(result.scheduled.length, 1);
        assert.equal(result.scheduled[0].title, 'Agreed meeting');
        assert.equal(result.scheduled[0].dueMinute, 1950);
        assert.equal(result.outcomes[11].calls, 3);
        assert.match(result.outcomes[11].error, /unverified_action_success/);
        assert.equal(result.outcomes[12].after.outfit, 'blue coat');
        assert(!result.history.some(text => text.includes('Lorne arrives with a black cloak')));
        assert.deepEqual(result.outcomes[12].receipt.audit.actions.map(action => action.outcome), ['failed', 'skipped']);
        assert.equal(result.outcomes.at(-2).calls, 2,
            'an unsupported effect on a narrative gesture is removed by repair');
        assert(result.outcomes.at(-1).receipt.receipt.events.some(event =>
            event.type === 'observation' && event.actor_id === 'aslan'),
        'derived NPC knowledge must reach the persisted linked receipt');
        assert.equal(bindingCalls, 26, 'every repaired draft is bound and checked again');
        await page.reload();
        await page.waitForFunction(() => state.worldInstances?.bound_test?.sessions?.some(session => session.outfit === 'blue coat'));
        console.log('PASS browser: server binding worker, Aslan/Lorne, dialogue/gestures, autonomous movement, effect preservation, two truncation retries, exact clock, atomic storage failure and reload');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
