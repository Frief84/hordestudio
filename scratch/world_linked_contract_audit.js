'use strict';
const assert = require('node:assert/strict');
const { compile, schema } = require('../worlds/scene-draft');

const context = { input: 'I take the key and open the gate.', location: 'hall', playerStart: 'hall',
    present: [], locations: ['hall'], now: 100, commitments: [], effectKeys: ['inventory_add'] };
const draft = { protocol: 'scene_draft_v3',
    narrative: [
        { id: 'p1', action_id: 'take_key', text: 'You take the key.' },
        { id: 'p2', action_id: 'open_gate', text: 'The gate opens.' }
    ],
    actions: [
        { action_id: 'take_key', request: 'I take the key ', kind: 'physical', status: 'resolved',
            response_id: 'p1', action_effects: { inventory_add: ['key'] } },
        { action_id: 'open_gate', request: 'and open the gate.', kind: 'physical', status: 'resolved',
            response_id: 'p2', depends_on: [{ action_id: 'take_key', outcome: 'succeeded' }] }
    ], events: [], effects: {}, speech: [], commitments: [] };
const reasons = value => compile(value, context).errors?.map(error => error.reason) || [];
const compiled = compile(draft, context);
assert(compiled.ok, JSON.stringify(compiled.errors));
assert.equal(compiled.linkedPlan.actions[1].depends_on[0].action_id, 'take_key');
assert(reasons({ ...draft, actions: [{ ...draft.actions[0], action_id: 'bad-ID' }, draft.actions[1]] })
    .includes('invalid_action_id'));
assert(reasons({ ...draft, actions: [draft.actions[0], { ...draft.actions[1], action_id: 'take_key' }] })
    .includes('duplicate_action_id'));
assert(reasons({ ...draft, actions: [draft.actions[0], { ...draft.actions[1], action_id: undefined }] })
    .includes('missing_action_id'));
assert(reasons({ ...draft, actions: [draft.actions[0], { ...draft.actions[1],
    depends_on: [{ action_id: 'absent', outcome: 'succeeded' }] }] })
    .includes('unknown_action_reference'));
assert(reasons({ ...draft, actions: [{ ...draft.actions[0],
    depends_on: [{ action_id: 'open_gate', outcome: 'succeeded' }] }, draft.actions[1]] })
    .includes('cyclic_action_dependency'));
for (const outcome of ['pending', 'unresolved', 'skipped'])
    assert(reasons({ ...draft, actions: [draft.actions[0], { ...draft.actions[1],
        depends_on: [{ action_id: 'take_key', outcome }] }] })
        .includes('unconfirmed_dependency_outcome'));
assert(reasons({ ...draft, events: [{ type: 'interaction', actor_id: 'player',
    status: 'completed', passage_id: 'p1' }] }).includes('unknown_action_reference'));
const singleActionInput = '*you smack her ass*';
const singleAction = { protocol: 'scene_draft_v3',
    narrative: [{ id: 'p1', text: 'You smack her ass; she reacts.' }],
    actions: [{ action_id: 'smack', kind: 'physical', status: 'resolved', response_id: 'p1',
        action_effects: {} }],
    events: [{ type: 'interaction', actor_id: 'player', status: 'completed',
        action: 'smack her ass', passage_id: 'p1' }],
    effects: {}, speech: [], commitments: [] };
const singleActionCompiled = compile(singleAction, { ...context, input: singleActionInput,
    linkedRequired: true });
assert(singleActionCompiled.ok, JSON.stringify(singleActionCompiled.errors));
assert.equal(singleActionCompiled.linkedPlan.events[0].action_id, 'smack',
    'a missing event link in a single simple action is assigned to its only possible action');
assert(reasons({ ...singleAction, events: [{ ...singleAction.events[0], action_id: 'unknown' }] })
    .includes('unknown_action_reference'), 'an explicitly wrong reference is still rejected');
assert(reasons({ ...draft, effects: { inventory_add: ['key'] } })
    .includes('unlinked_effects_in_linked_draft'));
const legacy = structuredClone(draft);
for (const action of legacy.actions) {
    delete action.action_id; delete action.action_effects; delete action.depends_on;
}
for (const passage of legacy.narrative) delete passage.action_id;
assert.equal(compile(legacy, context).linkedPlan, null, 'old ID-less V3 remains replayable');
const contract = schema({ events: { type: 'array', items: { type: 'object',
    properties: { type: { type: 'string' } } } }, inventory_add: { type: 'array' } },
    'scene_draft_v3', { input: context.input });
assert(contract.properties.actions.items.properties.action_id);
assert.deepEqual(contract.properties.actions.items.properties.depends_on.items.properties.outcome.enum,
    ['succeeded', 'failed', 'blocked']);
const linkedContract = schema({ events: { type: 'array', items: { type: 'object',
    properties: { type: { type: 'string' } } } }, inventory_add: { type: 'array' },
checks: { type: 'array' } }, 'scene_draft_v3', { input: context.input, linkedRequired: true });
assert.deepEqual(linkedContract.properties.effects.properties, {},
    'linked turns must not duplicate the legacy effect schema at top level');
assert(linkedContract.properties.actions.items.properties.action_effects.properties.inventory_add);
assert(linkedContract.properties.actions.items.properties.action_effects.properties.checks);
console.log('PASS linked action contract and legacy replay');
