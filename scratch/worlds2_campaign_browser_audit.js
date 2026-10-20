/** Portable Worlds and full-install ZIP round trips in fresh browser profiles. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(process.env.HORDE_APP_ROOT || path.resolve(__dirname, '..'));
globalThis.HordeHumanPackage = require('../human-package.js');
const Archive = require('../large-archive.js');
function assertRetains(actual, expected, path = 'legacy World state') {
    if (Array.isArray(expected)) {
        assert(Array.isArray(actual) && actual.length === expected.length, `${path}: array changed`);
        expected.forEach((item, index) => assertRetains(actual[index], item, `${path}[${index}]`));
    } else if (expected && typeof expected === 'object') {
        assert(actual && typeof actual === 'object', `${path}: object missing`);
        for (const [key, value] of Object.entries(expected))
            assertRetains(actual[key], value, `${path}.${key}`);
    } else assert.deepEqual(actual, expected, `${path}: value changed`);
}
globalThis.FileReader = class {
    readAsDataURL(blob) {
        blob.arrayBuffer().then(bytes => {
            this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;
            this.onload?.();
        }, error => { this.error = error; this.onerror?.(); });
    }
};

function serve(context) {
    return context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/worlds/bind-turn') {
            const headers = { 'access-control-allow-origin': '*',
                'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
            if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
            const result = spawnSync(process.execPath, [path.join(root, 'worlds/turn-binding-worker.js')],
                { input: route.request().postData(), encoding: 'utf8' });
            return route.fulfill({ status: 200, contentType: 'application/json', headers, body: result.stdout });
        }
        if (url.hostname !== 'worlds2-campaign.test') return route.abort();
        const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            return route.fulfill({ status: 404, body: '' });
        }
        const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream';
        return route.fulfill({ contentType: mime, body: fs.readFileSync(file) });
    });
}
async function ready(page) {
    await page.goto('https://worlds2-campaign.test/');
    await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
    await page.evaluate(() => { clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer); });
}
async function importCampaign(page, bytes, name = 'roundtrip.horde_campaign') {
    const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.evaluate(() => document.getElementById('import-world-btn').click())
    ]);
    await chooser.setFiles({ name, mimeType: 'application/zip', buffer: bytes });
}

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const source = await browser.newContext({ acceptDownloads: true });
        await serve(source);
        const page = await source.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await ready(page);
        await page.evaluate(() => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><desc>${'x'.repeat(75000)}</desc></svg>`;
            const image = 'data:image/svg+xml;base64,' + btoa(svg);
            const world = { id: 'campaign_source', name: 'Campaign Round Trip',
                locations: [{ id: 'room', name: 'Room', description: 'Quiet.', exits: [] }],
                entities: [{ id: 'story_person', name: 'Ada', type: 'npc', sessionOrigin: 'timeline_one', visuals: { portraitAssetId: 'ada_portrait' } }],
                mediaAssets: [{ id: 'ada_portrait', kind: 'portrait', label: 'Ada', data: image }], startLocationId: 'room',
                kernel: { enabled: true, memoryMode: 'ledger', sceneDrafts: true, sceneDraftProtocol: 'scene_draft_v3' },
                gameRules: { modules: { livingWorld: true, relationships: false } } };
            state.worlds = [world];
            state.editingWorld = world;
            state.worldInstances = { campaign_source: { activeSessionId: 'timeline_one', sessions: [
                { id: 'timeline_one', name: 'Played Timeline', playerLocation: 'room',
                    entityStates: { story_person: { location: 'room', observations: [
                        { id: 'old_observation', text: 'Ada witnessed the greeting.', sourceType: 'witnessed' }] } },
                    inventory: ['brass key'], npcRelationships: { 'player|story_person': { score: 64 } },
                    locationStates: { room: { conditions: [{ label: 'Quiet' }] } },
                    quests: [{ id: 'old_quest', title: 'Read the map', status: 'active' }],
                    scheduledEvents: [{ id: 'old_meeting', title: 'Meet Ada', status: 'scheduled', dueMinute: 1800 }],
                    worldClock: { absoluteMinutes: 600, turnCount: 2, bonusTimeMinutes: 0 },
                    ledger: 'Ada witnessed the greeting.', ledgerArchive: [{ lines: ['An older promise remains open.'] }],
                    worldTurnReceipts: [{ audit: { protocol: 'scene_draft_v2' }, receipt: { turn_id: 'old_v2' } },
                        { audit: { protocol: 'scene_draft_v3' }, receipt: { turn_id: 'old_v3' } }],
                    history: [{ id: 'scene_one', role: 'dm', text: 'Ada arrives.', turnSnapshot: { portrait: image },
                        sceneMemory: { receiptId: 'old_v2', location: 'room', records: [
                            { kind: 'testimony', actor: 'story_person', text: 'Ada saw the old map.' }] } },
                        { id: 'action_one', role: 'user', text: 'I greet Ada.' }] },
                { id: 'timeline_two', name: 'Forked Timeline', playerLocation: 'room', entityStates: {},
                    history: [{ id: 'scene_two', role: 'dm', text: 'Ada leaves.' }] }
            ] } };
        });
        const [campaignDownload] = await Promise.all([
            page.waitForEvent('download'), page.evaluate(() => document.getElementById('export-world-campaign-btn').click())
        ]);
        assert(campaignDownload.suggestedFilename().endsWith('.horde_campaign'));
        const campaignBytes = fs.readFileSync(await campaignDownload.path());
        assert.equal(campaignBytes.subarray(0, 4).toString('hex'), '504b0304');
        const files = await HordeHumanPackage.unzip(new Blob([campaignBytes]));
        assert.equal([...files.keys()].filter(key => key.startsWith('media/')).length, 1, 'snapshot and template media are deduplicated');
        const campaign = await Archive.unpack(new Blob([campaignBytes]), 'world-campaign');
        assert.equal(campaign._format, 'horde-world-campaign');
        assert.equal(campaign._version, 2);
        assert.equal(campaign.instance.sessions.length, 2);
        assert.equal(campaign.instance.sessions[0].history[0].turnSnapshot.portrait, campaign.world.mediaAssets[0].data);

        const target = await browser.newContext({ acceptDownloads: true });
        await serve(target);
        const fresh = await target.newPage();
        fresh.on('pageerror', error => errors.push(error.message));
        await ready(fresh);
        const originalWorldCount = await fresh.evaluate(() => state.worlds.length);
        const damaged = Buffer.from(campaignBytes);
        damaged[40] ^= 0xff;
        await importCampaign(fresh, damaged, 'damaged.horde_campaign');
        await fresh.waitForFunction(() => document.body.textContent.includes('Failed to import world:'));
        assert.equal(await fresh.evaluate(() => state.worlds.length), originalWorldCount, 'damaged archive never alters the library');
        await importCampaign(fresh, campaignBytes);
        await fresh.waitForFunction(() => state.worlds.some(world => world.name === 'Campaign Round Trip'), { timeout: 30000 });
        await fresh.waitForFunction(async () => {
            const world = state.worlds.find(item => item.name === 'Campaign Round Trip');
            return !!world && (await HordeDB.get(`worldInstance:${world.id}`))?.sessions?.length === 2;
        }, { timeout: 30000 });
        const imported = await fresh.evaluate(async () => {
            const world = state.worlds.find(item => item.name === 'Campaign Round Trip');
            const instance = state.worldInstances[world.id];
            const saved = await HordeDB.get(`worldInstance:${world.id}`);
            return { id: world.id, image: world.mediaAssets[0]?.data, activeSessionId: instance.activeSessionId,
                sessions: instance.sessions.map(session => session.history.map(message => message.text)),
                legacyState: { inventory: instance.sessions[0].inventory,
                    entityStates: instance.sessions[0].entityStates,
                    relationships: instance.sessions[0].npcRelationships,
                    locationStates: instance.sessions[0].locationStates,
                    quests: instance.sessions[0].quests,
                    commitments: instance.sessions[0].scheduledEvents,
                    worldClock: instance.sessions[0].worldClock,
                    ledger: instance.sessions[0].ledger,
                    ledgerArchive: instance.sessions[0].ledgerArchive,
                    receiptProtocols: instance.sessions[0].worldTurnReceipts.map(item => item.audit.protocol),
                    sceneMemory: instance.sessions[0].history[0].sceneMemory },
                persisted: saved?.sessions?.length === 2 };
        });
        assert.notEqual(imported.id, 'campaign_source');
        assert.equal(imported.activeSessionId, 'timeline_one');
        assert.deepEqual(imported.sessions, [['Ada arrives.', 'I greet Ada.'], ['Ada leaves.']]);
        assert.equal(imported.persisted, true);
        assert.equal(imported.image, campaign.world.mediaAssets[0].data);
        assertRetains(imported.legacyState, {
            inventory: campaign.instance.sessions[0].inventory,
            entityStates: campaign.instance.sessions[0].entityStates,
            relationships: campaign.instance.sessions[0].npcRelationships,
            locationStates: campaign.instance.sessions[0].locationStates,
            quests: campaign.instance.sessions[0].quests,
            commitments: campaign.instance.sessions[0].scheduledEvents,
            worldClock: campaign.instance.sessions[0].worldClock,
            ledger: campaign.instance.sessions[0].ledger,
            ledgerArchive: campaign.instance.sessions[0].ledgerArchive,
            receiptProtocols: ['scene_draft_v2', 'scene_draft_v3'],
            sceneMemory: campaign.instance.sessions[0].history[0].sceneMemory
        });
        await fresh.reload();
        await fresh.waitForFunction(id => !!state.worldInstances?.[id], imported.id, { timeout: 30000 });
        assert.deepEqual(await fresh.evaluate(id => {
            const session = state.worldInstances[id].sessions[0];
            return { ledger: session.ledger, observations: session.entityStates.story_person.observations,
                receiptProtocols: session.worldTurnReceipts.map(item => item.audit.protocol),
                sceneMemory: session.history[0].sceneMemory };
        }, imported.id), {
            ledger: imported.legacyState.ledger,
            observations: imported.legacyState.entityStates.story_person.observations,
            receiptProtocols: imported.legacyState.receiptProtocols,
            sceneMemory: imported.legacyState.sceneMemory
        }, 'mixed V2/V3 history and NPC memory survive reload');
        const beforeLegacy = await fresh.evaluate(() => state.worlds.length);
        await importCampaign(fresh, Buffer.from(JSON.stringify({ ...campaign, _version: 1 })), 'legacy.horde_campaign');
        await fresh.waitForFunction(count => state.worlds.length === count + 1, beforeLegacy, { timeout: 30000 });
        const legacyV1 = await fresh.evaluate(existingId => {
            const world = state.worlds.find(item => item.name === 'Campaign Round Trip' && item.id !== existingId);
            const session = state.worldInstances?.[world.id]?.sessions?.[0];
            return { memory: session?.history?.[0]?.sceneMemory?.records?.[0]?.text,
                observation: session?.entityStates?.story_person?.observations?.[0]?.text,
                inventory: session?.inventory, relationship: session?.npcRelationships?.['player|story_person']?.score,
                quest: session?.quests?.[0]?.id, deadline: session?.scheduledEvents?.[0]?.dueMinute,
                protocols: session?.worldTurnReceipts?.map(item => item.audit?.protocol) };
        }, imported.id);
        assert.equal(legacyV1.memory, 'Ada saw the old map.');
        assert.equal(legacyV1.observation, 'Ada witnessed the greeting.');
        assert(legacyV1.inventory?.some(item => String(item?.name || item).includes('brass key')));
        assert.equal(legacyV1.relationship, 64);
        assert.equal(legacyV1.quest, 'old_quest');
        assert.equal(legacyV1.deadline, 1800);
        assert.deepEqual(legacyV1.protocols, ['scene_draft_v2', 'scene_draft_v3']);

        const continued = await fresh.evaluate(async existingId => {
            const world = state.worlds.find(item => item.name === 'Campaign Round Trip' && item.id !== existingId);
            const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest(
                'SHA-256', new TextEncoder().encode(JSON.stringify(value)))))
                .map(byte => byte.toString(16).padStart(2, '0')).join('');
            const worldHashBefore = await digest(world);
            state.activeWorldId = world.id;
            const session = state.worldInstances[world.id].sessions[0];
            session.setupComplete = true;
            state.apiKey = 'offline'; state.globalSettings.apiProvider = 'openrouter';
            switchView('worldPlay'); renderWorldPlayState();
            const realFetch = window.fetch;
            let calls = 0, draftIndex = 0;
            window.fetch = async (url, options = {}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url, options);
                calls++;
                const draft = draftIndex === 0
                    ? { protocol: 'scene_draft_v3', actions: [{ kind: 'question', status: 'answered',
                        effects: [], response: [{ text: 'Ada recalls the old map.' }] }] }
                    : { protocol: 'scene_draft_v3', actions: [{ kind: 'physical', status: 'resolved',
                        effects: { outfit_set: [{ actor_id: 'player', outfit: 'red cloak' }] },
                        response: [{ text: 'You put on a red cloak.', events: [{ type: 'outfit',
                            actor_id: 'player', status: 'completed', outfit: 'red cloak' }] }] }],
                        reactions: [{ text: 'Ada puts on a blue coat.',
                            effects: { outfit_set: [{ actor_id: 'story_person', outfit: 'blue coat' }] },
                            events: [{ type: 'outfit', actor_id: 'story_person', status: 'completed',
                                outfit: 'blue coat' }] }] };
                const body = JSON.parse(options.body), raw = JSON.stringify(draft);
                if (body.stream) return new Response(`data: ${JSON.stringify({ choices: [{
                    delta: { content: raw }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
                { headers: { 'Content-Type': 'text/event-stream' } });
                return new Response(JSON.stringify({ choices: [{ message: { content: raw } }],
                    usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 } }),
                { headers: { 'Content-Type': 'application/json' } });
            };
            for (const input of ['What does the old map show?', 'I put on a red cloak.']) {
                document.getElementById('world-user-input').value = input;
                await executeWorldTurn();
                draftIndex++;
            }
            window.fetch = realFetch;
            const saved = (await HordeDB.get(`worldInstance:${world.id}`))?.sessions?.find(item => item.id === session.id);
            return { worldId: world.id, sessionId: session.id, calls,
                callAudits: session.history.filter(item => item.callAudit).map(item => item.callAudit),
                turnError: document.getElementById('world-turn-error-text')?.textContent,
                definitionUnchanged: (await digest(world)) === worldHashBefore,
                worldDefinition: { locations: structuredClone(world.locations), entities: structuredClone(world.entities),
                    startLocationId: world.startLocationId, kernel: structuredClone(world.kernel),
                    gameRules: structuredClone(world.gameRules), mediaAssets: structuredClone(world.mediaAssets) },
                accepted: session.history.at(-1)?.role === 'dm' && session.history.at(-1)?.stateSource !== 'frozen_no_receipt',
                protocols: session.worldTurnReceipts.map(item => item.audit?.protocol),
                oldMemory: session.history.some(item => item.id === 'scene_one' &&
                    item.sceneMemory?.records?.[0]?.text === 'Ada saw the old map.'),
                inventory: session.inventory, observations: session.entityStates.story_person.observations,
                relationship: session.npcRelationships['player|story_person']?.score,
                quest: session.quests[0]?.id, playerOutfit: session.outfit,
                npcOutfit: session.entityStates.story_person.outfit,
                persisted: !!saved, historyCount: session.history.length };
        }, imported.id);
        assert.equal(continued.calls, 2, JSON.stringify({ callAudits: continued.callAudits,
            turnError: continued.turnError }).slice(0, 3500));
        assert(continued.accepted && continued.persisted && continued.oldMemory && continued.definitionUnchanged);
        assert.deepEqual(continued.protocols.slice(0, 2), ['scene_draft_v2', 'scene_draft_v3']);
        assert.equal(continued.protocols.length, 4);
        assert.equal(continued.playerOutfit, 'red cloak');
        assert.equal(continued.npcOutfit, 'blue coat');
        assert(continued.inventory.some(item => String(item?.name || item).includes('brass key')));
        assert.equal(continued.observations[0].text, 'Ada witnessed the greeting.');
        assert.equal(continued.relationship, 64);
        assert.equal(continued.quest, 'old_quest');
        await fresh.reload();
        await fresh.waitForFunction(id => !!state.worldInstances?.[id], continued.worldId, { timeout: 30000 });
        const continuedReload = await fresh.evaluate(({ worldId, sessionId }) => {
            const world = state.worlds.find(item => item.id === worldId);
            const session = state.worldInstances[worldId].sessions.find(item => item.id === sessionId);
            return { worldDefinition: { locations: world.locations, entities: world.entities,
                startLocationId: world.startLocationId, kernel: world.kernel,
                gameRules: world.gameRules, mediaAssets: world.mediaAssets },
                protocols: session.worldTurnReceipts.map(item => item.audit?.protocol),
                oldMemory: session.history.some(item => item.id === 'scene_one' &&
                    item.sceneMemory?.records?.[0]?.text === 'Ada saw the old map.'),
                inventory: session.inventory, observations: session.entityStates.story_person.observations,
                relationship: session.npcRelationships['player|story_person']?.score,
                quest: session.quests[0]?.id, playerOutfit: session.outfit,
                npcOutfit: session.entityStates.story_person.outfit, historyCount: session.history.length };
        }, continued);
        assertRetains(continuedReload.worldDefinition, continued.worldDefinition,
            'authored World definition after continued legacy reload');
        delete continuedReload.worldDefinition;
        assert.deepEqual(continuedReload, {
            protocols: continued.protocols, oldMemory: true, inventory: continued.inventory,
            observations: continued.observations, relationship: continued.relationship,
            quest: continued.quest, playerOutfit: continued.playerOutfit,
            npcOutfit: continued.npcOutfit, historyCount: continued.historyCount
        }, 'imported V1 campaign continues through NPC actions and save/reload');

        await page.evaluate(async () => {
            state.chats = { fixture_owner: [{ id: 'fixture_chat', messages: [{ role: 'user', content: 'A map attachment',
                attachments: [{ id: 'map_attachment' }] }] }] };
            state.worldRecoverySnapshots = { archived_campaign: {
                capturedAt: '2026-10-01T00:00:00.000Z', reason: 'User recovery fixture',
                world: { id: 'archived_campaign', name: 'Archived Campaign',
                    locations: [{ id: 'room', name: 'Room', exits: [] }], entities: [], mediaAssets: [] }
            } };
            await HordeDB.set('chatAsset:map_attachment', new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }));
        });
        const [backupDownload] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => exportFullBackup())]);
        assert(backupDownload.suggestedFilename().endsWith('.hordebackup'));
        const backupBytes = fs.readFileSync(await backupDownload.path());
        const full = await Archive.unpack(new Blob([backupBytes]), 'full-backup');
        assert.equal(full._format, 'horde-studio-backup');
        assert.equal(full.worldInstances.campaign_source.sessions.length, 2);
        assert.equal(full.worldRecoverySnapshots.archived_campaign.world.name, 'Archived Campaign');
        assert.equal(full.chatAssets.map_attachment instanceof Blob, true);
        const second = await browser.newContext({ acceptDownloads: true });
        await serve(second);
        const restored = await second.newPage();
        restored.on('pageerror', error => errors.push(error.message));
        await ready(restored);
        await restored.evaluate(async () => {
            const obsolete = { id: 'obsolete_campaign', name: 'Old Campaign',
                locations: [{ id: 'old_room', name: 'Old Room', exits: [] }], entities: [], mediaAssets: [] };
            state.worlds.push(obsolete);
            state.worldInstances.obsolete_campaign = { activeSessionId: 'old_timeline', sessions: [{
                id: 'old_timeline', name: 'Old', history: [{ id: 'old_message', role: 'dm', text: 'Old data' }]
            }] };
            await saveState({ allWorldInstances: true });
        });
        await restored.locator('#restore-all-input').setInputFiles({ name: 'installation.hordebackup', mimeType: 'application/zip', buffer: backupBytes });
        await restored.waitForFunction(() => !document.getElementById('confirm-modal-overlay').classList.contains('hidden'), { timeout: 30000 });
        assert.match(await restored.locator('#confirm-msg').textContent(), /1 recoverable World\b/);
        await restored.locator('#confirm-ok-btn').click();
        await restored.waitForFunction(() => state.worldInstances?.campaign_source?.sessions?.length === 2, { timeout: 30000 });
        await restored.waitForFunction(async () => (await HordeDB.get('worldInstance:campaign_source'))?.sessions?.length === 2, { timeout: 30000 });
        await restored.reload();
        await restored.waitForFunction(() => state.worldInstances?.campaign_source?.sessions?.length === 2, { timeout: 30000 });
        assert.equal(await restored.evaluate(async () => (await HordeDB.get('chatAsset:map_attachment'))?.type), 'image/png');
        assert.equal(await restored.evaluate(async () => await HordeDB.get('worldInstance:obsolete_campaign')), null);
        const recoveryAfterReplace = await restored.evaluate(async () => ({
            memory: Object.keys(state.worldRecoverySnapshots || {}).sort(),
            saved: Object.keys(await HordeDB.get('worldRecoverySnapshots') || {}).sort()
        }));
        assert.deepEqual(recoveryAfterReplace, { memory: ['archived_campaign'], saved: ['archived_campaign'] },
            'replace restore must not retain Worlds from the previous installation as recovery cards');

        const legacyProfile = await browser.newContext({ acceptDownloads: true });
        await serve(legacyProfile);
        const legacyRestore = await legacyProfile.newPage();
        legacyRestore.on('pageerror', error => errors.push(error.message));
        await ready(legacyRestore);
        await legacyRestore.locator('#restore-all-input').setInputFiles({ name: 'legacy.json', mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify({ ...full, chatAssets: {} })) });
        await legacyRestore.waitForFunction(() => !document.getElementById('confirm-modal-overlay').classList.contains('hidden'), { timeout: 30000 });
        await legacyRestore.locator('#confirm-ok-btn').click();
        await legacyRestore.waitForFunction(async () => (await HordeDB.get('worldInstance:campaign_source'))?.sessions?.length === 2, { timeout: 30000 });

        const failureProfile = await browser.newContext({ acceptDownloads: true });
        await serve(failureProfile);
        const failurePage = await failureProfile.newPage();
        failurePage.on('pageerror', error => errors.push(error.message));
        await ready(failurePage);
        await failurePage.evaluate(async () => {
            state.worlds.push({ id: 'keep_world', name: 'Keep This World',
                locations: [{ id: 'keep_room', name: 'Keep Room', exits: [] }], entities: [], mediaAssets: [] });
            state.worldInstances.keep_world = { activeSessionId: 'keep_timeline', sessions: [{
                id: 'keep_timeline', name: 'Keep', history: [{ id: 'keep_message', role: 'dm', text: 'Must survive.' }]
            }] };
            state.chats = { keep_owner: [{ id: 'keep_chat', messages: [{ role: 'user', content: 'Keep',
                attachments: [{ id: 'keep_attachment' }] }] }] };
            await HordeDB.set('chatAsset:keep_attachment', new Blob(['old'], { type: 'image/png' }));
            await saveState({ allWorldInstances: true });
            const originalSetMultiple = HordeDB.setMultiple.bind(HordeDB);
            HordeDB.setMultiple = function (records) {
                if (Object.hasOwn(records, 'chatAsset:map_attachment')) {
                    return Promise.reject(new Error('Injected atomic restore failure'));
                }
                return originalSetMultiple(records);
            };
        });
        await failurePage.locator('#restore-all-input').setInputFiles({ name: 'failure.hordebackup', mimeType: 'application/zip', buffer: backupBytes });
        await failurePage.waitForFunction(() => !document.getElementById('confirm-modal-overlay').classList.contains('hidden'), { timeout: 30000 });
        await failurePage.locator('#confirm-ok-btn').click();
        await failurePage.waitForFunction(() => document.body.textContent.includes('existing data was kept'), { timeout: 30000 });
        const survived = await failurePage.evaluate(async () => ({
            oldWorld: state.worlds.some(world => world.id === 'keep_world'),
            oldShard: (await HordeDB.get('worldInstance:keep_world'))?.sessions?.length,
            oldAsset: (await HordeDB.get('chatAsset:keep_attachment'))?.type,
            newShard: await HordeDB.get('worldInstance:campaign_source'),
            newAsset: await HordeDB.get('chatAsset:map_attachment')
        }));
        assert.equal(survived.oldWorld, true);
        assert.equal(survived.oldShard, 1);
        assert.equal(survived.oldAsset, 'image/png');
        assert.equal(survived.newShard, undefined);
        assert.equal(survived.newAsset, undefined);
        await failurePage.reload();
        await failurePage.waitForFunction(() => state.worldInstances?.keep_world?.sessions?.length === 1, { timeout: 30000 });

        // The Worlds release gate is scoped to campaign/backup behavior. The
        // independent VH2 checkpoint flow remains covered when this flag is absent.
        if (!process.env.HORDE_WORLDS_ONLY) {
        // Full-install backups use compact binary VH2 checkpoints, not the
        // legacy 256 MB base64 workspace request. Browser and service commits
        // must stay untouched when the local service rejects an import.
        await page.evaluate(() => {
            state.companionTimelines.backup_fixture = { activeSessionId: 'backup_session', sessions: [{
                id: 'backup_session', name: 'Saved life', messages: [],
                runtime: { videoJobs: [{ id: 'pending_clip', status: 'generating' }] },
                vh2: { worldId: 'checkpoint_life', archiveWorldId: 'archived_life',
                    running: true, autoReplies: true, outbox: [] }
            }] };
            window.vh2Fetch = async (_timeline, path) => {
                if (!path.startsWith('/vh2/transfer-checkpoint?worldId=')) throw Error('Wrong VH2 export route');
                const worldId = new URLSearchParams(path.split('?')[1]).get('worldId');
                if (!['checkpoint_life', 'archived_life'].includes(worldId)) throw Error('Wrong VH2 world');
                return new Response(new Blob(['compact checkpoint fixture ' + worldId],
                    { type: 'application/vnd.horde.vh2-transfer+zip' }), { status: 200 });
            };
        });
        const [checkpointDownload] = await Promise.all([
            page.waitForEvent('download'), page.evaluate(() => exportFullBackup())
        ]);
        const checkpointBytes = fs.readFileSync(await checkpointDownload.path());
        const checkpointBackup = await Archive.unpack(new Blob([checkpointBytes]), 'full-backup');
        assert.equal(checkpointBackup.vh2Checkpoints.length, 2);
        assert.equal(checkpointBackup.vh2Checkpoints[0].worldId, 'checkpoint_life');
        assert.equal(checkpointBackup.vh2Checkpoints[0].data.type, 'application/vnd.horde.vh2-transfer+zip');
        assert.equal(await checkpointBackup.vh2Checkpoints[0].data.text(), 'compact checkpoint fixture checkpoint_life');
        assert.equal(checkpointBackup.vh2Checkpoints[1].worldId, 'archived_life');
        assert.equal(checkpointBackup.vh2ServiceArchives, undefined);

        const vh2Target = await browser.newContext({ acceptDownloads: true });
        await serve(vh2Target);
        const vh2Page = await vh2Target.newPage();
        vh2Page.on('pageerror', error => errors.push(error.message));
        await ready(vh2Page);
        await vh2Page.evaluate(async () => {
            state.worlds = [{ id: 'keep_existing', name: 'Keep Existing',
                locations: [{ id: 'room', name: 'Room', exits: [] }], entities: [], mediaAssets: [] }];
            await saveState({ allWorldInstances: true });
            window.mcpBridgeRequest = async (path) => {
                if (path === '/vh2/workspace/restore-checkpoints') throw Error('Injected service rejection');
                throw Error('Unexpected bridge call: ' + path);
            };
        });
        await vh2Page.locator('#restore-all-input').setInputFiles({ name: 'vh2.hordebackup', mimeType: 'application/zip', buffer: checkpointBytes });
        await vh2Page.waitForFunction(() => !document.getElementById('confirm-modal-overlay').classList.contains('hidden'));
        await vh2Page.locator('#confirm-ok-btn').click();
        await vh2Page.waitForFunction(() => document.body.textContent.includes('Injected service rejection'));
        assert.equal(await vh2Page.evaluate(() => state.worlds[0]?.id), 'keep_existing');
        assert.equal(await vh2Page.evaluate(async () => (await HordeDB.get('worlds'))?.[0]?.id), 'keep_existing');
        await vh2Page.evaluate(() => {
            window.checkpointServiceFingerprint = '';
            window.checkpointServiceCalls = 0;
            window.mcpBridgeRequest = async (path, options) => {
                if (path !== '/vh2/workspace/restore-checkpoints') throw Error('Unexpected bridge call: ' + path);
                if (!(options.body instanceof Blob) || options.body.type !== 'application/zip') throw Error('Incorrect checkpoint upload type');
                const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await options.body.arrayBuffer()))]
                    .map(byte => byte.toString(16).padStart(2, '0')).join('');
                if (window.checkpointServiceFingerprint && hash !== window.checkpointServiceFingerprint) throw Error('Different package cannot resume a service restore');
                window.checkpointServiceFingerprint = hash;
                const alreadyRestored = ++window.checkpointServiceCalls > 1;
                const files = await HordeHumanPackage.unzip(options.body);
                const manifest = JSON.parse(await files.get('manifest.json').text());
                const bodies = await Promise.all(manifest.archives.map(archive => files.get(archive.path).text()));
                sessionStorage.setItem('vh2_checkpoint_restore', JSON.stringify({ path, manifest, bodies, alreadyRestored, calls: window.checkpointServiceCalls }));
                return { worlds: manifest.archives.map(archive => ({ worldId: archive.worldId })), alreadyRestored };
            };
            const originalSetMultiple = HordeDB.setMultiple.bind(HordeDB);
            window.restoreOriginalSetMultiple = originalSetMultiple;
            HordeDB.setMultiple = records => records.companionTimelines?.backup_fixture
                ? Promise.reject(new Error('Injected browser commit failure after service restore'))
                : originalSetMultiple(records);
        });
        await vh2Page.locator('#restore-all-input').setInputFiles({ name: 'vh2.hordebackup', mimeType: 'application/zip', buffer: checkpointBytes });
        await vh2Page.waitForFunction(() => !document.getElementById('confirm-modal-overlay').classList.contains('hidden'));
        await vh2Page.locator('#confirm-ok-btn').click();
        await vh2Page.waitForFunction(() => document.body.textContent.includes('browser data was kept, but the Virtual Human service lives were restored'));
        assert.equal(await vh2Page.evaluate(() => state.worlds[0]?.id), 'keep_existing');
        assert.equal(await vh2Page.evaluate(async () => (await HordeDB.get('worlds'))?.[0]?.id), 'keep_existing');
        await vh2Page.evaluate(() => { HordeDB.setMultiple = window.restoreOriginalSetMultiple; });
        await vh2Page.locator('#restore-all-input').setInputFiles({ name: 'vh2.hordebackup', mimeType: 'application/zip', buffer: checkpointBytes });
        await vh2Page.waitForFunction(() => !document.getElementById('confirm-modal-overlay').classList.contains('hidden'));
        await vh2Page.locator('#confirm-ok-btn').click();
        await vh2Page.waitForFunction(() => !!state.companionTimelines?.backup_fixture);
        const checkpointReceipt = await vh2Page.evaluate(() => JSON.parse(sessionStorage.getItem('vh2_checkpoint_restore')));
        assert.equal(checkpointReceipt.path, '/vh2/workspace/restore-checkpoints');
        assert.equal(checkpointReceipt.manifest.archives[0].worldId, 'checkpoint_life');
        assert.equal(checkpointReceipt.manifest.archives[1].worldId, 'archived_life');
        assert.equal(checkpointReceipt.alreadyRestored, true);
        assert.equal(checkpointReceipt.calls, 2);
        assert.deepEqual(checkpointReceipt.bodies, [
            'compact checkpoint fixture checkpoint_life', 'compact checkpoint fixture archived_life'
        ]);
        assert.equal(await vh2Page.evaluate(() => state.companionTimelines.backup_fixture.sessions[0].vh2.running), false);
        assert.equal(await vh2Page.evaluate(() => state.companionTimelines.backup_fixture.sessions[0].runtime.videoJobs[0].status), 'unknown',
            'restored in-progress video jobs must not auto-submit again');
        }
        const staleContext = await browser.newContext({ acceptDownloads: true });
        await serve(staleContext);
        const staleTab = await staleContext.newPage();
        await ready(staleTab);
        await staleTab.waitForFunction(() => !saveStateInFlight && !worldSaveInFlight && !virtualHumanSaveInFlight);
        const otherTab = await staleContext.newPage();
        await ready(otherTab);
        let newerTabSaved = false;
        for (let attempt = 0; attempt < 3 && !newerTabSaved; attempt++) {
            newerTabSaved = await otherTab.evaluate(async () => {
                try {
                    await Promise.all([saveStateInFlight, worldSaveInFlight, virtualHumanSaveInFlight].filter(Boolean));
                    state.theme = { name: 'newer-tab' };
                    await saveState();
                    return true;
                } catch (error) {
                    if (error?.code === 'STATE_CONFLICT') return false;
                    throw error;
                }
            });
            if (!newerTabSaved) { await otherTab.reload(); await otherTab.waitForFunction(() => !!companionAgencyTimer); }
        }
        assert.equal(newerTabSaved, true, 'a current tab should be able to save the newer revision');
        assert.equal(await staleTab.evaluate(async () => {
            try { await exportFullBackup(); return false; }
            catch (error) { return /changed in another tab/.test(error.message); }
        }), true, 'a stale tab must not export an obsolete full backup');
        await staleTab.locator('#restore-all-input').setInputFiles({
            name: 'stale-restore.hordebackup', mimeType: 'application/zip', buffer: backupBytes
        });
        await staleTab.waitForFunction(() => !document.getElementById('confirm-modal-overlay').classList.contains('hidden'));
        await staleTab.locator('#confirm-ok-btn').click();
        await staleTab.waitForFunction(() => document.body.textContent.includes('Another tab changed saved data'));
        assert.equal(await otherTab.evaluate(async () => (await HordeDB.get('theme'))?.name), 'newer-tab',
            'a stale restore must not replace a newer tab’s saved data');
        assert.deepEqual(errors, []);

        const sample = { history: Array.from({ length: 100 }, (_, index) => ({
            id: `turn_${index}`, text: String(index).padStart(3, '0') + 'x'.repeat(100000)
        })) };
        const sharded = await Archive.pack(sample, 'world-campaign');
        const shardFiles = await HordeHumanPackage.unzip(sharded);
        assert([...shardFiles.keys()].filter(key => key.startsWith('data/')).length > 1);
        assert.deepEqual(await Archive.unpack(sharded, 'world-campaign'), sample);
        console.log(process.env.HORDE_WORLDS_ONLY
            ? 'PASS: Worlds campaign/full-install ZIP round trips; legacy V1 continuation with NPC effects and reload; media dedup, history sharding, corruption rejection, atomic restore rollback'
            : 'PASS: campaign/full-install ZIP round trips; binary VH2 checkpoint transport; legacy JSON imports; media dedup, history sharding, corruption rejection, atomic restore rollback');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
