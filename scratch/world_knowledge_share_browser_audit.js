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
            if (url.hostname !== 'knowledge-share.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/'
                ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file))
                return route.fulfill({ status: 404, body: '' });
            return route.fulfill({ contentType: { '.html': 'text/html',
                '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)]
                || 'application/octet-stream', body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        await page.goto('https://knowledge-share.test/');
        await page.waitForFunction(() => typeof runLivingWorldTick === 'function'
            && !!globalThis.HordeNpcGoalActions);
        const result = await page.evaluate(() => {
            clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer);
            const world = { id: 'knowledge_browser', name: 'Knowledge Browser',
                startLocationId: 'player_room', hudConfig: { timeStep: 5 },
                gameRules: { modules: { livingWorld: true } }, locations: [
                    { id: 'player_room', name: 'Player room', exits: [] },
                    { id: 'hall', name: 'Hall', exits: [{ targetLocationId: 'workshop' }] },
                    { id: 'workshop', name: 'Workshop', exits: [{ targetLocationId: 'hall' }] }
                ], entities: [
                    { id: 'a', type: 'npc', name: 'Ada', startLocation: 'hall',
                        goal: 'Tell Ben about the crash', goalPriority: 90 },
                    { id: 'b', type: 'npc', name: 'Ben', startLocation: 'hall',
                        goal: 'Maintain Hall', goalPriority: 20 },
                    { id: 'c', type: 'npc', name: 'Cy', startLocation: 'hall' }
                ], reactionRules: [{ id: 'investigate_report',
                    on: { sourceType: 'told', evidenceMode: 'hearsay', kind: 'disturbance' },
                    goal: { goal: 'Inspect Workshop', priority: 95,
                        completion: { type: 'actor_location', locationId: 'workshop' } } }] };
            state.worlds = [world];
            state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            const sess = prepareCurrentWorldSession(); sess.setupComplete = true;
            normalizeLivingWorldState(world, sess);
            sess.placeDiscoveries ||= {};
            sess.placeDiscoveries.a = ['hall', 'workshop'];
            sess.placeDiscoveries.b = ['hall', 'workshop'];
            sess.placeDiscoveries.c = ['hall', 'workshop'];
            sess.entityStates.a.observations = [{ id: 'obs_crash_a',
                eventId: 'event_crash', text: 'A crash came from Workshop.',
                sourceType: 'witnessed', evidenceMode: 'direct', kind: 'disturbance',
                allowedToShare: true, turn: 0, confidence: 1 }];
            sess.turnCount = 1;
            runLivingWorldTick(world, sess);
            const first = structuredClone(sess);
            const restored = JSON.parse(JSON.stringify(sess));
            Object.assign(sess, restored);
            sess.turnCount = 2;
            runLivingWorldTick(world, sess);
            const second = structuredClone(sess);
            runLivingWorldTick(world, sess);
            return { first, second, repeated: structuredClone(sess) };
        });
        const report = result.first.entityStates.b.observations.find(item =>
            item.sourceType === 'told');
        assert(report, 'autonomous NPC must deliver a confirmed report');
        assert.equal(report.sourceNpcId, 'a');
        assert.equal(report.sourceObservationId, 'obs_crash_a');
        assert.equal(report.evidenceMode, 'hearsay');
        assert.equal(result.first.entityStates.c.observations.length, 0);
        assert.equal(result.first.playerKnownEvents?.length || 0, 0);
        assert(result.first.turnEvents.some(event => event.type === 'dialogue'
            && event.actor_id === 'a' && event.target_id === 'b' && event.committed));
        assert.equal(result.second.entityStates.b.goal, 'Inspect Workshop');
        assert.equal(result.second.entityStates.b.location, 'workshop');
        assert(result.second.turnEvents.some(event => event.actor_id === 'b'
            && event.type === 'movement' && event.committed));
        assert.equal(result.second.entityStates.b.goalPool[0].sourceObservationId, report.id);
        assert.equal(result.second.entityStates.b.goalPool.length, 1);
        assert.equal(result.second.entityStates.b.observations.find(item =>
            item.id === report.id).deliveryActionId, report.deliveryActionId);
        assert.equal(result.repeated.entityStates.b.observations.length,
            result.second.entityStates.b.observations.length);
        console.log('PASS browser knowledge share: autonomous offscreen delivery, provenance, reaction priority, confirmed move, reload, repeated tick');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
