/** Deterministic browser audit through the actual World Studio and transcript. */
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
            if (url.hostname !== 'p41.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/'
                ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file)
                || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
            return route.fulfill({ contentType: { '.html': 'text/html', '.js': 'text/javascript',
                '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream',
                body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('https://p41.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
        if (await page.locator('#modal-overlay').isVisible()) await page.locator('#close-modal-btn').click();
        await page.evaluate(() => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            const world = { id: 'p41_world', name: 'P4.1 World', description: 'Audit world', dmPrompt: 'Stay concise.',
                intro: '', locations: [{ id: 'room', name: 'Room', exits: [] }], entities: [],
                startLocationId: 'room', gameRules: { profileId: 'custom',
                    universalChecks: { enabled: false, rules: [] } },
                hudConfig: { startTimeHours: 8, startTimeMinutes: 0, timeStep: 5, stats: [] } };
            state.worlds = [world];
            state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            const sess = prepareCurrentWorldSession();
            sess.setupComplete = true;
            openWorldStudio(world.id);
        });
        await page.locator('.world-studio-tab[data-tab="w-hud"]').click();
        const toggle = page.locator('#w-universal-checks-enabled');
        assert.equal(await toggle.isChecked(), false);
        await toggle.check();
        assert.equal(await page.evaluate(() => state.editingWorld.gameRules.universalChecks.enabled), true);
        await toggle.uncheck();
        assert.equal(await page.evaluate(() => state.editingWorld.gameRules.universalChecks.enabled), false);
        await toggle.check();
        await page.locator('#save-world-btn').click();
        await page.waitForFunction(() => state.worlds[0]?.gameRules?.universalChecks?.enabled === true);
        const roundTrip = await page.evaluate(() => {
            const imported = validateWorldData(JSON.parse(JSON.stringify(state.worlds[0])));
            normalizeAuthoredWorld(imported);
            return imported.gameRules.universalChecks.enabled;
        });
        assert.equal(roundTrip, true, 'export/import validation dropped the rule switch');
        await page.evaluate(() => {
            getCurrentWorldSession().setupComplete = false;
            window.__p41Began = false;
            openSessionZero(() => { window.__p41Began = true; });
        });
        assert.equal(await page.locator('#sz-life-seed-enabled').isChecked(), false);
        await page.locator('#sz-begin-btn').click();
        await page.waitForFunction(() => window.__p41Began && getCurrentWorldSession()?.setupComplete === true);
        assert.equal(await page.evaluate(() => !!getCurrentWorldSession().setupSnapshot), true);
        await page.evaluate(async () => {
            window.__p41Skipped = false;
            window.executeWorldTurn = async () => { window.__p41Skipped = true; };
            await createNewWorldSession();
        });
        assert.match(await page.locator('#sz-skip-btn').textContent(), /Start without life setup/i);
        await page.locator('#sz-skip-btn').click();
        await page.waitForFunction(() => window.__p41Skipped && getCurrentWorldSession()?.setupComplete === true);
        const result = await page.evaluate(async () => {
            const world = state.worlds[0];
            const sess = getCurrentWorldSession();
            openSessionZero();
            const controls = ['world-session-zero-overlay-title', 'sz-persona-select', 'sz-life-seed-enabled',
                'sz-origin-list', 'sz-begin-btn', 'sz-skip-btn'].every(id => !!document.getElementById(id));
            document.getElementById('sz-skip-btn').click();
            const check = { rule_id: 'focus', name: 'Focus', action_id: 'a', actor_id: 'player',
                values: [{ key: 'focus', actual: 7 }], modifiers: [], random: null, total: 7,
                difficulty: 6, result_id: 'pass', kind: 'success', receipt_id: 'turn_1' };
            sess.history = [{ id: 'dm_1', role: 'dm', text: 'The inscription responds.',
                versions: ['The inscription responds.'], currentVersion: 0, checkResults: [check] }];
            addWorldMessage('dm', 'The second take is different.', { isReroll: true,
                checkResults: [{ ...check, kind: 'failure', result_id: 'fail' }],
                deferPersist: true, deferEmbedding: true }, sess, world);
            const rerollKeptBoth = sess.history[0].versionTakeMetadata?.[0]?.checkResults?.[0]?.kind === 'success'
                && sess.history[0].checkResults?.[0]?.kind === 'failure';
            sess.history[0].currentVersion = 0;
            sess.history[0].text = sess.history[0].versions[0];
            applyWorldTakeMetadata(sess.history[0], sess.history[0].versionTakeMetadata[0]);
            switchView('worldPlay');
            renderWorldPlayState();
            await saveWorldsState();
            await saveState();
            return { controls, rerollKeptBoth, card: document.querySelector('.world-check-card')?.textContent || '',
                cards: document.querySelectorAll('.world-check-card').length };
        });
        assert.equal(result.controls, true);
        assert.equal(result.rerollKeptBoth, true);
        assert.equal(result.cards, 1);
        assert.match(result.card, /Focus/);
        assert.match(result.card, /Success/);
        await page.reload();
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
        await page.evaluate(() => { switchView('worldPlay'); renderWorldPlayState(); });
        assert.equal(await page.locator('.world-check-card').count(), 1, 'saved result card disappeared after reload');
        assert.equal(await page.evaluate(() => state.worlds[0].gameRules.universalChecks.enabled), true);
        assert.deepEqual(errors, []);
        console.log('PASS P4.1 World Studio save/reload, Session Zero begin/skip, reroll take, result card reload');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
