/**
 * Locked routes, first-person movement and persistent escorts.
 * Run with: node scratch/worlds2_route_escort_regression.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { app, buildContext } = require('./app_source.js');
const worldLore = require('../assets/worlds/world-lore.js');

const world = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures',
    'worlds2-rpg-live.horde_world'), 'utf8'));
const gate = world.locations.find(location => location.id === 'gate');
const cellar = world.locations.find(location => location.id === 'cellar');
const guardedExit = gate.exits.find(exit => exit.targetLocationId === 'cellar');
guardedExit.requiredItem = 'brass tower key';
guardedExit.allowCheckUnlock = true;
const reverseExit = cellar.exits.find(exit => exit.targetLocationId === 'gate');
reverseExit.requiredItem = 'brass tower key';
reverseExit.allowCheckUnlock = true;

const ctx = buildContext(vm, [
    'extractUserMovementTarget', 'resolveWorldMovementTarget',
    'worldExitRequirement', 'findWorldTravelPath', 'movePlayerAlongWorldPath',
    'requestedWorldTravelCompanionIds', 'userRequestsWorldDoorRelock',
    'applyWorldExitUnlocks',
    'validateWorldTurnReceipt', 'applyWorldEntityPatches'
], {
    console: { log() {}, warn() {}, error() {} },
    showToast() {},
    worldForSession: value => value,
    sessionNpcs: value => (value.entities || []).filter(entity => entity.type === 'npc'),
    isNpcActive: value => value && !['dead', 'gone'].includes(value.status),
    normalizeWorldGameRules: () => ({ modules: { inventory: true, conditions: true, relationships: true } }),
    buildWorldSceneFrame: (_, session) => ({ player_location_id: session.playerLocation,
        present_character_ids: Object.entries(session.entityStates || {})
            .filter(([, state]) => state.location === session.playerLocation).map(([id]) => id),
        activities: {} }),
    getWorldTimeData: () => ({ currentTotalMinutes: 100, timeStep: 5 }),
    globalThis: { HordeRpgMechanics: { itemName: item => item?.name || String(item || '') } }
});

const phrases = [
    ['square', 'I leave the square by the east road and follow the mapped causeway toward the tower. At the Marsh Causeway I stop.', 'causeway'],
    ['inn', 'I leave the Reed Inn, cross Village Square, and follow the mapped east road to Marsh Causeway.', 'causeway'],
    ['square', 'I am in Village Square. I take the single east-road exit to Marsh Causeway, no farther.', 'causeway']
];
for (const [from, input, expected] of phrases) {
    const phrase = ctx.extractUserMovementTarget(input);
    assert.equal(ctx.resolveWorldMovementTarget(world, from, phrase)?.id, expected, input);
}
assert.equal(ctx.extractUserMovementTarget('I tell Tomas to follow the mapped causeway.'), '',
    'ordering someone else to move must not move the player');
const directEscortInput = 'You take Cassy with you into the round room, unlock the door, and lock it again behind you';
const directEscortTarget = ctx.extractUserMovementTarget(directEscortInput);
assert.equal(directEscortTarget, 'the round room',
    'a direct second-person player action must identify the mapped destination');
assert.equal(ctx.extractUserMovementTarget('You take Cassy with you.'), '',
    'taking somebody along without a destination must not authorize a move');
assert.equal(ctx.extractUserMovementTarget('"You take Cassy with you into the round room," she says.'), '',
    'quoted dialogue must not become player movement');
assert.equal(ctx.userRequestsWorldDoorRelock(directEscortInput), true);
assert.equal(ctx.userRequestsWorldDoorRelock('You take Cassy into the round room and unlock the door.'), false);
assert.equal(ctx.userRequestsWorldDoorRelock('You do not lock it again behind you.'), false);

const session = { id: 'route_test', playerLocation: 'gate', inventory: [],
    entityStates: { tomas: { location: 'gate', followingPlayer: true } }, turnCount: 8 };
assert.equal(ctx.worldExitRequirement(session, guardedExit, 'gate').reason, 'required_item');
assert.equal(ctx.findWorldTravelPath(world, 'gate', 'cellar', { session }), null,
    'the authored door must not be traversable without its key');
assert.equal(ctx.resolveWorldMovementTarget(world, 'gate', 'Tower Cellar', true, session), null,
    'text travel cannot bypass the guarded mapped edge');
const blocked = ctx.movePlayerAlongWorldPath(world, session, cellar, { exit: guardedExit });
assert.equal(blocked.reason, 'required_item');
assert.equal(blocked.requiredItem, 'brass tower key');
assert.equal(session.playerLocation, 'gate');
assert.equal(session.entityStates.tomas.location, 'gate');

const wrongPlace = ctx.applyWorldExitUnlocks(world, session,
    [{ from_location_id: 'square', to_location_id: 'cellar' }]);
assert.equal(wrongPlace.length, 0, 'a check outcome may not unlock a distant exit');
assert.equal(ctx.worldExitRequirement(session, guardedExit, 'gate').ok, false);
const opened = ctx.applyWorldExitUnlocks(world, session,
    [{ from_location_id: 'gate', to_location_id: 'cellar' }]);
assert.equal(opened.length, 1, 'a local authored check gate can open');
assert.equal(ctx.worldExitRequirement(session, guardedExit, 'gate').unlocked, true);
assert.equal(session.unlockedExits['gate::cellar'], true);
assert.equal(ctx.worldExitRequirement(session, reverseExit, 'cellar').ok, true,
    'opening a two-way authored gate opens its matching reverse edge');
assert.deepEqual(Array.from(ctx.findWorldTravelPath(world, 'gate', 'cellar', { session })), ['gate', 'cellar']);
const entered = ctx.movePlayerAlongWorldPath(world, session, cellar, { exit: guardedExit });
assert.equal(entered.ok, true);
assert.equal(session.playerLocation, 'cellar');
assert.equal(session.entityStates.tomas.location, 'cellar', 'an accepted escort travels with the player');
assert.deepEqual(Array.from(entered.followersMoved), ['tomas']);
assert(session.entityStates.tomas.pinnedUntilTurn > session.turnCount,
    'schedules may not immediately teleport an escort away');

const keyOnlySession = { id: 'key_only', playerLocation: 'gate', inventory: [], unlockedExits: {} };
guardedExit.allowCheckUnlock = false;
assert.equal(ctx.applyWorldExitUnlocks(world, keyOnlySession,
    [{ from_location_id: 'gate', to_location_id: 'cellar' }]).length, 0,
    'a key-only gate cannot be opened by a model-requested check outcome');
assert.equal(ctx.worldExitRequirement(keyOnlySession, guardedExit, 'gate').ok, false);
keyOnlySession.inventory.push({ name: 'brass tower key', quantity: 1 });
assert.equal(ctx.worldExitRequirement(keyOnlySession, guardedExit, 'gate').ok, true,
    'the explicitly authored key still permits travel');
const accompaniedWorld = structuredClone(world);
accompaniedWorld.locations.find(location => location.id === 'cellar').name = 'Round Room';
accompaniedWorld.entities.push({ id: 'cassy', type: 'npc', name: 'Cassy' });
const unkeyedCompanionSession = { id: 'unkeyed_companion', playerLocation: 'gate', inventory: [],
    entityStates: { cassy: { location: 'gate' } }, turnCount: 8 };
assert.equal(ctx.movePlayerAlongWorldPath(accompaniedWorld, unkeyedCompanionSession,
    accompaniedWorld.locations.find(location => location.id === 'cellar'),
    { companionIds: ['cassy'] }).ok, false,
    'taking a companion must not bypass the locked route when the player lacks its key');
assert.equal(unkeyedCompanionSession.entityStates.cassy.location, 'gate');
const accompaniedSession = { id: 'keyed_companion', playerLocation: 'gate',
    inventory: [{ name: 'brass tower key', quantity: 1 }],
    entityStates: { cassy: { location: 'gate', followingPlayer: false } }, turnCount: 8 };
const accompaniedIds = ctx.requestedWorldTravelCompanionIds(accompaniedWorld, accompaniedSession, directEscortInput);
assert.deepEqual(Array.from(accompaniedIds), ['cassy']);
const accompaniedTarget = ctx.resolveWorldMovementTarget(accompaniedWorld, 'gate', directEscortTarget, true, accompaniedSession);
assert.equal(accompaniedTarget?.id, 'cellar');
ctx.globalThis.HordeWorldLore = {
    access: () => ({ ok: false, reason: 'authored denial' }),
    placeAwareness: () => ({ known: false }),
    rememberPlace: () => {}
};
const accompaniedMove = ctx.movePlayerAlongWorldPath(accompaniedWorld, accompaniedSession, accompaniedTarget,
    { companionIds: accompaniedIds, relockLastDoor: ctx.userRequestsWorldDoorRelock(directEscortInput) });
assert.equal(accompaniedMove.ok, true);
assert.equal(accompaniedMove.relocked, true, 'the explicitly requested final step re-locks the door');
assert.deepEqual(Array.from(accompaniedMove.doorChanges, change => change.action), ['unlocked', 'relocked']);
assert.equal(accompaniedSession.unlockedExits?.['gate::cellar'], undefined);
assert.equal(accompaniedSession.unlockedExits?.['cellar::gate'], undefined);
assert.equal(worldLore.exitLock(guardedExit, accompaniedSession, 'gate', 'cellar').currentState, 'locked',
    'World Lore must show the final closed state after re-locking');
assert.equal(accompaniedSession.playerLocation, 'cellar');
assert.equal(accompaniedSession.entityStates.cassy.location, 'cellar',
    'a named companion passes through the door opened by the player key');
assert.equal(accompaniedSession.entityStates.cassy.followingPlayer, false,
    'one escorted move does not silently create a durable escort agreement');
const openDoorSession = { id: 'door_left_open', playerLocation: 'gate',
    inventory: [{ name: 'brass tower key', quantity: 1 }],
    entityStates: { cassy: { location: 'gate' } }, turnCount: 8 };
const openDoorMove = ctx.movePlayerAlongWorldPath(accompaniedWorld, openDoorSession, accompaniedTarget,
    { companionIds: ['cassy'] });
assert.equal(openDoorMove.ok, true);
assert.equal(openDoorMove.relocked, false);
assert.deepEqual(Array.from(openDoorMove.doorChanges, change => change.action), ['unlocked']);
assert.equal(openDoorSession.unlockedExits['gate::cellar'], true,
    'without a re-lock instruction, the traversed keyed door remains open');
assert.equal(openDoorSession.unlockedExits['cellar::gate'], true,
    'the two directions of one physical door have the same state');
assert.equal(worldLore.exitLock(guardedExit, openDoorSession, 'gate', 'cellar').currentState, 'unlocked',
    'World Lore must show a key-opened door when the player omits re-locking');
openDoorSession.inventory = [];
assert.equal(ctx.worldExitRequirement(openDoorSession, reverseExit, 'cellar').ok, true,
    'an opened key-only door can be used without a second key until it is re-locked');
ctx.globalThis.HordeWorldLore = undefined;
const echoedMove = ctx.validateWorldTurnReceipt(accompaniedWorld, accompaniedSession, {
    scene: { player_location_id: 'cellar', player_location_changed: true,
        present_character_ids: ['cassy'] },
    events: [{ type: 'movement', actor_id: 'player', status: 'completed',
        from_location_id: 'gate', to_location_id: 'cellar', movement_mode: 'voluntary',
        evidence: 'You take Cassy with you into the round room.' }],
    entity_updates: [], state_updates: {}
}, { playerStartLocationId: 'gate', committedPlayerDestinationId: 'cellar',
    playerMovementAuthorized: true, authorizedPlayerDestinationId: 'cellar' });
assert(!echoedMove.rejectedEvents.some(item => item.reason === 'player_movement_not_authorized'),
    'the precommitted player move must remain authorized in the receipt');
guardedExit.allowCheckUnlock = true;

const checkOnly = { targetLocationId: 'cellar', text: 'down to Tower Cellar', allowCheckUnlock: true };
gate.exits.push(checkOnly);
const checkOnlySession = { id: 'check_only', playerLocation: 'gate', inventory: [] };
assert.equal(ctx.worldExitRequirement(checkOnlySession, checkOnly, 'gate').reason, 'locked_exit');

const receiptSession = { id: 'escort_test', playerLocation: 'cellar', inventory: [],
    entityStates: { tomas: { location: 'cellar' } }, turnCount: 4 };
const introductionSession = { id: 'new_rider', playerLocation: 'square', inventory: [],
    entityStates: { iven: { location: 'square' } }, turnCount: 4 };
const arrivalIntroduction = ctx.validateWorldTurnReceipt(world, introductionSession, {
    scene: { player_location_id: 'square', player_location_changed: false,
        present_character_ids: ['iven', 'lead_rider'] },
    events: [{ type: 'movement', status: 'completed', actor_id: 'lead_rider',
        from_location_id: 'causeway', to_location_id: 'square',
        movement_mode: 'voluntary', evidence: 'A new lead rider arrives in the square.' }],
    entity_updates: [{ entity_id: 'lead_rider', location_id: 'square',
        activity: 'questioning Iven', interacting_with: ['iven'] }],
    state_updates: { npc_introduced: [{ id: 'lead_rider', name: 'Lead Rider',
        description: 'A scarred officer arriving with six regulars.', persona: 'Professional.' }] }
});
assert.equal(arrivalIntroduction.rejectedEvents.length, 0,
    `A first-scene introduction should not fail on a redundant arrival event: ${JSON.stringify(arrivalIntroduction.rejectedEvents)}`);
assert.equal(arrivalIntroduction.acceptedEvents.filter(event => event.type === 'movement').length, 0,
    'A new actor must start in the current scene, not inherit an invented prior route.');
assert.equal(arrivalIntroduction.legacyArgs.npc_introduced[0].id, 'lead_rider');
const receipt = event => ({ scene: { player_location_id: 'cellar',
    player_location_changed: false, present_character_ids: ['tomas'] },
    events: [event], entity_updates: [], state_updates: {} });
const asked = ctx.validateWorldTurnReceipt(world, receiptSession, receipt({
    type: 'escort', actor_id: 'tomas', target_id: 'player', action: 'join',
    status: 'intended', evidence: 'The player asks Tomas to follow.'
}));
assert.equal(asked.acceptedEvents.length, 0, 'asking for company does not establish a follower');
const agreed = ctx.validateWorldTurnReceipt(world, receiptSession, receipt({
    type: 'escort', actor_id: 'tomas', target_id: 'player', action: 'join',
    status: 'completed', evidence: 'Tomas agrees to come with you.'
}));
assert.equal(agreed.rejectedEvents.length, 0);
ctx.applyWorldEntityPatches(world, receiptSession, agreed.entityPatches);
assert.equal(receiptSession.entityStates.tomas.followingPlayer, true);
const stopped = ctx.validateWorldTurnReceipt(world, receiptSession, receipt({
    type: 'escort', actor_id: 'tomas', target_id: 'player', action: 'leave',
    status: 'completed', evidence: 'Tomas stays behind in the cellar.'
}));
ctx.applyWorldEntityPatches(world, receiptSession, stopped.entityPatches);
assert.equal(receiptSession.entityStates.tomas.followingPlayer, false);

assert.match(app, /class="form-input exit-required-item"/, 'World Studio must expose the item guard');
assert.match(app, /class="exit-check-unlock"/, 'World Studio must expose an explicit check-unlock option');
assert.match(app, /btn\.disabled = true;\s*btn\.title = requirement\.requiredItem/,
    'the play UI must show why a guarded exit is unavailable');
assert.match(app, /authorizedCheckOutcome: result\.success === true/,
    'check outcomes must distinguish successful from failed or direct updates');
console.log('✓ movement intent, item/check-gated exits, and NPC escort continuity');
