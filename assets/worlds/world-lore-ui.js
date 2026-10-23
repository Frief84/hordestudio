/* Friendly map-first World Lore browser. Source records remain in Horde's
 * existing world systems; this view is a compact place index. */
(function (root) {
'use strict';
const L = () => root.HordeWorldLore;
const arr = value => Array.isArray(value) ? value : [];
const views = new WeakMap();
let serial = 0;
const title = row => row?.data?.name || row?.data?.keyword || row?.data?.label || row?.id || 'Unnamed place';
const isPlace = row => ['location', 'region'].includes(row?.kind);
function node(tag, text, css) {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (css) element.className = css;
    return element;
}
function button(text, action, css = 'btn btn-ghost') {
    const element = node('button', text, css); element.type = 'button'; element.onclick = action; return element;
}
function select(label, choices, value, change) {
    const element = node('select', null, 'form-select'); element.setAttribute('aria-label', label);
    choices.forEach(([choice, text]) => { const option = node('option', text); option.value = choice; option.selected = choice === value; element.append(option); });
    element.onchange = () => change(element.value); return element;
}
function disclosure(label, content) {
    const element = node('details', null, 'lore-disclosure'); element.append(node('summary', label), content); return element;
}
function placeItems(world, place, session) {
    const items = arr(world.entities).filter(item => item.type === 'item');
    return items.filter(item => {
        const current = session?.entityStates?.[item.id]?.location;
        const authored = item.locationId || item.location || item.startLocation || item.homeLocation;
        return (current || authored) === place.id;
    }).map(item => ({ id: item.id, name: item.name || item.id, description: item.description || '' }));
}
function currentPeople(world, place, session) {
    if (!session) return [];
    return arr(world.entities).filter(person => person.type !== 'item'
        && session.entityStates?.[person.id]?.location === place.id)
        .map(person => person.name || person.id);
}
function download(world, rows, session) {
    const places = rows.filter(isPlace).map(row => {
        const parent = L().parent(world, row), data = row.data;
        return { id: row.id, name: title(row), kind: row.kind, type: data.placeType || data.mapType || row.kind,
            parent: parent ? { id: parent.id, name: title(parent) } : null,
            description: data.description || '', appearance: data.appearance || data.visualDescription || '',
            contents: placeItems(world, row, session), connections: arr(data.exits).map(exit => {
                const target = L().exitTarget(world, exit), lock = L().exitLock(exit, session, row.id, target?.id);
                return { targetId: target?.id || null, target: title(target) || exit?.text || String(exit),
                    travelTime: exit?.travelTime ?? null, mode: exit?.mode || 'walk', lock: lock.currentState };
            }), access: data.access || { default: 'open' }, placeAwareness: data.placeAwareness || null };
    });
    const blob = new Blob([JSON.stringify({ world: world.name, places, findings: L().health(world) }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), anchor = node('a'); anchor.href = url; anchor.download = `${world.id || 'world'}-places.json`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function mount(container, world, options = {}) {
    const readonly = !!options.readonly, uid = `world-places-${++serial}`;
    const previous = views.get(container), state = previous?.worldId === world.id ? previous
        : { worldId: world.id, selected: null, query: '', type: '', limit: 60 };
    views.set(container, state);
    const rows = L().records(world).filter(isPlace).sort((a, b) => title(a).localeCompare(title(b), undefined, { numeric: true }));
    const bySource = source => rows.find(row => row.source === source);
    container.replaceChildren(); container.classList.add('world-lore-browser', 'world-lore-place-browser');

    const topline = node('div', null, 'lore-topline'), count = node('span', `${rows.length} places and regions`, 'lore-kicker');
    topline.append(count, button('Export place guide', () => download(world, rows, options.session), 'btn btn-ghost lore-export'));
    container.append(topline);

    const toolbar = node('div', null, 'world-lore-toolbar');
    const search = node('input', null, 'form-input'); search.type = 'search'; search.placeholder = 'Search places, rooms or regions…';
    search.setAttribute('aria-label', 'Search places'); search.value = state.query;
    const types = [...new Set(rows.map(row => row.data.placeType || row.data.mapType || row.kind))].sort();
    const typeFilter = select('Place type', [['', 'All place types'], ...types.map(type => [type, type])], state.type, value => { state.type = value; renderDirectory(); });
    toolbar.append(search, typeFilter); container.append(toolbar);
    const notice = node('p', readonly ? 'Current game view · locations and contents reflect this timeline.' : 'Places stay linked to their source records in your world.', 'lore-notice');
    notice.setAttribute('role', 'status'); container.append(notice);
    const proposalsHost = node('div', null, 'world-lore-place-proposals'); container.append(proposalsHost);

    const layout = node('div', null, 'world-lore-layout world-lore-place-layout');
    const directory = node('nav', null, 'world-lore-directory'), detail = node('section', null, 'world-lore-detail');
    directory.setAttribute('aria-label', 'Places'); detail.setAttribute('aria-label', 'Place details'); layout.append(directory, detail); container.append(layout);

    function filtered() {
        const query = state.query.trim().toLocaleLowerCase();
        return rows.filter(row => (!state.type || (row.data.placeType || row.data.mapType || row.kind) === state.type)
            && (!query || `${title(row)} ${row.id} ${row.data.description || ''} ${L().parent(world, row)?.name || ''}`.toLocaleLowerCase().includes(query)));
    }
    function open(row) { if (!row) return; state.selected = row.source; renderDirectory(); renderDetail(); }
    function placeLink(row) {
        const link = button(title(row), () => open(row), 'lore-link');
        link.setAttribute('aria-label', `${title(row)} · ${row.data.placeType || row.data.mapType || row.kind}`); return link;
    }
    function renderDirectory() {
        directory.replaceChildren(); const matches = filtered();
        const heading = node('div', null, 'lore-directory-heading'); heading.append(node('span', `${matches.length} ${matches.length === 1 ? 'place' : 'places'}`));
        if (state.query || state.type) heading.append(button('Clear filters', () => { state.query = ''; state.type = ''; search.value = ''; typeFilter.value = ''; renderDirectory(); }, 'lore-link'));
        directory.append(heading);
        if (!matches.length) { directory.append(node('p', 'No matching places. Try another search or clear the filters.', 'lore-empty')); return; }
        matches.slice(0, state.limit).forEach(row => {
            const parent = L().parent(world, row), item = button(null, () => open(row), 'lore-directory-item');
            item.setAttribute('aria-current', String(row.source === state.selected));
            item.append(node('strong', title(row)), node('small', [row.data.placeType || row.data.mapType || (row.kind === 'region' ? 'region' : 'place'), parent ? title(parent) : ''].filter(Boolean).join(' · ')));
            directory.append(item);
        });
        if (matches.length > state.limit) directory.append(button(`Show ${Math.min(60, matches.length - state.limit)} more`, () => { state.limit += 60; renderDirectory(); }));
    }
    function section(host, label, countValue = null) {
        host.append(node('h4', countValue == null ? label : `${label} · ${countValue}`));
    }
    function renderProposals() {
        proposalsHost.replaceChildren();
        const pending = arr(world.loreProposals).filter(proposal => proposal.status === 'pending');
        if (!pending.length) return;
        const list = node('div', null, 'lore-proposal-list');
        pending.forEach(proposal => {
            const row = L().get(world, proposal.proposal.kind, proposal.proposal.targetId);
            const card = node('article', null, 'lore-review-card');
            const description = proposal.proposal.field === 'access' ? 'Suggested access update' : 'Suggested door state';
            card.append(node('h4', `${row ? title(row) : proposal.proposal.targetId} · ${description}`),
                node('p', proposal.proposal.reason, 'lore-prose'),
                node('blockquote', `Evidence: “${proposal.proposal.evidence.quote}”`));
            if (!readonly) {
                const actions = node('div', null, 'world-lore-links');
                actions.append(button('Apply suggestion', () => {
                    try { L().applyProposal(world, proposal.id); notice.textContent = 'Suggestion applied to this draft. Use Save World to keep it.'; options.onChange?.(); renderProposals(); renderDetail(); }
                    catch (error) { notice.textContent = error.message; }
                }, 'btn btn-primary'), button('Dismiss', () => { proposal.status = 'rejected'; options.onChange?.(); renderProposals(); }));
                card.append(actions);
            }
            list.append(card);
        });
        proposalsHost.append(disclosure(`Review ${pending.length} AI ${pending.length === 1 ? 'suggestion' : 'suggestions'}`, list));
    }
    function renderDetail() {
        detail.replaceChildren(); const row = bySource(state.selected);
        if (!row) { detail.append(node('h3', 'Explore the map'), node('p', 'Choose a place to see its appearance, contents, connections and access.', 'lore-empty')); return; }
        const data = row.data, parent = L().parent(world, row), header = node('header', null, 'lore-detail-header'), intro = node('div');
        intro.append(node('span', `${data.placeType || data.mapType || (row.kind === 'region' ? 'Region' : 'Place')}`, 'lore-kicker'));
        intro.append(node('h3', title(row)));
        if (parent) { const crumb = node('div', null, 'lore-breadcrumbs'); crumb.append(placeLink(parent)); intro.append(crumb); }
        header.append(intro);
        if (!readonly) header.append(button('Edit in Places', () => document.querySelector('.world-studio-tab[data-tab="w-locations"]')?.click(), 'btn btn-ghost'));
        detail.append(header);

        const description = node('p', data.description || 'No description added yet.', 'lore-prose'); detail.append(description);
        const appearance = data.appearance || data.visualDescription;
        if (appearance) { section(detail, 'Appearance'); detail.append(node('p', appearance, 'lore-prose')); }

        const contents = placeItems(world, row, options.session);
        const contentNames = [...new Set([...contents.map(item => item.name), ...arr(data.items || data.contents).map(item => typeof item === 'string' ? item : item?.name || item?.id).filter(Boolean)])];
        section(detail, 'In this place', contentNames.length);
        if (!contentNames.length) detail.append(node('p', 'No objects are recorded here yet.', 'lore-empty'));
        else { const list = node('ul', null, 'lore-place-items'); contentNames.forEach(name => list.append(node('li', name))); detail.append(list); }

        const exits = arr(data.exits), incoming = rows.flatMap(origin => arr(origin.data.exits).map(exit => ({ origin, exit, target: L().exitTarget(world, exit) })))
            .filter(item => item.target?.id === row.id);
        section(detail, 'Ways to get there', exits.length + incoming.length);
        const routes = node('div', null, 'lore-place-routes');
        [...exits.map(exit => ({ origin: row, exit, target: L().exitTarget(world, exit) })), ...incoming]
            .forEach(({ origin, exit, target }) => {
                const lock = L().exitLock(exit, options.session, origin.id, target?.id), line = node('div', null, 'lore-route'), end = node('div');
                if (target || origin.id !== row.id) end.append(placeLink(origin.id === row.id ? target : origin));
                else end.append(node('span', `Unresolved route: ${exit?.text || exit?.targetLocationId || String(exit)}`, 'lore-warning'));
                line.append(end, node('span', `${exit?.travelTime == null ? 'Travel time not set' : `${exit.travelTime} min`}
                    · ${exit?.mode || 'walk'} · ${lock.currentState === 'locked' ? 'Locked' : lock.currentState === 'unlocked' ? 'Unlocked' : 'Lock not set'}`, 'lore-meta'));
                if (options.session && lock.currentState !== lock.state) line.append(node('small', `This game: ${lock.currentState}`, 'lore-meta'));
                routes.append(line);
            });
        if (!exits.length && !incoming.length) routes.append(node('p', 'No mapped routes yet.', 'lore-empty'));
        detail.append(routes);

        const actors = arr(world.entities).filter(person => person.type !== 'item');
        const results = actors.map(person => ({ person, rule: options.session?.placeAccessGrants?.[row.id]?.[person.id]
            ? { ok: true, reason: 'Durable permission shared in this game' }
            : L().access(world, person.id, row.id, row.kind) }));
        const denied = results.filter(item => !item.rule.ok), allowed = results.filter(item => item.rule.ok);
        section(detail, 'Who may enter');
        detail.append(node('p', denied.length ? `${allowed.length} allowed · ${denied.length} explicitly denied` : `Everyone (${allowed.length}) may enter unless the door is locked.`, 'lore-callout'));
        if (denied.length) {
            const list = node('div', null, 'lore-access-list'); denied.forEach(item => {
                const line = node('div', null, 'lore-access-row'); line.append(node('span', item.person.name || item.person.id), node('span', 'Not allowed', 'lore-badge is-denied')); list.append(line);
            }); detail.append(list);
        }
        section(detail, 'Who knows this place?');
        const aware = actors.filter(person => L().placeAwareness(world, person.id, row.id, options.session, row.kind).known);
        detail.append(node('p', aware.length ? `${aware.slice(0, 12).map(person => person.name || person.id).join(', ')}${aware.length > 12 ? ` · +${aware.length - 12} more` : ''}`
            : 'No person is known to be familiar with this place yet.', 'lore-callout'));
        if (data.placeAwareness?.includeChildren) detail.append(node('p', 'Faction and individual knowledge rules also apply to places inside this area.', 'lore-meta'));
        if (options.session) {
            const present = currentPeople(world, row, options.session), playerHere = options.session.playerLocation === row.id;
            section(detail, 'This game');
            detail.append(node('p', `${playerHere ? 'Player here' : 'Player elsewhere'} · ${present.length} ${present.length === 1 ? 'person' : 'people'} present${present.length ? `: ${present.join(', ')}` : ''}`, 'lore-callout'));
            const locationState = options.session.locationStates?.[row.id];
            if (locationState) {
                const changed = [locationState.description, locationState.appearance, locationState.visualDescription,
                    ...(arr(locationState.conditions))].filter(Boolean);
                if (changed.length) detail.append(node('p', `Current state: ${changed.join(' · ')}`, 'lore-meta'));
            }
        }
    }
    search.oninput = () => { state.query = search.value; renderDirectory(); };
    if (!bySource(state.selected)) state.selected = rows.find(row => row.kind === 'location' && row.id === world.startLocationId)?.source || rows[0]?.source || null;
    renderDirectory(); renderDetail(); renderProposals();
}
function debug(world, options = {}) {
    const dialog = node('dialog', null, 'world-lore-dialog'), content = node('div');
    dialog.append(button('Close place guide', () => dialog.close()), content); document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove()); mount(content, world, { ...options, readonly: true }); dialog.showModal();
}
root.HordeWorldLoreUI = { mount, debug };
})(globalThis);
