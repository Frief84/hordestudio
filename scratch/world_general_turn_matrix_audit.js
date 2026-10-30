/** Independent bound V3 turns across dialogue, movement and item state. */
'use strict';
const assert = require('node:assert/strict');
const scene = require('../worlds/scene-draft');
const binding = require('../worlds/turn-binding');
const linked = require('../worlds/linked-world-actions');

const fields = Object.fromEntries(['type', 'actor_id', 'status', 'action', 'item',
    'activity', 'target_id', 'from_location_id', 'to_location_id', 'movement_mode', 'evidence']
    .map(name => [name, { type: 'string', maxLength: 1000 }]));
const canonical = scene.schema({ events: { type: 'array', items: { type: 'object',
    properties: fields, required: ['type', 'actor_id', 'status'] } } },
'scene_draft_v3', { linkedRequired: true });
const genres = ['fantasy', 'mystery', 'science fiction', 'slice of life', 'western',
    'historical', 'cyberpunk', 'seafaring', 'comedy', 'horror'];
const makeWorld = index => {
    const npcId = `guide_${index}`;
    const itemId = `token_${index}`;
    const secondId = `shard_${index}`;
    const destination = `room_${index}`;
    const world = { id: `matrix_${index}`, name: genres[index],
        locations: [
            { id: 'foyer', name: 'Foyer', exits: [{ targetLocationId: destination }] },
            { id: destination, name: `Room ${index}`, exits: [{ targetLocationId: 'foyer' }] }
        ], entities: [
            { id: npcId, type: 'npc', name: `Guide ${index}`, startLocation: 'foyer' },
            { id: `rival_${index}`, type: 'npc', name: `Rival ${index}`, startLocation: 'foyer' },
            { id: `table_${index}`, type: 'object', name: `Table ${index}`, startLocation: 'foyer',
                interactable: { initialState: 'upright', transitions: [
                    { from: 'upright', to: 'overturned' }] } },
            { id: `cup_${index}`, type: 'object', name: `Cup ${index}`, startLocation: 'foyer',
                interactable: { initialState: 'intact', transitions: [
                    { from: 'intact', to: 'broken' }] } },
            { id: `book_${index}`, type: 'object', name: `Sketchbook ${index}`,
                startLocation: 'foyer', interactable: { initialState: 'blank', transitions: [
                    { from: 'blank', to: 'illustrated', requiredItem: `Token ${index}` }] } },
            { id: itemId, type: 'item', name: `Token ${index}`, startLocation: 'foyer' },
            { id: secondId, type: 'item', name: `Shard ${index}`, startLocation: 'foyer' }
        ] };
    const session = { id: `matrix_save_${index}`, playerLocation: 'foyer',
        turnCount: 1, worldStateVersion: 0, inventory: [],
        entityStates: { [npcId]: { location: 'foyer' },
            [`rival_${index}`]: { location: 'foyer' },
            [`table_${index}`]: { location: 'foyer' },
            [`cup_${index}`]: { location: 'foyer' },
            [`book_${index}`]: { location: 'foyer' },
            [itemId]: { location: 'foyer' }, [secondId]: { location: 'foyer' } },
        locationStates: {}, npcRelationships: {}, engineEvents: [] };
    return { world, session, npcId, rivalId: `rival_${index}`,
        rivalName: `Rival ${index}`, tableId: `table_${index}`,
        cupId: `cup_${index}`, bookId: `book_${index}`, itemId, secondId, destination,
        npcName: `Guide ${index}`, itemName: `Token ${index}`,
        secondName: `Shard ${index}` };
};
const action = (kind, status, text, options = {}) => ({ kind, status,
    response: [{ text, ...(options.event ? { events: [options.event] } : {}),
        ...(options.speech ? { speech: [options.speech] } : {}) }],
    effects: options.effects || [] });
const inventoryEvent = (item, verb) => ({ type: 'inventory', actor_id: 'player',
    status: 'completed', action: verb, item });
const transfer = (id, from, to) => ({ item_transfer: [{ item_id: id,
    from_id: from, to_id: to }] });
const scenarios = [
    (f, i) => ({ input: i % 2 ? `Was weiß ${f.npcName} über Raum ${i}?`
        : `What does ${f.npcName} know about room ${i}?`,
    actions: [action('question', 'answered', `${f.npcName} says "The room is quiet."`, {
        speech: { speaker: f.npcId, listeners: ['player'],
            quote: 'The room is quiet.' } })], expect: 'unchanged' }),
    (f, i) => ({ input: i % 2 ? `Ich grüße ${f.npcName}.`
        : `I greet ${f.npcName}.`,
    actions: [action('speech', 'resolved', `${f.npcName} returns the greeting.`)],
    expect: 'unchanged' }),
    (f, i) => ({ input: i % 2 ? `Ich sehe mich im Raum ${i} um.`
        : `I look around room ${i}.`,
    actions: [action('observation', 'resolved', 'The room remains quiet.')],
    expect: 'unchanged' }),
    (f, i) => ({ input: i % 2 ? `Ich lächle ${f.npcName} an.`
        : `I smile at ${f.npcName}.`,
    actions: [action('gesture', 'resolved', `${f.npcName} notices the smile.`)],
    expect: 'unchanged' }),
    (f, i) => ({ input: i % 2 ? `Ich setze mich neben ${f.npcName}.`
        : `I sit beside ${f.npcName}.`,
    actions: [action('physical', 'resolved', 'You settle into a seated pose.', {
        event: { type: 'activity', actor_id: 'player', status: 'completed',
            activity: 'sitting' } })], expect: 'unchanged' }),
    (f, i) => ({ input: i % 2 ? `Ich nehme ${f.itemName}.`
        : `I take ${f.itemName}.`,
    actions: [action('physical', 'resolved', `You take ${f.itemName}.`, {
        effects: transfer(f.itemId, 'foyer', 'player'),
        event: i === 0 ? undefined : inventoryEvent(f.itemName, 'add') })], expect: 'item' }),
    (f, i) => ({ input: i % 2 ? `Ich nehme ${f.itemName} aus ${f.npcName}s Hand.`
        : `I take ${f.itemName} from ${f.npcName}.`,
    setup: session => { session.entityStates[f.itemId].location = '';
        session.entityStates[f.npcId].inventory = [f.itemName]; },
    actions: [action('physical', 'resolved', `${f.npcName} lets you take ${f.itemName}.`, {
        effects: transfer(f.itemId, f.npcId, 'player'),
        event: i === 0 ? undefined : inventoryEvent(f.itemName, 'add') })], expect: 'item' }),
    (f, i) => ({ input: i % 2 ? `Ich gebe ${f.itemName} an ${f.npcName}.`
        : `I give ${f.itemName} to ${f.npcName}.`,
    setup: session => { session.inventory = [f.itemName];
        session.entityStates[f.itemId].location = ''; },
    actions: [action('physical', 'resolved', `${f.npcName} accepts ${f.itemName}.`, {
        effects: transfer(f.itemId, 'player', f.npcId),
        event: inventoryEvent(f.itemName, 'remove') })], expect: 'given' }),
    (f, i) => ({ input: i % 2 ? `Ich gehe in Raum ${i}.`
        : `I walk to room ${i}.`,
    actions: [action('travel', 'resolved', `You enter room ${i}.`, {
        effects: { actor_move: [{ actor_id: 'player', to_location_id: f.destination }] },
        event: { type: 'movement', actor_id: 'player', status: 'completed',
            from_location_id: 'foyer', to_location_id: f.destination,
            movement_mode: 'voluntary' } })], expect: 'travel' }),
    (f, i) => {
        const first = i % 2 ? 'Ich nicke. ' : 'I nod. ';
        const second = i % 2 ? `Ich frage ${f.npcName} nach dem Weg.`
            : `I ask ${f.npcName} for directions.`;
        return { input: first + second,
            actions: [action('gesture', 'resolved', 'You nod.'),
                action('question', 'answered', `${f.npcName} gives directions.`)],
            requests: [first, second], expect: 'unchanged' };
    },
    (f, i) => {
        const first = i % 2 ? `Ich nehme ${f.itemName} und `
            : `I take ${f.itemName} and `;
        const second = i % 2 ? `ich nehme ${f.secondName}.`
            : `I take ${f.secondName}.`;
        return { input: first + second, actions: [
            action('physical', 'resolved', `You take ${f.itemName}.`, {
                effects: transfer(f.itemId, 'foyer', 'player'),
                event: inventoryEvent(f.itemName, 'add') }),
            action('physical', 'resolved', `You take ${f.secondName}.`, {
                effects: transfer(f.secondId, 'foyer', 'player'),
                event: inventoryEvent(f.secondName, 'add') })],
        requests: [first, second], expect: 'two_items' };
    },
    (f, i) => ({ input: i % 2 ? 'Ich zeichne eine Skizze.' : 'I draw a sketch.',
        actions: [action('physical', 'resolved', 'A quick sketch takes shape on the page.', {
            event: { type: 'interaction', actor_id: 'player', status: 'completed',
                action: 'draw a sketch' } })], expect: 'unchanged' }),
    (f, i) => ({ input: i % 2 ? 'Ich gehe zum Schrank.' : 'I walk to the cabinet.',
        actions: [action('physical', 'resolved', 'You stop beside the cabinet.', {
            event: { type: 'interaction', actor_id: 'player', status: 'completed',
                action: 'walk to the cabinet' } })], expect: 'unchanged' }),
    (f, i) => ({ input: i % 2 ? 'Ich nehme das unbekannte Amulett.' : 'I take the unknown amulet.',
        actions: [action('physical', 'attempted', 'You do not acquire an amulet.')],
        expect: 'unchanged' }),
    (f, i) => ({ input: i % 2 ? `Ich lächlee ${f.npcName} an.`
        : `I smiile at ${f.npcName}.`,
        actions: [action('gesture', 'resolved', `${f.npcName} notices your smile.`)],
        expect: 'unchanged' }),
    (f, i) => ({ input: i % 2 ? 'Ich frage beide nach dem Weg.'
        : 'I ask both of them for directions.',
        actions: [{ kind: 'question', status: 'answered', effects: [], response: [
            { text: `${f.npcName} says "Take the exit."`,
                speech: [{ speaker: f.npcId, listeners: ['player'],
                    quote: 'Take the exit.' }] },
            { text: `${f.rivalName} says "I agree."`,
                speech: [{ speaker: f.rivalId, listeners: ['player'],
                    quote: 'I agree.' }] }] }],
        expect: 'unchanged' }),
    (f, i) => ({ input: i % 2 ? 'Ich werfe den Tisch um.' : 'I overturn the table.',
        actions: [action('physical', 'resolved', `The table tips onto its side.`, {
            effects: { interactable_transition: [{ target_id: f.tableId, to_state: 'overturned' }] },
            event: { type: 'environment', actor_id: 'player', status: 'completed',
                target_id: f.tableId, action: 'overturn' } })], expect: 'table' }),
    (f, i) => {
        const first = i % 2 ? 'Ich werfe den Tisch um und '
            : 'I overturn the table and ';
        const second = i % 2 ? 'die Tasse an die Wand.' : 'throw the cup against the wall.';
        return { input: first + second, requests: [first, second], actions: [
            action('physical', 'resolved', 'The table lands on its side.', {
                effects: { interactable_transition: [{ target_id: f.tableId,
                    to_state: 'overturned' }] },
                event: { type: 'environment', actor_id: 'player', status: 'completed',
                    target_id: f.tableId, action: 'overturn' } }),
            action('physical', 'resolved', 'The cup breaks against the wall.', {
                effects: { interactable_transition: [{ target_id: f.cupId,
                    to_state: 'broken' }] },
                event: { type: 'environment', actor_id: 'player', status: 'completed',
                target_id: f.cupId, action: 'break' } })], expect: 'table_and_cup' };
    },
    (f, i) => ({ input: i % 2 ? `Ich zeichne mit ${f.itemName} ins Skizzenbuch.`
        : `I draw in the sketchbook with ${f.itemName}.`,
        setup: session => { session.inventory = [f.itemName];
            session.entityStates[f.itemId].location = ''; },
        actions: [action('physical', 'resolved', 'A permanent drawing fills the sketchbook page.', {
            effects: { interactable_transition: [{ target_id: f.bookId,
                to_state: 'illustrated' }] },
            event: { type: 'environment', actor_id: 'player', status: 'completed',
                target_id: f.bookId, action: 'draw' } })], expect: 'book' })
];

(async () => {
    let passed = 0;
    for (const [category, scenario] of scenarios.entries()) for (let i = 0; i < 10; i++) {
        const f = makeWorld(i);
        const turn = scenario(f, i);
        turn.setup?.(f.session);
        const before = structuredClone(f.session);
        const proposal = { protocol: 'scene_draft_v3', actions: turn.actions.map((entry, slot) =>
            ({ ...entry, ...(turn.requests ? { request: turn.requests[slot] } : {}) })) };
        const bound = binding.bind(proposal, { turnId: `turn_matrix_${category}_${i}`,
            input: turn.input, now: 480, references: f.world.entities.concat(f.world.locations) },
        canonical);
        assert(bound.ok, `${category}/${i} bind: ${JSON.stringify(bound.errors)}`);
        const compiled = scene.compile(bound.draft, { input: turn.input, location: 'foyer',
            playerStart: 'foyer', present: [f.npcId, f.rivalId],
            actors: [{ id: f.npcId, name: f.npcName },
                { id: f.rivalId, name: f.rivalName }],
            locations: ['foyer', f.destination], now: 480, linkedRequired: true,
            contract: canonical });
        assert(compiled.ok, `${category}/${i} compile: ${JSON.stringify(compiled.errors)}`);
        const result = linked.executeLinkedActions(compiled.linkedPlan, f.world, f.session, {
            worldActionIds: bound.binding.worldActionIds, requireEffectWitnesses: true,
            canMove: () => ({ ok: true, travelTime: 0 }) });
        assert(result.ok, `${category}/${i} execute: ${JSON.stringify(result.errors)}`);
        assert.deepEqual(f.session, before, `${category}/${i} changed canonical state before commit`);
        const candidate = result.working.prepare().session;
        const inventory = candidate.inventory.map(item => typeof item === 'string' ? item : item.name);
        if (turn.expect === 'item' || turn.expect === 'two_items')
            assert(inventory.includes(f.itemName), `${category}/${i} lost acquired item`);
        if (category === 6) assert(!candidate.entityStates[f.npcId].inventory.includes(f.itemName),
            `${category}/${i} duplicated an NPC-held item`);
        if (turn.expect === 'two_items')
            assert(inventory.includes(f.secondName), `${category}/${i} lost second action`);
        if (turn.expect === 'given') {
            assert(!inventory.includes(f.itemName), `${category}/${i} retained given item: ${JSON.stringify(candidate.inventory)} / ${JSON.stringify(candidate.entityStates[f.itemId])}`);
            assert(candidate.entityStates[f.npcId].inventory.includes(f.itemName));
        }
        if (turn.expect === 'table' || turn.expect === 'table_and_cup')
            assert.equal(candidate.entityStates[f.tableId].interactableState, 'overturned',
                `${category}/${i} table state`);
        if (turn.expect === 'table_and_cup')
            assert.equal(candidate.entityStates[f.cupId].interactableState, 'broken',
                `${category}/${i} cup state`);
        if (turn.expect === 'book') {
            assert.equal(candidate.entityStates[f.bookId].interactableState, 'illustrated',
                `${category}/${i} sketchbook state`);
            assert(inventory.includes(f.itemName), `${category}/${i} drawing consumed its tool`);
        }
        assert.equal(candidate.playerLocation,
            turn.expect === 'travel' ? f.destination : 'foyer', `${category}/${i} location`);
        await result.working.commit(async saved => {
            assert.deepEqual(saved.session, candidate, `${category}/${i} persistence candidate`);
        });
        assert.deepEqual(f.session, candidate, `${category}/${i} commit mismatch`);
        passed++;
    }
    assert.equal(passed, scenarios.length * 10);
    const sequence = makeWorld(4);
    for (const [step, category] of [5, 7, 6].entries()) {
        const turn = scenarios[category](sequence, 4);
        const proposal = { protocol: 'scene_draft_v3', actions: turn.actions };
        const bound = binding.bind(proposal, { turnId: `turn_sequence_${step}`,
            input: turn.input, now: 480, references: sequence.world.entities.concat(sequence.world.locations) },
        canonical);
        assert(bound.ok, `sequence ${step}: ${JSON.stringify(bound.errors)}`);
        const compiled = scene.compile(bound.draft, { input: turn.input, location: 'foyer',
            playerStart: 'foyer', present: [sequence.npcId, sequence.rivalId],
            actors: [{ id: sequence.npcId, name: sequence.npcName },
                { id: sequence.rivalId, name: sequence.rivalName }],
            locations: ['foyer', sequence.destination], now: 480,
            linkedRequired: true, contract: canonical });
        assert(compiled.ok, `sequence ${step}: ${JSON.stringify(compiled.errors)}`);
        const executed = linked.executeLinkedActions(compiled.linkedPlan,
            sequence.world, sequence.session, { worldActionIds: bound.binding.worldActionIds,
                requireEffectWitnesses: true });
        assert(executed.ok, `sequence ${step}: ${JSON.stringify(executed.errors)}`);
        await executed.working.commit(async () => {});
        const playerHasItem = sequence.session.inventory.some(item =>
            typeof item === 'string' ? item === sequence.itemName : item.name === sequence.itemName);
        assert.equal(playerHasItem, step !== 1, `sequence ${step}: wrong owner`);
        assert.equal((sequence.session.entityStates[sequence.npcId].inventory || [])
            .includes(sequence.itemName), step === 1, `sequence ${step}: NPC stock`);
    }
    console.log(`PASS ${passed} distinct bound World turns across 10 genres and ${scenarios.length} action categories`);
})().catch(error => { console.error(error); process.exitCode = 1; });
