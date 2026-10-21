/** IndexedDB continuation for the Phase 4 World time probe. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');
const id = 'phase4_time_fixture';

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext();
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname !== 'world-time.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
                return route.fulfill({ status: 404, body: '' });
            const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
            return route.fulfill({ contentType: mime, body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('https://world-time.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer,
            null, { timeout: 30000 });
        const before = await page.evaluate(async id => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            await Promise.all([saveStateInFlight, worldSaveInFlight].filter(Boolean));
            const world = {
                id, name: 'Paused World', startLocationId: 'a', mediaAssets: [],
                hudConfig: { timeStep: 0, startTimeHours: 8 },
                settings: { timeAdvancesWhenAway: true },
                locations: [{ id: 'a', name: 'A', exits: [] }], entities: []
            };
            const sess = {
                id: 'legacy_session', name: 'Legacy session', history: [], turnCount: 1,
                playerLocation: 'a', bonusTimeMinutes: 0, entityStates: {},
                settings: { timeAdvancesWhenAway: true },
                lastBackgroundSeenAt: Date.now() - 600100,
                worldClock: { absoluteMinutes: 480, turnCount: 1, bonusTimeMinutes: 0 },
                scheduledEvents: [{ id: 'due', title: 'Due', description: 'An event',
                    dueMinute: 510, status: 'scheduled' }]
            };
            state.worlds.push(world);
            state.worldInstances[id] = { activeSessionId: sess.id, sessions: [sess] };
            await saveWorldsState({ worldId: id });
            const result = await runWorldBackgroundCatchUp(world, sess);
            return { ok: result.ok, reason: result.proof?.reason, ticks: result.ticks,
                minute: sess.worldClock.absoluteMinutes, event: sess.scheduledEvents[0].status,
                savedMinute: (await HordeDB.get(`worldInstance:${id}`)).sessions[0].worldClock.absoluteMinutes };
        }, id);
        assert.deepEqual(before, { ok: true, reason: 'paused', ticks: 0,
            minute: 480, event: 'scheduled', savedMinute: 480 });

        await page.reload();
        await page.waitForFunction(id => state.worldInstances?.[id]?.sessions?.[0], id, { timeout: 30000 });
        const afterReload = await page.evaluate(async id => {
            const world = state.worlds.find(item => item.id === id);
            const sess = state.worldInstances[id].sessions[0];
            const paused = getWorldTimeData(world, sess).currentTotalMinutes;
            sess.turnCount++;
            const nextTurn = getWorldTimeData(world, sess).currentTotalMinutes;
            sess.bonusTimeMinutes += 30;
            const manual = getWorldTimeData(world, sess).currentTotalMinutes;
            await saveWorldsState({ worldId: id });
            return { paused, nextTurn, manual, event: sess.scheduledEvents[0].status };
        }, id);
        assert.deepEqual(afterReload, { paused: 480, nextTurn: 480, manual: 510, event: 'scheduled' });

        await page.reload();
        await page.waitForFunction(id => state.worldInstances?.[id]?.sessions?.[0], id, { timeout: 30000 });
        const resumed = await page.evaluate(async id => {
            const world = state.worlds.find(item => item.id === id);
            const sess = state.worldInstances[id].sessions[0];
            const savedManual = getWorldTimeData(world, sess).currentTotalMinutes;
            sess.lastBackgroundSeenAt = Date.now() - 600100;
            const paused = await runWorldBackgroundCatchUp(world, sess);
            const stillPaused = sess.worldClock.absoluteMinutes;
            world.hudConfig.timeStep = 5;
            sess.lastBackgroundSeenAt = Date.now() - 600100;
            const active = await runWorldBackgroundCatchUp(world, sess);
            return { savedManual, pausedTicks: paused.ticks, stillPaused,
                activeTicks: active.ticks, finalMinute: sess.worldClock.absoluteMinutes,
                event: sess.scheduledEvents[0].status,
                savedFinal: (await HordeDB.get(`worldInstance:${id}`)).sessions[0].worldClock.absoluteMinutes };
        }, id);
        assert.deepEqual(resumed, { savedManual: 510, pausedTicks: 0, stillPaused: 510,
            activeTicks: 1, finalMinute: 570, event: 'triggered', savedFinal: 570 });
        const setClock = await page.evaluate(async id => {
            const world = state.worlds.find(item => item.id === id);
            const sess = state.worldInstances[id].sessions[0];
            const minute = HordeWorldTime.setAbsoluteMinutes(world, sess, 600).currentTotalMinutes;
            await saveWorldsState({ worldId: id });
            return minute;
        }, id);
        assert.equal(setClock, 600);
        await page.reload();
        await page.waitForFunction(id => state.worldInstances?.[id]?.sessions?.[0], id, { timeout: 30000 });
        assert.deepEqual(await page.evaluate(id => {
            const world = state.worlds.find(item => item.id === id);
            const sess = state.worldInstances[id].sessions[0];
            return { minute: getWorldTimeData(world, sess).currentTotalMinutes,
                event: sess.scheduledEvents[0].status };
        }, id), { minute: 600, event: 'triggered' });
        const legacy = await page.evaluate(async id => {
            const world = state.worlds.find(item => item.id === id);
            const sess = { id: 'before_world_clock', name: 'Earlier session', history: [],
                turnCount: 1, playerLocation: 'a', bonusTimeMinutes: 0,
                entityStates: {}, settings: { timeAdvancesWhenAway: true },
                lastBackgroundSeenAt: Date.now() - 600100, scheduledEvents: [] };
            state.worldInstances[id].sessions.push(sess);
            await saveWorldsState({ worldId: id });
            const result = await runWorldBackgroundCatchUp(world, sess);
            return { ticks: result.ticks, minute: sess.worldClock.absoluteMinutes };
        }, id);
        assert.deepEqual(legacy, { ticks: 1, minute: 540 });
        await page.reload();
        await page.waitForFunction(id => state.worldInstances?.[id]?.sessions?.length === 2,
            id, { timeout: 30000 });
        assert.deepEqual(await page.evaluate(id => state.worldInstances[id].sessions
            .map(sess => [sess.id, sess.worldClock.absoluteMinutes]), id),
        [['legacy_session', 600], ['before_world_clock', 540]]);
        assert.deepEqual(errors, []);
        console.log('PASS World time browser: paused and manual time survive IndexedDB reload; enabled background resumes');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
