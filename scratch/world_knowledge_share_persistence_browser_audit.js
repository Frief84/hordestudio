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
            if (url.hostname !== 'knowledge-persistence.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/'
                ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file)
                || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
            return route.fulfill({ contentType: { '.html': 'text/html',
                '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)]
                || 'application/octet-stream', body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        await page.goto('https://knowledge-persistence.test/');
        await page.waitForFunction(() => typeof persistPreparedWorldTurn === 'function'
            && !!globalThis.HordeLinkedWorldActions);
        const result = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer);
            await Promise.all([saveStateInFlight, worldSaveInFlight].filter(Boolean));
            const world = { id: 'knowledge_persistence_fixture', name: 'Knowledge persistence',
                startLocationId: 'room', locations: [{ id: 'room', name: 'Room', exits: [] }],
                entities: [{ id: 'a', type: 'npc', name: 'Ada' },
                    { id: 'b', type: 'npc', name: 'Ben' }],
                reactionRules: [{ id: 'hear_report', on: { sourceType: 'told' },
                    goal: { goal: 'Check report', priority: 80 } }] };
            state.worlds = [world];
            state.worldInstances = { [world.id]: { sessions: [{ id: 'knowledge_tx',
                playerLocation: 'room', turnCount: 3, worldStateVersion: 0,
                worldClock: { absoluteMinutes: 30 }, locationStates: {},
                npcRelationships: {}, worldNews: [], turnEvents: [], entityStates: {
                    a: { location: 'room', observations: [{ id: 'ada_original',
                        text: 'A noise was heard.', sourceType: 'witnessed',
                        evidenceMode: 'direct', allowedToShare: true, turn: 2 }] },
                    b: { location: 'room', observations: [] }
                } }], activeSessionId: 'knowledge_tx' } };
            state.activeWorldId = world.id;
            const sess = state.worldInstances[world.id].sessions[0];
            await saveWorldsState();
            const baseline = JSON.stringify(await HordeDB.get(`worldInstance:${world.id}`));
            const plan = { actions: [{ action_id: 'ada_ben_confirmed', kind: 'speech',
                status: 'resolved', response_id: 'line',
                action_effects: { knowledge_share: [{ actor_id: 'a',
                    recipient_id: 'b', observation_id: 'ada_original' }] } }],
                events: [{ id: 'ada_ben_event', action_id: 'ada_ben_confirmed',
                    passage_id: 'line', actor_id: 'a', target_id: 'b', type: 'dialogue',
                    action: 'report', status: 'completed' }],
                narrative: [{ id: 'line', action_id: 'ada_ben_confirmed',
                    text: 'Ada tells Ben about the noise.' }] };
            const linked = HordeLinkedWorldActions.executeLinkedActions(plan, world, sess,
                { requireEffectWitnesses: true });
            if (!linked.ok) throw new Error(JSON.stringify(linked.errors));
            linked.working.applyDetached((_world, candidate) => {
                candidate.turnCount++;
                HordeNpcGoalActions.evaluateObservationReactions(world.entities[1],
                    world, candidate, candidate.turnCount);
                candidate.turnEvents.push({ ...plan.events[0], committed: true });
            });
            const prepared = linked.working.prepare().session;
            const originalSetMultiple = HordeDB.setMultiple.bind(HordeDB);
            let failed = false;
            HordeDB.setMultiple = async records => {
                if (Object.hasOwn(records, `worldInstance:${world.id}`))
                    throw new Error('injected_knowledge_save_failure');
                return originalSetMultiple(records);
            };
            try { await persistPreparedWorldTurn(world, sess, linked.working); }
            catch (error) { failed = error.message === 'injected_knowledge_save_failure'; }
            finally { HordeDB.setMultiple = originalSetMultiple; }
            const afterFailure = JSON.stringify(await HordeDB.get(`worldInstance:${world.id}`));
            const liveAfterFailure = JSON.stringify(sess);
            const originalPut = IDBObjectStore.prototype.put;
            let midTransactionFailed = false;
            IDBObjectStore.prototype.put = function(value, key) {
                if (key === `worldInstance:${world.id}`)
                    throw new Error('injected_mid_transaction_abort');
                return originalPut.call(this, value, key);
            };
            try { await persistPreparedWorldTurn(world, sess, linked.working); }
            catch (error) { midTransactionFailed = error.message === 'injected_mid_transaction_abort'; }
            finally { IDBObjectStore.prototype.put = originalPut; }
            const afterMidFailure = JSON.stringify(await HordeDB.get(`worldInstance:${world.id}`));
            await persistPreparedWorldTurn(world, sess, linked.working);
            const afterRetry = await HordeDB.get(`worldInstance:${world.id}`);
            const durable = afterRetry.sessions[0];
            const duplicate = HordeLinkedWorldActions.executeLinkedActions(plan, world, sess,
                { requireEffectWitnesses: true });
            return { failed, midTransactionFailed, baseline, afterFailure,
                afterMidFailure, liveAfterFailure,
                preparedReport: prepared.entityStates.b.observations[0],
                report: durable.entityStates.b.observations[0],
                goalCount: durable.entityStates.b.goalPool?.length || 0,
                eventCount: durable.turnEvents.filter(event => event.committed).length,
                liveMatchesDurable: JSON.stringify(sess) === JSON.stringify(durable),
                duplicateOk: duplicate.ok };
        });
        assert.equal(result.failed, true);
        assert.equal(result.midTransactionFailed, true);
        assert.equal(result.afterFailure, result.baseline, 'failed save changed durable session');
        assert.equal(result.afterMidFailure, result.baseline,
            'aborted IndexedDB transaction changed durable session');
        assert.equal(result.liveAfterFailure,
            JSON.stringify(JSON.parse(result.baseline).sessions[0]),
            'failed save published a partial live report or goal');
        assert.equal(result.preparedReport.deliveryActionId, 'ada_ben_confirmed');
        assert.equal(result.report.deliveryActionId, 'ada_ben_confirmed');
        assert.equal(result.report.evidenceMode, 'hearsay');
        assert.equal(result.goalCount, 1);
        assert.equal(result.eventCount, 1);
        assert.equal(result.liveMatchesDurable, true);
        assert.equal(result.duplicateOk, false,
            'the confirmed action ID must not be accepted twice');
        await page.reload();
        await page.waitForFunction(() => state.worldInstances?.knowledge_persistence_fixture?.sessions?.length);
        const reloaded = await page.evaluate(() => {
            const sess = state.worldInstances.knowledge_persistence_fixture.sessions[0];
            return { reports: sess.entityStates.b.observations.length,
                actionId: sess.entityStates.b.observations[0]?.deliveryActionId,
                goals: sess.entityStates.b.goalPool?.length || 0,
                events: sess.turnEvents.filter(event => event.committed).length };
        });
        assert.deepEqual(reloaded, { reports: 1, actionId: 'ada_ben_confirmed',
            goals: 1, events: 1 });
        const legacyBefore = await page.evaluate(async () => {
            const worlds = [2, 3].map(version => ({ id: `knowledge_legacy_v${version}`,
                name: `Knowledge legacy V${version}`, schemaVersion: version,
                startLocationId: 'room', locations: [{ id: 'room', name: 'Room', exits: [] }],
                entities: [{ id: 'a', type: 'npc', name: 'Ada' },
                    { id: 'b', type: 'npc', name: 'Ben' }] }));
            state.worlds = worlds.map(world => upgradeWorldSchemaData(world).world);
            state.worldInstances = Object.fromEntries(worlds.map(world => [world.id,
                { activeSessionId: `session_v${world.schemaVersion}`, sessions: [{
                    id: `session_v${world.schemaVersion}`, playerLocation: 'room',
                    turnCount: 2, worldClock: { absoluteMinutes: 20 },
                    entityStates: { a: { location: 'room', observations: [{
                        id: 'old_witness', text: 'Old direct observation.',
                        sourceType: 'witnessed', turn: 1 }] },
                    b: { location: 'room', observations: [{ id: 'old_report',
                        text: 'Old report.', sourceType: 'told', turn: 1 }] } },
                    worldNews: [] }] } ]));
            state.activeWorldId = worlds[0].id;
            for (const world of state.worlds)
                normalizeLivingWorldState(world, state.worldInstances[world.id].sessions[0]);
            await saveState({ allWorldInstances: true });
            return state.worlds.map(world => ({ id: world.id,
                version: world.schemaVersion,
                communication: world.communication, reactions: world.reactionRules }));
        });
        await page.reload();
        await page.waitForFunction(() => state.worldInstances?.knowledge_legacy_v3?.sessions?.length);
        const legacyAfter = await page.evaluate(() => [2, 3].map(version => {
            const id = `knowledge_legacy_v${version}`;
            const world = state.worlds.find(item => item.id === id);
            const sess = state.worldInstances[id].sessions[0];
            return { version: world.schemaVersion,
                communication: world.communication, reactions: world.reactionRules,
                original: sess.entityStates.a.observations[0],
                report: sess.entityStates.b.observations[0],
                reports: sess.entityStates.b.observations.length,
                news: sess.worldNews.length,
                goals: sess.entityStates.b.goalPool?.length || 0 };
        }));
        assert.equal(legacyBefore.length, 2);
        for (const item of legacyAfter) {
            assert.equal(item.version, 4);
            assert.equal(item.communication, undefined);
            assert.equal(item.reactions, undefined);
            assert.equal(item.original.sourceType, 'witnessed');
            assert.equal(item.report.sourceType, 'told');
            assert.notEqual(item.report.evidenceMode, 'direct');
            assert.equal(item.report.deliveryActionId || '', '');
            assert.equal(item.reports, 1);
            assert.equal(item.news, 0);
            assert.equal(item.goals, 0);
        }
        console.log('PASS knowledge-share persistence: failed commit atomic, retry once, action idempotence, reload');
        console.log('PASS knowledge-share legacy: V2/V3 definitions and sessions migrate and reload without invented knowledge');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
