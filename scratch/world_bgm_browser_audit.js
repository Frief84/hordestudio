/** Isolated browser smoke test for authored location BGM; no user save is loaded. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'block' });
        const storedBgm = new Map();
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname !== 'bgm-audit.test') return route.abort();
            if (url.pathname.startsWith('/world-bgm/assets/') && route.request().method() === 'POST') {
                const name = decodeURIComponent(url.pathname.slice('/world-bgm/assets/'.length));
                if (name === 'fallback.ogg') return route.fulfill({ status: 404, body: '' });
                storedBgm.set(name, route.request().postDataBuffer());
                return route.fulfill({ status: 201, contentType: 'application/json',
                    body: JSON.stringify({ src: `assets/bgm/${name}` }) });
            }
            if (url.pathname.startsWith('/world-bgm/delete/') && route.request().method() === 'POST') {
                const name = decodeURIComponent(url.pathname.slice('/world-bgm/delete/'.length));
                storedBgm.delete(name);
                return route.fulfill({ status: 200, contentType: 'application/json',
                    body: JSON.stringify({ deleted: `assets/bgm/${name}` }) });
            }
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
                return route.fulfill({ status: 404, body: '' });
            return route.fulfill({ contentType: { '.html': 'text/html', '.js': 'text/javascript',
                '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => {
            HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
            HTMLMediaElement.prototype.pause = function () {};
        });
        await page.goto('https://bgm-audit.test/');
        await page.waitForFunction(() => typeof createNewWorld === 'function'
            && typeof state !== 'undefined' && typeof companionAgencyTimer !== 'undefined');
        await page.evaluate(() => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            window.__bgmModelCalls = 0;
            const fetchBeforeBgm = window.fetch;
            window.fetch = (...args) => {
                if (String(args[0]).includes('/chat/completions')) window.__bgmModelCalls++;
                return fetchBeforeBgm(...args);
            };
            createNewWorld();
            const world = state.editingWorld;
            world.name = 'The Submission Vault (isolated BGM fixture)';
            document.getElementById('w-studio-name').value = world.name;
            world.locations = [
                { id: 'loc_hall', name: 'Hall', description: 'Hall', mapType: 'area',
                    exits: [{ text: 'to Vault', targetLocationId: 'loc_vault' }],
                    bgm: { src: 'assets/bgm/hall.ogg', volume: 0.2 } },
                { id: 'loc_vault', name: 'Vault', description: 'Vault', mapType: 'room',
                    parentLocationId: 'loc_hall', exits: [{ text: 'to Hall', targetLocationId: 'loc_hall' }] }
            ];
            world.startLocationId = 'loc_hall';
            openWorldRecordInspector('location', 'loc_vault');
        });
        assert.equal(await page.locator('#world-record-body .room-bgm-panel').count(), 1);
        if (!(await page.locator('#world-record-body .room-bgm-panel').evaluate(panel => panel.open)))
            await page.locator('#world-record-body .room-bgm-panel summary').click();
        await page.locator('#world-record-body #bgmDropzone').evaluate(drop => {
            const transfer = new DataTransfer();
            transfer.items.add(new File([new Uint8Array([79, 103, 103, 83])], 'dropped.ogg',
                { type: 'audio/ogg' }));
            drop.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
        });
        await page.waitForFunction(() => document.getElementById('roomBgmSrc')?.value === 'assets/bgm/dropped.ogg');
        assert(storedBgm.has('dropped.ogg'));
        await page.locator('#world-record-body #roomBgmClearAssign').click();
        assert(storedBgm.has('dropped.ogg'));
        assert.equal(await page.evaluate(() => state.editingWorld.locations.find(location => location.id === 'loc_vault').bgm), undefined);
        await page.locator('#world-record-body #bgmDropzone').evaluate(drop => {
            const transfer = new DataTransfer();
            transfer.items.add(new File([new Uint8Array([79, 103, 103, 83])], 'fallback.ogg',
                { type: 'audio/ogg' }));
            drop.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
        });
        await page.waitForFunction(() => document.getElementById('roomBgmSrc')?.value === 'assets/bgm/fallback.ogg'
            && state.editingWorld.locations.find(location => location.id === 'loc_vault').bgm?._blobUrl);
        await page.waitForFunction(() => document.getElementById('worldBgm')?.getAttribute('src')?.startsWith('blob:'));
        assert(!storedBgm.has('fallback.ogg'));
        await page.locator('#world-record-body #roomBgmClearAssign').click();
        const chooser = page.waitForEvent('filechooser');
        await page.locator('#world-record-body #bgmDropzone').click();
        await (await chooser).setFiles({ name: 'browser.ogg', mimeType: 'audio/ogg',
            buffer: Buffer.from([79, 103, 103, 83]) });
        await page.waitForFunction(() => document.getElementById('roomBgmSrc')?.value === 'assets/bgm/browser.ogg');
        assert(storedBgm.has('browser.ogg'));
        page.once('dialog', dialog => dialog.accept());
        await page.locator('#world-record-body #roomBgmDeleteFile').click();
        await page.waitForFunction(() => !state.editingWorld.locations.find(location => location.id === 'loc_vault').bgm);
        assert(!storedBgm.has('browser.ogg'));
        await page.locator('#world-record-body #roomBgmSrc').fill('assets/bgm/vault.ogg');
        await page.locator('#world-record-body #roomBgmSrc').press('Tab');
        await page.locator('#world-record-body #roomBgmVol').evaluate(input => {
            input.value = '0.6';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.locator('#world-record-body #roomBgmLoop').uncheck();
        const draft = await page.evaluate(() => state.editingWorld.locations.find(location => location.id === 'loc_vault').bgm);
        assert.deepEqual(draft, { src: 'assets/bgm/vault.ogg', volume: 0.6, loop: false, crossfade: 600 });
        await page.locator('#world-record-body #roomBgmPreview').click();
        await page.waitForFunction(() => document.getElementById('worldBgm')?.getAttribute('src') === 'assets/bgm/vault.ogg');
        await page.locator('#world-record-body #roomBgmStop').click();
        await page.waitForFunction(() => !document.getElementById('worldBgm')?.hasAttribute('src'));
        const saved = await page.evaluate(async () => { closeWorldRecordInspector(); return saveWorld(); });
        assert.equal(saved, true);
        const persisted = await page.evaluate(async () => {
            const world = state.worlds.find(item => item.name === 'The Submission Vault (isolated BGM fixture)');
            const stored = (await HordeDB.get('worlds')).find(item => item.id === world.id);
            return { id: world.id, bgm: world.locations.find(item => item.id === 'loc_vault').bgm,
                stored: stored.locations.find(item => item.id === 'loc_vault').bgm };
        });
        assert.deepEqual(persisted.bgm, draft);
        assert.deepEqual(persisted.stored, draft);
        await page.evaluate(id => enterWorld(id), persisted.id);
        await page.waitForFunction(() => document.getElementById('worldBgm')?.getAttribute('src') === 'assets/bgm/hall.ogg');
        const travel = await page.evaluate(async () => {
            const world = state.worlds.find(item => item.id === state.activeWorldId);
            return travelThroughWorldExit(world, getCurrentWorldSession(),
                world.locations.find(item => item.id === 'loc_hall').exits[0]);
        });
        assert.equal(travel.ok, true, JSON.stringify(travel));
        await page.waitForFunction(() => document.getElementById('worldBgm')?.getAttribute('src') === 'assets/bgm/vault.ogg');
        const back = await page.evaluate(async () => {
            const world = state.worlds.find(item => item.id === state.activeWorldId);
            return travelThroughWorldExit(world, getCurrentWorldSession(),
                world.locations.find(item => item.id === 'loc_vault').exits[0]);
        });
        assert.equal(back.ok, true, JSON.stringify(back));
        await page.waitForFunction(() => document.getElementById('worldBgm')?.getAttribute('src') === 'assets/bgm/hall.ogg');
        assert.equal(await page.evaluate(() => window.__bgmModelCalls), 0);
        const linked = await page.evaluate(async () => {
            const world = state.worlds.find(item => item.id === state.activeWorldId);
            const sess = getCurrentWorldSession();
            world.model = 'fixture/model';
            world.kernel = { enabled: true, memoryMode: 'ledger', sceneDrafts: true,
                sceneDraftProtocol: 'scene_draft_v3' };
            sess.setupComplete = true;
            state.apiKey = 'offline';
            state.globalSettings.apiProvider = 'local';
            state.globalSettings.localBaseUrl = 'http://127.0.0.1:1234/v1';
            const draft = { protocol: 'scene_draft_v3',
                narrative: [{ id: 'p1', action_id: 'enter_vault', text: 'You enter the Vault.' }],
                actions: [{ action_id: 'enter_vault', kind: 'travel', status: 'resolved',
                    response_id: 'p1', action_effects: { actor_move: [
                        { actor_id: 'player', to_location_id: 'loc_vault' }] } }],
                events: [], effects: {}, speech: [], commitments: [] };
            const realFetch = window.fetch;
            let beforeCommit = false;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                beforeCommit = sess.playerLocation === 'loc_hall'
                    && document.getElementById('worldBgm')?.getAttribute('src') === 'assets/bgm/hall.ogg';
                const payload = { choices: [{ delta: { content: JSON.stringify(draft) }, finish_reason: 'stop' }] };
                return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`,
                    { headers: { 'Content-Type': 'text/event-stream' } });
            };
            document.getElementById('world-user-input').value = 'I enter the Vault.';
            await executeWorldTurn();
            window.fetch = realFetch;
            const saved = (await HordeDB.get(`worldInstance:${world.id}`))?.sessions
                ?.find(item => item.id === sess.id);
            return { beforeCommit, location: sess.playerLocation, savedLocation: saved?.playerLocation,
                outcome: sess.lastTurnAudit?.actions?.[0]?.outcome };
        });
        assert.deepEqual(linked, { beforeCommit: true, location: 'loc_vault',
            savedLocation: 'loc_vault', outcome: 'succeeded' }, JSON.stringify(linked));
        await page.waitForFunction(() => document.getElementById('worldBgm')?.getAttribute('src') === 'assets/bgm/vault.ogg');
        if (process.env.HORDE_WORLD_FIXTURE) {
            const original = JSON.parse(fs.readFileSync(process.env.HORDE_WORLD_FIXTURE, 'utf8'));
            assert.equal(original.name, 'The Submission Vault');
            assert.equal(original.locations.length, 11);
            const copyId = `bgm-audit-${Date.now()}`;
            await page.evaluate(({ world, id }) => {
                createNewWorld();
                Object.assign(state.editingWorld, world, {
                    id, name: `${world.name} (isolated BGM test)`
                });
                document.getElementById('w-studio-name').value = state.editingWorld.name;
                openWorldRecordInspector('location', world.locations[0].id);
            }, { world: original, id: copyId });
            assert.equal(await page.locator('#world-record-body #roomBgmSrc').inputValue(), '');
            await page.locator('#world-record-body #bgmDropzone').evaluate(drop => {
                const transfer = new DataTransfer();
                transfer.items.add(new File([new Uint8Array([79, 103, 103, 83])], 'vault-copy.ogg',
                    { type: 'audio/ogg' }));
                drop.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
            });
            await page.waitForFunction(() => document.getElementById('roomBgmSrc')?.value === 'assets/bgm/vault-copy.ogg');
            assert(storedBgm.has('vault-copy.ogg'));
            await page.locator('#world-record-body #roomBgmClearAssign').click();
            assert(storedBgm.has('vault-copy.ogg'));
            assert.equal(await page.evaluate(() => state.editingWorld.locations[0].bgm), undefined);
            const vaultSaved = await page.evaluate(async () => {
                closeWorldRecordInspector();
                return saveWorld();
            });
            assert.equal(vaultSaved, true);
            const vaultStored = await page.evaluate(async id =>
                (await HordeDB.get('worlds')).find(item => item.id === id), copyId);
            assert.equal(vaultStored.locations.length, original.locations.length);
            assert.equal(vaultStored.locations[0].bgm, undefined);
            console.log('Actual Submission Vault export passed in isolated browser context');
        }
        assert.deepEqual(errors, []);
        console.log('BGM browser audit passed: drop, picker, blob fallback, both delete actions, preview/stop, persistence, direct and linked travel');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
