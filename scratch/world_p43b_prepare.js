/** P4.3b: import the real Vault export in a fresh browser context; no model calls. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();

const root = path.resolve(__dirname, '..');
const output = path.join(__dirname, 'world-model-p43b-2026-10-27');
const source = path.join(output, 'The_Submission_Vault_source.horde_world');
const worldBytes = fs.readFileSync(source);

function serve(context) {
    return context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname !== 'p43b-isolated.test') return route.abort();
        const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
            return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ contentType: { '.html': 'text/html', '.js': 'text/javascript',
            '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    });
}

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext({ acceptDownloads: true });
        await serve(context);
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.goto('https://p43b-isolated.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
        await page.evaluate(() => { clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer); });
        const [chooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            page.evaluate(() => document.getElementById('import-world-btn').click())
        ]);
        await chooser.setFiles({ name: 'The_Submission_Vault_source.horde_world',
            mimeType: 'application/json', buffer: worldBytes });
        await page.waitForFunction(() => state.worlds.some(world => world.name === 'The Submission Vault'),
            null, { timeout: 120000 });
        const result = await page.evaluate(async () => {
            const world = state.worlds.find(item => item.name === 'The Submission Vault');
            assertWorld(world);
            state.activeWorldId = world.id;
            state.worldInstances[world.id] = { sessions: [{ id: 'p43b_fresh_session', name: 'P4.3b isolated Master' }],
                activeSessionId: 'p43b_fresh_session' };
            const sess = state.worldInstances[world.id].sessions[0];
            resetWorldTimeline(world, sess);
            prepareCurrentWorldSession();
            const master = world.startingLives.find(item => item.name === 'Master');
            if (!master) throw Error('Master starting life missing');
            applyStartingLifeToSession(world, sess, master.id);
            sess.setupComplete = true;
            await saveWorldsState();
            const saved = (await HordeDB.get(`worldInstance:${world.id}`))?.sessions?.find(item => item.id === sess.id);
            const locationStates = Object.fromEntries(Object.entries(sess.locationStates || {}).map(([id, value]) =>
                [id, { ...value }]));
            const entities = world.entities.map(item => ({ id: item.id, name: item.name, type: item.type,
                locationId: item.locationId ?? null, startLocation: item.startLocation ?? null,
                requiredItem: item.requiredItem ?? null,
                sessionState: sess.entityStates[item.id] ?? null }));
            const locations = world.locations.map(item => ({ id: item.id, name: item.name,
                access: item.access ?? null, accessRules: item.accessRules ?? null,
                exits: item.exits ?? [] }));
            return { world: { id: world.id, name: world.name, locations, entities,
                    startingLives: world.startingLives, gameRules: world.gameRules, kernel: world.kernel },
                session: { id: sess.id, originId: sess.originId, playerLocation: sess.playerLocation,
                    inventory: sess.inventory, entityStates: sess.entityStates, locationStates,
                    playerStats: sess.playerStats, npcRelationships: sess.npcRelationships,
                    turnEvents: sess.turnEvents, history: sess.history, setupComplete: sess.setupComplete },
                saved: saved && { id: saved.id, originId: saved.originId, playerLocation: saved.playerLocation,
                    inventory: saved.inventory, entityStates: saved.entityStates,
                    locationStates: saved.locationStates, setupComplete: saved.setupComplete } };
            function assertWorld(value) { if (!value) throw Error('Imported world missing'); }
        });
        const npc = result.world.entities.filter(item => item.type === 'npc');
        assert.equal(result.world.locations.length, 11);
        assert.equal(result.world.entities.length, 32);
        assert.equal(npc.length, 4);
        assert.equal(result.session.playerLocation, 'loc_antechamber');
        assert(result.session.inventory.includes('Cell key'));
        assert.deepEqual(result.session.inventory, result.saved.inventory);
        assert.deepEqual(result.session.entityStates, result.saved.entityStates);
        fs.writeFileSync(path.join(output, 'import-session.json'), JSON.stringify({ ...result, pageErrors }, null, 2));
        console.log(JSON.stringify({ rooms: result.world.locations.length, entities: result.world.entities.length,
            npcs: npc.map(item => ({ name: item.name, definitionLocationId: item.locationId,
                definitionStartLocation: item.startLocation, loadedLocation: item.sessionState?.location })),
            playerLocation: result.session.playerLocation, inventory: result.session.inventory,
            saved: !!result.saved, pageErrors }, null, 2));
        await context.close();
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
