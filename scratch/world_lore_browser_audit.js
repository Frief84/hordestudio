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
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname !== 'world-lore.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
                return route.fulfill({ status: 404, body: '' });
            const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
            return route.fulfill({ contentType: mime, body: fs.readFileSync(file) });
        });
        await page.goto('https://world-lore.test/');
        await page.waitForFunction(() => typeof setupWorldPlayLogic === 'function' && !!globalThis.HordeWorldLoreUI);
        await page.evaluate(() => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            const world = {
                id: 'test', name: 'The Green March', startLocationId: 'road',
                regions: [{ id: 'march', name: 'The Green March', description: 'Forests and old roads.' }],
                locations: [
                    { id: 'road', name: 'Old Road', placeType: 'road', description: 'A path between fields.', regionId: 'march',
                        exits: [{ targetLocationId: 'forest', travelTime: 30, lockState: 'unlocked' }] },
                    { id: 'forest', name: 'Whispering Forest', placeType: 'forest', regionId: 'march',
                        description: 'Tall trees hide a sacred grove. Wardens know this forest.',
                        appearance: 'Silver leaves and dark moss.', items: ['Lantern'],
                        access: { default: 'restricted', factions: { wardens: 'allow' } }, exits: [] }
                ],
                entities: [
                    { id: 'mara', type: 'npc', name: 'Mara', factionId: 'wardens', homeLocation: 'forest' },
                    { id: 'iven', type: 'npc', name: 'Iven' },
                    { id: 'basket', type: 'item', name: 'Basket', locationId: 'forest' }
                ],
                factions: [{ id: 'wardens', name: 'Wardens' }],
                lorebook: [{ id: 'oath', keyword: 'Ancient oath', text: 'Keep this original lore.', customField: 'keep me' }]
            };
            state.editingWorld = world;
            state.worlds = [world];
            state.activeWorldId = world.id;
            globalThis.loreTestWorld = world;
            const host = document.createElement('main');
            host.id = 'lore-test-host';
            host.style.cssText = 'padding:24px;max-width:1200px;margin:auto';
            [...document.body.children].forEach(el => { if (el.tagName !== 'SCRIPT') el.style.display = 'none'; });
            document.body.append(host);
            HordeWorldLoreUI.mount(host, world);
        });

        const host = page.locator('#lore-test-host');
        assert.equal(await host.locator('.lore-directory-item').count(), 3);
        await host.getByLabel('Search places').fill('Whispering Forest');
        assert.equal(await host.locator('.lore-directory-item').count(), 1);
        await host.locator('.lore-directory-item').click();
        const detail = host.locator('.world-lore-detail');
        const content = await detail.innerText();
        for (const expected of ['Silver leaves', 'Lantern', 'Basket', 'Old Road', '30 min', 'Iven', 'Mara'])
            assert(content.includes(expected), `Missing place detail: ${expected}`);
        assert.equal(await detail.locator('textarea').count(), 0, 'The place guide remains read-first');
        await host.getByLabel('Search places').fill('no-such-place');
        assert.equal(await host.locator('.lore-directory-item').count(), 0);
        await host.getByRole('button', { name: 'Clear filters' }).click();
        assert.equal(await host.locator('.lore-directory-item').count(), 3);

        const proposed = await page.evaluate(() => {
            const result = HordeWorldLore.stageProposals(loreTestWorld, [{
                kind: 'location', targetId: 'forest', field: 'placeAwareness',
                value: { factions: { wardens: 'know' } }, reason: 'Wardens know this forest.',
                evidence: { kind: 'location', id: 'forest', field: 'description', quote: 'Wardens know this forest.' }
            }]);
            HordeWorldLoreUI.mount(document.getElementById('lore-test-host'), loreTestWorld);
            return result;
        });
        assert.equal(proposed.added, 1, proposed.errors.join('; '));
        assert.equal(await page.evaluate(() => loreTestWorld.locations[1].placeAwareness), undefined);
        await host.locator('.world-lore-place-proposals summary').click();
        await host.getByRole('button', { name: 'Apply suggestion' }).click();
        assert.equal(await page.evaluate(() => loreTestWorld.locations[1].placeAwareness.factions.wardens), 'know');

        const unchanged = await page.evaluate(() => {
            const before = JSON.stringify(loreTestWorld);
            HordeWorldLoreUI.debug(loreTestWorld, {
                session: { playerLocation: 'road', entityStates: { mara: { location: 'forest' }, basket: { location: 'forest' } },
                    locationStates: { forest: { description: 'A fallen tree blocks the path.' } } }
            });
            return before === JSON.stringify(loreTestWorld);
        });
        assert.equal(unchanged, true, 'The game view must not mutate authored lore');
        const dialog = page.locator('dialog.world-lore-dialog');
        await dialog.getByLabel('Search places').fill('Whispering Forest');
        await dialog.locator('.lore-directory-item').click();
        assert((await dialog.locator('.world-lore-detail').innerText()).includes('A fallen tree blocks the path.'));
        assert.equal(await dialog.getByRole('button', { name: 'Edit in Places' }).count(), 0);
        await page.setViewportSize({ width: 390, height: 844 });
        assert(await page.evaluate(() => document.querySelector('dialog').scrollWidth <= document.querySelector('dialog').clientWidth + 2));
        await dialog.getByRole('button', { name: 'Close place guide' }).click();

        await page.evaluate(() => {
            document.getElementById('lore-test-host').remove();
            [...document.body.children].forEach(el => { if (el.tagName !== 'SCRIPT') el.style.display = ''; });
            document.getElementById('modal-overlay').classList.add('hidden');
            openWorldStudio();
            document.querySelector('.world-studio-tab[data-tab="w-overview"]').click();
        });
        await page.setViewportSize({ width: 1300, height: 1000 });
        assert.equal(await page.locator('[data-generate-world-structure]').count(), 2);
        await page.locator('#tab-w-overview [data-generate-world-structure]').click();
        await page.waitForFunction(() => !!state.editingWorld.worldStructure && !document.querySelector('[data-generate-world-structure]').disabled);
        assert.equal(await page.evaluate(() => state.editingWorld.lorebook[0].text), 'Keep this original lore.');
        assert.equal(await page.evaluate(() => state.editingWorld.lorebook[0].customField), 'keep me');

        await page.locator('.world-studio-tab[data-tab="w-lore"]').click();
        assert(await page.locator('#tab-w-lore .lore-text-editor').isVisible());
        await page.locator('#tab-w-lore .world-lore-structure-panel > summary').click();
        assert(await page.locator('#tab-w-lore [data-generate-world-structure]').isVisible());
        await page.locator('#tab-w-lore [data-generate-world-structure]').click();
        await page.waitForFunction(() => !document.querySelector('#tab-w-lore [data-generate-world-structure]').disabled);
        assert.equal(await page.evaluate(() => state.editingWorld.lorebook.length), 1);
        assert.equal(await page.locator('#w-lore-browser .lore-directory-item').count(), 3);

        const models = await page.evaluate(async () => {
            const originalBatch = suggestWorldLoreBatch;
            const originalCredentials = hasApiCredentials;
            const called = [];
            suggestWorldLoreBatch = async (_world, _rows, model) => { called.push(model); return { added: 0, errors: [] }; };
            hasApiCredentials = () => true;
            try {
                state.editingWorld.loreGeneration = { mode: 'custom', model: 'test/custom' };
                await generateWorldStructure();
                state.editingWorld.loreGeneration = { mode: 'world' };
                document.getElementById('w-studio-model').value = 'test/world';
                await generateWorldStructure();
                return called;
            } finally {
                suggestWorldLoreBatch = originalBatch;
                hasApiCredentials = originalCredentials;
            }
        });
        assert.deepEqual(models, ['test/custom', 'test/world']);
        assert.equal(await page.evaluate(() => state.editingWorld.lorebook[0].text), 'Keep this original lore.');
        assert.deepEqual(errors, []);
        console.log('PASS: World Lore place guide, review, game view, both generation buttons, model selection and lore preservation');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
