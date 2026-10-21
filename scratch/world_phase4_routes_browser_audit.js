/** P0a.2: isolated browser/IndexedDB route and background continuation audit. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');
const id = 'phase4_routes_fixture';

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext();
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname !== 'world-routes.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
                return route.fulfill({ status: 404, body: '' });
            const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
            return route.fulfill({ contentType: mime, body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('https://world-routes.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer,
            null, { timeout: 30000 });
        const first = await page.evaluate(async id => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            await Promise.all([saveStateInFlight, worldSaveInFlight].filter(Boolean));
            const world = {
                id, name: 'Route audit', startLocationId: 'a', mediaAssets: [],
                hudConfig: { timeStep: 5, startTimeHours: 8, enableSchedules: true },
                settings: { timeAdvancesWhenAway: true },
                locations: [
                    { id: 'a', name: 'A', exits: [
                        { targetLocationId: 'b', travelTime: 60 },
                        { targetLocationId: 'vault', requiredItem: 'key', travelTime: 1 },
                        { targetLocationId: 'secret', travelTime: 1 }] },
                    { id: 'b', name: 'B', exits: [{ text: 'to C', travelTime: 120 }] },
                    { id: 'c', name: 'C', exits: ['to D'] },
                    { id: 'd', name: 'D', exits: [] },
                    { id: 'vault', name: 'Vault', exits: [] },
                    { id: 'secret', name: 'Secret', exits: [],
                        access: { default: 'restricted', npcs: { m: 'deny' } } }
                ],
                entities: [
                    { id: 'n', name: 'N', type: 'npc', startLocation: 'a',
                        schedule: [{ time: '09:00', locationId: 'd', activity: 'working' }] },
                    { id: 'm', name: 'M', type: 'npc', startLocation: 'a',
                        schedule: [{ time: '09:00', locationId: 'secret', activity: 'waiting' }] },
                    { id: 'comp', name: 'Companion', type: 'npc', startLocation: 'a' }
                ]
            };
            const sess = {
                id: 'legacy_route_session', history: [], turnCount: 1,
                playerLocation: 'a', bonusTimeMinutes: 0,
                settings: { timeAdvancesWhenAway: true },
                lastBackgroundSeenAt: Date.now() - 600100,
                worldClock: { absoluteMinutes: 480, turnCount: 1, bonusTimeMinutes: 0 },
                entityStates: { n: { location: 'a' }, m: { location: 'a' }, comp: { location: 'a' } },
                placeDiscoveries: { n: ['b', 'c', 'd'] },
                scheduledEvents: [
                    { id: 'due', title: 'Due', description: 'An event',
                        locationId: 'a', dueMinute: 600, status: 'scheduled' },
                    { id: 'hourly', title: 'Bell', description: 'The bell rings',
                        locationId: 'a', dueMinute: 540, repeatEveryMinutes: 60, status: 'scheduled' },
                    { id: 'turn_only', title: 'Patrol', description: 'Patrol passes',
                        dueTurn: 2, repeatEveryTurns: 2, status: 'scheduled' }
                ]
            };
            state.worlds.push(world);
            state.worldInstances[id] = { activeSessionId: sess.id, sessions: [sess] };
            const view = worldForSession(world, sess);
            const route = findWorldTravelPath(view, 'a', 'd', { session: sess });
            const locked = findWorldTravelPath(view, 'a', 'vault', { session: sess });
            const denied = findWorldTravelPath(view, 'a', 'secret', { session: sess, npcId: 'm' });
            const player = structuredClone(sess);
            const playerMove = movePlayerAlongWorldPath(world, player, view.locations.find(item => item.id === 'd'),
                { companionIds: ['comp'], showTravelToast: false });
            const agent = structuredClone(sess);
            normalizeLivingWorldState(world, agent);
            const agentMove = processStructuredActions({ npc_moves: [{ npc_id: 'n', location_id: 'd' }] },
                world, agent, { deferFeedback: true });
            const deniedAgent = processStructuredActions({ npc_moves: [{ npc_id: 'm', location_id: 'secret' }] },
                world, agent, { deferFeedback: true });
            await saveWorldsState({ worldId: id });
            const result = await runWorldBackgroundCatchUp(world, sess);
            return { route, locked, denied, travelMinutes: playerMove.travelMinutes,
                playerLocation: player.playerLocation, companionLocation: player.entityStates.comp.location,
                agentLocation: agent.entityStates.n.location,
                agentJourney: agent.entityStates.n.journey?.legTravelMinutes,
                agentRejections: agentMove.moduleRejections?.length,
                deniedAgentRejections: deniedAgent.moduleRejections?.length,
                ticks: result.ticks, minute: sess.worldClock.absoluteMinutes,
                npcLocation: sess.entityStates.n.location, journey: sess.entityStates.n.journey,
                deniedLocation: sess.entityStates.m.location,
                eventStatus: sess.scheduledEvents[0].status,
                hourlyDue: sess.scheduledEvents[1].dueMinute,
                turnOnly: sess.scheduledEvents[2].status,
                eventCount: sess.livingWorldActivity.events };
        }, id);
        assert.deepEqual(first.route, ['a', 'b', 'c', 'd']);
        assert.equal(first.locked, null);
        assert.equal(first.denied, null);
        assert.deepEqual([first.travelMinutes, first.playerLocation, first.companionLocation], [180, 'd', 'd']);
        assert.deepEqual([first.agentLocation, first.agentJourney, first.agentRejections,
            first.deniedAgentRejections], [null, [60, 120, 0], 0, 1]);
        assert.deepEqual([first.ticks, first.minute, first.npcLocation, first.deniedLocation, first.eventStatus],
            [1, 540, null, 'a', 'scheduled']);
        assert.deepEqual([first.hourlyDue, first.turnOnly, first.eventCount], [600, 'scheduled', 1]);
        assert.deepEqual(first.journey.legTravelMinutes, [60, 120, 0]);

        await page.reload();
        await page.waitForFunction(id => state.worldInstances?.[id]?.sessions?.[0], id, { timeout: 30000 });
        const continued = await page.evaluate(async id => {
            const world = state.worlds.find(item => item.id === id);
            const sess = state.worldInstances[id].sessions[0];
            const restoredJourney = structuredClone(sess.entityStates.n.journey);
            sess.lastBackgroundSeenAt = Date.now() - 1200100; // two hours: still in transit at 11:00
            const mid = await runWorldBackgroundCatchUp(world, sess);
            const midState = { ticks: mid.ticks, minute: sess.worldClock.absoluteMinutes,
                location: sess.entityStates.n.location, progress: sess.entityStates.n.journey?.progressIndex,
                event: sess.scheduledEvents[0].status,
                hourlyDue: sess.scheduledEvents[1].dueMinute,
                eventCount: sess.livingWorldActivity.events };
            sess.lastBackgroundSeenAt = Date.now() - 600100;
            const end = await runWorldBackgroundCatchUp(world, sess);
            const completed = { ticks: end.ticks, minute: sess.worldClock.absoluteMinutes,
                location: sess.entityStates.n.location, journey: sess.entityStates.n.journey || null,
                denied: sess.entityStates.m.location, event: sess.scheduledEvents[0].status,
                hourlyDue: sess.scheduledEvents[1].dueMinute,
                turnOnly: sess.scheduledEvents[2].status,
                eventCount: sess.livingWorldActivity.events,
                moved: end.moved.map(item => ({ id: item.id, from: item.from, to: item.to,
                    path: item.path })) };
            const closed = structuredClone(sess);
            closed.id = 'closure_session';
            closed.worldClock = { absoluteMinutes: 480, turnCount: 1, bonusTimeMinutes: 0 };
            closed.lastLivingWorldMinute = 480;
            closed.lastLivingWorldTick = 0;
            closed.entityStates.n = { location: 'a' };
            closed.entityStates.m = { location: 'a' };
            closed.scheduledEvents = [{ id: 'closure', title: 'Bridge closes',
                description: 'The route is closed', locationId: 'b',
                conditionOnTrigger: 'impassable', dueMinute: 600, status: 'scheduled' }];
            closed.lastBackgroundSeenAt = Date.now() - 1200100;
            state.worldInstances[id].sessions.push(closed);
            const closureResult = await runWorldBackgroundCatchUp(world, closed);
            const closure = { ticks: closureResult.ticks, minute: closed.worldClock.absoluteMinutes,
                location: closed.entityStates.n.location, journey: closed.entityStates.n.journey || null,
                event: closed.scheduledEvents[0].status,
                condition: closed.locationStates.b?.conditions?.some(item => item.label === 'impassable') };
            sess.lastBackgroundSeenAt = Date.now() - 600100;
            const relevant = source => JSON.stringify(Object.fromEntries([
                'worldClock', 'entityStates', 'scheduledEvents', 'worldNews',
                'playerLocation', 'turnCount', 'lastBackgroundSeenAt', 'engineEvents',
                'placeDiscoveries'
            ].map(key => [key, source[key]])));
            const rollbackBaseline = relevant(sess);
            const save = saveWorldsState;
            saveWorldsState = async () => { throw new Error('test save failure'); };
            let failed;
            try { failed = await runWorldBackgroundCatchUp(world, sess); }
            finally { saveWorldsState = save; }
            const rolledBack = relevant(sess) === rollbackBaseline;
            const persistedAfterFailure = (await HordeDB.get(`worldInstance:${id}`))
                .sessions[0].scheduledEvents[1].dueMinute;
            const retried = await runWorldBackgroundCatchUp(world, sess);
            const retry = { ticks: retried.ticks, minute: sess.worldClock.absoluteMinutes,
                hourlyDue: sess.scheduledEvents[1].dueMinute,
                eventCount: sess.livingWorldActivity.events };
            const noRepeat = await runWorldBackgroundCatchUp(world, sess);
            return { restoredJourney, midState, completed, closure,
                rollbackReason: failed.reason, rolledBack, persistedAfterFailure,
                retry, noRepeatTicks: noRepeat.ticks,
                persisted: (await HordeDB.get(`worldInstance:${id}`)).sessions[0].entityStates.n.location };
        }, id);
        assert.deepEqual(continued.restoredJourney.legTravelMinutes, [60, 120, 0]);
        assert.deepEqual(continued.midState, { ticks: 2, minute: 660,
            location: null, progress: 1, event: 'triggered', hourlyDue: 720, eventCount: 4 });
        assert.deepEqual(continued.completed, { ticks: 1, minute: 720,
            location: 'd', journey: null, denied: 'a', event: 'triggered',
            hourlyDue: 780, turnOnly: 'scheduled', eventCount: 5,
            moved: [{ id: 'n', from: 'a', to: 'd', path: ['a', 'b', 'c', 'd'] }] });
        assert.deepEqual(continued.closure, { ticks: 2, minute: 600,
            location: 'a', journey: null, event: 'triggered', condition: true });
        assert.equal(continued.rollbackReason, 'save_failed');
        assert.equal(continued.rolledBack, true);
        assert.equal(continued.persistedAfterFailure, 780);
        assert.deepEqual(continued.retry, { ticks: 1, minute: 780,
            hourlyDue: 840, eventCount: 6 });
        assert.equal(continued.noRepeatTicks, 0);
        assert.equal(continued.persisted, 'd');
        assert.deepEqual(errors, []);
        console.log('PASS World routes browser: player/companion, NPC schedule/background, access, timed legs, events, reload, rollback');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
