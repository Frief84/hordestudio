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
            if (url.hostname !== 'npc-debug.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/'
                ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file))
                return route.fulfill({ status: 404, body: '' });
            return route.fulfill({ contentType: { '.html': 'text/html',
                '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)]
                || 'application/octet-stream', body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        await page.goto('https://npc-debug.test/');
        await page.waitForFunction(() => typeof renderWorldNpcDebugger === 'function');
        const result = await page.evaluate(() => {
            const world = { id: 'debug_fixture', locations: [
                { id: 'room', name: 'Room' }, { id: 'remote', name: 'Remote' }],
                entities: [
                    { id: 'alice', type: 'npc', name: 'Alice', persona: 'Careful' },
                    { id: 'bob', type: 'npc', name: 'Bob' }
                ] };
            const sess = { id: 'session', turnCount: 7,
                worldClock: { absoluteMinutes: 360 }, lastLivingWorldTick: 7,
                playerLocation: 'room', entityStates: {
                    alice: { location: 'room', goal: 'Find key', goalStatus: 'blocked',
                        goalPool: [{ goal: 'Find key', priority: 60, urgency: 70 },
                            { goal: 'Go home', priority: 40 }],
                        goalSelection: { turn: 7, selectedGoal: 'Find key', candidates: [
                            { goal: 'Find key', score: 102, factors: { priority: 60,
                                urgency: 70, blocked: false } },
                            { goal: 'Go home', score: 40, factors: { priority: 40 } }] },
                        goalActionIndex: 1, goalBlockedReason: 'door_locked',
                        goalActionProgress: { status: 'blocked', index: 1,
                            blockedReason: 'door_locked', lastCheckedTurn: 7 },
                        goalStates: { 'Go home': { goalStatus: 'interrupted',
                            goalActionIndex: 2 } },
                        observations: [
                            { text: 'Saw key', sourceType: 'witnessed', eventId: 'e1',
                                learnedAt: { turn: 6, absoluteMinute: 350 } },
                            { text: 'Key is cursed', sourceType: 'told', sourceNpcId: 'bob',
                                originNpcId: 'bob', sourceObservationId: 'o2',
                                learnedAt: { turn: 7, absoluteMinute: 360 } }] },
                    bob: { location: 'remote', goal: 'Travel', goalStatus: 'active',
                        goalActionProposal: { label: 'Move to Room' } }
                }, turnEvents: [{ id: 'e1', actor_id: 'alice', type: 'inventory',
                    action_id: 'a1', turn: 6, committed: true }],
                worldNews: [{ id: 'n1', text: 'Old news', knownBy: ['alice'], turn: 5 }],
                worldTurnReceipts: [{ turn: 7, audit: { receipt_id: 'r7',
                    turnResolution: { status: 'repaired', failures: [{ reasons: [{
                        reason: 'unwitnessed_companion_or_actor_move',
                        proposedMoves: [{ actor: 'alice', from: 'room', to: 'remote' }],
                        missingWitnesses: [{ actor: 'alice', from: 'room', to: 'remote' }]
                    }] }] } } }] };
            const before = JSON.stringify(sess);
            renderWorldNpcDebugger(world, sess);
            const monitor = document.getElementById('world-debug-monitor');
            const initial = monitor.textContent;
            monitor.querySelectorAll('button')[0].click();
            const inspector = document.getElementById('world-debug-inspector').textContent;
            const after = JSON.stringify(sess);
            const restored = JSON.parse(JSON.stringify(sess));
            renderWorldNpcDebugger(world, restored);
            const reloaded = document.getElementById('world-debug-inspector').textContent;
            document.getElementById('world-debug-goal-filter').value = 'blocked';
            renderWorldNpcDebugger(world, restored);
            const filtered = monitor.querySelectorAll('button').length;
            document.getElementById('world-debug-goal-filter').value = '';
            const legacy = { entityStates: { alice: { location: 'room' },
                bob: { location: 'remote' } }, turnCount: 1 };
            const legacyBefore = JSON.stringify(legacy);
            renderWorldNpcDebugger(world, legacy);
            monitor.querySelector('button').click();
            return { initial, inspector, before, after, reloaded, filtered,
                legacyReadOnly: legacyBefore === JSON.stringify(legacy),
                legacyInspector: document.getElementById('world-debug-inspector').textContent };
        });
        assert.match(result.initial, /Remote \(remote\)/);
        assert.match(result.initial, /Bob/);
        assert.match(result.initial, /Proposed: Move to Room/);
        assert.match(result.inspector, /Go home.*interrupted/s);
        assert.match(result.inspector, /Action index: 2/);
        assert.match(result.inspector, /priority.*60/i);
        assert.match(result.inspector, /door_locked/);
        assert.match(result.inspector, /Own observation.*Saw key/s);
        assert.match(result.inspector, /Report.*Key is cursed.*sender bob/s);
        assert.match(result.inspector, /Committed event.*e1/s);
        assert.match(result.inspector, /unwitnessed_companion_or_actor_move/);
        assert.equal(result.before, result.after);
        assert.equal(result.inspector, result.reloaded);
        assert.equal(result.filtered, 1);
        assert.equal(result.legacyReadOnly, true);
        assert.match(result.legacyInspector, /Stored location: Room \(room\)/);
        console.log('World Monitor and NPC Inspector browser audit passed');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
