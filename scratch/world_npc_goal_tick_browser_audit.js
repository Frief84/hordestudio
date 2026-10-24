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
            if (url.hostname !== 'npc-goal.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file))
                return route.fulfill({ status: 404, body: '' });
            return route.fulfill({ contentType: { '.html': 'text/html', '.js': 'text/javascript',
                '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('https://npc-goal.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
        const result = await page.evaluate(() => {
            clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer);
            const steps = [
                { label: 'takes the brass key', effect: { type: 'item_transfer', payload:
                    { actor_id: 'keeper', item_id: 'brass_key', from_id: 'store', to_id: 'keeper' } } },
                { label: 'unlocks the archive door', effect: { type: 'interactable_transition', payload:
                    { actor_id: 'keeper', target_id: 'archive_door', to_state: 'open' } } },
                { label: 'enters the archive', effect: { type: 'actor_move', payload:
                    { actor_id: 'keeper', to_location_id: 'archive' } } }
            ];
            const world = { id: 'goal_tick', name: 'Goal Tick', startLocationId: 'foyer',
                hudConfig: { timeStep: 5 }, gameRules: { modules: { livingWorld: true } },
                locations: [
                    { id: 'foyer', name: 'Foyer', exits: [{ targetLocationId: 'store' }] },
                    { id: 'store', name: 'Store', exits: [{ targetLocationId: 'foyer' },
                        { targetLocationId: 'archive', doorId: 'archive_door',
                            requiredItem: 'Brass key', lockState: 'locked' }] },
                    { id: 'archive', name: 'Archive', exits: [{ targetLocationId: 'store' }] }
                ], entities: [
                    { id: 'keeper', type: 'npc', name: 'Keeper', startLocation: 'store',
                        goal: 'Reach the archive', goalActionSteps: steps,
                        goalCompletion: { type: 'actor_location', locationId: 'archive' } },
                    { id: 'brass_key', type: 'item', name: 'Brass key', locationId: 'store' }
                ] };
            state.worlds = [world]; state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            const sess = prepareCurrentWorldSession(); sess.setupComplete = true;
            sess.entityStates.keeper = { ...sess.entityStates.keeper, location: 'store', inventory: [] };
            sess.entityStates.brass_key = { location: 'store' };
            const freshKey = structuredClone(sess.entityStates.brass_key);
            sess.placeDiscoveries ||= {}; sess.placeDiscoveries.keeper = ['store', 'archive'];
            const record = () => ({ turn: sess.turnCount,
                index: sess.entityStates.keeper.goalActionIndex,
                progress: sess.entityStates.keeper.goalProgress,
                status: sess.entityStates.keeper.goalStatus,
                proof: sess.entityStates.keeper.goalCompletionProof?.eventId,
                blocked: sess.entityStates.keeper.goalBlockedReason,
                location: sess.entityStates.keeper.location,
                inventory: sess.entityStates.keeper.inventory,
                door: sess.unlockedExits?.archive_door,
                events: (sess.turnEvents || []).filter(item =>
                    item.action_id?.startsWith('npc_goal_keeper_')).length,
                news: (sess.worldNews || []).map(item => item.text || item.summary) });
            normalizeLivingWorldState(world, sess);
            const snapshots = [];
            for (let turn = 1; turn <= 3; turn++) {
                sess.turnCount = turn;
                runLivingWorldTick(world, sess);
                snapshots.push(record());
                if (turn === 1) Object.assign(sess, JSON.parse(JSON.stringify(sess)));
                runLivingWorldTick(world, sess);
                snapshots.push(record());
            }
            sess.entityStates.keeper.goalStatus = 'active';
            sess.entityStates.keeper.goalActionIndex = 0;
            sess.entityStates.keeper.goalProgress = 0;
            sess.entityStates.keeper.location = 'store';
            sess.entityStates.keeper.inventory = [];
            sess.entityStates.brass_key.location = null;
            sess.unlockedExits = {};
            sess.turnCount = 4;
            runLivingWorldTick(world, sess);
            const missing = record();
            sess.entityStates.brass_key = structuredClone(freshKey);
            sess.playerLocation = 'store';
            sess.turnCount = 5;
            runLivingWorldTick(world, sess);
            const resumed = record();
            sess.entityStates.keeper.goalAutonomy = 'paused';
            sess.turnCount = 6;
            runLivingWorldTick(world, sess);
            const paused = record();
            sess.entityStates.keeper.goalAutonomy = 'medium';
            sess.entityStates.keeper.goalActionIndex = 2;
            sess.entityStates.keeper.goalProgress = 67;
            sess.entityStates.keeper.location = 'store';
            sess.playerLocation = 'foyer';
            sess.placeDiscoveries.keeper = [];
            sess.turnCount = 7;
            runLivingWorldTick(world, sess);
            const unknownPlace = record();
            sess.placeDiscoveries.keeper = ['store', 'archive'];
            sess.entityStates.keeper.goalActionIndex = 1;
            sess.entityStates.keeper.goalStatus = 'active';
            sess.entityStates.keeper.location = 'store';
            sess.entityStates.keeper.inventory = ['Brass key'];
            sess.unlockedExits.archive_door = true; // another actor opened it
            sess.turnCount = 8;
            runLivingWorldTick(world, sess);
            const externallyOpened = record();
            return { snapshots, missing, resumed, paused, unknownPlace, externallyOpened };
        });
        assert.deepEqual(errors, []);
        assert.deepEqual(result.snapshots.filter((_item, i) => i % 2 === 0).map(item => item.index), [1, 2, 3]);
        assert.deepEqual(result.snapshots.filter((_item, i) => i % 2 === 1).map(item => item.index), [1, 2, 3]);
        assert.deepEqual(result.snapshots.map(item => item.events), [1, 1, 2, 2, 3, 3]);
        assert.equal(result.snapshots[0].location, 'store');
        assert.equal(result.snapshots[2].door, true);
        assert.equal(result.snapshots[4].location, 'archive');
        assert.equal(result.snapshots[4].status, 'completed');
        assert(result.snapshots[4].proof, 'completion has a confirmed receipt');
        assert.equal(result.missing.index, 0);
        assert.equal(result.missing.progress, 0);
        assert.equal(result.missing.door, undefined);
        assert(result.missing.blocked);
        assert.equal(result.resumed.index, 1);
        assert.equal(result.paused.index, 1);
        assert.equal(result.unknownPlace.index, 2);
        assert.equal(result.unknownPlace.location, 'store');
        assert(result.unknownPlace.blocked);
        assert.equal(result.externallyOpened.location, 'archive');
        assert.equal(result.externallyOpened.status, 'completed');
        console.log('PASS NPC goal tick: verified multi-step actions, blocker, resume, pause, visible NPC, idempotence');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
