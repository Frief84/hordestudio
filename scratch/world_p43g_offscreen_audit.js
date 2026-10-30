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
            if (url.hostname !== 'p43g.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
            return route.fulfill({ contentType: { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        await page.goto('https://p43g.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
        const result = await page.evaluate(() => {
            clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer);
            const pickup = (npc, item) => [{ label: `takes ${item}`, effect: { type: 'item_transfer', payload: { actor_id: npc, item_id: item, from_id: 'garden', to_id: npc } } }];
            const world = { id: 'p43g_garden', name: 'Garden', startLocationId: 'house', hudConfig: { timeStep: 5 }, gameRules: { modules: { livingWorld: true, inventory: true, worldLore: true } }, locations: [
                { id: 'house', name: 'House', exits: [{ targetLocationId: 'garden' }] },
                { id: 'garden', name: 'Garden', exits: [{ targetLocationId: 'house' }] },
                { id: 'bedroom', name: 'Bedroom', exits: [] }
            ], entities: [
                { id: 'linda', type: 'npc', name: 'Linda', startLocation: 'garden', goal: 'Take the watering can', goalActionSteps: pickup('linda', 'can') },
                { id: 'cass', type: 'npc', name: 'Cass', startLocation: 'garden', goal: 'Take the gloves', goalActionSteps: pickup('cass', 'gloves') },
                { id: 'remote', type: 'npc', name: 'Remote', startLocation: 'bedroom' },
                { id: 'can', type: 'item', name: 'Watering can', locationId: 'garden' },
                { id: 'gloves', type: 'item', name: 'Gloves', locationId: 'garden' }
            ] };
            state.worlds = [world]; state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } }; state.activeWorldId = world.id;
            const sess = prepareCurrentWorldSession(); sess.setupComplete = true; sess.playerLocation = 'house';
            for (const id of ['linda', 'cass']) { sess.entityStates[id].location = 'garden'; sess.entityStates[id].inventory = []; }
            sess.entityStates.remote.location = 'bedroom';
            sess.entityStates.can = { location: 'garden' }; sess.entityStates.gloves = { location: 'garden' };
            normalizeLivingWorldState(world, sess);
            runLivingWorldTick(world, sess);
            const firstMinute = sess.lastNpcSimulationMinute;
            sess.bonusTimeMinutes = (sess.bonusTimeMinutes || 0) + 20;
            runLivingWorldTick(world, sess, { clockOnly: true });
            normalizeLivingWorldState(world, sess);
            const after = JSON.parse(JSON.stringify(sess));
            runLivingWorldTick(world, sess, { clockOnly: true });
            const lindaRecall = globalThis.HordeNpcGoalActions.relevantNpcMemories(
                sess.entityStates.linda, sess.worldNews, 'linda', [], 6);
            const cassRecall = globalThis.HordeNpcGoalActions.relevantNpcMemories(
                sess.entityStates.cass, sess.worldNews, 'cass', [], 6);
            const deniedTeleport = worldLinkedMovementVerdict(world, sess, 'player',
                'house', 'garden', { mode: 'teleport' });
            const allowedTeleport = worldLinkedMovementVerdict({ ...world,
                magic: { enabled: true } }, sess, 'player', 'house', 'garden',
                { mode: 'teleport' });
            const reloaded = JSON.parse(JSON.stringify(sess));
            reloaded.bonusTimeMinutes += 10;
            runLivingWorldTick(world, reloaded, { clockOnly: true });
            return { firstMinute, lastMinute: sess.lastNpcSimulationMinute,
                deniedTeleport, allowedTeleport, lindaRecall, cassRecall,
                resumedMinute: reloaded.lastNpcSimulationMinute,
                resumedEvents: reloaded.turnEvents.length, items: [sess.entityStates.linda.inventory, sess.entityStates.cass.inventory],
                linda: sess.entityStates.linda.observations || [], cass: sess.entityStates.cass.observations || [],
                remote: sess.entityStates.remote.observations || [], events: sess.turnEvents || [],
                news: sess.worldNews || [], repeated: JSON.stringify(after) === JSON.stringify(sess) };
        });
        assert(result.items[0].length && result.items[1].length, 'both NPCs act independently');
        assert(result.lastMinute >= result.firstMinute + 20, 'clock catch-up progressed');
        assert.equal(result.resumedMinute, result.lastMinute + 10,
            'saved NPC time cursor resumes after JSON reload');
        assert(result.linda.some(item => item.sourceType === 'told' && item.sourceNpcId === 'cass') || result.cass.some(item => item.sourceType === 'told' && item.sourceNpcId === 'linda'), 'NPC conversation relays sourced knowledge');
        assert.equal(result.remote.length, 0, 'remote NPC remains uninformed');
        assert(result.lindaRecall.observations.length || result.cassRecall.observations.length,
            'later NPC dialogue can retrieve the sourced memory');
        assert(result.events.some(item => item.type === 'dialogue' && item.actor_id !== 'player'), 'conversation has a confirmed event');
        assert(result.news.filter(item => item.type === 'npc_goal').every(item => !item.playerVisible), 'offscreen events are hidden');
        assert(result.repeated, 'same world minute is idempotent');
        assert.equal(result.deniedTeleport.reason, 'teleport_not_authorized');
        assert(result.allowedTeleport.ok, 'explicit magical world can still authorize teleport');
        console.log('PASS P4.3g offscreen: independent NPC actions, conversation, provenance, privacy, time cursor');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
