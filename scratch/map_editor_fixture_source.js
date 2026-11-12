const WORLD_MAP_TYPES = new Set(['region', 'transit', 'route', 'building', 'outdoor', 'room', 'area']);

function formatWorldMapType(type) {
    return ({
        region: 'Region / Settlement',
        transit: 'Transit hub',
        route: 'Street / Path',
        building: 'Building',
        outdoor: 'Yard / Outdoor',
        room: 'Room / Interior',
        area: 'Area'
    })[type] || 'Area';
}

function inferWorldMapType(location) {
    if (WORLD_MAP_TYPES.has(location?.mapType)) return location.mapType;
    const text = `${location?.name || ''} ${location?.description || ''}`.toLowerCase();
    if (/\b(street|road|lane|avenue|boulevard|highway|trail|path|passageway|alley|bridge|canal|river|rail|route)\b/.test(text)) return 'route';
    if (/\b(bus stop|train station|railway station|metro station|subway station|airport|airfield|ferry terminal|coach station|transit hub)\b/.test(text)) return 'transit';
    if (/\b(house|home|hall|hotel|inn|tavern|shop|store|market|school|hospital|temple|church|cathedral|tower|castle|palace|manor|fort|station|warehouse|factory|library|museum|theatre|theater|building|cottage|cabin|farmhouse|apartment|citadel)\b/.test(text)) return 'building';
    if (/\b(bedroom|bathroom|kitchen|office|study|nursery|cellar|basement|attic|foyer|lobby|corridor|hallway|closet|pantry|dining room|living room|guest room|chamber|suite|workshop|laboratory|lab|room)\b/.test(text)) return 'room';
    if (/\b(backyard|front yard|yard|garden|courtyard|patio|porch|terrace|grounds|balcony|rooftop|park|field|plaza|square|beach|dock|harbor|forest|woods|clearing)\b/.test(text)) return 'outdoor';
    if (/\b(city|town|village|district|quarter|neighborhood|neighbourhood|kingdom|province|county|region|realm|island|continent)\b/.test(text)) return 'region';
    return 'area';
}

function inferWorldMapFloor(location) {
    if (location?.mapFloor) return String(location.mapFloor).trim();
    const text = `${location?.name || ''} ${location?.description || ''}`.toLowerCase();
    const match = text.match(/\b(basement|cellar|ground(?: floor)?|first floor|second floor|third floor|upper floor|lower floor|attic|rooftop|level\s*-?\d+|\d+(?:st|nd|rd|th) floor)\b/);
    return match ? match[1] : '';
}

function worldMapNameTokens(name) {
    const generic = new Set([
        'the', 'a', 'an', 'of', 'at', 'in', 'on', 'and', 's',
        'house', 'home', 'building', 'room', 'bedroom', 'bathroom', 'kitchen',
        'yard', 'backyard', 'garden', 'garage', 'hall', 'floor', 'level'
    ]);
    return String(name || '').toLowerCase()
        .replace(/['’]s\b/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/)
        .filter(token => token && !generic.has(token));
}

function getWorldMapContainerId(node, nodeById) {
    if (!node || ['region', 'route', 'building', 'area'].includes(node.type)) return '';
    const visited = new Set([node.id]);
    let parent = nodeById.get(node.parentId);
    while (parent && !visited.has(parent.id)) {
        if (parent.type === 'building' || parent.type === 'area') return parent.id;
        visited.add(parent.id);
        parent = nodeById.get(parent.parentId);
    }
    return '';
}

function buildSemanticWorldGraph(world) {
    const locations = Array.isArray(world?.locations) ? world.locations : [];
    locations.forEach((location, index) => {
        if (!location.id) location.id = `loc_${String(location.name || index).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
    });
    const nodes = locations.map(location => ({
        id: location.id,
        location,
        type: inferWorldMapType(location),
        floor: inferWorldMapFloor(location),
        parentId: '',
        regionKey: '',
        explicitType: WORLD_MAP_TYPES.has(location.mapType)
    }));
    const nodeById = new Map(nodes.map(node => [node.id, node]));
    const byIdKey = new Map(nodes.map(node => [String(node.id || '').trim().toLowerCase(), node]));
    const nameGroups = new Map();
    nodes.forEach(node => {
        const key = String(node.location.name || '').trim().toLowerCase();
        if (!key) return;
        if (!nameGroups.has(key)) nameGroups.set(key, []);
        nameGroups.get(key).push(node);
    });
    const byName = new Map([...nameGroups.entries()]
        .filter(([, matches]) => matches.length === 1)
        .map(([key, matches]) => [key, matches[0]]));
    const resolveTarget = ref => {
        const query = String(ref || '').trim().toLowerCase();
        return nodeById.get(ref) || byIdKey.get(query) || byName.get(query) || null;
    };
    const unresolved = [];
    const exitEntries = [];
    nodes.forEach(node => {
        (node.location.exits || []).forEach(exit => {
            const targetRef = getExitTargetName(exit);
            const target = resolveTarget(targetRef);
            if (!target || target.id === node.id) {
                if (targetRef) unresolved.push({ sourceId: node.id, target: targetRef });
                return;
            }
            const text = typeof exit === 'string' ? exit : (exit.text || '');
            const direction = String(text).split(/\s+to\s+/i)[0].trim();
            exitEntries.push({
                sourceId: node.id,
                targetId: target.id,
                isOneWay: !!(exit && typeof exit === 'object' && exit.isOneWay),
                travelTime: Math.max(0, parseInt(typeof exit === 'object' ? exit.travelTime : 0) || 0),
                direction: /^to$/i.test(direction) ? '' : direction
            });
        });
    });

    const pairMap = new Map();
    exitEntries.forEach(entry => {
        const ordered = [entry.sourceId, entry.targetId].sort();
        const key = ordered.join('|');
        if (!pairMap.has(key)) pairMap.set(key, { a: ordered[0], b: ordered[1], entries: [] });
        pairMap.get(key).entries.push(entry);
    });
    const edges = [...pairMap.values()].map(pair => {
        const directions = new Set(pair.entries.map(entry => `${entry.sourceId}>${entry.targetId}`));
        const explicit = pair.entries.find(entry => entry.isOneWay);
        const hasReverse = directions.has(`${pair.a}>${pair.b}`) && directions.has(`${pair.b}>${pair.a}`);
        const isOneWay = !hasReverse;
        const directed = explicit || pair.entries[0];
        const times = pair.entries.map(entry => entry.travelTime).filter(Boolean);
        return {
            sourceId: isOneWay ? directed.sourceId : pair.a,
            targetId: isOneWay ? directed.targetId : pair.b,
            isOneWay,
            travelTime: times.length ? Math.min(...times) : 0,
            directions: [...new Set(pair.entries.map(entry => entry.direction).filter(Boolean))],
            originalCount: pair.entries.length
        };
    });

    const adjacency = new Map(nodes.map(node => [node.id, new Set()]));
    edges.forEach(edge => {
        adjacency.get(edge.sourceId)?.add(edge.targetId);
        adjacency.get(edge.targetId)?.add(edge.sourceId);
    });

    // Explicit hierarchy wins. A region field that names a building is also a
    // strong containment signal (common in imported worlds).
    nodes.forEach(node => {
        const explicitParent = nodeById.get(node.location.parentLocationId)
            || byName.get(String(node.location.parentLocationId || '').toLowerCase());
        if (explicitParent && explicitParent.id !== node.id) {
            node.parentId = explicitParent.id;
            return;
        }
        const regionMatch = nodeById.get(node.location.region)
            || byName.get(String(node.location.region || '').trim().toLowerCase());
        if (regionMatch && regionMatch.id !== node.id && regionMatch.type === 'building'
            && ['room', 'outdoor', 'area'].includes(node.type)) {
            node.parentId = regionMatch.id;
        }
    });

    const buildings = nodes.filter(node => node.type === 'building').sort((a, b) =>
        String(a.location.name).localeCompare(String(b.location.name)));
    const buildingsByToken = new Map();
    buildings.forEach(building => {
        worldMapNameTokens(building.location.name).forEach(token => {
            if (!buildingsByToken.has(token)) buildingsByToken.set(token, []);
            buildingsByToken.get(token).push(building);
        });
    });
    const attachedOutdoor = node => /\b(yard|backyard|garden|courtyard|patio|porch|terrace|grounds|balcony|rooftop|garage)\b/i.test(node.location.name || '');
    const autoParentScores = new Map();

    nodes.forEach(node => {
        if (node.parentId || !['room', 'outdoor'].includes(node.type)) return;
        if (node.type === 'outdoor' && !attachedOutdoor(node)) return;
        const directBuildings = [...(adjacency.get(node.id) || [])].map(id => nodeById.get(id)).filter(candidate => candidate?.type === 'building');
        const nodeTokens = worldMapNameTokens(node.location.name);
        const tokenBuildings = [...new Set(nodeTokens.flatMap(token => buildingsByToken.get(token) || []))];
        const scores = new Map();
        directBuildings.forEach(building => scores.set(building.id, (scores.get(building.id) || 0) + 12));
        tokenBuildings.forEach(building => {
            const sharedTokens = worldMapNameTokens(building.location.name).filter(token => nodeTokens.includes(token)).length;
            scores.set(building.id, (scores.get(building.id) || 0) + sharedTokens * 40);
        });
        autoParentScores.set(node.id, scores);
        const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        if (ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1])) {
            node.parentId = ranked[0][0];
        }
    });

    // Resolve ambiguous rooms using already-classified neighboring rooms. This
    // prevents a heavily interconnected location from falling into whichever
    // building happened to sort first.
    for (let pass = 0; pass < nodes.length; pass++) {
        let changed = false;
        nodes.forEach(node => {
            if (node.parentId || !['room', 'outdoor'].includes(node.type)) return;
            if (node.type === 'outdoor' && !attachedOutdoor(node)) return;
            const scores = new Map(autoParentScores.get(node.id) || []);
            for (const neighborId of adjacency.get(node.id) || []) {
                const neighborParent = nodeById.get(neighborId)?.parentId;
                if (neighborParent && nodeById.get(neighborParent)?.type === 'building') {
                    scores.set(neighborParent, (scores.get(neighborParent) || 0) + 24);
                }
            }
            const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
            if (ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1])) {
                node.parentId = ranked[0][0];
                changed = true;
            }
        });
        if (!changed) break;
    }

    // Multi-source graph walk attaches interior rooms that connect through
    // other rooms rather than directly to the building node.
    const owner = new Map();
    const queue = [];
    buildings.forEach(building => {
        owner.set(building.id, building.id);
        queue.push(building.id);
    });
    nodes.forEach(node => {
        if (!node.parentId || nodeById.get(node.parentId)?.type !== 'building') return;
        owner.set(node.id, node.parentId);
        queue.push(node.id);
    });
    for (let cursor = 0; cursor < queue.length; cursor++) {
        const currentId = queue[cursor];
        const buildingId = owner.get(currentId);
        const building = nodeById.get(buildingId);
        for (const nextId of adjacency.get(currentId) || []) {
            const next = nodeById.get(nextId);
            if (!next || owner.has(nextId) || (next.type === 'building' && next.id !== buildingId)) continue;
            if (next.type !== 'room' && !(next.type === 'outdoor' && attachedOutdoor(next))) continue;
            if (next.parentId && next.parentId !== buildingId) continue;
            const directBuildings = [...(adjacency.get(nextId) || [])]
                .map(id => nodeById.get(id))
                .filter(candidate => candidate?.type === 'building');
            if (!next.parentId && directBuildings.length > 1) continue;
            const buildingRegion = String(building.location.region || '').trim().toLowerCase();
            const nextRegion = String(next.location.region || '').trim().toLowerCase();
            if (buildingRegion && nextRegion && buildingRegion !== nextRegion) continue;
            owner.set(nextId, buildingId);
            queue.push(nextId);
        }
    }
    nodes.forEach(node => {
        if (!node.parentId && node.type === 'room' && owner.has(node.id)) node.parentId = owner.get(node.id);
    });

    nodes.forEach(node => {
        const visited = new Set();
        let cursor = node;
        let regionName = '';
        while (cursor && !visited.has(cursor.id)) {
            visited.add(cursor.id);
            if (cursor.type === 'region') {
                regionName = String(cursor.location.name || cursor.location.region || 'World').trim();
                break;
            }
            const declaredRegion = String(cursor.location.region || '').trim();
            if (declaredRegion) {
                const regionMatch = byName.get(declaredRegion.toLowerCase());
                regionName = regionMatch?.type === 'region'
                    ? String(regionMatch.location.name || declaredRegion)
                    : declaredRegion;
            }
            cursor = nodeById.get(cursor.parentId);
        }
        node.regionKey = regionName || 'World';
    });

    const collapsed = new Map();
    edges.forEach(edge => {
        const source = nodeById.get(edge.sourceId);
        const target = nodeById.get(edge.targetId);
        if (!source || !target) return;
        const sourceContainerId = getWorldMapContainerId(source, nodeById);
        const targetContainerId = getWorldMapContainerId(target, nodeById);
        if (sourceContainerId === target.id || targetContainerId === source.id) return; // visible containment already communicates this
        let sourceId = source.id;
        let targetId = target.id;
        if (sourceContainerId && sourceContainerId !== targetContainerId) sourceId = sourceContainerId;
        if (targetContainerId && targetContainerId !== sourceContainerId) targetId = targetContainerId;
        if (sourceId === targetId) return;
        const ordered = [sourceId, targetId].sort();
        const key = ordered.join('|');
        let aggregate = collapsed.get(key);
        if (!aggregate) {
            aggregate = {
                sourceId: edge.isOneWay ? sourceId : ordered[0],
                targetId: edge.isOneWay ? targetId : ordered[1],
                isOneWay: edge.isOneWay,
                hasTwoWaySource: !edge.isOneWay,
                oneWayDirections: new Set(edge.isOneWay ? [`${sourceId}>${targetId}`] : []),
                travelTime: edge.travelTime,
                count: 0,
                internalParentId: sourceContainerId && sourceContainerId === targetContainerId
                    ? sourceContainerId : ''
            };
            collapsed.set(key, aggregate);
        }
        aggregate.count += edge.originalCount || 1;
        aggregate.hasTwoWaySource = aggregate.hasTwoWaySource || !edge.isOneWay;
        if (edge.isOneWay) aggregate.oneWayDirections.add(`${sourceId}>${targetId}`);
        aggregate.isOneWay = !aggregate.hasTwoWaySource && aggregate.oneWayDirections.size === 1;
        if (aggregate.isOneWay) {
            [aggregate.sourceId, aggregate.targetId] = [...aggregate.oneWayDirections][0].split('>');
        } else {
            [aggregate.sourceId, aggregate.targetId] = ordered;
        }
        if (!aggregate.travelTime || (edge.travelTime && edge.travelTime < aggregate.travelTime)) aggregate.travelTime = edge.travelTime;
    });

    // Dense room meshes are reduced to a spanning network; one-way and timed
    // links remain even when redundant because they carry gameplay meaning.
    const externalEdges = [];
    const internalGroups = new Map();
    [...collapsed.values()].forEach(edge => {
        if (!edge.internalParentId) externalEdges.push(edge);
        else {
            if (!internalGroups.has(edge.internalParentId)) internalGroups.set(edge.internalParentId, []);
            internalGroups.get(edge.internalParentId).push(edge);
        }
    });
    const displayEdges = [...externalEdges];
    internalGroups.forEach(group => {
        const parent = new Map();
        const root = id => {
            if (!parent.has(id)) parent.set(id, id);
            let value = id;
            while (parent.get(value) !== value) value = parent.get(value);
            return value;
        };
        const union = (a, b) => {
            const ra = root(a), rb = root(b);
            if (ra !== rb) parent.set(ra, rb);
        };
        group.sort((a, b) => Number(b.isOneWay || !!b.travelTime) - Number(a.isOneWay || !!a.travelTime));
        group.forEach(edge => {
            const special = edge.isOneWay || edge.travelTime;
            if (special || root(edge.sourceId) !== root(edge.targetId)) {
                displayEdges.push(edge);
                union(edge.sourceId, edge.targetId);
            }
        });
    });

    return {
        nodes,
        nodeById,
        edges,
        displayEdges,
        unresolved,
        originalExitCount: exitEntries.length,
        collapsedConnectionCount: collapsed.size
    };
}

function layoutSemanticWorldGraph(graph, currentLocationId = '') {
    const positions = new Map();
    const regionBoxes = [];
    const clusterBoxes = [];
    const childrenByParent = new Map();
    graph.nodes.forEach(node => {
        const containerId = getWorldMapContainerId(node, graph.nodeById);
        if (!containerId) return;
        if (!childrenByParent.has(containerId)) childrenByParent.set(containerId, []);
        childrenByParent.get(containerId).push(node);
    });
    const regions = new Map();
    graph.nodes.forEach(node => {
        if (!regions.has(node.regionKey)) regions.set(node.regionKey, []);
        regions.get(node.regionKey).push(node);
    });
    const currentRegion = graph.nodeById.get(currentLocationId)?.regionKey;
    const orderedRegions = [...regions.entries()].sort((a, b) => {
        if (a[0] === currentRegion) return -1;
        if (b[0] === currentRegion) return 1;
        return a[0].localeCompare(b[0]);
    });

    let regionY = 24;
    let overallWidth = 820;
    orderedRegions.forEach(([regionName, regionNodes]) => {
        const contentWidth = Math.max(760, Math.min(1500, Math.ceil(Math.sqrt(regionNodes.length || 1)) * 250));
        const regionTop = regionY;
        // A route or region may be a semantic parent, but it is not a visual
        // container. Its buildings remain full map units; only rooms/yards
        // collapse into the nearest building/area cluster.
        const topNodes = regionNodes.filter(node => !getWorldMapContainerId(node, graph.nodeById));
        const routes = topNodes.filter(node => node.type === 'route');
        const units = topNodes.filter(node => node.type !== 'route');
        let cursorY = regionTop + 60;

        if (routes.length) {
            const columns = Math.max(1, Math.floor((contentWidth - 40) / 210));
            routes.forEach((node, index) => {
                const col = index % columns;
                const row = Math.floor(index / columns);
                positions.set(node.id, {
                    x: 70 + col * 210 + 90,
                    y: cursorY + row * 70 + 26,
                    width: 180,
                    height: 46
                });
            });
            cursorY += Math.ceil(routes.length / columns) * 70 + 18;
        }

        let cursorX = 60;
        let rowHeight = 0;
        units.forEach(unit => {
            const children = (childrenByParent.get(unit.id) || []).sort((a, b) =>
                String(a.floor).localeCompare(String(b.floor)) || String(a.location.name).localeCompare(String(b.location.name)));
            const childColumns = children.length ? Math.min(6, Math.max(1, Math.ceil(Math.sqrt(children.length)))) : 0;
            const unitWidth = children.length ? Math.max(240, childColumns * 170 + 34) : 210;
            const childRows = childColumns ? Math.ceil(children.length / childColumns) : 0;
            const unitHeight = children.length ? 104 + childRows * 68 + 24 : 92;
            if (cursorX > 60 && cursorX + unitWidth > contentWidth) {
                cursorX = 60;
                cursorY += rowHeight + 24;
                rowHeight = 0;
            }
            if (children.length) {
                clusterBoxes.push({
                    id: unit.id,
                    label: unit.location.name || 'Unnamed building',
                    x: cursorX,
                    y: cursorY,
                    width: unitWidth,
                    height: unitHeight,
                    type: unit.type
                });
                positions.set(unit.id, {
                    x: cursorX + unitWidth / 2,
                    y: cursorY + 42,
                    width: Math.min(210, unitWidth - 30),
                    height: 56
                });
                children.forEach((child, index) => {
                    const col = index % childColumns;
                    const row = Math.floor(index / childColumns);
                    positions.set(child.id, {
                        x: cursorX + 17 + col * 170 + 75,
                        y: cursorY + 104 + row * 68 + 23,
                        width: 150,
                        height: 46
                    });
                });
            } else {
                positions.set(unit.id, {
                    x: cursorX + unitWidth / 2,
                    y: cursorY + unitHeight / 2,
                    width: unit.type === 'region' ? 190 : 180,
                    height: unit.type === 'outdoor' ? 48 : 54
                });
            }
            cursorX += unitWidth + 24;
            rowHeight = Math.max(rowHeight, unitHeight);
        });
        const regionHeight = Math.max(150, cursorY + rowHeight + 34 - regionTop);
        regionBoxes.push({ label: regionName, x: 24, y: regionTop, width: contentWidth + 56, height: regionHeight });
        regionY = regionTop + regionHeight + 26;
        overallWidth = Math.max(overallWidth, contentWidth + 104);
    });

    return {
        positions,
        regionBoxes,
        clusterBoxes,
        width: overallWidth,
        height: Math.max(260, regionY)
    };
}

function simplifySemanticMapPolyline(points) {
    const clean = [];
    points.forEach(point => {
        const normalized = { x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 };
        const previous = clean[clean.length - 1];
        if (!previous || previous.x !== normalized.x || previous.y !== normalized.y) clean.push(normalized);
    });
    for (let index = clean.length - 2; index > 0; index--) {
        const before = clean[index - 1];
        const current = clean[index];
        const after = clean[index + 1];
        if ((before.x === current.x && current.x === after.x)
            || (before.y === current.y && current.y === after.y)) {
            clean.splice(index, 1);
        }
    }
    return clean;
}

function semanticMapBoundaryPoint(position, toward) {
    const dx = toward.x - position.x;
    const dy = toward.y - position.y;
    const halfWidth = Math.max(1, position.width / 2);
    const halfHeight = Math.max(1, position.height / 2);
    if (Math.abs(dx) / halfWidth >= Math.abs(dy) / halfHeight) {
        return { x: position.x + Math.sign(dx || 1) * halfWidth, y: position.y };
    }
    return { x: position.x, y: position.y + Math.sign(dy || 1) * halfHeight };
}

function semanticMapRoundedPath(points, radius = 13) {
    const clean = simplifySemanticMapPolyline(points);
    if (clean.length < 2) return '';
    let path = `M ${clean[0].x} ${clean[0].y}`;
    for (let index = 1; index < clean.length - 1; index++) {
        const previous = clean[index - 1];
        const corner = clean[index];
        const next = clean[index + 1];
        const incoming = Math.hypot(corner.x - previous.x, corner.y - previous.y);
        const outgoing = Math.hypot(next.x - corner.x, next.y - corner.y);
        const bend = Math.min(radius, incoming / 2, outgoing / 2);
        const before = {
            x: corner.x - Math.sign(corner.x - previous.x) * bend,
            y: corner.y - Math.sign(corner.y - previous.y) * bend
        };
        const after = {
            x: corner.x + Math.sign(next.x - corner.x) * bend,
            y: corner.y + Math.sign(next.y - corner.y) * bend
        };
        path += ` L ${before.x} ${before.y} Q ${corner.x} ${corner.y} ${after.x} ${after.y}`;
    }
    const end = clean[clean.length - 1];
    return `${path} L ${end.x} ${end.y}`;
}

function semanticMapSegmentIntersection(a, b, rect) {
    const epsilon = 0.5;
    if (Math.abs(a.y - b.y) < epsilon) {
        const left = Math.min(a.x, b.x);
        const right = Math.max(a.x, b.x);
        return a.y >= rect.top && a.y <= rect.bottom && right >= rect.left && left <= rect.right;
    }
    if (Math.abs(a.x - b.x) < epsilon) {
        const top = Math.min(a.y, b.y);
        const bottom = Math.max(a.y, b.y);
        return a.x >= rect.left && a.x <= rect.right && bottom >= rect.top && top <= rect.bottom;
    }
    return false;
}

function routeSemanticMapEdges(graph, layout) {
    const cellSize = 180;
    const obstacles = [];
    graph.nodes.forEach(node => {
        const position = layout.positions.get(node.id);
        if (!position) return;
        const padding = node.type === 'room' ? 7 : 11;
        obstacles.push({
            id: node.id,
            kind: 'node',
            left: position.x - position.width / 2 - padding,
            right: position.x + position.width / 2 + padding,
            top: position.y - position.height / 2 - padding,
            bottom: position.y + position.height / 2 + padding
        });
    });
    layout.clusterBoxes.forEach(box => {
        obstacles.push({
            id: box.id,
            kind: 'cluster',
            left: box.x - 9,
            right: box.x + box.width + 9,
            top: box.y - 9,
            bottom: box.y + box.height + 9
        });
    });

    const obstacleGrid = new Map();
    obstacles.forEach((obstacle, obstacleIndex) => {
        const minX = Math.floor(obstacle.left / cellSize);
        const maxX = Math.floor(obstacle.right / cellSize);
        const minY = Math.floor(obstacle.top / cellSize);
        const maxY = Math.floor(obstacle.bottom / cellSize);
        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                const key = `${x}:${y}`;
                if (!obstacleGrid.has(key)) obstacleGrid.set(key, []);
                obstacleGrid.get(key).push(obstacleIndex);
            }
        }
    });
    const obstaclesForSegment = (a, b) => {
        const minX = Math.floor((Math.min(a.x, b.x) - 2) / cellSize);
        const maxX = Math.floor((Math.max(a.x, b.x) + 2) / cellSize);
        const minY = Math.floor((Math.min(a.y, b.y) - 2) / cellSize);
        const maxY = Math.floor((Math.max(a.y, b.y) + 2) / cellSize);
        const indexes = new Set();
        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                (obstacleGrid.get(`${x}:${y}`) || []).forEach(index => indexes.add(index));
            }
        }
        return [...indexes].map(index => obstacles[index]);
    };
    const hashEdge = edge => {
        const text = `${edge.sourceId}>${edge.targetId}`;
        let hash = 0;
        for (let index = 0; index < text.length; index++) hash = (Math.imul(hash, 31) + text.charCodeAt(index)) | 0;
        return Math.abs(hash);
    };
    const detailedOverlapRouting = graph.displayEdges.length <= 1200;
    const usedSegments = [];
    const orderedEdges = [...graph.displayEdges].sort((a, b) =>
        Number(!!a.internalParentId) - Number(!!b.internalParentId)
        || `${a.sourceId}|${a.targetId}`.localeCompare(`${b.sourceId}|${b.targetId}`));
    const routes = [];

    orderedEdges.forEach(edge => {
        const from = layout.positions.get(edge.sourceId);
        const to = layout.positions.get(edge.targetId);
        if (!from || !to) return;
        const lane = ((hashEdge(edge) % 9) - 4) * 10;
        const midX = Math.max(16, Math.min(layout.width - 16, (from.x + to.x) / 2 + lane));
        const midY = Math.max(16, Math.min(layout.height - 16, (from.y + to.y) / 2 + lane));
        const top = Math.max(16, Math.min(from.y, to.y) - 34 - Math.abs(lane));
        const bottom = Math.min(layout.height - 16, Math.max(from.y, to.y) + 34 + Math.abs(lane));
        const left = Math.max(16, Math.min(from.x, to.x) - 34 - Math.abs(lane));
        const right = Math.min(layout.width - 16, Math.max(from.x, to.x) + 34 + Math.abs(lane));
        const candidates = [
            [{ x: from.x, y: from.y }, { x: to.x, y: from.y }, { x: to.x, y: to.y }],
            [{ x: from.x, y: from.y }, { x: from.x, y: to.y }, { x: to.x, y: to.y }],
            [{ x: from.x, y: from.y }, { x: midX, y: from.y }, { x: midX, y: to.y }, { x: to.x, y: to.y }],
            [{ x: from.x, y: from.y }, { x: from.x, y: midY }, { x: to.x, y: midY }, { x: to.x, y: to.y }],
            [{ x: from.x, y: from.y }, { x: from.x, y: top }, { x: to.x, y: top }, { x: to.x, y: to.y }],
            [{ x: from.x, y: from.y }, { x: from.x, y: bottom }, { x: to.x, y: bottom }, { x: to.x, y: to.y }],
            [{ x: from.x, y: from.y }, { x: left, y: from.y }, { x: left, y: to.y }, { x: to.x, y: to.y }],
            [{ x: from.x, y: from.y }, { x: right, y: from.y }, { x: right, y: to.y }, { x: to.x, y: to.y }],
            [{ x: from.x, y: from.y }, { x: from.x, y: 16 }, { x: to.x, y: 16 }, { x: to.x, y: to.y }],
            [{ x: from.x, y: from.y }, { x: from.x, y: layout.height - 16 }, { x: to.x, y: layout.height - 16 }, { x: to.x, y: to.y }],
            [{ x: from.x, y: from.y }, { x: 16, y: from.y }, { x: 16, y: to.y }, { x: to.x, y: to.y }],
            [{ x: from.x, y: from.y }, { x: layout.width - 16, y: from.y }, { x: layout.width - 16, y: to.y }, { x: to.x, y: to.y }]
        ];
        if (Math.abs(from.y - to.y) < 1 || Math.abs(from.x - to.x) < 1) {
            candidates.unshift([{ x: from.x, y: from.y }, { x: to.x, y: to.y }]);
        }
        const sourceContainer = getWorldMapContainerId(graph.nodeById.get(edge.sourceId), graph.nodeById);
        const targetContainer = getWorldMapContainerId(graph.nodeById.get(edge.targetId), graph.nodeById);
        const ignoredObstacles = new Set([edge.sourceId, edge.targetId, sourceContainer, targetContainer].filter(Boolean));
        let best = null;
        candidates.forEach((candidate, candidateIndex) => {
            let points = simplifySemanticMapPolyline(candidate);
            if (points.length < 2) return;
            points[0] = semanticMapBoundaryPoint(from, points[1]);
            points[points.length - 1] = semanticMapBoundaryPoint(to, points[points.length - 2]);
            points = simplifySemanticMapPolyline(points);
            let score = (points.length - 2) * 7 + candidateIndex * 0.01;
            let collisions = 0;
            const segments = [];
            for (let index = 1; index < points.length; index++) {
                const a = points[index - 1];
                const b = points[index];
                const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
                score += length * 0.002;
                obstaclesForSegment(a, b).forEach(obstacle => {
                    if (ignoredObstacles.has(obstacle.id)) return;
                    if (semanticMapSegmentIntersection(a, b, obstacle)) {
                        collisions++;
                        score += obstacle.kind === 'cluster' ? 16000 : 9000;
                    }
                });
                if (detailedOverlapRouting) {
                    usedSegments.forEach(existing => {
                        const currentHorizontal = a.y === b.y;
                        const existingHorizontal = existing.a.y === existing.b.y;
                        if (currentHorizontal && existingHorizontal && a.y === existing.a.y) {
                            const overlap = Math.min(Math.max(a.x, b.x), Math.max(existing.a.x, existing.b.x))
                                - Math.max(Math.min(a.x, b.x), Math.min(existing.a.x, existing.b.x));
                            if (overlap > 0) score += 500 + overlap;
                        } else if (!currentHorizontal && !existingHorizontal && a.x === existing.a.x) {
                            const overlap = Math.min(Math.max(a.y, b.y), Math.max(existing.a.y, existing.b.y))
                                - Math.max(Math.min(a.y, b.y), Math.min(existing.a.y, existing.b.y));
                            if (overlap > 0) score += 500 + overlap;
                        } else if (currentHorizontal !== existingHorizontal) {
                            const horizontalSegment = currentHorizontal ? { a, b } : existing;
                            const verticalSegment = currentHorizontal ? existing : { a, b };
                            const crosses = verticalSegment.a.x > Math.min(horizontalSegment.a.x, horizontalSegment.b.x)
                                && verticalSegment.a.x < Math.max(horizontalSegment.a.x, horizontalSegment.b.x)
                                && horizontalSegment.a.y > Math.min(verticalSegment.a.y, verticalSegment.b.y)
                                && horizontalSegment.a.y < Math.max(verticalSegment.a.y, verticalSegment.b.y);
                            if (crosses) score += 45;
                        }
                    });
                }
                segments.push({ a, b });
            }
            if (!best || score < best.score) best = { points, segments, score, collisions };
        });
        if (!best) return;
        usedSegments.push(...best.segments);
        const middleIndex = Math.floor((best.points.length - 1) / 2);
        const labelStart = best.points[middleIndex];
        const labelEnd = best.points[Math.min(best.points.length - 1, middleIndex + 1)];
        routes.push({
            edge,
            points: best.points,
            d: semanticMapRoundedPath(best.points),
            collisions: best.collisions,
            labelPoint: {
                x: (labelStart.x + labelEnd.x) / 2,
                y: (labelStart.y + labelEnd.y) / 2
            }
        });
    });
    return routes;
}

function wrapWorldMapLabel(label, max = 20) {
    const words = String(label || 'Unnamed').split(/\s+/);
    if (String(label || '').length <= max) return [String(label || 'Unnamed')];
    const lines = ['', ''];
    words.forEach(word => {
        const index = (!lines[0] || `${lines[0]} ${word}`.length <= max) ? 0 : 1;
        lines[index] = `${lines[index]} ${word}`.trim();
    });
    if (lines[1].length > max + 6) lines[1] = `${lines[1].slice(0, max + 3).trim()}…`;
    return lines.filter(Boolean);
}


function getExitTargetName(exit) {
    let text = "";
    if (typeof exit === 'string') {
        text = exit;
    } else if (exit && typeof exit === 'object') {
        if (exit.targetLocationId) return String(exit.targetLocationId).trim();
        text = typeof exit.text === 'string' ? exit.text : (exit.text !== undefined && exit.text !== null ? String(exit.text) : "");
    }
    const cleanStr = text.trim();
    if (cleanStr.toLowerCase().startsWith('to ')) {
        return cleanStr.substring(3).trim();
    } else if (cleanStr.toLowerCase().includes(' to ')) {
        const parts = cleanStr.split(/\s+[tT][oO]\s+/);
        if (parts.length > 1) {
            // Only the first "to" separates direction from destination.
            // Names such as "The Road to Ruin" and "Gate to Hell" must remain
            // intact or movement, validation, and map links resolve differently.
            return parts.slice(1).join(' to ').trim();
        }
    }
    return cleanStr;
}
function createWorldLocationRecord(world, regionId = '', parentLocationId = '', mapType = '') {
    const region = (world?.regions || []).find(item => item.id === regionId);
    const loc = {
        id: `loc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: '',
        regionId: region?.id || '',
        region: region?.name || '',
        mapType,
        parentLocationId,
        mapFloor: '',
        description: '',
        hiddenDescription: '',
        exits: [],
        secrets: []
    };
    return loc;
}
function ensureWorldDoorIds(world, sess = null) {
    const locations = Array.isArray(world?.locations) ? world.locations : [];
    const byId = new Map();
    const byName = new Map();
    locations.forEach(location => {
        const id = String(location.id || '').trim().toLowerCase();
        if (id) byId.set(id, byId.has(id) ? null : location);
        const name = String(location.name || '').trim().toLowerCase();
        if (name) byName.set(name, byName.has(name) ? null : location);
    });
    const edges = new Map();
    const targetOf = exit => {
        const ref = String(getExitTargetName(exit) || '').trim().toLowerCase();
        return byId.has(ref) ? byId.get(ref) : byName.get(ref) || null;
    };
    locations.forEach(from => (from.exits || []).forEach((entry, index) => {
        const to = targetOf(entry);
        if (!to || to.id === from.id) return;
        const exit = typeof entry === 'string' ? (from.exits[index] = { text: entry }) : entry;
        if (!exit || typeof exit !== 'object') return;
        const key = `${from.id}\u0000${to.id}`;
        if (!edges.has(key)) edges.set(key, []);
        edges.get(key).push({ from, to, exit, index });
    }));
    const handled = new Set();
    for (const group of edges.values()) for (const edge of group) {
        if (handled.has(edge.exit)) continue;
        const reverse = edges.get(`${edge.to.id}\u0000${edge.from.id}`) || [];
        // Directional travel metadata does not make two reciprocal records
        // separate physical locks. Only an absent or ambiguous reverse edge
        // prevents pairing; route permissions remain checked independently.
        const paired = group.length === 1 && reverse.length === 1 ? reverse[0] : null;
        const sortedIds = [edge.from.id, edge.to.id].sort();
        const baseId = `door:${sortedIds.map(encodeURIComponent).join('::')}`;
        const previousIds = [edge.exit.doorId, paired?.exit.doorId]
            .map(value => String(value || '').trim()).filter(Boolean);
        const id = previousIds[0]
            || (paired ? baseId : `${baseId}:${encodeURIComponent(edge.from.id)}:${edge.index}`);
        edge.exit.doorId = id;
        handled.add(edge.exit);
        if (paired) {
            paired.exit.doorId = id;
            handled.add(paired.exit);
            const key = String(edge.exit.requiredItem || paired.exit.requiredItem || '').trim();
            if (key) {
                if (!String(edge.exit.requiredItem || '').trim()) edge.exit.requiredItem = key;
                if (!String(paired.exit.requiredItem || '').trim()) paired.exit.requiredItem = key;
            }
            if (edge.exit.lockState === 'locked' || paired.exit.lockState === 'locked') {
                edge.exit.lockState = 'locked';
                paired.exit.lockState = 'locked';
            }
            if (edge.exit.allowCheckUnlock === true && paired.exit.allowCheckUnlock == null) paired.exit.allowCheckUnlock = true;
            if (paired.exit.allowCheckUnlock === true && edge.exit.allowCheckUnlock == null) edge.exit.allowCheckUnlock = true;
        }
        if (sess && isPlainObject(sess.unlockedExits)) {
            const legacy = [
                worldExitUnlockKey(edge.from.id, edge.to.id),
                worldExitUnlockKey(edge.from.id, edge.exit.targetLocationId || getExitTargetName(edge.exit)),
                ...(paired ? [
                    worldExitUnlockKey(edge.to.id, edge.from.id),
                    worldExitUnlockKey(edge.to.id, paired.exit.targetLocationId || getExitTargetName(paired.exit))
                ] : [])
            ].filter(Boolean);
            const oldKeys = [...new Set([...legacy, ...previousIds])].filter(key => key !== id);
            if (oldKeys.some(key => sess.unlockedExits[key] === true)) sess.unlockedExits[id] = true;
            oldKeys.forEach(key => { delete sess.unlockedExits[key]; });
        }
    }
}
function normalizeWorldTravelMode(value, fallback = 'walk') {
    const mode = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    return mode || fallback;
}
function upsertWorldTravelConnection(world, origin, target, details = {}) {
    if (!world || !origin || !target || origin.id === target.id) return;
    const mode = normalizeWorldTravelMode(details.mode);
    const travelTime = Math.max(0, Math.min(100000, Number(details.travelTime) || 0));
    const makeExit = (from, to) => ({
        targetLocationId: to.id,
        text: `to ${to.name || to.id}`,
        direction: '', mode, travelTime,
        routeName: String(details.routeName || '').slice(0, 160),
        cost: String(details.cost || '').slice(0, 120),
        ...(details.requiredItem !== undefined
            ? { requiredItem: String(details.requiredItem || '').trim().slice(0, 160) } : {}),
        ...(details.allowCheckUnlock !== undefined
            ? { allowCheckUnlock: details.allowCheckUnlock === true } : {}),
        isOneWay: details.isOneWay === true
    });
    const existing = (origin.exits || []).find(exit => getLocationRef(world, exit?.targetLocationId || getExitTargetName(exit))?.id === target.id);
    if (existing && typeof existing === 'object') Object.assign(existing, makeExit(origin, target));
    else (origin.exits ||= []).push(makeExit(origin, target));
    if (!details.isOneWay) {
        const reverse = (target.exits || []).find(exit => getLocationRef(world, exit?.targetLocationId || getExitTargetName(exit))?.id === origin.id);
        if (reverse && typeof reverse === 'object') Object.assign(reverse, makeExit(target, origin), { isOneWay: false });
        else (target.exits ||= []).push({ ...makeExit(target, origin), isOneWay: false });
    }
    ensureWorldDoorIds(world);
}
function renderSemanticWorldMap(container, world, options = {}) {
    if (!container || !world) return null;
    container._mapDispose?.();
    const ns = 'http://www.w3.org/2000/svg';
    const mode = options.mode || container.dataset.mapMode || 'map';
    const graph = buildSemanticWorldGraph(world);
    const layout = layoutSemanticWorldGraph(graph, options.currentLocationId || '');
    if (mode === 'map' && globalThis.HordeMapEditor && (options.architect || world.mapLayout?.version === 1)) {
        return globalThis.HordeMapEditor.render(container, world, layout, {
            ...options, graph,
            background: worldMediaSource(world, world.presentation?.mapSkinAssetId),
            rerender: () => renderSemanticWorldMap(container, world, { ...options, mode: 'map' }),
            onMode: next => renderSemanticWorldMap(container, world, { ...options, mode: next }),
            onOpenLocation: id => focusWorldLocationCard(id),
            onChange: structural => {
                if (!options.architect || !structural) return;
                ensureWorldDoorIds(world);
                queueWorldStructureSync(world);
                updateWorldTokenCount();
            },
            createLocation: name => {
                if (!options.architect) throw new Error('This map is read-only.');
                if ((world.locations || []).length >= 2000) throw new Error('The world already contains 2,000 locations.');
                const location = createWorldLocationRecord(world, '', '', 'room');
                location.name = name;
                world.locations.push(location);
                return location;
            },
            connect: (fromId, toId) => {
                if (!options.architect) throw new Error('This map is read-only.');
                const from = world.locations.find(location => location.id === fromId);
                const to = world.locations.find(location => location.id === toId);
                if (!from || !to || from === to) return;
                // Upsert rewrites travel properties: use it only on a fresh pair.
                if (globalThis.HordeMapEditor.connections(world).some(link =>
                    [link.sourceId, link.targetId].includes(fromId) && [link.sourceId, link.targetId].includes(toId))) return;
                if ((from.exits || []).length >= 500 || (to.exits || []).length >= 500) throw new Error('A location already contains 500 exits.');
                const a = { id: from.id, name: from.name, exits: [] };
                const b = { id: to.id, name: to.name, exits: [] };
                upsertWorldTravelConnection({ locations: [a, b] }, a, b, { mode: 'walk', travelTime: 0 });
                (from.exits ||= []).push(...a.exits);
                (to.exits ||= []).push(...b.exits);
            }
        });
    }
    container.replaceChildren();
    container.classList.add('semantic-map-host');
    container.classList.toggle('is-cartographic', mode === 'map');
    container.dataset.mapMode = mode;
    // Older renderers painted the host behind both the toolbar and map.
    container.style.backgroundImage = '';

    const toolbar = document.createElement('div');
    toolbar.className = 'semantic-map-toolbar';
    toolbar.style.backgroundImage = '';
    const summary = document.createElement('div');
    summary.className = 'semantic-map-summary';
    const hiddenLinks = Math.max(0, graph.collapsedConnectionCount - graph.displayEdges.length);
    summary.textContent = `${graph.nodes.length} location${graph.nodes.length === 1 ? '' : 's'}`
        + ` · ${layout.regionBoxes.length} region${layout.regionBoxes.length === 1 ? '' : 's'}`
        + ` · ${graph.displayEdges.length} readable path${graph.displayEdges.length === 1 ? '' : 's'}`
        + (hiddenLinks ? ` · ${hiddenLinks} redundant links simplified` : '');
    const legend = document.createElement('div');
    legend.className = 'semantic-map-legend';
    const typeOrder = ['region', 'route', 'building', 'outdoor', 'room', 'area'];
    const presentTypes = new Set(graph.nodes.map(node => node.type));
    typeOrder.filter(type => presentTypes.has(type)).forEach(type => {
        const item = document.createElement('span');
        item.className = `semantic-map-legend-item type-${type}`;
        item.textContent = formatWorldMapType(type);
        legend.appendChild(item);
    });
    const controls = document.createElement('div');
    controls.className = 'semantic-map-toolbar-controls';
    const modeControls = document.createElement('div');
    modeControls.className = 'semantic-map-modes';
    [['map', 'Map'], ['graph', 'Graph']].forEach(([targetMode, label]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tool-btn semantic-map-mode-btn';
        button.textContent = label;
        button.setAttribute('aria-pressed', String(mode === targetMode));
        button.setAttribute('aria-label', `Show ${label.toLowerCase()} view`);
        button.onclick = () => {
            if (targetMode === mode) return;
            renderSemanticWorldMap(container, world, { ...options, mode: targetMode });
        };
        modeControls.appendChild(button);
    });
    controls.append(modeControls, legend);
    toolbar.append(summary, controls);

    const detail = document.createElement('div');
    detail.className = 'semantic-map-detail';
    if (graph.unresolved.length) {
        detail.textContent = `⚠ ${graph.unresolved.length} exit${graph.unresolved.length === 1 ? '' : 's'} point to missing locations.`;
        detail.classList.add('has-warning');
    } else {
        detail.textContent = options.architect
            ? `${mode === 'map' ? 'Paths route around places. ' : ''}Select a location to edit its map role, parent, floor, or exits.`
            : `${mode === 'map' ? 'Paths route around places. ' : ''}Select a location for details.`;
    }

    const scroll = document.createElement('div');
    scroll.className = `semantic-map-scroll mode-${mode}`;
    const mapBackground = world.media?.mapBackground
        || worldMediaSource(world, world.presentation?.mapSkinAssetId);
    if (mode === 'map' && mapBackground) {
        scroll.style.backgroundImage = `url('${cssUrl(mapBackground)}')`;
        scroll.style.backgroundSize = 'contain';
        scroll.style.backgroundRepeat = 'no-repeat';
        scroll.style.backgroundPosition = 'center';
        scroll.style.backgroundColor = '#0a0a0a';
        // Size and position against the scrolling content, so the floor plan
        // travels with the SVG instead of remaining fixed to the viewport.
        scroll.style.backgroundAttachment = 'local';
        scroll.style.backgroundOrigin = 'content-box';
    }
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Semantic map of ${world.name || 'world'}`);
    svg.setAttribute('class', `semantic-world-svg${mode === 'map' ? ' is-cartographic' : ''}`);
    svg.style.width = `${layout.width}px`;
    svg.style.height = `${layout.height}px`;

    const defs = document.createElementNS(ns, 'defs');
    const marker = document.createElementNS(ns, 'marker');
    marker.setAttribute('id', options.architect ? 'semantic-arrow-architect' : 'semantic-arrow-play');
    marker.setAttribute('markerWidth', '9');
    marker.setAttribute('markerHeight', '7');
    marker.setAttribute('refX', '8');
    marker.setAttribute('refY', '3.5');
    marker.setAttribute('orient', 'auto');
    const arrow = document.createElementNS(ns, 'path');
    arrow.setAttribute('d', 'M0,0 L9,3.5 L0,7 Z');
    arrow.setAttribute('fill', 'var(--red)');
    marker.appendChild(arrow);
    defs.appendChild(marker);
    svg.appendChild(defs);

    layout.regionBoxes.forEach(box => {
        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('class', 'semantic-region-box');
        rect.setAttribute('x', box.x);
        rect.setAttribute('y', box.y);
        rect.setAttribute('width', box.width);
        rect.setAttribute('height', box.height);
        rect.setAttribute('rx', mode === 'map' ? '10' : '18');
        const label = document.createElementNS(ns, 'text');
        label.setAttribute('class', 'semantic-region-label');
        label.setAttribute('x', box.x + 18);
        label.setAttribute('y', box.y + 27);
        label.textContent = box.label;
        svg.append(rect, label);
    });
    layout.clusterBoxes.forEach(box => {
        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('class', `semantic-cluster-box type-${box.type}`);
        rect.setAttribute('x', box.x);
        rect.setAttribute('y', box.y);
        rect.setAttribute('width', box.width);
        rect.setAttribute('height', box.height);
        rect.setAttribute('rx', mode === 'map' && box.type === 'building' ? '4' : '14');
        svg.appendChild(rect);
    });

    const routedEdges = mode === 'map' ? routeSemanticMapEdges(graph, layout) : null;
    const edgesToRender = routedEdges || graph.displayEdges.map(edge => ({ edge }));
    edgesToRender.forEach(route => {
        const edge = route.edge;
        const from = layout.positions.get(edge.sourceId);
        const to = layout.positions.get(edge.targetId);
        if (!from || !to) return;
        let d = route.d;
        if (!d) {
            const sameRow = Math.abs(to.y - from.y) < 24;
            if (sameRow) {
                const fromX = from.x + (to.x > from.x ? from.width / 2 : -from.width / 2);
                const toX = to.x + (to.x > from.x ? -to.width / 2 : to.width / 2);
                const bend = Math.max(24, Math.abs(toX - fromX) * 0.35);
                d = `M ${fromX} ${from.y} C ${fromX + Math.sign(toX - fromX) * bend} ${from.y}, ${toX - Math.sign(toX - fromX) * bend} ${to.y}, ${toX} ${to.y}`;
            } else {
                const down = to.y > from.y;
                const fromY = from.y + (down ? from.height / 2 : -from.height / 2);
                const toY = to.y + (down ? -to.height / 2 : to.height / 2);
                const midY = (fromY + toY) / 2;
                d = `M ${from.x} ${fromY} V ${midY} H ${to.x} V ${toY}`;
            }
        }
        const sourceType = graph.nodeById.get(edge.sourceId)?.type;
        const targetType = graph.nodeById.get(edge.targetId)?.type;
        const isRoad = sourceType === 'route' || targetType === 'route';
        if (mode === 'map' && !edge.internalParentId) {
            const casing = document.createElementNS(ns, 'path');
            casing.setAttribute('class', `cartographic-map-edge-casing ${isRoad ? 'is-road' : 'is-trail'}`);
            casing.setAttribute('d', d);
            svg.appendChild(casing);
        }
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('class', `semantic-map-edge${mode === 'map' ? ` cartographic-map-edge ${isRoad ? 'is-road' : 'is-trail'}` : ''}${edge.isOneWay ? ' is-one-way' : ''}${edge.internalParentId ? ' is-internal' : ''}`);
        path.setAttribute('d', d);
        if (edge.isOneWay) path.setAttribute('marker-end', `url(#${options.architect ? 'semantic-arrow-architect' : 'semantic-arrow-play'})`);
        const title = document.createElementNS(ns, 'title');
        const sourceName = graph.nodeById.get(edge.sourceId)?.location.name || edge.sourceId;
        const targetName = graph.nodeById.get(edge.targetId)?.location.name || edge.targetId;
        title.textContent = `${sourceName} ${edge.isOneWay ? '→' : '↔'} ${targetName}${edge.travelTime ? ` · ${edge.travelTime} min` : ''}${edge.count > 2 ? ` · ${edge.count} source links combined` : ''}`;
        path.appendChild(title);
        svg.appendChild(path);
        if (edge.travelTime || edge.count > 2) {
            const label = document.createElementNS(ns, 'text');
            label.setAttribute('class', 'semantic-edge-label');
            label.setAttribute('x', route.labelPoint?.x ?? (from.x + to.x) / 2);
            label.setAttribute('y', (route.labelPoint?.y ?? (from.y + to.y) / 2) - 5);
            label.textContent = edge.travelTime ? `${edge.travelTime}m` : `${edge.count} links`;
            svg.appendChild(label);
        }
    });

    if (mode === 'map') {
        const compass = document.createElementNS(ns, 'g');
        compass.setAttribute('class', 'semantic-map-compass');
        compass.setAttribute('transform', `translate(${layout.width - 54} 54)`);
        compass.setAttribute('aria-hidden', 'true');
        const circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('r', '22');
        const vertical = document.createElementNS(ns, 'path');
        vertical.setAttribute('d', 'M 0 -14 V 14 M -4 -7 L 0 -15 L 4 -7');
        const horizontal = document.createElementNS(ns, 'path');
        horizontal.setAttribute('d', 'M -14 0 H 14');
        const north = document.createElementNS(ns, 'text');
        north.setAttribute('x', '0');
        north.setAttribute('y', '-27');
        north.setAttribute('text-anchor', 'middle');
        north.textContent = 'N';
        compass.append(circle, vertical, horizontal, north);
        svg.appendChild(compass);
    }

    graph.nodes.forEach(node => {
        const pos = layout.positions.get(node.id);
        if (!pos) return;
        const group = document.createElementNS(ns, 'g');
        group.setAttribute('class', `semantic-map-node type-${node.type}${node.id === options.currentLocationId ? ' is-current' : ''}`);
        group.setAttribute('role', 'button');
        group.setAttribute('tabindex', '0');
        group.setAttribute('aria-label', `${node.location.name || 'Unnamed'}, ${formatWorldMapType(node.type)}`);
        group.dataset.id = node.id;
        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('x', pos.x - pos.width / 2);
        rect.setAttribute('y', pos.y - pos.height / 2);
        rect.setAttribute('width', pos.width);
        rect.setAttribute('height', pos.height);
        rect.setAttribute('rx', node.type === 'route' || node.type === 'outdoor'
            ? String(pos.height / 2)
            : (mode === 'map' ? (node.type === 'room' ? '3' : '5') : '10'));
        rect.setAttribute('class', 'semantic-node-shape');
        group.appendChild(rect);

        const lines = wrapWorldMapLabel(node.location.name, node.parentId ? 18 : 22);
        const baseY = pos.y - ((lines.length - 1) * 8) + (node.floor ? -3 : 3);
        const text = document.createElementNS(ns, 'text');
        text.setAttribute('class', 'semantic-node-label');
        text.setAttribute('x', pos.x);
        text.setAttribute('y', baseY);
        text.setAttribute('text-anchor', 'middle');
        lines.forEach((line, index) => {
            const span = document.createElementNS(ns, 'tspan');
            span.setAttribute('x', pos.x);
            span.setAttribute('dy', index === 0 ? '0' : '15');
            span.textContent = line;
            text.appendChild(span);
        });
        group.appendChild(text);
        if (node.floor) {
            const floor = document.createElementNS(ns, 'text');
            floor.setAttribute('class', 'semantic-node-meta');
            floor.setAttribute('x', pos.x);
            floor.setAttribute('y', pos.y + pos.height / 2 - 6);
            floor.setAttribute('text-anchor', 'middle');
            floor.textContent = node.floor;
            group.appendChild(floor);
        }
        const title = document.createElementNS(ns, 'title');
        title.textContent = `${formatWorldMapType(node.type)}${node.floor ? ` · ${node.floor}` : ''}\n${node.location.description || ''}`;
        group.appendChild(title);

        const selectNode = () => {
            const exitNames = (node.location.exits || []).map(getExitTargetName).filter(Boolean);
            detail.classList.remove('has-warning');
            detail.textContent = `${node.location.name || 'Unnamed'} · ${formatWorldMapType(node.type)}`
                + (node.floor ? ` · ${node.floor}` : '')
                + (node.parentId ? ` · inside ${graph.nodeById.get(node.parentId)?.location.name || node.parentId}` : '')
                + (exitNames.length ? ` · connects to ${exitNames.slice(0, 6).join(', ')}${exitNames.length > 6 ? '…' : ''}` : ' · no exits');
            container.querySelectorAll('.semantic-map-node.is-selected').forEach(item => item.classList.remove('is-selected'));
            group.classList.add('is-selected');
            if (options.onNodeSelect) options.onNodeSelect(node);
        };
        group.onclick = selectNode;
        group.onkeydown = event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                selectNode();
            }
        };
        svg.appendChild(group);
    });

    scroll.appendChild(svg);
    container.append(toolbar, detail, scroll);
    const currentPosition = layout.positions.get(options.currentLocationId);
    if (currentPosition) {
        requestAnimationFrame(() => {
            scroll.scrollLeft = Math.max(0, currentPosition.x - scroll.clientWidth / 2 + 12);
            scroll.scrollTop = Math.max(0, currentPosition.y - scroll.clientHeight / 2 + 12);
        });
    }
    return { graph, layout, svg, routes: routedEdges || [] };
}
function worldMediaSource(world, assetId) {
    return worldMediaAsset(world, assetId)?.data || '';
}
function worldMediaAsset(world, assetId) {
    if (!world || !assetId) return null;
    // A lookup must not prune the authored media library as a side effect of
    // drawing a card, map, or transcript. Import/edit paths normalize it.
    return (Array.isArray(world.mediaAssets) ? world.mediaAssets : [])
        .find(asset => asset?.id === assetId) || null;
}
function cssUrl(url) {
    if (!url) return '';
    const cleaned = String(url).replace(/["'()\\<>\n\r]/g, '');
    if (/^\s*(javascript|vbscript):/i.test(cleaned)) return '';
    return cleaned;
}