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
            if (url.hostname !== 'npc-multi.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/'
                ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file))
                return route.fulfill({ status: 404, body: '' });
            return route.fulfill({ contentType: { '.html': 'text/html',
                '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)]
                || 'application/octet-stream', body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        await page.goto('https://npc-multi.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined'
            && !!companionAgencyTimer);
        const result = await page.evaluate(() => {
            clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer);
            const pickup = actor => ({ label: 'take shared key', effect: {
                type: 'item_transfer', payload: { actor_id: actor,
                    item_id: 'key', from_id: 'store', to_id: actor } } });
            const move = (actor, place) => ({ label: `go to ${place}`, effect: {
                type: 'actor_move', payload: { actor_id: actor,
                    to_location_id: place } } });
            const world = { id: 'multi_goal', name: 'Multi Goal',
                startLocationId: 'player_room', hudConfig: { timeStep: 5 },
                gameRules: { modules: { livingWorld: true } }, locations: [
                    { id: 'player_room', name: 'Player room', exits: [] },
                    { id: 'store', name: 'Store', exits: [
                        { targetLocationId: 'shelter' }, { targetLocationId: 'archive' }] },
                    { id: 'shelter', name: 'Shelter', exits: [
                        { targetLocationId: 'store' }, { targetLocationId: 'archive' }] },
                    { id: 'archive', name: 'Archive', exits: [] },
                    { id: 'remote', name: 'Remote', exits: [{ targetLocationId: 'remote_end' }] },
                    { id: 'remote_end', name: 'Remote end', exits: [] }
                ], entities: [
                    { id: 'keeper', type: 'npc', name: 'Keeper', startLocation: 'store',
                        goal: 'Reach archive with key', goalPriority: 50,
                        goalActionSteps: [pickup('keeper'), move('keeper', 'archive')],
                        goalCompletion: { type: 'actor_location', locationId: 'archive' },
                        goalPool: [{ goal: 'Reach shelter', priority: 10,
                            actionSteps: [move('keeper', 'shelter')],
                            completion: { type: 'actor_location', locationId: 'shelter' } }] },
                    { id: 'rival', type: 'npc', name: 'Rival', startLocation: 'store',
                        goal: 'Get key', goalActionSteps: [pickup('rival')] },
                    { id: 'remote_actor', type: 'npc', name: 'Remote actor',
                        startLocation: 'remote', goal: 'Reach remote end',
                        goalActionSteps: [move('remote_actor', 'remote_end')] },
                    { id: 'eater', type: 'npc', name: 'Eater', startLocation: 'remote',
                        goal: 'Consume ration', goalCompletion: { type: 'confirmed_event',
                            eventType: 'inventory', targetId: 'ration' } },
                    { id: 'key', type: 'item', name: 'Key', locationId: 'store' },
                    { id: 'ration', type: 'item', name: 'Ration',
                        properties: { npcConsumable: true } }
                ] };
            state.worlds = [world];
            state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            const sess = prepareCurrentWorldSession(); sess.setupComplete = true;
            for (const id of ['keeper', 'rival', 'remote_actor'])
                sess.entityStates[id].inventory = [];
            sess.entityStates.eater.inventory = ['ration'];
            sess.entityStates.key = { location: 'store' };
            sess.placeDiscoveries ||= {};
            sess.placeDiscoveries.keeper = ['store', 'shelter', 'archive'];
            sess.placeDiscoveries.remote_actor = ['remote', 'remote_end'];
            normalizeLivingWorldState(world, sess);
            const tick = turn => { sess.turnCount = turn; runLivingWorldTick(world, sess); };
            tick(1);
            const first = { keeper: structuredClone(sess.entityStates.keeper),
                rival: structuredClone(sess.entityStates.rival),
                remote: structuredClone(sess.entityStates.remote_actor),
                eater: structuredClone(sess.entityStates.eater),
                key: structuredClone(sess.entityStates.key),
                events: structuredClone(sess.turnEvents || []),
                news: structuredClone(sess.worldNews || []) };
            world.entities[0].goalPool[0].priority = 90;
            tick(2);
            const urgent = structuredClone(sess.entityStates.keeper);
            Object.assign(sess, JSON.parse(JSON.stringify(sess)));
            tick(3);
            const resumed = structuredClone(sess.entityStates.keeper);
            const count = (sess.turnEvents || []).filter(event =>
                event.action_id?.startsWith('npc_goal_keeper_')).length;
            tick(3);
            return { first, urgent, resumed,
                duplicateCount: (sess.turnEvents || []).filter(event =>
                    event.action_id?.startsWith('npc_goal_keeper_')).length,
                count, final: structuredClone(sess.entityStates.keeper) };
        });
        assert.equal(result.first.keeper.goalActionIndex, 1);
        assert.equal(result.first.rival.inventory.length, 0);
        assert.equal(result.first.remote.location, 'remote_end');
        assert.equal(result.first.eater.inventory.length, 0);
        assert.equal(result.first.eater.goalStatus, 'completed');
        assert(!result.first.key.location);
        assert.equal(result.first.events.filter(event => event.item === 'key').length, 1);
        assert.equal(result.first.news.some(item => item.playerVisible === true
            && item.type === 'npc_goal'), false);
        assert.equal(result.urgent.goal, 'Reach shelter');
        assert.equal(result.urgent.goalStatus, 'completed');
        assert.equal(result.urgent.goalStates['Reach archive with key'].goalActionIndex, 1);
        assert.equal(result.resumed.goal, 'Reach archive with key');
        assert.equal(result.resumed.location, 'archive');
        assert.equal(result.resumed.goalStatus, 'completed');
        assert.equal(result.duplicateCount, result.count);
        assert.equal(result.final.inventory.length, 1);
        console.log('PASS multi NPC goals: contention, offscreen rooms, interruption, reload, resume, idempotence');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
