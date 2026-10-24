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
            if (url.hostname !== 'perception.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/'
                ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file))
                return route.fulfill({ status: 404, body: '' });
            return route.fulfill({ contentType: { '.html': 'text/html',
                '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)]
                || 'application/octet-stream', body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        await page.goto('https://perception.test/');
        await page.waitForFunction(() => !!globalThis.HordeWorldPerception
            && !!globalThis.HordeNpcGoalActions);
        const result = await page.evaluate(() => {
            const world = { locations: [{ id: 'a', exits: [
                { targetLocationId: 'b' }] }, { id: 'b', exits: [] }],
            entities: [{ id: 'near', type: 'npc' }, { id: 'remote', type: 'npc' }],
            perception: { channels: { hearing: { enabled: true,
                edgeAttenuation: 1, threshold: 0.5 } } },
            perceptionRules: [{ on: { type: 'environment' }, stimuli: [
                { channel: 'hearing', strength: 2, text: 'A bell rings.',
                    remoteText: 'A bell is heard from a.' }] }] };
            const session = { turnCount: 2, worldClock: { absoluteMinutes: 20 },
                playerLocation: 'elsewhere', entityStates: {
                    near: { location: 'a', observations: [], goal: 'Find bell' },
                    remote: { location: 'b', observations: [], goal: 'Find bell' }
                } };
            const observations = HordeWorldPerception.perceiveConfirmedEvent(world,
                session, { id: 'evt_bell', type: 'environment', status: 'completed',
                    location_id: 'a', actor_id: 'player' });
            const remembered = HordeNpcGoalActions.relevantNpcMemories(
                session.entityStates.remote, [], 'remote', [], 3);
            return { observations, remembered, session };
        });
        assert.equal(result.observations.length, 2);
        assert.equal(result.remembered.observations[0].text,
            'A bell is heard from a.');
        assert.equal(result.session.entityStates.near.observations[0].eventId,
            'evt_bell');
        assert.equal(result.session.playerKnownEvents, undefined);
        console.log('PASS perception browser: private offscreen observation reaches existing NPC memory selector');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
