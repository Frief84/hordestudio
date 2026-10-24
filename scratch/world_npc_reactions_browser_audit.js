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
            if (url.hostname !== 'npc-reactions.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/'
                ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file))
                return route.fulfill({ status: 404, body: '' });
            return route.fulfill({ contentType: { '.html': 'text/html',
                '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)]
                || 'application/octet-stream', body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        await page.goto('https://npc-reactions.test/');
        await page.waitForFunction(() => !!globalThis.HordeWorldPerception
            && !!globalThis.HordeNpcGoalActions && typeof runLivingWorldTick === 'function');
        const result = await page.evaluate(() => {
            clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer);
            const world = { id: 'reaction_browser', name: 'Reaction Browser',
                startLocationId: 'player_room', hudConfig: { timeStep: 5 },
                gameRules: { modules: { livingWorld: true } }, locations: [
                    { id: 'player_room', name: 'Player room', exits: [] },
                    { id: 'workshop', name: 'Workshop', exits: [{ targetLocationId: 'corridor' }] },
                    { id: 'corridor', name: 'Corridor', exits: [{ targetLocationId: 'workshop' }] }
                ], entities: [
                    { id: 'keeper', type: 'npc', name: 'Keeper', startLocation: 'corridor',
                        goal: 'Maintain supplies', goalPriority: 50,
                        personalityTraits: { duty: 90 } },
                    { id: 'bystander', type: 'npc', name: 'Bystander', startLocation: 'corridor',
                        goal: 'Maintain supplies', goalPriority: 50,
                        personalityTraits: { duty: 10 } }
                ], perception: { channels: { hearing: { enabled: true,
                    edgeAttenuation: 1, threshold: 0.5 } } },
                perceptionRules: [{ on: { type: 'environment', action: 'crash' },
                    stimuli: [{ channel: 'hearing', kind: 'disturbance', strength: 3,
                        text: 'A crash.', remoteText: 'A crash from the workshop.' }] }],
                reactionRules: [{ id: 'respond', on: { channel: 'hearing', kind: 'disturbance' },
                    when: [{ source: 'personality', key: 'duty', atLeast: 60 }],
                    goal: { goal: 'Inspect Workshop', priority: 95,
                        completion: { type: 'actor_location', locationId: 'workshop' } } }] };
            state.worlds = [world];
            state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            const sess = prepareCurrentWorldSession(); sess.setupComplete = true;
            sess.placeDiscoveries ||= {};
            sess.placeDiscoveries.keeper = ['corridor', 'workshop'];
            sess.placeDiscoveries.bystander = ['corridor', 'workshop'];
            normalizeLivingWorldState(world, sess);
            sess.turnCount = 1;
            const event = { id: 'evt_browser_crash', type: 'environment',
                action: 'crash', status: 'completed', actor_id: 'player',
                location_id: 'workshop' };
            HordeWorldPerception.perceiveConfirmedEvent(world, sess, event);
            const observed = structuredClone({ keeper: sess.entityStates.keeper.observations,
                bystander: sess.entityStates.bystander.observations });
            sess.turnCount = 2;
            runLivingWorldTick(world, sess);
            const after = structuredClone({ keeper: sess.entityStates.keeper,
                bystander: sess.entityStates.bystander,
                turnEvents: sess.turnEvents || [], playerKnownEvents: sess.playerKnownEvents || [] });
            sess.turnCount = 3;
            runLivingWorldTick(world, sess);
            return { observed, after, second: structuredClone({
                keeper: sess.entityStates.keeper, turnEvents: sess.turnEvents || [] }) };
        });
        assert.equal(result.observed.keeper.length, 1);
        assert.equal(result.observed.bystander.length, 1);
        assert.equal(result.after.keeper.goal, 'Inspect Workshop');
        assert.equal(result.after.keeper.location, 'workshop');
        assert.equal(result.after.keeper.goalStatus, 'completed');
        assert.equal(result.after.keeper.goalPool[0].sourceObservationId,
            result.observed.keeper[0].id);
        assert.equal(result.after.bystander.goal, 'Maintain supplies');
        assert.equal(result.after.playerKnownEvents.length, 0);
        assert(result.after.turnEvents.some(event => event.actor_id === 'keeper'
            && event.type === 'movement'));
        assert.equal(result.second.keeper.goal, 'Maintain supplies');
        assert.equal(result.second.keeper.goalPool.length, 1);
        assert.equal(result.second.turnEvents.filter(event => event.actor_id === 'keeper'
            && event.type === 'movement').length, 1);
        console.log('PASS browser NPC reactions: same event, different goals, validated offscreen action, completion, resume, no duplicate action');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
