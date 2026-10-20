'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const scene = require('../worlds/scene-draft');
const binding = require('../worlds/turn-binding');
const linked = require('../worlds/linked-world-actions');

// Complete Aslan shoulder reply from the existing browser audit.
const aslanInput = `Aslan considers the options for a moment, his golden eyes gleaming with amusement.

"The shoulder, I think. I've spent quite enough time sitting on a stone, and exchanging a view of the road for the inside of a pocket seems a rather questionable improvement."

"Now then, my good fellow, would you mind lending me a hand? These legs of mine are better suited to dignified sitting than heroic climbing."`;
const eventFields = Object.fromEntries(['type', 'actor_id', 'status', 'action', 'item', 'outfit',
    'from_location_id', 'to_location_id', 'activity', 'condition', 'next_status',
    'target_id'].map(key => [key, { type: 'string', maxLength: 1000 }]));
const canonical = scene.schema({ events: { type: 'array', items: { type: 'object',
    properties: eventFields, required: ['type', 'actor_id', 'status'] } } },
'scene_draft_v3', { linkedRequired: true });
const context = { turnId: 'turn_aslan_shoulder', now: 485 };
const world = { id: 'test', locations: [{ id: 'stone', exits: [{ targetLocationId: 'path' }] },
    { id: 'path', exits: [{ targetLocationId: 'stone' }] }],
entities: [{ id: 'lorne', type: 'npc', name: 'Lorne' },
    { id: 'aslan', type: 'npc', name: 'Aslan' }] };
const initial = { id: 'test_save', playerLocation: 'stone', turnCount: 2, inventory: [],
    entityStates: { lorne: { location: 'stone' }, aslan: { location: 'stone' } },
    locationStates: {}, npcRelationships: {}, engineEvents: [], worldStateVersion: 1,
    worldClock: { absoluteMinutes: 485, turnCount: 2, bonusTimeMinutes: 0 } };
const action = (kind, text, effects = []) => ({ kind, status: 'resolved', effects,
    response: [{ text }] });
const proposal = (actions, reactions = []) => ({ protocol: 'scene_draft_v3', actions, reactions });

function run(draft, input, options = {}) {
    const bound = binding.bind(draft, { ...context, input }, canonical);
    if (!bound.ok) return { bound };
    const compiled = scene.compile(bound.draft, { input, location: 'stone', playerStart: 'stone',
        present: ['lorne', 'aslan'], locations: ['stone', 'path'], now: 485,
        commitments: [], linkedRequired: true, contract: canonical });
    assert(compiled.ok, JSON.stringify(compiled.errors));
    const session = structuredClone(options.session || initial);
    const executed = linked.executeLinkedActions(compiled.linkedPlan, options.world || world, session,
        { worldActionIds: bound.binding.worldActionIds, requireEffectWitnesses: true });
    return { bound, compiled, executed, session };
}

test('complete Aslan dialogue: an unsupported relationship effect is not committed', () => {
    const draft = proposal([action('gesture', 'Lorne offers his hand to Aslan.',
        { relation_set: [{ subject_id: 'lorne', target_id: 'aslan', value: 50 }] })]);
    assert.deepEqual(binding.validate(draft, binding.schema(canonical)), []);
    const result = run(draft, aslanInput);
    assert(result.bound.ok, JSON.stringify(result.bound.errors));
    assert.equal(result.bound.draft.actions[0].request, aslanInput);
    assert.equal(result.executed.ok, false);
    assert.equal(result.executed.errors[0].reason, 'unwitnessed_action_effect');
    assert.deepEqual(result.session.npcRelationships, {});
    const repaired = structuredClone(draft);
    repaired.actions[0].effects = [];
    assert.deepEqual(binding.repairLosses(result.executed.verifiedEffects,
        repaired, canonical, draft), [], 'an unverified effect may be removed in repair');
});

test('the same unsupported effect is rejected even when labelled speech', () => {
    const result = run(proposal([action('speech', 'Lorne offers his hand to Aslan.',
        { relation_set: [{ subject_id: 'lorne', target_id: 'aslan', value: 50 }] })]), aslanInput);
    assert(result.bound.ok, JSON.stringify(result.bound.errors));
    assert.equal(result.executed.ok, false);
    assert.equal(result.executed.errors[0].reason, 'unwitnessed_action_effect');
});

test('a gesture label cannot discard a witnessed player outfit change', () => {
    const effects = { outfit_set: [{ actor_id: 'player', outfit: 'red cloak' }] };
    const dressed = action('gesture', 'The red cloak settles around you.', effects);
    dressed.response[0].events = [{ type: 'outfit', actor_id: 'player',
        status: 'completed', outfit: 'red cloak' }];
    const result = run(proposal([dressed]), 'I put on the red cloak.');
    assert(result.bound.ok, JSON.stringify(result.bound.errors));
    assert(result.executed.ok, JSON.stringify(result.executed.errors));
    assert.deepEqual(result.bound.draft.actions[0].action_effects, effects);
    assert.equal(result.executed.working.prepare().session.outfit, 'red cloak');
    assert.equal(result.executed.verifiedEffects[0].effects[0].type, 'outfit_set');
    const dropped = proposal([action('speech', 'The cloak settles around you.')]);
    assert.equal(binding.repairLosses(result.executed.verifiedEffects,
        dropped, canonical)[0].reason, 'repair_dropped_verified_effect');
    const earlierPhysical = structuredClone(proposal([dressed]));
    earlierPhysical.actions[0].kind = 'physical';
    assert.deepEqual(binding.repairLosses(result.executed.verifiedEffects,
        proposal([dressed]), canonical, earlierPhysical), [],
    'relabeling does not invalidate an unchanged, verified effect');
    const unchanged = run(proposal([dressed]), 'I put on the red cloak.',
        { session: { ...initial, outfit: 'red cloak' } });
    assert(unchanged.executed.ok);
    assert.deepEqual(unchanged.executed.verifiedEffects, [],
        'a matching model event without an actual state change grants no repair protection');
    for (const eventChange of [{ outfit: 'blue cloak' }, { actor_id: 'lorne' }]) {
        const contradicted = structuredClone(dressed);
        Object.assign(contradicted.response[0].events[0], eventChange);
        const invalid = run(proposal([contradicted]), 'I put on the red cloak.');
        assert.equal(invalid.executed.ok, false);
        assert.equal(invalid.executed.errors[0].reason, 'unwitnessed_action_effect');
        assert.equal(invalid.session.outfit, undefined, 'the candidate state rolls back');
    }
});

test('mixed actions keep separate requests, events and the valid effect', () => {
    const input = 'I put on the red cloak. I nod.';
    const dressed = action('physical', 'The red cloak settles around you.',
        { outfit_set: [{ actor_id: 'player', outfit: 'red cloak' }] });
    dressed.request = 'I put on the red cloak.';
    dressed.response[0].events = [{ type: 'outfit', actor_id: 'player',
        status: 'completed', outfit: 'red cloak' }];
    const nod = action('gesture', 'Lorne returns the nod.');
    nod.request = 'I nod.';
    const result = run(proposal([dressed, nod]), input);
    assert(result.bound.ok, JSON.stringify(result.bound.errors));
    assert(result.executed.ok, JSON.stringify(result.executed.errors));
    assert.deepEqual(result.bound.draft.actions.map(item => item.request),
        ['I put on the red cloak.', 'I nod.']);
    assert.deepEqual(result.bound.draft.events.map(item => item.action_id),
        result.bound.draft.actions.map(item => item.action_id));
    assert.equal(result.executed.verifiedEffects.length, 1);
});

test('an independent NPC reaction retains its own witnessed effect', () => {
    const reaction = { text: 'Lorne steps onto the path.',
        effects: { actor_move: [{ actor_id: 'lorne', to_location_id: 'path' }] },
        events: [{ type: 'movement', actor_id: 'lorne', status: 'completed',
            from_location_id: 'stone', to_location_id: 'path' }] };
    const result = run(proposal([action('speech', 'Lorne considers the request.')],
        [reaction]), aslanInput);
    assert(result.bound.ok, JSON.stringify(result.bound.errors));
    assert(result.executed.ok, JSON.stringify(result.executed.errors));
    assert.equal(result.executed.verifiedEffects[0].source, 'reaction');
    assert.equal(result.executed.working.prepare().session.entityStates.lorne.location, 'path');
    assert.equal(result.session.entityStates.lorne.location, 'stone');
    const missingEvent = structuredClone(reaction);
    delete missingEvent.events;
    const rejected = run(proposal([action('speech', 'Lorne considers the request.')],
        [missingEvent]), aslanInput);
    assert.equal(rejected.executed.errors[0].reason, 'unwitnessed_world_effect');
});

test('a failed prerequisite skips a later witnessed effect without protecting it', () => {
    const attempt = { kind: 'physical', status: 'attempted', request: 'I try the latch; ',
        effects: [], response: [{ text: 'The latch does not yield.' }] };
    const later = action('physical', 'The red cloak settles around you.',
        { outfit_set: [{ actor_id: 'player', outfit: 'red cloak' }] });
    later.request = 'if it opens, I put on the red cloak.';
    later.depends_on = [{ action_index: 0, outcome: 'succeeded' }];
    later.response[0].events = [{ type: 'outfit', actor_id: 'player',
        status: 'completed', outfit: 'red cloak' }];
    const result = run(proposal([attempt, later]),
        'I try the latch; if it opens, I put on the red cloak.');
    assert(result.bound.ok, JSON.stringify(result.bound.errors));
    assert(result.executed.ok, JSON.stringify(result.executed.errors));
    assert.deepEqual([...result.executed.outcomes.values()], ['failed', 'skipped']);
    assert.equal(result.executed.working.prepare().session.outfit, undefined);
    assert.deepEqual(result.executed.verifiedEffects, []);
});
