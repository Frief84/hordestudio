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
            if (url.hostname !== 'free-goal.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file))
                return route.fulfill({ status: 404, body: '' });
            return route.fulfill({ contentType: { '.html': 'text/html', '.js': 'text/javascript',
                '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        await page.goto('https://free-goal.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
        const result = await page.evaluate(() => {
            clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer);
            const npc = { id: 'keeper', type: 'npc', name: 'Keeper', startLocation: 'store',
                persona: 'Careful and patient.', goal: 'Ich möchte das Archive erreichen.' };
            const world = { id: 'free_goal', name: 'Free Goal', startLocationId: 'foyer',
                hudConfig: { timeStep: 5 }, gameRules: { modules: { livingWorld: true } },
                locations: [
                    { id: 'foyer', name: 'Foyer', exits: [{ targetLocationId: 'store' }] },
                    { id: 'store', name: 'Store', exits: [{ targetLocationId: 'archive',
                        doorId: 'archive_door', requiredItem: 'Brass key', lockState: 'locked' }] },
                    { id: 'archive', name: 'Archive', exits: [{ targetLocationId: 'store' }] },
                    { id: 'secret', name: 'Secret', exits: [] }
                ], entities: [npc,
                    { id: 'brass_key', type: 'item', name: 'Brass key', locationId: 'store' }] };
            state.worlds = [world]; state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            const sess = prepareCurrentWorldSession(); sess.setupComplete = true;
            sess.entityStates.keeper = { ...sess.entityStates.keeper, location: 'store', inventory: [] };
            sess.entityStates.brass_key = { location: 'store' };
            sess.placeDiscoveries ||= {}; sess.placeDiscoveries.keeper = ['store', 'archive'];
            normalizeLivingWorldState(world, sess);
            const knowsPlace = (_actor, id) => sess.placeDiscoveries.keeper.includes(id);
            const options = () => HordeNpcGoalActions.npcGoalOptions(npc, world, sess, { knowsPlace });
            const record = () => ({ location: sess.entityStates.keeper.location,
                inventory: structuredClone(sess.entityStates.keeper.inventory),
                status: sess.entityStates.keeper.goalStatus,
                blocked: sess.entityStates.keeper.goalBlockedReason,
                proposal: sess.entityStates.keeper.goalActionProposal,
                last: sess.entityStates.keeper.goalLastAction,
                events: (sess.turnEvents || []).filter(e => e.actor_id === 'keeper').length });
            sess.turnCount = 1; runLivingWorldTick(world, sess);
            const blocked = record();
            const take = options().find(o => o.effect.type === 'item_transfer');
            const accept = applyWorldAgentProposals(world, sess, { npc_goal_actions: [{
                npc_id: npc.id, goal: sess.entityStates.keeper.goal,
                label: 'takes the key first', reason: 'door is locked', effect: take.effect }
            ] }, [], 1).outcomes[0].outcome;
            Object.assign(sess, JSON.parse(JSON.stringify(sess))); // save/reload
            sess.turnCount = 2; runLivingWorldTick(world, sess);
            const acquired = record();
            const open = options().find(o => o.effect.type === 'interactable_transition');
            applyWorldAgentProposals(world, sess, { npc_goal_actions: [{
                npc_id: npc.id, goal: sess.entityStates.keeper.goal,
                effect: open.effect }] }, [], 2);
            sess.turnCount = 3; runLivingWorldTick(world, sess);
            const opened = !!sess.unlockedExits?.archive_door;
            sess.turnCount = 4; runLivingWorldTick(world, sess);
            const arrived = record();
            runLivingWorldTick(world, sess);
            const repeat = record();
            sess.entityStates.keeper.goal = 'Ich möchte Secret erreichen.';
            sess.entityStates.keeper.goalStatus = 'active';
            sess.entityStates.keeper.goalProgress = 0;
            sess.turnCount = 5; runLivingWorldTick(world, sess);
            const unknown = record();
            const forged = HordeNpcGoalActions.acceptNpcGoalProposal(npc,
                { npc_id: npc.id, goal: sess.entityStates.keeper.goal,
                    effect: { type: 'actor_move', payload: { actor_id: 'keeper', to_location_id: 'secret' } } },
                world, sess, { knowsPlace });
            world.entities.push({ id: 'scout', type: 'npc', name: 'Scout',
                persona: 'Impatient and curious.', startLocation: 'store' });
            sess.entityStates.scout = { location: 'store', inventory: [],
                goal: 'Get into the archive.', goalStatus: 'active' };
            sess.entityStates.keeper.location = 'store';
            sess.entityStates.keeper.goal = 'Get into the archive.';
            sess.entityStates.keeper.goalStatus = 'active';
            sess.placeDiscoveries.scout = ['store', 'archive'];
            sess.unlockedExits = {};
            const scout = world.entities.at(-1);
            const scoutOptions = HordeNpcGoalActions.npcGoalOptions(scout, world, sess,
                { knowsPlace: (_actor, id) => sess.placeDiscoveries.scout.includes(id) });
            const scoutDoor = scoutOptions.find(o => o.effect.type === 'interactable_transition');
            const digest = buildWorldAgentDigest(world, sess);
            const scoutChoice = applyWorldAgentProposals(world, sess, { npc_goal_actions: [{
                npc_id: 'scout', goal: sess.entityStates.scout.goal,
                effect: scoutDoor.effect, reason: 'tries the door first' }] }, [], 6);
            sess.entityStates.brass_key = { location: 'store', hidden: true };
            const hidden = HordeNpcGoalActions.npcGoalOptions(npc, world, sess,
                { knowsPlace }).some(o => o.effect.type === 'item_transfer');
            sess.entityStates.brass_key.hidden = false;
            sess.entityStates.keeper.inventory = [];
            sess.entityStates.keeper.goal = 'I need Brass key.';
            sess.entityStates.keeper.goalStatus = 'active';
            sess.turnCount = 7; runLivingWorldTick(world, sess);
            const acquiredFreeItem = record();
            return { blocked, accept, acquired, opened, arrived, repeat, unknown, forged,
                scoutChoice: scoutChoice.outcomes[0].outcome,
                scoutEffect: sess.entityStates.scout.goalActionProposal?.effect?.type,
                hidden, digestHasPersonas: digest.includes('Careful and patient.')
                    && digest.includes('Impatient and curious.'), acquiredFreeItem };
        });
        assert.equal(result.blocked.location, 'store');
        assert.equal(result.blocked.status, 'active');
        assert.equal(result.blocked.events, 0);
        assert.equal(result.accept, 'succeeded');
        assert.equal(result.acquired.events, 1);
        assert(result.acquired.inventory.length);
        assert.equal(result.acquired.status, 'active');
        assert.equal(result.opened, true);
        assert.equal(result.arrived.location, 'archive');
        assert.equal(result.arrived.status, 'completed');
        assert.equal(result.arrived.events, 3);
        assert.deepEqual(result.repeat, result.arrived);
        assert.equal(result.unknown.status, 'active');
        assert.equal(result.unknown.location, 'archive');
        assert.equal(result.forged, false);
        assert.equal(result.scoutChoice, 'succeeded');
        assert.equal(result.scoutEffect, 'interactable_transition');
        assert.equal(result.hidden, false);
        assert.equal(result.digestHasPersonas, true);
        assert(result.acquiredFreeItem.inventory.length);
        assert.equal(result.acquiredFreeItem.location, 'store');
        console.log('PASS free NPC goals: blocked move, simulated agent choice, item, door, arrival, reload, idempotence, unknown place');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
