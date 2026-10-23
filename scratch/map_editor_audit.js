'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const editor = require('../assets/worlds/map-editor.js');
const { buildContext, functionSource, app } = require('./app_source.js');
const ctx = buildContext(vm, ['ensureWorldDoorIds', 'worldExitRequirement', 'validateWorldData', 'normalizeAuthoredWorld'], {
    HordeMapEditor: editor, state: { worlds: [] }, console,
    HordeWorldLore: require('../assets/worlds/world-lore.js')
});
const world = { id: 'map_test', name: 'Map audit', entities: [{ id: 'key', type: 'item', name: 'Brass key' }], lorebook: [], locations: [
    { id: 'a', name: 'Room A', mapType: 'room', parentLocationId: 'building', mapFloor: '2', exits: [{ targetLocationId: 'b', text: 'to Room B', travelTime: 7, cost: '2 coins', requiredItem: 'Old key', allowCheckUnlock: true }] },
    { id: 'b', name: 'Room B', mapType: 'room', exits: [{ targetLocationId: 'a', text: 'to Room A', travelTime: 7, cost: '2 coins', requiredItem: 'Old key' }, { targetLocationId: 'c', text: 'to Room C', isOneWay: true, travelTime: 3 }] },
    { id: 'c', name: 'Room C', mapType: 'room', exits: [] }
] };
ctx.ensureWorldDoorIds(world);
const authored = JSON.stringify(world.locations);
const auto = { width: 1000, height: 700, positions: new Map(world.locations.map((l, i) => [l.id, { x: 120 + 300 * i, y: 200, width: 140, height: 60 }])) };
world.mapLayout = editor.geometry(world, auto);
world.mapLayout.nodes.a.x = 180;
world.mapLayout.nodes.a = editor.resize(world.mapLayout.nodes.a, 'se', { x: 70, y: 45 }, world.mapLayout);
assert.equal(JSON.stringify(world.locations), authored, 'drag/resize cannot mutate authored travel or hierarchy');
const links = editor.connections(world), door = links.find(l => l.sourceId === 'a');
const oneWay = links.find(l => l.targetId === 'c');
assert.equal(links.length, 2); assert.equal(oneWay.isOneWay, true); assert.equal(door.isOneWay, false);
const route = world.mapLayout.routes[door.key]; route.points.push({ x: 450, y: 300 }); route.door = .4; // Legacy marker metadata must be discarded on normalization.
const points = editor.routePoints(world.mapLayout, door);
assert.equal(points[0].x, world.mapLayout.nodes.a.x + world.mapLayout.nodes.a.width / 2);
assert.deepEqual(points[1], route.points[0]);
assert.ok(editor.nearest(points, editor.along(points, .4)).distance < .001);
const imported = ctx.validateWorldData(JSON.parse(JSON.stringify(world)));
ctx.normalizeAuthoredWorld(imported);
assert.equal(Object.values(imported.mapLayout.routes)[0].door, undefined); delete route.door;
assert.deepEqual(JSON.parse(JSON.stringify(imported.mapLayout)), JSON.parse(JSON.stringify(world.mapLayout)));
editor.setConnectionLock(world, door, { lockable: true, key: 'Brass key', locked: true, allowCheckUnlock: true });
for (const entry of door.entries) {
    assert.equal(entry.exit.requiredItem, 'Brass key'); assert.equal(entry.exit.lockState, 'locked');
    assert.equal(entry.exit.travelTime, 7); assert.equal(entry.exit.cost, '2 coins');
    assert.equal(entry.exit.doorId, door.doorId);
}
assert.equal(ctx.worldExitRequirement({ inventory: [] }, door.entries[0].exit, 'a').ok, false);
assert.equal(ctx.worldExitRequirement({ inventory: ['Brass key'] }, door.entries[0].exit, 'a').ok, true);
assert.equal(ctx.worldExitRequirement({ inventory: [], unlockedExits: { [door.doorId]: true } }, door.entries[1].exit, 'b').ok, true);
assert.equal(ctx.worldExitRequirement({ inventory: [], entityStates: { npc: { inventory: ['Brass key'] } } }, door.entries[0].exit, 'a', 'npc').ok, true);
editor.setConnectionLock(world, door, { lockable: true, key: 'Brass key', locked: false });
assert.equal(ctx.worldExitRequirement({ inventory: [] }, door.entries[0].exit, 'a').ok, true);
assert.equal(door.entries[0].exit.lockKeyItem, 'Brass key');
door.entries[0].exit.lockState = 'locked';
assert.equal(ctx.worldExitRequirement({ inventory: [] }, door.entries[0].exit, 'a').ok, false);
assert.equal(ctx.worldExitRequirement({ inventory: ['Brass key'] }, door.entries[0].exit, 'a').ok, true,
    'a later lock-state edit must use the configured key without treating an initially open door as locked');
door.entries[0].exit.lockState = 'unlocked';
assert.equal(oneWay.entries[0].exit.travelTime, 3);
assert.throws(() => editor.setConnectionLock(world, door, { lockable: true, key: '', locked: true }), /key\/item/);
const history = editor.history(world, () => {});
let before = history.capture(false); world.mapLayout.nodes.a.x += 20; history.commit(before, false);
history.undo(); assert.equal(world.mapLayout.nodes.a.x, before.layout.nodes.a.x);
history.redo(); assert.equal(world.mapLayout.nodes.a.x, before.layout.nodes.a.x + 20);
before = history.capture(true); world.locations.push({ id: 'new', name: 'New room', exits: [] }); history.commit(before, true);
history.undo(); assert.equal(world.locations.length, 3); history.redo(); assert.equal(world.locations.length, 4);
world.locations[0].description = 'An unrelated edit';
assert.throws(() => history.undo(), /outside the map/); assert.equal(world.locations[0].description, 'An unrelated edit');
const ids = new Map([['a', 'copied_a'], ['b', 'copied_b'], ['c', 'copied_c']]);
const copy = structuredClone(world); copy.mapLayout = editor.remap(copy.mapLayout, ids);
copy.locations.forEach(loc => { loc.id = ids.get(loc.id) || loc.id; loc.exits.forEach(exit => exit.targetLocationId = ids.get(exit.targetLocationId) || exit.targetLocationId); });
editor.normalize(copy); assert.deepEqual(copy.mapLayout.nodes.copied_a, world.mapLayout.nodes.a);
assert.deepEqual(Object.values(copy.mapLayout.routes).find(r => r.sourceId === 'copied_a').points, route.points);
copy.locations = copy.locations.filter(l => l.id !== 'copied_b'); editor.normalize(copy);
assert.equal(copy.mapLayout.nodes.copied_b, undefined); assert.equal(Object.keys(copy.mapLayout.routes).length, 0);
copy.mapLayout.nodes.copied_a = { x: NaN, y: Infinity, width: -2, height: 0 }; editor.normalize(copy);
assert.ok(Number.isFinite(copy.mapLayout.nodes.copied_a.x)); assert.equal(copy.mapLayout.nodes.copied_a.width, 48);
console.log('PASS: map geometry, round trip through real import/normalization, shared doors, keys, NPC access, one-way routes, guarded undo/redo and ID remapping');

const large = { locations: Array.from({ length: 2000 }, (_, i) => ({ id: `loc${i}`, name: `Room ${i}`, exits: i < 1999 ? [{ targetLocationId: `loc${i + 1}` }] : [] })) };
const start = Date.now();
large.mapLayout = editor.geometry(large, { width: 20000, height: 20000 });
const secondPass = editor.geometry(large);
assert.equal(Object.keys(secondPass.nodes).length, 2000);
assert.equal(Object.keys(secondPass.routes).length, 1999);
assert.ok(Date.now() - start < 5000, 'saved map normalization must remain linear at the world limit');
console.log(`PASS: 2,000-room manual layout and 1,999 connections normalized twice in ${Date.now() - start}ms`);

// Serve this fixture through the normal local server. It never loads app startup
// or reads/writes a user's saved worlds. Renderer and connection callbacks are real.
if (process.argv.includes('--browser-fixture')) {
    const names = ['getExitTargetName', 'createWorldLocationRecord', 'ensureWorldDoorIds', 'normalizeWorldTravelMode', 'upsertWorldTravelConnection', 'renderSemanticWorldMap', 'worldMediaSource', 'worldMediaAsset', 'cssUrl'];
    const engineStart = app.indexOf('const WORLD_MAP_TYPES');
    const engineEnd = app.indexOf('function focusWorldLocationCard', engineStart);
    const source = app.slice(engineStart, engineEnd) + '\n' + names.map(name => functionSource(name)).join('\n');
    fs.writeFileSync(path.join(__dirname, 'map_editor_fixture_source.js'), source);
}
