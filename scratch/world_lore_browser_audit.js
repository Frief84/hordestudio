'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');
(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        await page.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname !== 'world-lore.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
            const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
            return route.fulfill({ contentType: mime, body: fs.readFileSync(file) });
        });
        await page.goto('https://world-lore.test/');
        await page.waitForFunction(() => typeof setupWorldPlayLogic === 'function' && !!globalThis.HordeWorldLoreUI);
        await page.evaluate(() => {
            clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer);
            const world = { id: 'test', name: 'The Green March', startLocationId: 'road',
                regions: [{ id: 'march', name: 'The Green March', description: 'Forests, rivers and old roads.' }],
                locations: [
                    { id: 'road', name: 'Old Road', placeType: 'road', description: 'A path between fields.', regionId: 'march', exits: [{ targetLocationId: 'forest', travelTime: 30 }] },
                    { id: 'forest', name: 'Whispering Forest', placeType: 'forest', regionId: 'march', description: 'Tall trees hide a sacred grove. Only wardens may enter.', access: { default: 'restricted', includeChildren: true, factions: { wardens: 'allow' } }, exits: [], secrets: [{ id: 'bell', label: 'The buried bell', truth: 'The bell is beneath the oldest oak.', knowledge: { visibility: 'assigned', npcIds: ['mara'], factionIds: [] } }] }
                ], entities: [{ id: 'mara', type: 'npc', name: 'Mara', factionId: 'wardens', description: 'A forest warden.' }, { id: 'iven', type: 'npc', name: 'Iven', description: 'A traveler.' }],
                factions: [{ id: 'wardens', name: 'Wardens', description: 'Keepers of the forest.' }], lorebook: [] };
            state.editingWorld = world; state.worlds = [world]; state.activeWorldId = world.id;
            globalThis.loreTestWorld = world;
            const host = document.createElement('main'); host.id = 'lore-test-host'; host.style.cssText = 'padding:24px;max-width:1200px;margin:auto';
            [...document.body.children].forEach(el => { if (el.tagName !== 'SCRIPT') el.style.display = 'none'; });
            document.body.append(host);
            HordeWorldLoreUI.mount(host, world, { suggest: async row => HordeWorldLore.stageProposals(world, [{ kind: row.kind, targetId: row.id, field: 'knowledge', value: { visibility: 'public' }, reason: 'The description establishes the forest.', evidence: { kind: row.kind, id: row.id, field: 'description', quote: 'Tall trees hide a sacred grove.' } }]) });
        });
        await page.getByRole('button', { name: 'Whispering Forest · Place', exact: true }).first().click();
        assert.equal(await page.locator('.world-lore-detail textarea').count(), 0);
        await page.getByRole('button', { name: 'Edit entry', exact: true }).click();
        await page.getByLabel('Place type (including custom types)').fill('enchanted forest');
        await page.getByLabel('Place type (including custom types)').press('Tab');
        assert.equal(await page.evaluate(() => loreTestWorld.locations[1].placeType), 'enchanted forest');
        await page.getByRole('button', { name: 'Done editing', exact: true }).click();
        await page.getByRole('tab', { name: 'Access', exact: true }).click();
        assert(await page.locator('.world-lore-detail').innerText().then(t => t.includes('Denied') && t.includes('Allowed')));
        await page.getByRole('button', { name: 'The buried bell · Secret', exact: true }).first().click();
        assert((await page.locator('.world-lore-detail').innerText()).includes('beneath'));
        await page.getByRole('tab', { name: 'Knowledge', exact: true }).click();
        assert((await page.locator('.world-lore-detail').innerText()).includes('Mara'));
        await page.getByRole('button', { name: 'Whispering Forest · Place', exact: true }).first().click();
        await page.getByRole('button', { name: 'Edit entry', exact: true }).click();
        await page.getByRole('button', { name: 'Suggest knowledge & links' }).click();
        await page.locator('[data-category=proposals]').click();
        assert.equal(await page.evaluate(() => loreTestWorld.locations[1].knowledge), undefined);
        await page.getByRole('button', { name: 'Accept', exact: true }).click();
        assert.equal(await page.evaluate(() => loreTestWorld.locations[1].knowledge.visibility), 'public');
        // Larger authored worlds remain bounded and permission edits update immediately.
        await page.evaluate(() => {
            for (let i = 0; i < 80; i++) loreTestWorld.entities.push({ id: `visitor-${i}`, name: `Visitor ${i}`, type: 'npc' });
            HordeWorldLoreUI.mount(document.getElementById('lore-test-host'), loreTestWorld);
        });
        await page.locator('[data-category=""]').click();
        assert.equal(await page.locator('.lore-directory-item').count(), 40);
        await page.getByLabel('Search world lore').fill('Whispering Forest');
        await page.getByRole('button', { name: 'Whispering Forest · Place', exact: true }).click();
        await page.getByRole('tab', { name: 'Access', exact: true }).click();
        assert.equal(await page.locator('.lore-access-row').count(), 12);
        await page.getByRole('button', { name: 'Edit entry', exact: true }).click();
        await page.locator('summary').filter({ hasText: /^People · allowed/ }).click();
        await page.locator('.lore-picker').filter({ has: page.getByLabel('Find people · allowed', { exact: true }) }).getByLabel('Iven', { exact: true }).check();
        assert.equal(await page.evaluate(() => HordeWorldLore.access(loreTestWorld, 'iven', 'forest').ok), true);
        await page.getByLabel('Search access').fill('Iven');
        assert.equal(await page.locator('.lore-access-row').count(), 1);
        assert((await page.locator('.lore-access-row').innerText()).includes('Allowed'));
        await page.getByRole('button', { name: 'Done editing', exact: true }).click();
        await page.getByRole('tab', { name: 'Knowledge', exact: true }).click();
        await page.getByRole('button', { name: 'Edit entry', exact: true }).click();
        await page.getByLabel('Who knows this?', { exact: true }).selectOption('assigned');
        await page.locator('summary').filter({ hasText: /^People who know/ }).click();
        await page.locator('.lore-picker').filter({ has: page.getByLabel('Find people who know', { exact: true }) }).getByLabel('Mara', { exact: true }).check();
        assert.deepEqual(await page.evaluate(() => loreTestWorld.locations[1].knowledge.npcIds), ['mara']);
        await page.evaluate(() => { loreTestWorld.entities = loreTestWorld.entities.filter(r => !r.id.startsWith('visitor-')); });
        const result = await page.evaluate(() => {
            const before = JSON.stringify(loreTestWorld);
            HordeWorldLoreUI.debug(loreTestWorld, { session: { playerLocation: 'road', entityStates: { mara: { location: 'forest' }, iven: { location: 'road' } } } });
            return before === JSON.stringify(loreTestWorld);
        });
        assert.equal(result, true, 'debug rendering cannot mutate authored world');
        await page.locator('dialog').getByRole('button', { name: 'Whispering Forest · Place', exact: true }).first().click();
        assert.equal(await page.locator('dialog').getByRole('button', { name: 'Edit entry', exact: true }).count(), 0);
        assert.equal(await page.locator('dialog .world-lore-detail textarea').count(), 0);
        await page.locator('dialog').getByRole('tab', { name: 'Overview', exact: true }).press('ArrowRight');
        assert.equal(await page.locator('dialog').getByRole('tab', { name: 'Knowledge', exact: true }).getAttribute('aria-selected'), 'true');
        await page.locator('dialog').getByRole('tab', { name: 'Overview', exact: true }).click();
        await page.locator('dialog').getByLabel('Search world lore').fill('no-such-entry');
        assert.equal(await page.locator('dialog .lore-directory-item').count(), 0);
        await page.locator('dialog').getByRole('button', { name: 'Clear filters', exact: true }).click();
        assert(await page.locator('dialog .lore-directory-item').count() > 0);
        await page.screenshot({ path: path.join(__dirname, 'world-lore-desktop.png') });
        await page.setViewportSize({ width: 390, height: 844 });
        assert(await page.evaluate(() => document.querySelector('dialog').scrollWidth <= document.querySelector('dialog').clientWidth + 2));
        await page.screenshot({ path: path.join(__dirname, 'world-lore-mobile.png') });
        await page.getByRole('button', { name: 'Close author / debug view', exact: true }).click();
        await page.setViewportSize({ width: 1300, height: 1000 });
        await page.evaluate(fixture => {
            document.getElementById('lore-test-host').remove();
            [...document.body.children].forEach(el => { if (el.tagName !== 'SCRIPT') el.style.display = ''; });
            document.getElementById('modal-overlay').classList.add('hidden');
            const world = { ...fixture, ...loreTestWorld, lorebook: [{ id: 'existing_lore', keyword: 'Ancient oath', text: 'This existing lore must remain exactly as authored.', customField: 'keep me' }] };
            state.editingWorld = world;
            globalThis.loreTestWorld = world;
            openWorldStudio();
            document.querySelector('.world-studio-tab[data-tab="w-overview"]').click();
        }, JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/worlds2-rpg-live.horde_world'), 'utf8')));
        assert.equal(await page.locator('[data-generate-world-structure]').count(), 2);
        // Reproduce an already-open page whose newly added module scripts did
        // not load; clicking the real button must recover rather than throw.
        await page.evaluate(() => { delete globalThis.HordeWorldLore; delete globalThis.HordeWorldLoreUI; });
        await page.locator('#tab-w-overview [data-generate-world-structure]').click();
        await page.waitForFunction(() => !!state.editingWorld.worldStructure && !document.querySelector('[data-generate-world-structure]').disabled);
        assert.equal(await page.evaluate(() => state.editingWorld.lorebook[0].text), 'This existing lore must remain exactly as authored.');
        assert.equal(await page.evaluate(() => state.editingWorld.lorebook[0].customField), 'keep me');
        await page.locator('#tab-w-overview').screenshot({ path: path.join(__dirname, 'world-structure-overview.png') });
        await page.locator('.world-studio-tab[data-tab="w-lore"]').click();
        assert.equal(await page.locator('.lore-text-editor').getAttribute('open'), null);
        await page.locator('#tab-w-lore [data-generate-world-structure]').click();
        await page.waitForFunction(() => !document.querySelector('[data-generate-world-structure]').disabled);
        assert.equal(await page.evaluate(() => state.editingWorld.lorebook.length), 1);
        const generation = await page.evaluate(async () => {
            const client = HordeWorldModelClient.json, credentials = hasApiCredentials;
            const calls = [];
            hasApiCredentials = () => true;
            HordeWorldModelClient.json = async request => {
                calls.push(request.body.model);
                return { response: { ok: true }, data: { choices: [{ message: { content: JSON.stringify({ proposals: [{ kind: 'location', targetId: 'road', field: 'knowledge', value: { visibility: 'public' }, reason: 'Public path', evidence: { kind: 'location', id: 'road', field: 'description', quote: 'A path between fields.' } }] }) } }] } };
            };
            try {
                const original = JSON.stringify(state.editingWorld.locations[0]);
                state.editingWorld.loreGeneration = { mode: 'custom', model: 'test/custom' };
                await generateWorldStructure();
                const unchanged = original === JSON.stringify(state.editingWorld.locations[0]);
                state.editingWorld.loreGeneration = { mode: 'world' };
                document.getElementById('w-studio-model').value = 'test/world';
                await generateWorldStructure();
                const defaultModel = state.globalSettings.defaultModel;
                state.globalSettings.defaultModel = 'test/default'; document.getElementById('w-studio-model').value = '';
                const fallback = worldLoreModel();
                state.globalSettings.defaultModel = defaultModel;
                document.getElementById('w-studio-model').value = 'test/world';
                state.editingWorld.loreGeneration = { mode: 'none' }; await generateWorldStructure();
                state.editingWorld.loreGeneration = { mode: 'world' }; renderWorldLoreModelControls();
                return { calls, unchanged, fallback, pending: state.editingWorld.loreProposals.filter(p => p.status === 'pending').length };
            } finally { HordeWorldModelClient.json = client; hasApiCredentials = credentials; }
        });
        assert.deepEqual(generation.calls, ['test/custom', 'test/world']);
        assert.equal(generation.unchanged, true);
        assert.equal(generation.fallback, 'test/default');
        assert(generation.pending > 0);
        await page.locator('#w-lore-browser').getByLabel('Search world lore').fill('Whispering Forest');
        await page.locator('#w-lore-browser').getByRole('button', { name: 'Whispering Forest · Place', exact: true }).click();
        await page.locator('#w-lore-browser').getByRole('tab', { name: 'Access', exact: true }).click();
        await page.locator('#w-lore-browser').getByRole('button', { name: 'Edit entry', exact: true }).click();
        await page.getByLabel('Initial lock: Old Road to Whispering Forest', { exact: true }).selectOption('locked');
        await page.getByLabel('Can open with a successful check', { exact: true }).check();
        assert.equal(await page.evaluate(() => state.editingWorld.locations[0].exits[0].allowCheckUnlock), true);
        await page.locator('#w-lore-browser').getByRole('button', { name: 'Done editing', exact: true }).click();
        await page.locator('#w-lore-browser .world-lore-detail').screenshot({ path: path.join(__dirname, 'world-lore-locks.png') });
        await page.evaluate(() => { window.savedModelCatalog = getOpenRouterModels; getOpenRouterModels = async () => [{ id: 'test/available', name: 'Available model' }]; });
        await page.locator('#tab-w-lore').getByLabel('Structure generation', { exact: true }).selectOption('custom');
        await page.locator('#tab-w-lore').getByRole('button', { name: 'Load available models', exact: true }).click();
        assert.equal(await page.locator('#tab-w-lore datalist option').first().getAttribute('value'), 'test/available');
        await page.locator('#tab-w-lore').getByLabel('World Lore model', { exact: true }).fill('test/available');
        await page.locator('#tab-w-lore').getByLabel('World Lore model', { exact: true }).press('Tab');
        await page.locator('#tab-w-lore .panel-header').scrollIntoViewIfNeeded();
        await page.locator('#tab-w-lore .panel-header').screenshot({ path: path.join(__dirname, 'world-lore-models.png') });
        await page.locator('#tab-w-lore').getByLabel('Structure generation', { exact: true }).selectOption('world');
        await page.evaluate(() => { getOpenRouterModels = window.savedModelCatalog; });
        const persisted = await page.evaluate(async () => {
            await saveWorld();
            const saved = state.worlds.find(w => w.id === state.editingWorld.id);
            return { lore: saved.lorebook[0], hasStructure: !!saved.worldStructure,
                lock: saved.locations[0].exits[0].lockState, modelMode: saved.loreGeneration.mode, status: HordeWorldLore.structureStatus(saved).state };
        });
        assert.equal(persisted.lore.text, 'This existing lore must remain exactly as authored.');
        assert.equal(persisted.lore.customField, 'keep me');
        assert.equal(persisted.hasStructure, true);
        assert.equal(persisted.lock, 'locked');
        assert.equal(persisted.modelMode, 'world');
        await page.evaluate(() => HordeWorldLore.generate(state.editingWorld));
        const checks = await page.evaluate(() => {
            const world = state.editingWorld;
            const current = HordeWorldLore.structureStatus(world).state;
            world.locations[0].description += ' A changed detail.';
            const lint = buildWorldLintReport(world);
            renderWorldAudit();
            return { current, stale: lint.some(f => f.area === 'World Structure' && f.msg.includes('changed after')),
                displayed: document.getElementById('audit-results-container').textContent.includes('World Structure') };
        });
        assert.deepEqual(checks, { current: 'current', stale: true, displayed: true });
        assert.deepEqual(errors, []);
        console.log('PASS: World Lore navigation, proposal review, debug, mobile, both editor generation buttons, preservation and Health Check');
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
