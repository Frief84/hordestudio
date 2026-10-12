/* Shared authored knowledge. Pure reads; migrate/applyProposal are explicit writes.
 * Containment is geography, never an implicit travel edge. */
(function (root) {
'use strict';
const VERSION = 4;
const TYPES = ['continent', 'region', 'landscape', 'forest', 'settlement', 'city', 'district', 'square', 'road', 'route', 'water', 'harbor', 'building', 'floor', 'room', 'cave', 'landmark', 'area', 'outdoor', 'other'];
const list = value => Array.isArray(value) ? value : [];
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const indexes = new WeakMap();
const clone = value => JSON.parse(JSON.stringify(value));
const key = (kind, id) => `${kind}:${id}`;
const groups = world => [['region', list(world.regions)], ['location', list(world.locations)], ['npc', list(world.entities)], ['faction', list(world.factions)], ['lore', list(world.lorebook)]];
function records(world) {
    if (indexes.has(world)) return indexes.get(world).rows;
    const rows = [];
    for (const [kind, items] of groups(world)) for (const item of items) {
        if (!object(item)) continue;
        rows.push({ kind, id: item.id, name: item.name || item.keyword || item.id, data: item, source: key(kind, item.id) });
        for (const secret of list(item.secrets).filter(object)) rows.push({ kind: 'secret', id: secret.id,
            name: secret.label || secret.id, data: secret, owner: { kind, id: item.id }, source: key('secret', secret.id) });
    }
    return rows;
}
function get(world, kind, id) {
    if (indexes.has(world)) return indexes.get(world).byKey.get(key(kind, id)) || null;
    const matches = records(world).filter(r => r.kind === kind && r.id === id);
    return matches.length === 1 ? matches[0] : null;
}
function migrate(world) {
    if (!world || typeof world !== 'object') return world;
    const used = new Set(records(world).map(r => r.id).filter(Boolean));
    let sequence = 1;
    const ensure = (item, prefix) => {
        if (item.id) return;
        let id; do { id = `${prefix}_${sequence++}`; } while (used.has(id));
        item.id = id; used.add(id);
    };
    for (const [kind, items] of groups(world)) for (const item of items) {
        if (!object(item)) continue;
        ensure(item, kind);
        for (const secret of list(item.secrets).filter(object)) ensure(secret, 'secret');
    }
    // Resolve existing explicit references automatically, never guess at a
    // destination or manufacture a reciprocal edge/time from containment.
    for (const place of list(world.locations).filter(object)) {
        place.exits = list(place.exits).map(exit => {
            const target = exitTarget(world, exit);
            if (!target) return exit;
            return { ...(typeof exit === 'string' ? { text: exit } : exit), targetLocationId: target.id };
        });
    }
    for (const row of records(world)) if (!row.data.knowledge && Array.isArray(row.data.knownBy)) {
        const ids = row.data.knownBy.filter(id => !!get(world, 'npc', id));
        if (ids.length) row.data.knowledge = { visibility: 'assigned', npcIds: ids, factionIds: [] };
    }
    world.worldLoreVersion = VERSION;
    return world;
}
function parent(world, row) {
    const d = row.data;
    if (row.kind === 'region') return d.parentRegionId ? get(world, 'region', d.parentRegionId) : null;
    if (row.kind !== 'location') return null;
    if (d.parentLocationId) return get(world, 'location', d.parentLocationId);
    if (d.regionId) return get(world, 'region', d.regionId);
    const matches = records(world).filter(r => r.kind === 'region' && (r.id === d.region || r.name === d.region));
    return matches.length === 1 ? matches[0] : null;
}
function lineage(world, row) {
    const result = [], seen = new Set([row.source]);
    let p = parent(world, row);
    while (p && !seen.has(p.source)) { result.push(p); seen.add(p.source); p = parent(world, p); }
    return result;
}
function factions(world, npcId) {
    const npc = get(world, 'npc', npcId)?.data;
    if (!npc) return [];
    return [...new Set([npc.factionId, ...list(npc.factionIds), ...list(world.factions)
        .filter(f => list(f.members).some(m => (typeof m === 'string' ? m : m?.id) === npcId)).map(f => f.id)])]
        .filter(id => !!get(world, 'faction', id));
}
function audience(data, fallback = 'unspecified') {
    return data.knowledge || { visibility: fallback, npcIds: [], factionIds: [] };
}
function facts(world) {
    const result = [];
    for (const row of records(world)) {
        const d = row.data;
        const field = row.kind === 'secret' ? 'truth' : row.kind === 'lore' ? 'text' : 'description';
        if (d[field]) result.push({ id: row.source, name: row.name, text: d[field], source: row.source, field,
            about: [...(row.owner ? [row.owner] : [{ kind: row.kind, id: row.id }]), ...list(d.about).filter(object)],
            knowledge: audience(d, row.kind === 'secret' ? 'narrator' : 'unspecified') });
        if (d.hiddenDescription) result.push({ id: `${row.source}:hidden`, name: `${row.name} (hidden)`,
            text: d.hiddenDescription, source: row.source, field: 'hiddenDescription',
            about: [{ kind: row.kind, id: row.id }], knowledge: d.hiddenKnowledge || { visibility: 'narrator' } });
    }
    return result;
}
function knows(world, fact, npcId) {
    if (!get(world, 'npc', npcId)) return false;
    const a = fact.knowledge;
    return a.visibility === 'public' || (a.visibility === 'assigned' &&
        (list(a.npcIds).includes(npcId) || factions(world, npcId).some(id => list(a.factionIds).includes(id))));
}
function knowledge(world, npcId) { return facts(world).filter(f => knows(world, f, npcId)); }
function exitLock(exit, session, fromId = '', toId = '') {
    const requiredItem = typeof exit?.requiredItem === 'string' ? exit.requiredItem.trim() : '';
    const allowCheckUnlock = exit?.allowCheckUnlock === true;
    // Routes start open unless the author explicitly marks them unknown or
    // locked. Missing metadata is the ordinary unlocked default, not a lint
    // defect; this also keeps legacy maps traversable as authored.
    const state = requiredItem || allowCheckUnlock || exit?.lockState === 'locked' ? 'locked'
        : exit?.lockState === 'unknown' ? 'unknown' : 'unlocked';
    const key = `${String(fromId).toLowerCase()}::${String(toId).toLowerCase()}`;
    return { state, requiredItem, allowCheckUnlock, currentState: session?.unlockedExits?.[key] === true && state === 'locked' ? 'unlocked' : state };
}
function graph(world) {
    const rows = records(world), edges = [];
    const names = new Map();
    for (const other of rows) { const name = String(other.name || '').toLowerCase(); names.set(name, names.has(name) ? null : other); }
    const add = (type, from, to, source, extra = {}) => { if (from && to) edges.push({ type, from, to, source, ...extra }); };
    for (const r of rows) {
        const d = r.data, p = parent(world, r);
        if (p) add('contained_in', r.source, p.source, r.source);
        if (r.owner) add('secret_of', r.source, key(r.owner.kind, r.owner.id), r.source);
        for (const exit of list(d.exits)) {
            const target = exitTarget(world, exit);
            if (target) add('connected_to', r.source, target.source, r.source, { travelTime: exit?.travelTime ?? null, mode: exit?.mode || null, lock: exitLock(exit) });
        }
        for (const about of list(d.about).filter(object)) add('about', r.source, key(about.kind, about.id), r.source);
        if (d.access) {
            for (const [bucket, kind] of [['npcs', 'npc'], ['factions', 'faction']]) for (const [id, decision] of Object.entries(d.access[bucket] || {})) {
                add(decision === 'allow' ? 'may_enter' : 'may_not_enter', key(kind, id), r.source, r.source, { includeChildren: d.access.includeChildren === true });
            }
        }
        if (r.kind === 'npc') {
            for (const id of factions(world, r.id)) add('member_of', r.source, key('faction', id), r.source);
            for (const [field, relation] of [['homeLocation', 'home'], ['startLocation', 'starts_at']]) {
                const target = exitTarget(world, { text: d[field] || '' }); if (target) add(relation, r.source, target.source, r.source);
            }
        }
        const text = [d.description, d.text, d.truth, d.hint, d.persona, d.hiddenDescription].filter(v => typeof v === 'string').join('\n').toLowerCase();
        // Name mentions help navigation/retrieval only. They neither establish
        // knowledge nor grant access. Ambiguous names deliberately stay unlinked.
        for (const [name, other] of names) if (other && other.source !== r.source && name.length >= 3) {
            let offset = text.indexOf(name);
            while (offset !== -1) {
                const left = text[offset - 1] || '', right = text[offset + name.length] || '';
                if (!/[\p{L}\p{N}_]/u.test(left) && !/[\p{L}\p{N}_]/u.test(right)) { add('mentions', r.source, other.source, r.source, { derived: true }); break; }
                offset = text.indexOf(name, offset + 1);
            }
        }
    }
    for (const fact of facts(world)) {
        for (const npcId of list(fact.knowledge.npcIds)) if (fact.knowledge.visibility === 'assigned') add('knows', key('npc', npcId), fact.source, fact.source, { field: fact.field });
        for (const factionId of list(fact.knowledge.factionIds)) if (fact.knowledge.visibility === 'assigned') add('knows', key('faction', factionId), fact.source, fact.source, { field: fact.field });
    }
    return { version: VERSION, nodes: rows.map(r => ({ id: r.source, kind: r.kind, name: r.name, type: r.data.placeType || r.data.mapType || r.kind, access: r.data.access ? clone(r.data.access) : null,
        placeAwareness: r.data.placeAwareness ? clone(r.data.placeAwareness) : null })), edges };
}
function fingerprint(world) {
    // The generated structure is a place index. Character/lore prose is still
    // available to Horde's lore systems, but it must not make the map index
    // stale unless it changes an access rule or a place reference.
    const text = JSON.stringify(records(world).filter(r => ['location', 'region'].includes(r.kind)
        || (r.kind === 'npc' && r.data.type === 'item')).map(r => {
        const d = r.data;
        const fields = ['name', 'description', 'appearance', 'visualDescription', 'type', 'itemType'];
        return [r.source, Object.fromEntries(fields.map(f => [f, d[f] || ''])),
            { access: d.access || null, placeAwareness: d.placeAwareness || null,
                type: d.placeType || d.mapType || r.kind,
                parent: parent(world, r)?.source || d.parentLocationId || d.parentRegionId || d.regionId || d.region || '',
                itemLocation: d.locationId || d.location || d.startLocation || d.homeLocation || '',
                contents: list(d.items || d.contents),
                people: r.kind === 'location' || r.kind === 'region' ? list(world.entities).filter(e => e.type !== 'item').map(e => e.id) : [],
                factionIds: list(d.factionIds), members: list(d.members) },
            list(d.exits).map(e => ({ target: exitTarget(world, e)?.id || (typeof e === 'string' ? e : e?.targetLocationId || e?.text),
                travelTime: Number(e?.travelTime) || 0, mode: e?.mode || 'walk', routeName: e?.routeName || '',
                lockState: e?.lockState || 'unlocked', requiredItem: e?.requiredItem || '', allowCheckUnlock: e?.allowCheckUnlock === true }))];
    }));
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return `${text.length}:${(hash >>> 0).toString(16)}`;
}
function generate(world) {
    const draft = clone(world);
    migrate(draft);
    validateShape(draft);
    const allEdges = indexed(graph)(draft).edges;
    const placeKeys = new Set(records(draft).filter(r => ['location', 'region'].includes(r.kind)).map(r => r.source));
    const nodes = records(draft).filter(r => ['location', 'region'].includes(r.kind)).map(r => {
        const d = r.data, contents = list(d.items || d.contents).map(x => typeof x === 'string' ? x : x?.name || x?.id).filter(Boolean);
        for (const item of list(draft.entities).filter(e => e.type === 'item'
            && (e.locationId || e.location || e.startLocation || e.homeLocation) === d.id)) contents.push(item.name || item.id);
        const occupants = list(draft.entities).filter(e => e.type !== 'item'
            && (e.startLocation === d.id || e.homeLocation === d.id)).map(e => e.id).filter(Boolean);
        return { id: r.source, kind: r.kind, name: r.name, type: d.placeType || d.mapType || r.kind,
            description: d.description || '', appearance: d.appearance || d.visualDescription || '',
            parent: parent(draft, r)?.source || null, contents: [...new Set(contents)],
            access: d.access ? clone(d.access) : { default: 'open', npcs: {}, factions: {} },
            placeAwareness: d.placeAwareness ? clone(d.placeAwareness) : null,
            people: occupants,
            exits: list(d.exits).map(exit => { const target = exitTarget(draft, exit), lock = exitLock(exit);
                return { targetId: target?.id || null, travelTime: exit?.travelTime ?? null,
                    mode: exit?.mode || 'walk', lock: lock.state }; }) };
    });
    const structure = { version: VERSION, nodes, edges: allEdges.filter(edge =>
        ['connected_to', 'contained_in'].includes(edge.type) && placeKeys.has(edge.from) && placeKeys.has(edge.to)) };
    migrate(world);
    world.worldStructure = { ...structure, sourceFingerprint: fingerprint(world), generatedAt: new Date().toISOString() };
    return world.worldStructure;
}
function structureStatus(world) {
    const savedStructure = object(world.worldStructure) ? world.worldStructure : null;
    // Pre-map World Lore used a broader knowledge graph. Keep its existence
    // visible and distinguish it from the newer place-only index so users do
    // not see a false "not generated" message for a populated world.
    if (!savedStructure) {
        const placeCount = list(world.locations).length + list(world.regions).length;
        const recordCount = records(world).length;
        return { state: 'missing', message: `Existing World Lore found: ${placeCount} places and regions across ${recordCount} records. Generate the place structure when ready.` };
    }
    const nodeCount = list(savedStructure.nodes).length, edgeCount = list(savedStructure.edges).length;
    if (!Array.isArray(savedStructure.nodes) || !Array.isArray(savedStructure.edges)) return {
        state: 'stale', message: `A saved generated structure was found (${nodeCount} records and ${edgeCount} relationships) in an older format. Regenerate it to update the map index; existing world data is preserved.` };
    const placeNodes = savedStructure.nodes.filter(node => ['location', 'region'].includes(node.kind));
    const placeEdges = savedStructure.edges.filter(edge => ['connected_to', 'contained_in'].includes(edge.type));
    const placeOnlyIndex = savedStructure.version >= VERSION && savedStructure.nodes.length === placeNodes.length
        && savedStructure.edges.length === placeEdges.length;
    if (!placeOnlyIndex) return {
        state: 'legacy', message: `Existing World Lore structure found: ${nodeCount} records and ${edgeCount} relationships, including ${placeNodes.length} places. This is the saved legacy structure; it has not been removed. Generate the updated place index when ready.` };
    if (savedStructure.sourceFingerprint !== fingerprint(world)) return {
        state: 'stale', message: 'The world changed after structure generation. Generate World Structure again to refresh its place index.' };
    return { state: 'current', message: `World structure is current: ${savedStructure.nodes.length} places and ${savedStructure.edges.length} relationships.` };
}
function health(world) {
    const issues = validate(world).map(i => ({ ...i, severity: /duplicate|cycle|Invalid|ambiguous/.test(i.message) ? 'critical' : 'warning' }));
    const status = structureStatus(world);
    if (status.state !== 'current') issues.unshift({ source: 'world:structure', message: status.message, severity: 'warning' });
    for (const row of records(world)) {
        if (row.kind === 'secret' && row.data.knowledge?.visibility === 'public') issues.push({ source: row.source, message: 'Secret marked as public knowledge. Verify that this is intentional.', severity: 'warning' });
        if (row.kind !== 'npc' || row.data.type === 'item') continue;
        for (const ref of [row.data.startLocation, row.data.homeLocation, ...list(row.data.schedule).map(b => b.locationId || b.location)].filter(Boolean)) {
            const place = exitTarget(world, { text: ref });
            if (place && !access(world, row.id, place.id).ok) issues.push({ source: row.source, message: `Starting placement or schedule conflicts with access to ${place.name}.`, severity: 'warning' });
            if (place && !placeAwareness(world, row.id, place.id).known) issues.push({ source: row.source,
                message: `A starting, home or scheduled place is explicitly unknown to ${row.name}: ${place.name}.`, severity: 'warning' });
        }
        for (const place of records(world).filter(r => ['location', 'region'].includes(r.kind) && r.data.access)) {
            const decisions = factions(world, row.id).map(id => place.data.access.factions?.[id]);
            if (decisions.includes('allow') && decisions.includes('deny')) issues.push({ source: place.source,
                message: `Conflicting faction permissions for ${row.name}; deny takes precedence unless an individual rule overrides it.`, severity: 'warning' });
        }
        for (const place of records(world).filter(r => ['location', 'region'].includes(r.kind) && r.data.placeAwareness)) {
            const decisions = factions(world, row.id).map(id => place.data.placeAwareness.factions?.[id]);
            if (decisions.includes('know') && decisions.includes('unknown')) issues.push({ source: place.source,
                message: `Conflicting faction place knowledge for ${row.name}; unknown wins unless a personal rule overrides it.`, severity: 'warning' });
        }
    }
    return issues;
}
function access(world, npcId, placeId, kind = 'location') {
    const place = get(world, kind, placeId);
    if (!place || !get(world, 'npc', npcId)) return { ok: false, reason: 'Unknown or ambiguous actor/place', source: null };
    const chain = [place, ...lineage(world, place)];
    const ruleRow = chain.find((r, i) => r.data.access && (!i || r.data.access.includeChildren === true));
    if (!ruleRow) return { ok: true, reason: 'No access restriction authored', source: null };
    const rule = ruleRow.data.access, memberOf = factions(world, npcId);
    const npcRule = rule.npcs?.[npcId];
    if (npcRule === 'allow' || npcRule === 'deny') return { ok: npcRule === 'allow', reason: `Individual ${npcRule}`, source: ruleRow.source };
    const decisions = memberOf.map(id => rule.factions?.[id]);
    const decision = decisions.includes('allow') ? 'allow' : decisions.includes('deny') ? 'deny'
        : ['open', 'everyone'].includes(rule.default) ? 'allow' : 'deny';
    return { ok: decision === 'allow', reason: decisions.includes('deny') || decisions.includes('allow') ? `Faction ${decision}` : `Place default: ${rule.default || 'restricted'}`, source: ruleRow.source };
}
// Place awareness is deliberately independent of lore facts and entry rights.
// A faction's area rule reaches descendants; a nearer rule or an individual
// rule at the same place is more specific. Visits belong to one game only.
function placeAwareness(world, npcId, placeId, session = null, kind = 'location') {
    const place = get(world, kind, placeId), npc = get(world, 'npc', npcId)?.data;
    if (!place || !npc) return { known: false, source: null };
    const discovered = list(session?.placeDiscoveries?.[npcId]);
    if (discovered.includes(placeId) || session?.entityStates?.[npcId]?.location === placeId
        || session?.placeAccessGrants?.[placeId]?.[npcId])
        return { known: true, source: 'game' };
    const memberships = factions(world, npcId);
    for (const [depth, row] of [place, ...lineage(world, place)].entries()) {
        const rule = row.data.placeAwareness;
        if (!object(rule) || (depth && rule.includeChildren !== true)) continue;
        const individual = rule.npcs?.[npcId];
        if (individual === 'know' || individual === 'unknown')
            return { known: individual === 'know', source: row.source };
        const decisions = memberships.map(id => rule.factions?.[id]);
        if (decisions.includes('unknown') || decisions.includes('know'))
            return { known: !decisions.includes('unknown'), source: row.source };
    }
    const familiar = [npc.startLocation, npc.homeLocation, npc.locationId,
        ...list(Object.prototype.hasOwnProperty.call(session?.npcScheduleOverrides || {}, npcId)
            ? session.npcScheduleOverrides[npcId] : npc.schedule).map(block => block.locationId || block.location)]
        .filter(Boolean);
    if (familiar.some(ref => ref === placeId || ref === place.name)) return { known: true, source: 'routine' };
    return { known: false, source: null };
}
function rememberPlace(session, npcId, placeId) {
    if (!session || !npcId || !placeId) return false;
    if (!object(session.placeDiscoveries)) session.placeDiscoveries = {};
    const known = list(session.placeDiscoveries[npcId]);
    if (known.includes(placeId)) return false;
    session.placeDiscoveries[npcId] = [...known, placeId];
    return true;
}
function placeIndex(world, session = null) {
    const places = records(world).filter(row => ['location', 'region'].includes(row.kind));
    const byId = new Map(places.map(row => [row.id, row]));
    const routes = new Map();
    for (const row of places) {
        routes.set(row.id, list(row.data.exits).map(exit => {
            const target = exitTarget(world, exit);
            return target ? { to: target.id, minutes: Math.max(0, Number(exit?.travelTime) || 0),
                mode: exit?.mode || 'walk', lock: exitLock(exit, session, row.id, target.id).currentState,
                exit } : null;
        }).filter(Boolean));
    }
    return { byId, routes };
}
function exitTarget(world, exit) {
    if (exit && typeof exit === 'object' && exit.targetLocationId) return get(world, 'location', exit.targetLocationId);
    const text = String(typeof exit === 'string' ? exit : exit?.text || '').trim();
    const target = text.replace(/^.*?\bto\s+/i, '').trim().toLowerCase();
    const rows = records(world).filter(r => r.kind === 'location');
    const ids = rows.filter(r => String(r.id).toLowerCase() === target);
    const matches = ids.length ? ids : rows.filter(r => String(r.name).toLowerCase() === target);
    return matches.length === 1 ? matches[0] : null;
}
function validate(world) {
    const issues = [], rows = records(world), seen = new Set();
    const add = (row, message) => issues.push({ source: row.source, message });
    const ref = (row, kind, id) => { if (id && !get(world, kind, id)) add(row, `Unknown or ambiguous ${kind}: ${id}`); };
    for (const row of rows) {
        const d = row.data;
        if (!row.id || seen.has(row.source)) add(row, 'Missing or duplicate ID');
        seen.add(row.source);
        if (['location', 'region'].includes(row.kind)) {
            if (!d.description) add(row, 'Description missing');
            if (!d.access && (list(d.tags).includes('restricted') || /\bonly\b[^.!?]{0,100}\b(?:may|can) enter\b|\b(?:zutritt nur|nur .{1,60} darf|kein zutritt)\b/i.test(d.description || ''))) add(row, 'Description suggests restricted access but no structured entry rule exists. Review with AI or assign permissions.');
            ref(row, 'location', d.parentLocationId); ref(row, 'region', d.regionId || d.parentRegionId);
            const ancestry = [row, ...lineage(world, row)];
            if (parent(world, ancestry[ancestry.length - 1])) add(row, 'Containment cycle');
            for (const exit of list(d.exits)) if (!exitTarget(world, exit)) add(row, `Unresolved connection: ${typeof exit === 'string' ? exit : exit?.targetLocationId || exit?.text}`);
            for (const exit of list(d.exits)) {
                const target = exitTarget(world, exit), label = target?.name || exit?.text || 'connection';
                if (exit?.lockState !== undefined && !['unknown', 'unlocked', 'locked'].includes(exit.lockState)) add(row, `Invalid lock state: ${label}`);
                if (exit?.lockState === 'unlocked' && (exit.requiredItem || exit.allowCheckUnlock)) add(row, `Unlocked access conflicts with a key/check requirement: ${label}`);
                if (exitLock(exit).state === 'unknown' && ['room', 'building'].includes(target?.data.placeType || target?.data.mapType)) add(row, `Initial lock state unspecified: ${label}`);
            }
            if (d.access) {
                if (!['open', 'restricted'].includes(d.access.default)) add(row, 'Invalid access default');
                for (const [bucket, kind] of [['npcs', 'npc'], ['factions', 'faction']]) for (const [id, value] of Object.entries(d.access[bucket] || {})) {
                    ref(row, kind, id); if (!['allow', 'deny'].includes(value)) add(row, `Invalid access decision: ${id}`);
                }
            }
            if (d.placeAwareness) {
                if (d.placeAwareness.includeChildren !== undefined && typeof d.placeAwareness.includeChildren !== 'boolean') add(row, 'Invalid place awareness inheritance');
                for (const [bucket, kind] of [['npcs', 'npc'], ['factions', 'faction']]) for (const [id, decision] of Object.entries(d.placeAwareness[bucket] || {})) {
                    ref(row, kind, id); if (!['know', 'unknown'].includes(decision)) add(row, `Invalid place awareness decision: ${id}`);
                }
            }
        }
        for (const a of [d.knowledge, d.hiddenKnowledge].filter(Boolean)) {
            if (!['public', 'assigned', 'narrator', 'unspecified'].includes(a.visibility)) add(row, 'Invalid knowledge visibility');
            for (const id of list(a.npcIds)) ref(row, 'npc', id);
            for (const id of list(a.factionIds)) ref(row, 'faction', id);
            if (a.visibility === 'assigned' && !list(a.npcIds).length && !list(a.factionIds).length) add(row, 'Assigned knowledge has no recipients');
        }
        for (const r of list(d.about)) { if (object(r)) ref(row, r.kind, r.id); else add(row, 'Invalid related record'); }
        // Missing knowledge metadata already means narrator-only in `knows`.
        // Reporting it for every description, person and item floods the
        // Structural Lint with harmless defaults and distracts from place,
        // route, access and door-state errors. Keep validating explicit rules
        // above, but do not require authors to materialize this default.
    }
    return issues;
}
function context(world, { locationId, npcIds = [], query = '', budget = 8000, session = null } = {}) {
    const location = get(world, 'location', locationId), all = facts(world);
    const allPlaces = location ? [location, ...lineage(world, location), ...list(location.data.exits).map(e => exitTarget(world, e)).filter(Boolean)] : [];
    const words = String(query).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];
    const queryPhrase = ` ${String(query).toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, ' ')} `;
    for (const row of records(world).filter(r => ['location', 'region'].includes(r.kind))) {
        const namePhrase = ` ${String(row.name).toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, ' ').trim()} `;
        if ((namePhrase.trim().length >= 4 && queryPhrase.includes(namePhrase))
            || queryPhrase.includes(` ${String(row.id).toLowerCase()} `)) allPlaces.push(row);
    }
    const places = [...new Map(allPlaces.map(r => [r.source, r])).values()].slice(0, 12);
    const sources = new Set([...places.map(r => r.source), ...npcIds.map(id => key('npc', id))]);
    const ranked = all.map(f => ({ f, score: (sources.has(f.source) || f.about.some(r => sources.has(key(r.kind, r.id))) ? 100 : 0)
        + words.slice(0, 40).filter(w => `${f.name} ${f.text}`.toLowerCase().includes(w)).length }))
        .filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.f.id.localeCompare(b.f.id));
    // Keep the entire world addressable without repeating every route on every
    // turn. The active place card below contains authoritative local exits;
    // the engine's separate location manifest supplies nearby travel options.
    const compactPlaces = places.map(r => ({ id: r.id, name: r.name, kind: r.kind }));
    const packet = { version: VERSION, locationId, narrator: [], npcKnowledge: Object.fromEntries(npcIds.map(id => [id, []])),
        placeIndex: compactPlaces,
        npcPlaces: Object.fromEntries(npcIds.map(id => [id, compactPlaces.filter(p => placeAwareness(world, id, p.id, session, p.kind).known).map(p => p.id)])),
        places: places.map(r => ({ id: r.id, kind: r.kind, name: r.name, type: r.data.placeType || r.data.mapType || r.kind,
            parent: parent(world, r)?.source || null, connections: list(r.data.exits).slice(0, 8).map(e => ({ targetId: exitTarget(world, e)?.id || null,
                travelTime: e?.travelTime ?? null, mode: e?.mode || null, lock: exitLock(e, session, r.id, exitTarget(world, e)?.id) })),
            access: Object.fromEntries(npcIds.map(id => [id, session?.placeAccessGrants?.[r.id]?.[id]
                ? { ok: true, reason: 'Durable game permission' } : access(world, id, r.id, r.kind)])),
            description: r.id === locationId ? String(r.data.description || '').slice(0, 900) : '', appearance: r.id === locationId ? String(r.data.appearance || r.data.visualDescription || '').slice(0, 500) : '',
            contents: r.id === locationId ? [...new Set([...list(r.data.items || r.data.contents).map(x => typeof x === 'string' ? x : x?.name || x?.id).filter(Boolean),
                ...list(world.entities).filter(item => item.type === 'item' && (item.locationId || item.location || item.startLocation || item.homeLocation) === r.id).map(item => item.name || item.id)])].slice(0, 12) : [] })),
        selection: { reason: 'Current place, hierarchy, adjacent places, named NPCs and query terms', omitted: 0,
            omittedPlaces: Math.max(0, allPlaces.length - places.length), omittedConnections: places.reduce((n, r) => n + Math.max(0, list(r.data.exits).length - 24), 0), budget } };
    while (packet.places.length > 1 && JSON.stringify(packet).length > budget * 0.65) { packet.places.pop(); packet.selection.omittedPlaces++; }
    // Preserve valid JSON; omit whole facts rather than cutting strings mid-record.
    for (const { f } of ranked) {
        const included = { id: f.id, text: f.text, source: f.source, field: f.field };
        packet.narrator.push(included);
        const recipients = npcIds.filter(id => knows(world, f, id));
        recipients.forEach(id => packet.npcKnowledge[id].push(included));
        if (JSON.stringify(packet).length > budget) {
            packet.narrator.pop(); recipients.forEach(id => packet.npcKnowledge[id].pop()); packet.selection.omitted++;
        }
    }
    packet.selection.characters = JSON.stringify(packet).length;
    return packet;
}
const FIELDS = new Set(['knowledge', 'hiddenKnowledge', 'about', 'access', 'placeAwareness', 'placeType', 'parentLocationId', 'regionId', 'parentRegionId', 'exits']);
function validateProposal(world, proposal) {
    const target = get(world, proposal?.kind, proposal?.targetId);
    if (!target || !FIELDS.has(proposal.field)) throw new Error('Unknown proposal target or field');
    if (['access', 'placeAwareness', 'placeType', 'parentLocationId', 'regionId', 'parentRegionId'].includes(proposal.field) && !['location', 'region'].includes(target.kind)) throw new Error('This field requires a place');
    validateField(proposal.field, proposal.value);
    if (proposal.field === 'access' || proposal.field === 'placeAwareness') {
        const authored = target.data[proposal.field];
        if (object(authored)) {
            for (const field of ['default', 'includeChildren']) if (authored[field] !== undefined
                && proposal.value[field] !== authored[field]) throw new Error('AI proposal cannot overwrite an authored rule');
            for (const bucket of ['npcs', 'factions']) for (const [id, decision] of Object.entries(authored[bucket] || {})) {
                if (proposal.value[bucket]?.[id] !== decision) throw new Error('AI proposal cannot overwrite an authored rule');
            }
        }
    }
    if (proposal.field === 'exits') {
        if (target.kind !== 'location') throw new Error('Lock proposals require a location');
        const strip = exits => exits.map(e => typeof e === 'string' ? e : Object.fromEntries(Object.entries(e).filter(([k]) => !['lockState', 'requiredItem', 'allowCheckUnlock'].includes(k)).sort(([a], [b]) => a.localeCompare(b))));
        if (JSON.stringify(strip(list(target.data.exits))) !== JSON.stringify(strip(proposal.value))) throw new Error('Lock proposals cannot add, remove or change travel connections');
        for (const [index, oldExit] of list(target.data.exits).entries()) if (oldExit && typeof oldExit === 'object'
            && ['locked', 'unlocked'].includes(oldExit.lockState) && proposal.value[index]?.lockState !== oldExit.lockState)
            throw new Error('AI proposal cannot overwrite an authored door state');
    }
    const evidence = proposal.evidence;
    const source = evidence && get(world, evidence.kind, evidence.id);
    if (!source || !['description', 'persona', 'text', 'truth', 'hint', 'hiddenDescription'].includes(evidence.field)
        || !evidence.quote || typeof source.data[evidence.field] !== 'string' || !source.data[evidence.field].includes(evidence.quote)) throw new Error('Proposal requires an exact existing source excerpt');
    if (!proposal.reason || typeof proposal.reason !== 'string') throw new Error('Proposal requires a reason');
    const before = new Set(validate(world).map(i => JSON.stringify(i)));
    const copy = clone(world); get(copy, proposal.kind, proposal.targetId).data[proposal.field] = clone(proposal.value);
    const fresh = validate(copy).filter(i => !before.has(JSON.stringify(i)));
    if (fresh.length) throw new Error(fresh.map(i => i.message).join('; '));
    return target;
}
function validateField(field, value) {
    const ids = v => Array.isArray(v) && v.every(id => typeof id === 'string' && id.length > 0 && id.length <= 160 && !['__proto__', 'constructor', 'prototype'].includes(id));
    if (['knowledge', 'hiddenKnowledge'].includes(field)) {
        if (!object(value) || !['public', 'assigned', 'narrator', 'unspecified'].includes(value.visibility)
            || !ids(value.npcIds || []) || !ids(value.factionIds || [])) throw new Error('Invalid knowledge assignment');
    } else if (field === 'about') {
        if (!Array.isArray(value) || !value.every(r => object(r) && ['location', 'region', 'npc', 'faction', 'lore', 'secret'].includes(r.kind) && ids([r.id]))) throw new Error('Invalid related records');
    } else if (field === 'access') {
        if (!object(value) || !['open', 'restricted'].includes(value.default)
            || (value.includeChildren !== undefined && typeof value.includeChildren !== 'boolean')) throw new Error('Invalid access rule');
        for (const bucket of ['npcs', 'factions']) if (value[bucket] !== undefined && (!object(value[bucket])
            || !ids(Object.keys(value[bucket])) || Object.values(value[bucket]).some(v => !['allow', 'deny'].includes(v)))) throw new Error('Invalid access assignments');
    } else if (field === 'placeAwareness') {
        if (!object(value) || (value.includeChildren !== undefined && typeof value.includeChildren !== 'boolean'))
            throw new Error('Invalid place awareness rule');
        for (const bucket of ['npcs', 'factions']) if (value[bucket] !== undefined && (!object(value[bucket])
            || !ids(Object.keys(value[bucket])) || Object.values(value[bucket]).some(v => !['know', 'unknown'].includes(v))))
            throw new Error('Invalid place awareness assignments');
    } else if (field === 'exits') {
        if (!Array.isArray(value) || value.some(e => typeof e !== 'string' && (!object(e) || (e.lockState !== undefined && !['unknown', 'unlocked', 'locked'].includes(e.lockState)) || (e.requiredItem !== undefined && (typeof e.requiredItem !== 'string' || e.requiredItem.length > 160)) || (e.allowCheckUnlock !== undefined && typeof e.allowCheckUnlock !== 'boolean')))) throw new Error('Invalid exit lock fields');
    } else if (typeof value !== 'string' || value.length > 160) throw new Error('Invalid place field');
}
function validateShape(world) {
    for (const r of records(world)) for (const field of FIELDS) if (r.data[field] !== undefined) validateField(field, r.data[field]);
    if (world.loreProposals !== undefined && !Array.isArray(world.loreProposals)) throw new Error('Invalid lore proposals');
}
function stageProposals(world, proposals) {
    world.loreProposals ||= [];
    const result = { added: 0, errors: [] };
    for (const raw of list(proposals).slice(0, 30)) {
        try {
            const target = validateProposal(world, raw);
            const proposal = { kind: raw.kind, targetId: raw.targetId, field: raw.field, value: clone(raw.value), evidence: clone(raw.evidence), reason: raw.reason };
            if (world.loreProposals.some(p => p.status === 'pending' && JSON.stringify(p.proposal) === JSON.stringify(proposal))) continue;
            world.loreProposals.push({ id: `proposal_${Date.now()}_${world.loreProposals.length}`, status: 'pending',
                before: JSON.stringify(target.data[raw.field] ?? null), proposal }); result.added++;
        } catch (e) { result.errors.push(e.message); }
    }
    return result;
}
function applyProposal(world, id) {
    const pending = list(world.loreProposals).find(p => p.id === id && p.status === 'pending');
    if (!pending) throw new Error('Proposal is no longer pending');
    const target = validateProposal(world, pending.proposal);
    if (JSON.stringify(target.data[pending.proposal.field] ?? null) !== pending.before) throw new Error('The target changed. Reject this stale proposal and generate a new one.');
    target.data[pending.proposal.field] = clone(pending.proposal.value); pending.status = 'accepted';
}
function rewriteReferences(world, kind, oldId, newId) {
    // On deletion retain dangling authored references for review; never broaden
    // access or turn a private fact public by silently removing a restriction.
    if (!newId) return;
    for (const r of records(world)) {
        const d = r.data;
        for (const ref of list(d.about)) if (ref.kind === kind && ref.id === oldId) ref.id = newId;
        if (kind === 'location' && d.parentLocationId === oldId) d.parentLocationId = newId;
        for (const a of [d.knowledge, d.hiddenKnowledge].filter(Boolean)) {
            const bucket = kind === 'npc' ? 'npcIds' : kind === 'faction' ? 'factionIds' : null;
            if (bucket) a[bucket] = list(a[bucket]).map(id => id === oldId ? newId : id);
        }
        const bucket = kind === 'npc' ? 'npcs' : kind === 'faction' ? 'factions' : null;
        if (bucket && d.access?.[bucket]?.[oldId]) { d.access[bucket][newId] = d.access[bucket][oldId]; delete d.access[bucket][oldId]; }
        if (bucket && d.placeAwareness?.[bucket]?.[oldId]) { d.placeAwareness[bucket][newId] = d.placeAwareness[bucket][oldId]; delete d.placeAwareness[bucket][oldId]; }
    }
    // Existing proposals must be re-generated after ID edits, not silently retargeted.
    for (const p of list(world.loreProposals)) if (p.status === 'pending') p.status = 'stale';
}
// Build an index once per public read. Discard it afterwards so author edits
// cannot leave stale knowledge or stale permissions behind.
function indexed(fn) { return function (world, ...args) {
    if (indexes.has(world)) return fn(world, ...args);
    const rows = records(world), byKey = new Map();
    for (const r of rows) byKey.set(r.source, byKey.has(r.source) ? null : r);
    indexes.set(world, { rows, byKey });
    try { return fn(world, ...args); } finally { indexes.delete(world); }
}; }
function withIndex(world, fn) { return indexed(() => fn())(world); }
root.HordeWorldLore = { exitLock, VERSION, TYPES, migrate, generate, stageProposals, applyProposal, rewriteReferences, validateShape, rememberPlace, withIndex,
    ...Object.fromEntries(Object.entries({ records, get, parent, lineage, facts, knowledge, knows, access, placeAwareness, placeIndex, exitTarget, validate, context, graph, structureStatus, health }).map(([name, fn]) => [name, indexed(fn)])) };
if (typeof module !== 'undefined') module.exports = root.HordeWorldLore;
})(globalThis);
