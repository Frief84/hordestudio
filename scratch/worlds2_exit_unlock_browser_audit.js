/** Offline browser check for authored check-gated exits and persisted unlocks. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures',
    'worlds2-rpg-live.horde_world'), 'utf8'));

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext();
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname !== 'world-exit-check.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
                return route.fulfill({ status: 404, body: '' });
            }
            const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
            return route.fulfill({ contentType: mime, body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('https://world-exit-check.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
        const result = await page.evaluate(async source => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            const world = structuredClone(source);
            world.id = 'world_exit_unlock_fixture';
            world.startLocationId = 'gate';
            world.gameRules.dice = { resolution: 'engine', sides: 20,
                defaultDifficulty: 10, criticals: false, modifierMode: 'none' };
            world.gameRules.modules = { ...world.gameRules.modules, checks: true, inventory: true };
            const gate = world.locations.find(location => location.id === 'gate');
            const cellar = world.locations.find(location => location.id === 'cellar');
            const exit = gate.exits.find(item => item.targetLocationId === 'cellar');
            const reverse = cellar.exits.find(item => item.targetLocationId === 'gate');
            exit.requiredItem = 'tower key';
            exit.allowCheckUnlock = true;
            reverse.requiredItem = 'tower key';
            reverse.allowCheckUnlock = true;
            state.worlds = [world];
            state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            const session = prepareCurrentWorldSession();
            session.setupComplete = true;
            session.playerLocation = 'gate';
            session.inventory = [];
            session.pendingChecks = [];
            session.pendingCheck = null;
            session.entityStates.tomas = { ...session.entityStates.tomas,
                location: 'gate', status: 'alive', followingPlayer: true };
            session.history.push({ id: 'opening', role: 'dm', text: 'You stand before a locked gate.', location: 'gate' });
            switchView('worldPlay');
            document.getElementById('modal-overlay')?.classList.add('hidden');
            renderWorldPlayState();
            const button = [...document.querySelectorAll('#world-exits-list button')]
                .find(item => item.textContent.includes('Tower Cellar'));
            const before = {
                disabled: button?.disabled,
                label: button?.textContent,
                title: button?.title,
                lockIcon: button ? getComputedStyle(button, '::after').content : '',
                path: findWorldTravelPath(world, 'gate', 'cellar', { session })
            };
            const snapshot = captureWorldTurnState(world, session);
            session.inventory.push({ name: 'tower key', quantity: 1 });
            const openedWithKey = applyPlayerKeyDoorOpening(world, session,
                'YouYou open the door to the Tower Cellar');
            const keyDoor = {
                committed: openedWithKey?.committed,
                playerLocation: session.playerLocation,
                unlocked: session.unlockedExits?.[exit.doorId] === true,
                reverseUnlocked: exit.doorId === reverse.doorId
                    && session.unlockedExits?.[reverse.doorId] === true,
                loreLock: HordeWorldLore.exitLock(exit, session, 'gate', 'cellar').currentState
            };
            renderWorldPlayState();
            const unlockedButton = [...document.querySelectorAll('#world-exits-list button')]
                .find(item => item.textContent.includes('Tower Cellar'));
            const unlockedIcon = getComputedStyle(unlockedButton, '::after').content;
            const relockedWithKey = applyPlayerKeyDoorAction(world, session,
                'YouYou lock the door of the Tower Cellar');
            renderWorldPlayState();
            const relockedButton = [...document.querySelectorAll('#world-exits-list button')]
                .find(item => item.textContent.includes('Tower Cellar'));
            const relockedIcon = getComputedStyle(relockedButton, '::after').content;
            restoreWorldTurnState(world, session, snapshot);
            const direct = processStructuredActions({ exit_unlocks: [
                { from_location_id: 'gate', to_location_id: 'cellar' }
            ] }, world, session);
            const afterDirect = worldExitRequirement(session, exit, 'gate').ok;
            const checked = processStructuredActions({ checks: [{
                label: 'Force the tower gate', difficulty: 2, modifier: 5,
                on_success: { exit_unlocks: [{ from_location_id: 'gate', to_location_id: 'cellar' }] }
            }] }, world, session);
            renderWorldPlayState();
            const afterCheck = {
                success: checked.checkResults[0]?.success,
                opened: checked.checkOutcomeResults[0]?.exitUnlockResults?.length === 1,
                route: findWorldTravelPath(world, 'gate', 'cellar', { session }),
                buttonDisabled: [...document.querySelectorAll('#world-exits-list button')]
                    .find(item => item.textContent.includes('Tower Cellar'))?.disabled,
                reverseOpen: worldExitRequirement(session, reverse, 'cellar').ok
            };
            await saveWorldsState({ worldId: world.id });
            const persisted = await HordeDB.get(`worldInstance:${world.id}`);
            const savedUnlock = persisted?.sessions?.[0]?.unlockedExits?.[exit.doorId] === true;
            const travel = await travelThroughWorldExit(world, session, exit);
            const afterTravel = await HordeDB.get(`worldInstance:${world.id}`);
            const movementEvents = (afterTravel?.sessions?.[0]?.turnEvents || [])
                .filter(event => event.type === 'movement' && event.from_location_id === 'gate'
                    && event.to_location_id === 'cellar');
            const travelProof = {
                ok: travel.ok && travel.moved,
                playerLocation: session.playerLocation,
                followerLocation: session.entityStates.tomas.location,
                persistedPlayerLocation: afterTravel?.sessions?.[0]?.playerLocation,
                persistedFollowerLocation: afterTravel?.sessions?.[0]?.entityStates?.tomas?.location,
                actors: movementEvents.map(event => event.actor_id).sort(),
                allCommitted: movementEvents.every(event => event.committed === true),
                engineReceiptCount: (afterTravel?.sessions?.[0]?.worldTurnReceipts || [])
                    .filter(entry => entry.audit?.source === 'engine_travel').length
            };
            restoreWorldTurnState(world, session, snapshot);
            const restored = worldExitRequirement(session, exit, 'gate').ok;
            world.entities.push({ id: 'linda', type: 'npc', name: 'Linda' });
            session.playerLocation = 'gate';
            session.entityStates.linda = { location: 'gate', status: 'alive' };
            session.inventory = [{ name: 'tower key', quantity: 1 }];
            const naturalTravelContext = applyUserDirectedMovement(world, session,
                'Ich gehe mit Linda an der Hand in den Tower Cellar');
            const naturalTravel = { playerLocation: session.playerLocation,
                lindaLocation: session.entityStates.linda.location,
                context: naturalTravelContext };
            restoreWorldTurnState(world, session, snapshot);
            session.playerLocation = 'gate';
            session.entityStates.linda = { location: 'gate', status: 'alive' };
            session.inventory = [{ name: 'tower key', quantity: 1 }];
            const directTakeContext = applyUserDirectedMovement(world, session,
                'You\nyou take linda to the Tower Cellar');
            const directTake = { playerLocation: session.playerLocation,
                lindaLocation: session.entityStates.linda.location,
                context: directTakeContext };
            return { before, keyDoor, unlockedIcon, relockedWithKey,
                relockedIcon, directRejected: direct.moduleRejections?.[0]?.reason,
                afterDirect, afterCheck, savedUnlock, travelProof, restored, naturalTravel, directTake };
        }, fixture);
        assert.equal(result.before.disabled, true);
        assert.doesNotMatch(result.before.label, /requires tower key|route closed/i);
        assert.match(result.before.title, /Requires tower key or a successful check/);
        assert.match(result.before.lockIcon, /🔒/);
        assert.equal(result.before.path, null);
        assert.deepEqual(result.keyDoor, { committed: true, playerLocation: 'gate',
            unlocked: true, reverseUnlocked: true, loreLock: 'unlocked' });
        assert.match(result.unlockedIcon, /🔓/);
        assert.equal(result.relockedWithKey.committed, true);
        assert.equal(result.relockedWithKey.changed, true);
        assert.match(result.relockedIcon, /🔒/,
            'carrying a key must not show a relocked door as open');
        assert.equal(result.directRejected, 'requires_successful_check');
        assert.equal(result.afterDirect, false);
        assert.equal(result.afterCheck.success, true);
        assert.equal(result.afterCheck.opened, true);
        assert.deepEqual(result.afterCheck.route, ['gate', 'cellar']);
        assert.equal(result.afterCheck.buttonDisabled, false);
        assert.equal(result.afterCheck.reverseOpen, true);
        assert.equal(result.savedUnlock, true);
        assert.deepEqual(result.travelProof, {
            ok: true, playerLocation: 'cellar', followerLocation: 'cellar',
            persistedPlayerLocation: 'cellar', persistedFollowerLocation: 'cellar',
            actors: ['player', 'tomas'], allCommitted: true, engineReceiptCount: 1
        });
        assert.equal(result.restored, false, 'rewinding a timeline must re-lock the exit');
        assert.equal(result.naturalTravel.playerLocation, 'cellar');
        assert.equal(result.naturalTravel.lindaLocation, 'cellar');
        assert.match(result.naturalTravel.context, /Linda accompanied the player/);
        assert.equal(result.directTake.playerLocation, 'cellar');
        assert.equal(result.directTake.lindaLocation, 'cellar');
        assert.match(result.directTake.context, /Linda accompanied the player/);
        assert.deepEqual(errors, []);
        console.log('PASS: authored gate blocks, check unlocks, direct travel commits player and escort, rewind re-locks');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
