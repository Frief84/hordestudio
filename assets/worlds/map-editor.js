/* Authored map geometry is deliberately separate from travel and door state. */
(function (root) {
    'use strict';
    const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
    const finite = n => typeof n === 'number' && Number.isFinite(n);
    const sessions = new WeakMap();
    const ns = 'http://www.w3.org/2000/svg';
    const pairKey = (a, b) => JSON.stringify([a, b].sort());
    function targetName(exit) {
        if (exit?.targetLocationId) return String(exit.targetLocationId).trim();
        const text = String(typeof exit === 'string' ? exit : exit?.text || '').trim();
        return /^to\s/i.test(text) ? text.replace(/^to\s+/i, '') : text.split(/\s+to\s+/i).slice(1).join(' to ') || text;
    }
    function connections(world) {
        const byId = new Map(), byName = new Map(), links = new Map();
        for (const loc of world.locations || []) {
            byId.set(String(loc.id).toLowerCase(), loc);
            const name = String(loc.name || '').trim().toLowerCase();
            byName.set(name, byName.has(name) ? null : loc);
        }
        for (const from of world.locations || []) (from.exits || []).forEach((exit, index) => {
            const ref = targetName(exit).toLowerCase();
            const to = byId.get(ref) || byName.get(ref);
            if (!to || from.id === to.id) return;
            const doorId = String(exit?.doorId || '');
            const key = doorId ? `door:${doorId}` : `pair:${pairKey(from.id, to.id)}`;
            if (!links.has(key)) links.set(key, { key, sourceId: from.id, targetId: to.id, doorId, entries: [] });
            links.get(key).entries.push({ from, to, exit, index });
        });
        return [...links.values()].map(link => ({ ...link,
            isOneWay: !link.entries.some(entry => entry.from.id === link.targetId)
        }));
    }
    function geometry(world, auto) {
        const raw = world.mapLayout?.version === 1 ? world.mapLayout : {};
        const width = finite(raw.width) ? clamp(raw.width, 320, 100000) : Math.max(800, auto?.width || 800);
        const height = finite(raw.height) ? clamp(raw.height, 240, 100000) : Math.max(600, auto?.height || 600);
        const nodes = Object.create(null);
        (world.locations || []).forEach((loc, index) => {
            const saved = raw.nodes && Object.hasOwn(raw.nodes, loc.id) ? raw.nodes[loc.id] : null;
            const source = saved || auto?.positions?.get(loc.id) || { x: 100 + (index % 5) * 140, y: 100 + Math.floor(index / 5) * 80 };
            const w = clamp(finite(source.width) ? source.width : 120, 48, width);
            const h = clamp(finite(source.height) ? source.height : 50, 32, height);
            nodes[loc.id] = {
                x: clamp(finite(source.x) ? source.x : width / 2, w / 2, width - w / 2),
                y: clamp(finite(source.y) ? source.y : height / 2, h / 2, height - h / 2), width: w, height: h
            };
        });
        const routes = Object.create(null);
        const savedByPair = new Map();
        for (const route of Object.values(raw.routes || {})) {
            if (!route || typeof route !== 'object') continue;
            const pair = pairKey(route.sourceId, route.targetId);
            if (!savedByPair.has(pair)) savedByPair.set(pair, []);
            savedByPair.get(pair).push(route);
        }
        for (const link of connections(world)) {
            const saved = (savedByPair.get(pairKey(link.sourceId, link.targetId)) || [])
                .find(route => !route.doorId || route.doorId === link.doorId);
            const points = (Array.isArray(saved?.points) ? saved.points : []).filter(p => p && finite(p.x) && finite(p.y))
                .slice(0, 100).map(p => ({ x: clamp(p.x, 0, width), y: clamp(p.y, 0, height) }));
            if (saved && saved.sourceId !== link.sourceId) points.reverse();
            routes[link.key] = { sourceId: link.sourceId, targetId: link.targetId, doorId: link.doorId, points };
        }
        return { version: 1, width, height, nodes, routes };
    }
    function normalize(world) {
        if (world.mapLayout?.version === 1) world.mapLayout = geometry(world);
    }
    function remap(layout, ids) {
        if (!layout || layout.version !== 1) return undefined;
        const result = clone(layout), map = id => ids.get(id) || id;
        result.nodes = Object.fromEntries(Object.entries(layout.nodes || {}).map(([id, box]) => [map(id), box]));
        // Door IDs remain stable when a world is copied. Endpoint references do not.
        for (const route of Object.values(result.routes || {})) {
            if (!route || typeof route !== 'object') continue;
            route.sourceId = map(route.sourceId); route.targetId = map(route.targetId);
        }
        return result;
    }
    function merge(world, incoming, ids) {
        const mapped = remap(incoming, ids); if (!mapped) return;
        if (world.mapLayout?.version !== 1) { world.mapLayout = mapped; normalize(world); return; }
        const target = world.mapLayout;
        const sx = target.width / Math.max(320, mapped.width || 800), sy = target.height / Math.max(240, mapped.height || 600);
        for (const [id, box] of Object.entries(mapped.nodes || {})) if (!Object.hasOwn(target.nodes || {}, id)) {
            if (!box || typeof box !== 'object') continue;
            (target.nodes ||= {})[id] = { x: box.x * sx, y: box.y * sy, width: box.width * sx, height: box.height * sy };
        }
        for (const [key, route] of Object.entries(mapped.routes || {})) if (!Object.hasOwn(target.routes || {}, key)) {
            if (!route || typeof route !== 'object') continue;
            (target.routes ||= {})[key] = { ...route, points: (Array.isArray(route.points) ? route.points : []).filter(p => p && finite(p.x) && finite(p.y)).map(p => ({ x: p.x * sx, y: p.y * sy })) };
        }
        normalize(world);
    }
    function boundary(box, next) {
        const dx = next.x - box.x, dy = next.y - box.y;
        const scale = Math.min(dx ? box.width / 2 / Math.abs(dx) : Infinity, dy ? box.height / 2 / Math.abs(dy) : Infinity);
        return finite(scale) ? { x: box.x + dx * scale, y: box.y + dy * scale } : { x: box.x, y: box.y };
    }
    function routePoints(layout, link) {
        const a = layout.nodes[link.sourceId], b = layout.nodes[link.targetId];
        const points = layout.routes[link.key]?.points || [];
        return [boundary(a, points[0] || b), ...points, boundary(b, points.at(-1) || a)];
    }
    function along(points, fraction) {
        const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
        let left = lengths.reduce((a, b) => a + b, 0) * fraction;
        for (let i = 0; i < lengths.length; i++) {
            if (left <= lengths[i] || i === lengths.length - 1) {
                const t = lengths[i] ? left / lengths[i] : 0;
                return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t };
            }
            left -= lengths[i];
        }
        return points[0];
    }
    function nearest(points, point) {
        let best = { distance: Infinity, fraction: 0, index: 0 }, travelled = 0;
        const total = points.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);
        for (let i = 0; i < points.length - 1; i++) {
            const a = points[i], b = points[i + 1], dx = b.x - a.x, dy = b.y - a.y;
            const length = Math.hypot(dx, dy);
            const t = length ? clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / (length * length), 0, 1) : 0;
            const distance = Math.hypot(a.x + t * dx - point.x, a.y + t * dy - point.y);
            if (distance < best.distance) best = { distance, fraction: total ? (travelled + t * length) / total : 0, index: i };
            travelled += length;
        }
        return best;
    }
    function resize(box, handle, delta, layout) {
        let left = box.x - box.width / 2, right = box.x + box.width / 2;
        let top = box.y - box.height / 2, bottom = box.y + box.height / 2;
        if (handle.includes('w')) left = clamp(left + delta.x, 0, right - 48);
        if (handle.includes('e')) right = clamp(right + delta.x, left + 48, layout.width);
        if (handle.includes('n')) top = clamp(top + delta.y, 0, bottom - 32);
        if (handle.includes('s')) bottom = clamp(bottom + delta.y, top + 32, layout.height);
        return { x: (left + right) / 2, y: (top + bottom) / 2, width: right - left, height: bottom - top };
    }
    function setConnectionLock(world, link, settings) {
        const lockable = settings.lockable === true;
        const key = lockable ? String(settings.key || '').trim().slice(0, 160) : '';
        if (lockable && !key && !settings.allowCheckUnlock) throw new Error('Enter a key/item or allow an unlock check.');
        for (const entry of link.entries) {
            const exit = typeof entry.exit === 'string' ? { text: entry.exit } : entry.exit;
            entry.from.exits[entry.index] = exit;
            // Keep ID, direction, travel costs and all unrelated exit properties.
            exit.lockable = lockable;
            exit.lockKeyItem = key;
            exit.lockState = lockable && settings.locked ? 'locked' : 'unlocked';
            exit.requiredItem = lockable && settings.locked ? key : '';
            exit.allowCheckUnlock = lockable && settings.locked && settings.allowCheckUnlock === true;
            exit.lockAllowCheckUnlock = lockable && settings.allowCheckUnlock === true;
        }
    }
    function history(world, notify) {
        const undo = [], redo = [];
        function capture(structural) { return { layout: clone(world.mapLayout), ...(structural ? { locations: clone(world.locations) } : {}) }; }
        function restore(snapshot) {
            if (snapshot.layout === undefined) delete world.mapLayout; else world.mapLayout = clone(snapshot.layout);
            if (snapshot.locations) world.locations = clone(snapshot.locations);
        }
        function commit(before, structural) {
            notify(structural);
            const after = capture(structural);
            if (same(before, after)) return;
            undo.push({ before, after, structural }); if (undo.length > 50) undo.shift(); redo.length = 0;
        }
        function step(from, to, side, expected) {
            const item = from.at(-1); if (!item) return false;
            if (!same(capture(item.structural), item[expected])) {
                undo.length = redo.length = 0;
                throw new Error('The world changed outside the map. Map history has been reset.');
            }
            restore(item[side]); from.pop(); to.push(item); notify(item.structural);
            item[side] = capture(item.structural);
            return true;
        }
        return { capture, restore, commit, undo: () => step(undo, redo, 'before', 'after'), redo: () => step(redo, undo, 'after', 'before'),
            get canUndo() { return !!undo.length; }, get canRedo() { return !!redo.length; } };
    }
    function render(container, world, auto, api) {
        container._mapDispose?.();
        const editable = api.architect === true;
        let state = sessions.get(world);
        if (!state) {
            state = { zoom: 1, selected: null, tool: 'select', first: null, left: 0, top: 0, showMarkers: true };
            state.history = history(world, structural => api.onChange?.(structural));
            sessions.set(world, state);
        }
        let layout = geometry(world, auto), links = connections(world), gesture = null;
        if (state.selected?.key && !layout.routes[state.selected.key]) {
            const previous = world.mapLayout?.routes?.[state.selected.key];
            const replacement = previous && links.find(link => pairKey(link.sourceId, link.targetId) === pairKey(previous.sourceId, previous.targetId));
            state.selected = replacement ? { kind: 'link', key: replacement.key } : null;
        }
        const locById = new Map((world.locations || []).map(loc => [loc.id, loc]));
        container.replaceChildren();
        container.dataset.mapMode = 'map';
        container.classList.add('semantic-map-host', 'is-cartographic');
        container.style.backgroundImage = '';
        const el = (tag, className, text) => { const e = document.createElement(tag); if (className) e.className = className; if (text) e.textContent = text; return e; };
        const svgEl = (tag, attrs = {}, text) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); if (text) e.textContent = text; return e; };
        const toolbar = el('div', 'semantic-map-toolbar');
        toolbar.append(el('strong', 'semantic-map-summary', editable ? 'Edit floor plan' : 'Map'));
        const controls = el('div', 'world-map-tools');
        const button = (label, handler, parent = controls) => { const b = el('button', 'tool-btn', label); b.type = 'button'; b.onclick = handler; parent.append(b); return b; };
        const mapButton = button('Map', () => {}, toolbar); mapButton.setAttribute('aria-pressed', 'true');
        button('Graph', () => { cancel(); api.onMode('graph'); }, toolbar);
        if (!editable) {
            const markerToggle = el('label', 'world-map-marker-toggle');
            const markerInput = el('input'); markerInput.type = 'checkbox'; markerInput.checked = state.showMarkers;
            markerInput.setAttribute('aria-label', 'Show room markers');
            markerInput.onchange = () => { state.showMarkers = markerInput.checked; nodes.style.display = state.showMarkers ? '' : 'none'; };
            markerToggle.append(markerInput, document.createTextNode('Show markers'));
            toolbar.append(markerToggle);
        }
        const detail = el('div', 'semantic-map-detail', editable ? 'Drag markers · drag edges to resize · double-click a line to add a waypoint · drag empty space to pan' : 'Select a location for details.');
        detail.setAttribute('aria-live', 'polite');
        const viewport = el('div', 'world-map-viewport'); viewport.tabIndex = 0;
        viewport.setAttribute('aria-label', editable ? 'Floor plan workspace' : 'Map');
        const scroll = el('div', 'semantic-map-scroll mode-map world-map-sheet');
        const bg = world.media?.mapBackground || api.background || '';
        scroll.style.backgroundImage = bg ? `url(${JSON.stringify(bg)})` : 'none';
        scroll.style.backgroundSize = 'contain'; scroll.style.backgroundRepeat = 'no-repeat'; scroll.style.backgroundPosition = 'center'; scroll.style.backgroundColor = '#0a0a0a';
        const svg = svgEl('svg', { viewBox: `0 0 ${layout.width} ${layout.height}`, class: 'semantic-world-svg world-map-editor-svg', role: 'group', 'aria-label': `Map of ${world.name || 'world'}` });
        const defs = svgEl('defs');
        const markerId = `map-arrow-${editable ? 'editor' : 'play'}`;
        const marker = svgEl('marker', { id: markerId, markerWidth: 9, markerHeight: 7, refX: 8, refY: 3.5, orient: 'auto' });
        marker.append(svgEl('path', { d: 'M0,0 L9,3.5 L0,7 Z', fill: 'var(--red)' })); defs.append(marker);
        const paths = svgEl('g'), nodes = svgEl('g'), handles = svgEl('g'); svg.append(defs, paths, nodes, handles);
        scroll.append(svg); viewport.append(scroll);
        const inspector = el('div', 'world-map-inspector'); inspector.hidden = true;
        container.append(toolbar, controls, detail, inspector, viewport);
        const report = error => { detail.textContent = error.message || String(error); };
        function refresh() { state.left = viewport.scrollLeft; state.top = viewport.scrollTop; api.rerender(); }
        function transaction(action, structural = false) {
            const before = state.history.capture(structural);
            try {
                world.mapLayout = clone(layout); action();
                state.history.commit(before, structural); refresh();
            } catch (error) { state.history.restore(before); report(error); }
        }
        function cancel() {
            if (gesture?.before) { state.history.restore(gesture.before); layout = geometry(world, auto); }
            gesture = null; state.first = null; state.tool = 'select'; draw(); updateTools();
        }
        function setTool(tool) { cancel(); state.tool = tool; updateTools(); }
        const toolButtons = [];
        let nameInput, undoButton, redoButton, openButton, clearButton, pointButton;
        if (editable) {
            toolButtons.push(['select', button('Select', () => setTool('select'))], ['connect', button('Connect', () => setTool('connect'))]);
            nameInput = el('input', 'form-input world-map-room-name'); nameInput.placeholder = 'New room'; nameInput.maxLength = 300; nameInput.setAttribute('aria-label', 'New room name'); controls.append(nameInput);
            toolButtons.push(['add', button('Place room', () => {
                if (!nameInput.value.trim()) { nameInput.focus(); report('Enter a room name first.'); return; }
                setTool('add');
            })]);
            openButton = button('Edit location', () => api.onOpenLocation?.(state.selected?.id));
            pointButton = button('Add waypoint', () => setTool('waypoint'));
            clearButton = button('Remove waypoint', () => transaction(() => {
                const route = world.mapLayout.routes[state.selected.key];
                route.points.splice(state.selected.index, 1);
                state.selected = { kind: 'link', key: state.selected.key };
            }));
            undoButton = button('Undo', () => { try { state.history.undo(); refresh(); } catch (e) { report(e); updateTools(); } });
            redoButton = button('Redo', () => { try { state.history.redo(); refresh(); } catch (e) { report(e); updateTools(); } });
        }
        const zoomLabel = el('span', 'world-map-zoom');
        // Auto margins center smaller sheets, but become zero on overflowing axes.
        const sheetInset = () => ({
            x: Math.max(0, (viewport.clientWidth - scroll.offsetWidth) / 2),
            y: Math.max(0, (viewport.clientHeight - scroll.offsetHeight) / 2)
        });
        function zoom(value) {
            const old = state.zoom, before = sheetInset();
            const cx = (viewport.scrollLeft + viewport.clientWidth / 2 - before.x) / old;
            const cy = (viewport.scrollTop + viewport.clientHeight / 2 - before.y) / old;
            state.zoom = clamp(value, .05, 4); applySize();
            const after = sheetInset();
            viewport.scrollLeft = after.x + cx * state.zoom - viewport.clientWidth / 2;
            viewport.scrollTop = after.y + cy * state.zoom - viewport.clientHeight / 2;
        }
        button('−', () => zoom(state.zoom / 1.2)).setAttribute('aria-label', 'Zoom out'); controls.append(zoomLabel);
        button('+', () => zoom(state.zoom * 1.2)).setAttribute('aria-label', 'Zoom in');
        button('Fit map', () => { zoom(Math.min(viewport.clientWidth / layout.width, viewport.clientHeight / layout.height)); viewport.scrollLeft = viewport.scrollTop = 0; });
        function applySize() {
            scroll.style.width = `${layout.width * state.zoom}px`; scroll.style.height = `${layout.height * state.zoom}px`;
            svg.style.width = '100%'; svg.style.height = '100%'; zoomLabel.textContent = `${Math.round(state.zoom * 100)} %`;
        }
        function updateTools() {
            for (const [tool, b] of toolButtons) b.setAttribute('aria-pressed', String(state.tool === tool));
            if (!editable) return;
            openButton.disabled = state.selected?.kind !== 'node';
            pointButton.disabled = !state.selected?.key || !layout.routes[state.selected.key];
            clearButton.disabled = state.selected?.kind !== 'point';
            undoButton.disabled = !state.history.canUndo; redoButton.disabled = !state.history.canRedo;
            viewport.dataset.tool = state.tool;
            if (state.tool === 'connect') detail.textContent = state.first ? 'Select the destination room.' : 'Select a starting room, then a destination. Existing connections are preserved.';
            if (state.tool === 'add') detail.textContent = 'Click the floor plan to place the named room.';
            if (state.tool === 'waypoint') detail.textContent = 'Click the map to add a waypoint to the selected connection.';
        }
        function select(value, inspect = true) {
            state.selected = value;
            if (value?.kind === 'node') {
                const loc = locById.get(value.id); detail.textContent = editable
                    ? `${loc?.name || value.id} · Drag or use the arrow keys to move · Edit location to change room details`
                    : `${loc?.name || value.id} · ${loc?.description || ''}`;
            }
            drawHandles(); updateTools(); if (inspect) showInspector();
        }
        function showInspector() {
            inspector.replaceChildren(); inspector.hidden = true;
            if (!editable || !state.selected?.key) return;
            const link = links.find(l => l.key === state.selected.key); if (!link) return;
            inspector.hidden = false;
            inspector.append(el('strong', '', `${locById.get(link.sourceId)?.name} ↔ ${locById.get(link.targetId)?.name}`));
            const exit = link.entries.find(e => e.exit?.lockState === 'locked' || e.exit?.requiredItem)?.exit
                || link.entries.find(e => typeof e.exit === 'object')?.exit || {};
            function check(label, checked) { const wrapper = el('label'); const input = el('input'); input.type = 'checkbox'; input.checked = checked; wrapper.append(input, document.createTextNode(label)); inspector.append(wrapper); return input; }
            const lockable = check('Lockable', exit.lockable || !!(exit.requiredItem || exit.allowCheckUnlock || exit.lockState === 'locked'));
            const keyLabel = el('label', '', 'Key / item');
            const key = el('input', 'form-input'); key.maxLength = 160; key.value = exit.requiredItem || exit.lockKeyItem || ''; key.setAttribute('aria-label', 'Key / item');
            const list = el('datalist'); list.id = 'world-map-key-items'; key.setAttribute('list', list.id);
            (world.entities || []).filter(e => e.type === 'item').forEach(item => { const o = el('option'); o.value = item.name; list.append(o); });
            keyLabel.append(key, list); inspector.append(keyLabel);
            const locked = check('Locked initially', exit.lockState === 'locked' || !!exit.requiredItem || !!exit.allowCheckUnlock);
            const checkUnlock = check('Unlock check allowed', exit.lockAllowCheckUnlock ?? exit.allowCheckUnlock === true);
            const enable = () => { key.disabled = locked.disabled = checkUnlock.disabled = !lockable.checked; }; lockable.onchange = enable; enable();
            button('Save connection', () => transaction(() => setConnectionLock(world, link, {
                lockable: lockable.checked, key: key.value, locked: locked.checked, allowCheckUnlock: checkUnlock.checked
            }), true), inspector);
            inspector.append(el('small', '', 'The lock and key apply to this connection in both directions. Existing game states are preserved.'));
        }
        const nodeElements = new Map(), pathElements = new Map();
        function draw() {
            paths.replaceChildren(); nodes.replaceChildren(); nodeElements.clear(); pathElements.clear();
            for (const link of links) {
                const points = routePoints(layout, link), d = points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
                const group = svgEl('g', { 'data-link': link.key, class: 'world-map-link', tabindex: editable ? 0 : -1, role: 'button', 'aria-label': `${locById.get(link.sourceId)?.name} → ${locById.get(link.targetId)?.name}` });
                group.append(svgEl('path', { d, class: 'world-map-edge-halo' }), svgEl('path', { d, class: `semantic-map-edge${link.isOneWay ? ' is-one-way' : ''}`, ...(link.isOneWay ? { 'marker-end': `url(#${markerId})` } : {}) }), svgEl('path', { d, class: 'world-map-edge-hit' }));
                const title = svgEl('title', {}, `${locById.get(link.sourceId)?.name} ${link.isOneWay ? '→' : '↔'} ${locById.get(link.targetId)?.name}`); group.append(title);
                paths.append(group); pathElements.set(link.key, group);
            }
            for (const loc of world.locations || []) {
                const box = layout.nodes[loc.id]; if (!box) continue;
                const type = api.graph?.nodeById.get(loc.id)?.type || 'room';
                const g = svgEl('g', { class: `semantic-map-node type-${type}${loc.id === api.currentLocationId ? ' is-current' : ''}`, 'data-id': loc.id, tabindex: 0, role: 'button', 'aria-label': loc.name || 'Unnamed' });
                g.append(svgEl('rect', { class: 'semantic-node-shape', x: box.x - box.width / 2, y: box.y - box.height / 2, width: box.width, height: box.height, rx: 4 }));
                const label = String(loc.name || 'Unnamed'), max = Math.max(3, Math.floor((box.width - 12) / 7));
                const text = svgEl('text', { class: 'semantic-node-label', x: box.x, y: box.y + 4, 'text-anchor': 'middle' }, label.length > max ? `${label.slice(0, max - 1)}…` : label);
                g.append(text, svgEl('title', {}, `${label}\n${loc.description || ''}`)); nodes.append(g); nodeElements.set(loc.id, g);
            }
            nodes.style.display = state.showMarkers ? '' : 'none';
            drawHandles();
        }
        function drawHandles() {
            handles.replaceChildren();
            for (const [id, g] of nodeElements) g.classList.toggle('is-selected', state.selected?.kind === 'node' && state.selected.id === id);
            for (const [key, g] of pathElements) g.classList.toggle('is-selected', state.selected?.key === key);
            if (!editable) return;
            if (state.selected?.kind === 'node') {
                const b = layout.nodes[state.selected.id]; if (!b) return;
                for (const [handle, dx, dy] of [['nw', -1, -1], ['n', 0, -1], ['ne', 1, -1], ['e', 1, 0], ['se', 1, 1], ['s', 0, 1], ['sw', -1, 1], ['w', -1, 0]]) {
                    handles.append(svgEl('rect', { class: 'world-map-resize-handle', 'data-resize': handle, x: b.x + dx * b.width / 2 - 5, y: b.y + dy * b.height / 2 - 5, width: 10, height: 10, style: `cursor:${handle}-resize` }));
                }
            }
            if (state.selected?.key) (layout.routes[state.selected.key]?.points || []).forEach((p, index) => handles.append(svgEl('circle', { class: 'world-map-waypoint', 'data-point': index, 'data-key': state.selected.key, cx: p.x, cy: p.y, r: 6 })));
        }
        function drawGesture() {
            // A large world must not recreate thousands of SVG nodes per pointer event.
            if (gesture.id) {
                const box = layout.nodes[gesture.id], group = nodeElements.get(gesture.id);
                const shape = group.querySelector('rect'), text = group.querySelector('text');
                for (const [key, value] of Object.entries({ x: box.x - box.width / 2, y: box.y - box.height / 2, width: box.width, height: box.height })) shape.setAttribute(key, value);
                text.setAttribute('x', box.x); text.setAttribute('y', box.y + 4);
                const label = String(locById.get(gesture.id)?.name || 'Unnamed'), max = Math.max(3, Math.floor((box.width - 12) / 7));
                text.textContent = label.length > max ? `${label.slice(0, max - 1)}…` : label;
            }
            for (const link of links) {
                if (link.key !== gesture.key && link.sourceId !== gesture.id && link.targetId !== gesture.id) continue;
                const d = routePoints(layout, link).map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
                pathElements.get(link.key).querySelectorAll('path').forEach(path => path.setAttribute('d', d));
            }
            drawHandles();
        }
        function coords(event) {
            const matrix = svg.getScreenCTM(); if (!matrix) return { x: 0, y: 0 };
            const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
            return { x: clamp(point.x, 0, layout.width), y: clamp(point.y, 0, layout.height) };
        }
        function target(event) {
            const e = event.target.closest('[data-resize],[data-point],[data-id],[data-link]');
            if (!e) return null;
            if (e.hasAttribute('data-resize')) return { kind: 'resize', id: state.selected.id, handle: e.dataset.resize };
            if (e.hasAttribute('data-point')) return { kind: 'point', key: e.dataset.key, index: Number(e.dataset.point) };
            if (e.hasAttribute('data-id')) return { kind: 'node', id: e.dataset.id };
            return { kind: 'link', key: e.dataset.link };
        }
        function connectNode(id) {
            if (!state.first) { state.first = id; updateTools(); return; }
            const from = state.first; state.first = null;
            if (from === id) { updateTools(); return; }
            const existing = links.find(l => pairKey(l.sourceId, l.targetId) === pairKey(from, id));
            if (existing) { state.tool = 'select'; select({ kind: 'link', key: existing.key }); return; }
            transaction(() => {
                api.connect(from, id); state.tool = 'select';
                const link = connections(world).find(l => pairKey(l.sourceId, l.targetId) === pairKey(from, id));
                state.selected = link ? { kind: 'link', key: link.key } : null;
            }, true);
        }
        viewport.onpointerdown = event => {
            if (event.button !== 0 && event.button !== 1) return;
            const hit = target(event), p = coords(event);
            viewport.focus({ preventScroll: true });
            if (editable && event.button === 0 && state.tool === 'waypoint' && state.selected?.key) {
                const link = links.find(l => l.key === state.selected.key);
                const index = nearest(routePoints(layout, link), p).index;
                transaction(() => {
                    const points = world.mapLayout.routes[link.key].points;
                    if (points.length >= 100) throw new Error('A connection can have at most 100 waypoints.');
                    points.splice(index, 0, p); state.selected = { kind: 'point', key: link.key, index }; state.tool = 'select';
                }); return;
            }
            if (editable && event.button === 0 && state.tool === 'add') {
                if (!nameInput.value.trim()) return;
                transaction(() => {
                    const loc = api.createLocation(nameInput.value.trim());
                    world.mapLayout.nodes[loc.id] = { x: clamp(p.x, 60, layout.width - 60), y: clamp(p.y, 25, layout.height - 25), width: 120, height: 50 };
                    state.selected = { kind: 'node', id: loc.id }; state.tool = 'select';
                }, true); return;
            }
            if (editable && state.tool === 'connect' && hit?.kind === 'node') { connectNode(hit.id); return; }
            if (hit && event.button === 0) {
                // Opening/closing the inspector changes viewport height. Defer
                // it until release so dragging never jumps by that height.
                if (hit.kind !== 'resize') select(hit, hit.kind === 'link' || !editable);
                if (!editable || hit.kind === 'link') return;
                gesture = { ...hit, start: p, box: hit.id ? clone(layout.nodes[hit.id]) : null, before: state.history.capture(false) };
            } else gesture = { kind: 'pan', x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
            viewport.setPointerCapture(event.pointerId); event.preventDefault();
        };
        viewport.onpointermove = event => {
            if (!gesture) return;
            if (gesture.kind === 'pan') { viewport.scrollLeft = gesture.left - event.clientX + gesture.x; viewport.scrollTop = gesture.top - event.clientY + gesture.y; return; }
            const p = coords(event), delta = { x: p.x - gesture.start.x, y: p.y - gesture.start.y };
            if (!gesture.moved && Math.hypot(delta.x, delta.y) * state.zoom < 3) return;
            gesture.moved = true;
            if (gesture.kind === 'node') {
                const b = gesture.box; layout.nodes[gesture.id] = { ...b, x: clamp(b.x + delta.x, b.width / 2, layout.width - b.width / 2), y: clamp(b.y + delta.y, b.height / 2, layout.height - b.height / 2) };
            } else if (gesture.kind === 'resize') layout.nodes[gesture.id] = resize(gesture.box, gesture.handle, delta, layout);
            else if (gesture.kind === 'point') layout.routes[gesture.key].points[gesture.index] = p;
            drawGesture();
        };
        viewport.onpointerup = event => {
            if (!gesture) return;
            const finished = gesture; gesture = null;
            if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
            if (finished.moved) { world.mapLayout = clone(layout); state.history.commit(finished.before, false); updateTools(); }
            if (finished.kind !== 'pan') showInspector();
            if (!editable && finished.kind === 'node') api.onSelect?.(locById.get(finished.id));
        };
        viewport.onpointercancel = cancel;
        viewport.ondblclick = event => {
            if (!editable) return;
            const hit = target(event); if (hit?.kind !== 'link') return;
            const link = links.find(l => l.key === hit.key), p = coords(event), index = nearest(routePoints(layout, link), p).index;
            transaction(() => {
                const points = world.mapLayout.routes[hit.key].points;
                if (points.length >= 100) throw new Error('A connection can have at most 100 waypoints.');
                points.splice(index, 0, p); state.selected = { kind: 'point', key: hit.key, index };
            });
        };
        viewport.onwheel = event => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); zoom(state.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1)); } };
        container.onkeydown = event => {
            if (event.key === 'Escape') { cancel(); return; }
            if (event.target.matches('input,textarea,select')) return;
            if (editable && (event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) { event.preventDefault(); (event.shiftKey || event.key.toLowerCase() === 'y' ? redoButton : undoButton).click(); return; }
            const hit = target(event);
            if (hit && ['Enter', ' '].includes(event.key)) { event.preventDefault(); if (editable && state.tool === 'connect' && hit.kind === 'node') connectNode(hit.id); else select(hit); return; }
            if (editable && state.selected?.kind === 'node' && /^Arrow/.test(event.key)) {
                event.preventDefault(); const step = event.shiftKey ? 10 : 1;
                transaction(() => { const b = world.mapLayout.nodes[state.selected.id]; b.x = clamp(b.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), b.width / 2, layout.width - b.width / 2); b.y = clamp(b.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0), b.height / 2, layout.height - b.height / 2); });
            }
        };
        container._mapDispose = () => { if (gesture) cancel(); state.left = viewport.scrollLeft; state.top = viewport.scrollTop; container.onkeydown = null; container._mapDispose = null; };
        applySize(); draw(); updateTools(); showInspector();
        viewport.scrollLeft = state.left; viewport.scrollTop = state.top;
        if (!editable && layout.nodes[api.currentLocationId]) {
            const current = layout.nodes[api.currentLocationId];
            viewport.scrollLeft = Math.max(0, current.x * state.zoom - viewport.clientWidth / 2);
            viewport.scrollTop = Math.max(0, current.y * state.zoom - viewport.clientHeight / 2);
        }
        return { layout, svg, links };
    }
    root.HordeMapEditor = { connections, geometry, normalize, remap, merge, boundary, routePoints, along, nearest, resize, setConnectionLock, history, render };
    if (typeof module !== 'undefined') module.exports = root.HordeMapEditor;
})(globalThis);
