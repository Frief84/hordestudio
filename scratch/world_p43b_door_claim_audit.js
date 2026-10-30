/** Regression for a committed unlock event without an actual door transition. */
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
            if (url.hostname !== 'p43b-door-audit.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
                return route.fulfill({ status: 404, body: '' });
            return route.fulfill({ contentType: { '.html': 'text/html', '.js': 'text/javascript',
                '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        await page.goto('https://p43b-door-audit.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
        const result = await page.evaluate(() => {
            clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer);
            const doorId = 'door:foyer::round';
            const world = { id: 'p43b_door_regression', locations: [
                { id: 'foyer', name: 'Foyer', exits: [{ targetLocationId: 'round', doorId,
                    lockState: 'locked', requiredItem: 'Cell key' }] },
                { id: 'round', name: 'Round Room', exits: [{ targetLocationId: 'foyer', doorId,
                    lockState: 'locked', requiredItem: 'Cell key' }] }
            ], entities: [], gameRules: { modules: {} } };
            const before = { playerLocation: 'foyer', inventory: ['Cell key'], entityStates: {},
                turnEvents: [], worldStateVersion: 0 };
            const after = { ...structuredClone(before), worldStateVersion: 1, unlockedExits: {},
                turnEvents: [{ type: 'interaction', actor_id: 'player', status: 'completed',
                    action: 'unlock', target_id: doorId, committed: true, world_state_version: 1 }] };
            const receipt = { events: [{ type: 'interaction', actor_id: 'player', status: 'completed',
                action: 'unlock', target_id: doorId }], passages: [] };
            const narrative = 'The lock clicks and the door to the Round Room swings open.';
            const unsupported = worldFinalNarrativeConflicts(world, before, after, narrative,
                'I unlock the Round Room door with the Cell key.', receipt);
            const noEventReceipt = { events: [], passages: [] };
            const narrativeOnly = worldFinalNarrativeConflicts(world, before, after,
                'The door to the Round Room swings open with a creak.',
                'I unlock the Round Room door with a brass key.', noEventReceipt);
            after.unlockedExits[doorId] = true;
            const supported = worldFinalNarrativeConflicts(world, before, after, narrative,
                'I unlock the Round Room door with the Cell key.', receipt);
            after.unlockedExits = {};
            receipt.events[0].status = 'attempted';
            const attempted = worldFinalNarrativeConflicts(world, before, after,
                'You try the lock, but it does not open.', 'I try to unlock the door.', receipt);
            return { unsupported, narrativeOnly, supported, attempted };
        });
        assert(result.unsupported.some(item => item.reason === 'uncommitted_door_opening'),
            JSON.stringify(result));
        assert(result.narrativeOnly.some(item => item.reason === 'uncommitted_door_opening'),
            JSON.stringify(result));
        assert(!result.supported.some(item => item.reason === 'uncommitted_door_opening'),
            JSON.stringify(result));
        assert(!result.attempted.some(item => item.reason === 'uncommitted_door_opening'),
            JSON.stringify(result));
        console.log('PASS P4.3b door claim requires authoritative lock transition');
        await context.close();
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
