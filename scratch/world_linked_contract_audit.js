'use strict';
const assert = require('node:assert/strict');
const { compile, schema } = require('../worlds/scene-draft');
const { executeLinkedActions } = require('../worlds/linked-world-actions');

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
assert(compile({ ...singleAction,
    events: [{ ...singleAction.events[0], action_id: 'unknown' }] },
{ ...context, input: singleActionInput, linkedRequired: true }).errors
    .some(error => error.reason === 'unknown_action_reference'),
    'an explicitly wrong reference is still rejected');
const dialogueInput = '*narrows his golden eyes* "Are we engaging in amph\"ibian body shaming now? Rather bold, I must say."';
assert.equal(require('../worlds/scene-draft').simpleRequest(dialogueInput), false);
const dialogue = { protocol: 'scene_draft_v3',
    narrative: [{ id: 'reply', action_id: 'speak', text: 'The dragon answers.' }],
    actions: [{ action_id: 'speak', request: dialogueInput, kind: 'speech',
        status: 'resolved', response_id: 'reply', action_effects: {} }],
    events: [{ type: 'dialogue', actor_id: 'player', status: 'completed',
        passage_id: 'reply' }], effects: {}, speech: [], commitments: [] };
const dialogueContract = schema({ events: { type: 'array', items: { type: 'object',
    properties: { type: { type: 'string' }, actor_id: { type: 'string' },
        status: { type: 'string' } } } } }, 'scene_draft_v3',
{ input: dialogueInput, linkedRequired: true });
const dialogueContext = { ...context, input: dialogueInput, linkedRequired: true,
    contract: dialogueContract };
const linkedDialogue = compile(dialogue, dialogueContext);
assert(linkedDialogue.ok, JSON.stringify(linkedDialogue.errors));
assert.equal(linkedDialogue.linkedPlan.events[0].action_id, 'speak');
assert.equal(linkedDialogue.repairs[0].type, 'event_action_id');
assert.equal(dialogue.events[0].action_id, undefined, 'do not mutate model output');
const dialogueTurn = executeLinkedActions(linkedDialogue.linkedPlan,
    { id: 'test_world', entities: [], locations: [{ id: 'hall', name: 'Hall', exits: [] }] },
    { id: 'test_session', playerLocation: 'hall', inventory: [], entityStates: {},
        locationStates: {}, npcRelationships: {}, engineEvents: [], worldStateVersion: 1 });
assert(dialogueTurn.ok, JSON.stringify(dialogueTurn.errors));
assert(compile({ ...dialogue, events: [{ ...dialogue.events[0], action_id: 'unknown' }] },
    dialogueContext).errors.some(error => error.reason === 'unknown_action_reference'),
    'explicitly wrong dialogue links remain rejected');
assert(compile({ ...dialogue, events: [{ ...dialogue.events[0], passage_id: 'missing' }] },
    dialogueContext).errors.some(error => error.reason === 'unknown_action_reference'),
    'a passage that does not exist cannot establish ownership');
const splitInput = 'I narrow my eyes. "Are we engaging in body shaming?"';
const splitDialogue = { ...dialogue,
    narrative: [{ id: 'gesture', action_id: 'narrow', text: 'You narrow your eyes.' },
        { id: 'reply', action_id: 'speak', text: 'The dragon answers.' }],
    actions: [{ action_id: 'narrow', request: 'I narrow my eyes.', kind: 'physical',
        status: 'resolved', response_id: 'gesture', action_effects: {} },
    { ...dialogue.actions[0], request: '"Are we engaging in body shaming?"' }] };
const splitCompiled = compile(splitDialogue, { ...context, input: splitInput, linkedRequired: true });
assert(splitCompiled.ok, JSON.stringify(splitCompiled.errors));
assert.equal(splitCompiled.linkedPlan.events[0].action_id, 'speak',
    'the dialogue passage selects speech, not the earlier physical action');
const ambiguousDialogue = { ...dialogue,
    actions: [dialogue.actions[0], { ...dialogue.actions[0], action_id: 'other', response_id: 'reply' }] };
assert(compile(ambiguousDialogue, dialogueContext).errors.some(error =>
    error.reason === 'unknown_action_reference'),
    'two actions claiming one passage cannot silently own a dialogue event');
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
