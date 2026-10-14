/**
 * Semantic world-map regression and limit stress test.
 * Run with: node scratch/world_map_stress_test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const start = app.indexOf('const WORLD_MAP_TYPES');
const end = app.indexOf('function focusWorldLocationCard', start);
assert(start >= 0 && end > start, 'Semantic map engine source was not found');

const context = {};
vm.runInNewContext(`
function getExitTargetName(exit) {
    const text = typeof exit === 'string' ? exit : String(exit?.text || '');
    const clean = text.trim();
    if (/^to\\s+/i.test(clean)) return clean.replace(/^to\\s+/i, '').trim();
    const parts = clean.split(/\\s+to\\s+/i);
    return parts.length > 1 ? parts.slice(1).join(' to ').trim() : clean;
}
${app.slice(start, end)}
this.buildGraph = buildSemanticWorldGraph;
this.layoutGraph = layoutSemanticWorldGraph;
this.routeEdges = routeSemanticMapEdges;
this.inferType = inferWorldMapType;
`, context);

const link = (text, extra = {}) => ({ text, ...extra });
const world = {
    name: 'Willowbrook',
    locations: [
        {
            id: 'lane',
            name: 'Willowbrook Lane',
            region: 'Willowbrook',
            description: 'A residential street.',
            exits: ['to Smith House', 'to Harris House']
        },
        {
            id: 'a_smith',
            name: 'Smith House',
            region: 'Willowbrook',
            exits: ['to Willowbrook Lane', 'to Smith Backyard', 'to Master Bedroom']
        },
        {
            id: 'smith_yard',
            name: 'Smith Backyard',
            region: 'Willowbrook',
            exits: ['to Smith House']
        },
        {
            id: 'master',
            name: 'Master Bedroom',
            region: 'Willowbrook',
            exits: ['to Smith House', "to User's Room", 'to Hallway']
        },
        {
            id: 'user_room',
            name: "User's Room",
            region: 'Willowbrook',
            mapFloor: 'second floor',
            exits: ['to Master Bedroom', 'to Hallway', 'to Smith House', 'to Harris House']
        },
        {
            id: 'smith_hall',
            name: 'Hallway',
            region: 'Willowbrook',
            exits: ['to Master Bedroom', "to User's Room", 'to Smith House']
        },
        {
            id: 'z_harris',
            name: 'Harris House',
            region: 'Willowbrook',
            exits: [
                'to Willowbrook Lane',
                'to Harris Backyard',
                "to Emily's Room"
            ]
        },
        {
            id: 'harris_yard',
            name: 'Harris Backyard',
            region: 'Willowbrook',
            exits: ['to Harris House']
        },
        {
            id: 'emily',
            name: "Emily's Room",
            region: 'Willowbrook',
            exits: ['to Harris House', 'to Contested Bathroom']
        },
        {
            id: 'bathroom',
            name: 'Contested Bathroom',
            region: 'Willowbrook',
            exits: ["to Emily's Room"]
        }
    ]
};

const graph = context.buildGraph(world);
const byId = id => graph.nodeById.get(id);
assert.strictEqual(byId('lane').type, 'route');
assert.strictEqual(byId('a_smith').type, 'building');
assert.strictEqual(byId('master').type, 'room');
assert.strictEqual(byId('smith_yard').type, 'outdoor');
assert.strictEqual(byId('smith_yard').parentId, 'a_smith');
assert.strictEqual(byId('harris_yard').parentId, 'z_harris');
assert.strictEqual(byId('user_room').parentId, 'a_smith', 'neighboring-room evidence should resolve an over-connected room');
assert.strictEqual(byId('bathroom').parentId, 'z_harris', 'nested room chains should remain in their building');

const directionWorld = {
    locations: [
        { id: 'a_smith', name: 'Smith House', mapType: 'building', exits: [] },
        {
            id: 'z_harris',
            name: 'Harris House',
            mapType: 'building',
            exits: [link('West to Smith House', { isOneWay: true, travelTime: 8 })]
        }
    ]
};
const directionGraph = context.buildGraph(directionWorld);
const oneWay = directionGraph.displayEdges.find(edge =>
    edge.sourceId === 'z_harris' && edge.targetId === 'a_smith');
assert(oneWay?.isOneWay, 'one-way direction must survive alphabetical edge deduplication');
assert.strictEqual(oneWay.travelTime, 8);
assert(graph.displayEdges.length < graph.originalExitCount, 'reverse and redundant exits should be simplified');
assert(!graph.displayEdges.some(edge =>
    (edge.sourceId === 'a_smith' && edge.targetId === 'master')
    || (edge.sourceId === 'master' && edge.targetId === 'a_smith')),
'building-to-child exits should be conveyed by containment rather than another line');

const layout = context.layoutGraph(graph, 'user_room');
assert.strictEqual(layout.positions.size, world.locations.length);
const coordinateKeys = new Set();
layout.positions.forEach((position, id) => {
    assert(Number.isFinite(position.x) && Number.isFinite(position.y), `${id} has invalid coordinates`);
    const key = `${position.x}:${position.y}`;
    assert(!coordinateKeys.has(key), `${id} exactly overlaps another node`);
    coordinateKeys.add(key);
});
for (const childId of ['master', 'user_room', 'smith_hall']) {
    const child = layout.positions.get(childId);
    const cluster = layout.clusterBoxes.find(box => box.id === 'a_smith');
    assert(cluster, 'Smith House cluster should exist');
    assert(child.x > cluster.x && child.x < cluster.x + cluster.width);
    assert(child.y > cluster.y && child.y < cluster.y + cluster.height);
}

// Reproduce the manual setup that originally hid everything below the street:
// region → street → buildings → rooms/yards.
const manualStreetWorld = {
    name: 'Manual Street',
    locations: [
        {
            id: 'greenfield',
            name: 'Greenfield',
            mapType: 'region',
            exits: []
        },
        {
            id: 'willowbrook',
            name: 'Willowbrook Lane',
            mapType: 'route',
            parentLocationId: 'greenfield',
            region: 'Greenfield',
            exits: ['to Smith House', 'to Harris House']
        },
        {
            id: 'smith',
            name: 'Smith House',
            mapType: 'building',
            parentLocationId: 'willowbrook',
            region: 'Smith House',
            exits: ['to Willowbrook Lane', 'to Smith Bedroom', 'to Smith Backyard']
        },
        {
            id: 'smith_bed',
            name: 'Smith Bedroom',
            mapType: 'room',
            parentLocationId: 'smith',
            region: 'Smith House',
            exits: ['to Smith House']
        },
        {
            id: 'smith_backyard',
            name: 'Smith Backyard',
            mapType: 'outdoor',
            parentLocationId: 'smith',
            region: 'Smith House',
            exits: ['to Smith House']
        },
        {
            id: 'harris',
            name: 'Harris House',
            mapType: 'building',
            parentLocationId: 'willowbrook',
            region: 'Harris House',
            exits: ['to Willowbrook Lane', "to Emily's Room"]
        },
        {
            id: 'emily_room',
            name: "Emily's Room",
            mapType: 'room',
            parentLocationId: 'harris',
            region: 'Harris House',
            exits: ['to Harris House']
        }
    ]
};
const manualGraph = context.buildGraph(manualStreetWorld);
const manualLayout = context.layoutGraph(manualGraph);
assert.strictEqual(manualGraph.nodeById.get('willowbrook').parentId, 'greenfield');
assert(manualGraph.nodes.every(node => node.regionKey === 'Greenfield'),
    'the outer spatial region should win over lower-level grouping labels');
assert.strictEqual(manualLayout.positions.size, manualStreetWorld.locations.length,
    'every nested location must receive a visible map position');
assert.strictEqual(manualLayout.regionBoxes.length, 1, 'manual hierarchy should not create empty phantom regions');
assert(manualLayout.clusterBoxes.some(box => box.id === 'smith'));
assert(manualLayout.clusterBoxes.some(box => box.id === 'harris'));
assert(manualGraph.displayEdges.some(edge =>
    [edge.sourceId, edge.targetId].includes('willowbrook')
    && [edge.sourceId, edge.targetId].includes('smith')),
'street-to-building connections should remain visible');
for (const childId of ['smith_bed', 'smith_backyard']) {
    const child = manualLayout.positions.get(childId);
    const cluster = manualLayout.clusterBoxes.find(box => box.id === 'smith');
    assert(child.x > cluster.x && child.x < cluster.x + cluster.width);
    assert(child.y > cluster.y && child.y < cluster.y + cluster.height);
}
const manualRoutes = context.routeEdges(manualGraph, manualLayout);
assert.strictEqual(manualRoutes.length, manualGraph.displayEdges.length,
    'cartographic routing must retain every readable connection');
assert(manualRoutes.every(route => route.d.startsWith('M ') && route.points.length >= 2),
    'every cartographic route must produce a valid SVG path');
assert(manualRoutes.some(route => route.d.includes(' Q ')),
    'multi-turn map paths should use rounded corners');
assert(manualRoutes.every(route =>
    Number.isFinite(route.labelPoint.x) && Number.isFinite(route.labelPoint.y)),
'cartographic path labels must have finite coordinates');
assert(manualRoutes.every(route => route.collisions === 0),
    `manual street paths should route around unrelated places and building footprints: ${
        manualRoutes.filter(route => route.collisions).map(route =>
            `${route.edge.sourceId}>${route.edge.targetId}=${route.collisions} ${JSON.stringify(route.points)}`).join(', ')}`);
manualRoutes.forEach(route => {
    const source = manualLayout.positions.get(route.edge.sourceId);
    const startPoint = route.points[0];
    assert(startPoint.x !== source.x || startPoint.y !== source.y,
        'paths must begin at place boundaries rather than beneath node labels');
});

// Exercise the documented 2,000-location world limit with nested geography.
const largeWorld = { name: 'Limit World', locations: [] };
for (let buildingIndex = 0; buildingIndex < 100; buildingIndex++) {
    const buildingId = `building_${buildingIndex}`;
    largeWorld.locations.push({
        id: buildingId,
        name: `Tower ${buildingIndex}`,
        mapType: 'building',
        region: `District ${Math.floor(buildingIndex / 10)}`,
        exits: []
    });
    for (let roomIndex = 0; roomIndex < 19; roomIndex++) {
        largeWorld.locations.push({
            id: `room_${buildingIndex}_${roomIndex}`,
            name: `Room ${buildingIndex}-${roomIndex}`,
            mapType: 'room',
            parentLocationId: buildingId,
            mapFloor: String(Math.floor(roomIndex / 4) + 1),
            region: `District ${Math.floor(buildingIndex / 10)}`,
            exits: roomIndex
                ? [`to Room ${buildingIndex}-${roomIndex - 1}`]
                : [`to Tower ${buildingIndex}`]
        });
    }
}
assert.strictEqual(largeWorld.locations.length, 2000);
const limitStart = Date.now();
const largeGraph = context.buildGraph(largeWorld);
const largeLayout = context.layoutGraph(largeGraph);
const layoutElapsed = Date.now() - limitStart;
const routeStart = Date.now();
const largeRoutes = context.routeEdges(largeGraph, largeLayout);
const routeElapsed = Date.now() - routeStart;
assert.strictEqual(largeGraph.nodes.length, 2000);
assert.strictEqual(largeLayout.positions.size, 2000);
assert.strictEqual(largeLayout.clusterBoxes.length, 100);
assert.strictEqual(largeRoutes.length, largeGraph.displayEdges.length);
// A wall-clock budget on a shared machine is noisy: routing the 2,000-location
// limit has measured anywhere from 1.7s to 5.7s on the same unchanged code, so
// a 5s budget failed roughly one run in three and taught us to ignore it. The
// budget exists to catch an algorithmic regression — something that turns this
// quadratic — not to police a second either way, so it is set well clear of the
// observed spread.
assert(layoutElapsed < 15000, `2,000-location semantic layout took too long (${layoutElapsed}ms)`);
assert(routeElapsed < 15000, `2,000-location cartographic routing took too long (${routeElapsed}ms)`);

console.log('✓ hierarchy, type inference, edge simplification, and one-way direction');
console.log('✓ nested building layout contains rooms without exact node overlap');
console.log('✓ manual region → street → buildings → rooms hierarchy stays fully visible');
console.log('✓ cartographic paths keep all connections, anchor to place boundaries, and round turns');
console.log(`✓ 2,000-location limit laid out in ${layoutElapsed}ms and routed in ${routeElapsed}ms`);

// Exercise the actual renderer without starting the rest of the application.
function element() {
    return {
        style: {}, dataset: {}, children: [], attributes: {},
        classList: { add() {}, toggle() {}, remove() {} },
        setAttribute(key, value) { this.attributes[key] = value; },
        append(...children) { this.children.push(...children); },
        appendChild(child) { this.children.push(child); },
        replaceChildren() { this.children = []; }
    };
}
context.document = { createElement: element, createElementNS: element };
context.cssUrl = value => value;
context.worldMediaSource = (value, id) => value.mediaAssets?.find(asset => asset.id === id)?.data || '';
const renderStart = app.indexOf('function renderSemanticWorldMap(');
const renderEnd = app.indexOf('\nfunction ', renderStart + 1);
vm.runInNewContext(app.slice(renderStart, renderEnd), context);
const image = 'data:image/png;base64,aGVsbG8=';
const portableWorld = JSON.parse(JSON.stringify({ ...world, media: { mapBackground: image } }));
const host = element();
host.style.backgroundImage = `url('${image}')`;
context.renderSemanticWorldMap(host, portableWorld);
assert.strictEqual(host.style.backgroundImage, '');
assert.strictEqual(host.children[0].style.backgroundImage, '');
const mapScroll = host.children[2];
assert.strictEqual(mapScroll.className, 'semantic-map-scroll mode-map');
assert.strictEqual(mapScroll.style.backgroundImage, `url('${image}')`);
assert.strictEqual(mapScroll.style.backgroundSize, 'contain');
assert.strictEqual(mapScroll.style.backgroundAttachment, 'local');
assert.strictEqual(mapScroll.style.backgroundRepeat, 'no-repeat');
assert.strictEqual(mapScroll.style.backgroundPosition, 'center');
assert.strictEqual(mapScroll.style.backgroundColor, '#0a0a0a');
assert.strictEqual(mapScroll.children[0].attributes.role, 'img');
context.renderSemanticWorldMap(host, portableWorld, { mode: 'graph' });
assert.strictEqual(host.children[2].style.backgroundImage, undefined);
context.renderSemanticWorldMap(host, {
    ...world, presentation: { mapSkinAssetId: 'legacy' },
    mediaAssets: [{ id: 'legacy', data: image }]
}, { mode: 'map' });
assert.strictEqual(host.children[2].style.backgroundImage, `url('${image}')`);
context.renderSemanticWorldMap(host, world, { mode: 'map' });
assert.strictEqual(host.children[2].style.backgroundImage, undefined);
console.log('✓ map background placement, portable data, legacy assets, view switching, and clearing');
