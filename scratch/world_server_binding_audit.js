'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const scene = require('../worlds/scene-draft');
const binding = require('../worlds/turn-binding');
const linked = require('../worlds/linked-world-actions');
const turnContext = require('../worlds/turn-context');
const workingApi = require('../worlds/working-state');
const fields = Object.fromEntries(['type', 'actor_id', 'status', 'action', 'item', 'outfit',
    'from_location_id', 'to_location_id', 'activity', 'condition', 'next_status',
    'target_id', 'change', 'evidence']
    .map(key => [key, { type: 'string', maxLength: 1000 }]));
fields.change = { type: 'integer' };
const canonical = scene.schema({ events: { type: 'array', items: { type: 'object',
    properties: fields, required: ['type', 'actor_id', 'status'] } },
quests_update: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, title: { type: 'string' } }, additionalProperties: false } },
time_skip_minutes: { type: 'integer', minimum: 1 } }, 'scene_draft_v3',
{ linkedRequired: true });
const registeredEffects = canonical.properties.actions.items.properties.action_effects;
const boundContract = binding.schema(canonical);
assert.deepEqual(boundContract.properties.actions.items.properties.effects.anyOf[0], registeredEffects);
assert.deepEqual(boundContract.properties.reactions.items.properties.effects.anyOf[0], registeredEffects);
assert(!boundContract.properties.actions.items.properties.status.enum.includes('pending_check'),
    'a World without registered checks cannot propose pending_check');
const world = { id: 'test', locations: [{ id: 'stone', exits: [{ targetLocationId: 'path' }] },
    { id: 'path', exits: [{ targetLocationId: 'stone' }] }],
entities: [{ id: 'lorne', type: 'npc', name: 'Lorne' }] };
const initial = { id: 'test_save', playerLocation: 'stone', turnCount: 2, inventory: [],
    entityStates: { lorne: { location: 'stone' } }, locationStates: {},
    npcRelationships: {}, engineEvents: [], worldStateVersion: 1,
    worldClock: { absoluteMinutes: 485, turnCount: 2, bonusTimeMinutes: 0 } };
const context = { turnId: 'turn_stable', input: 'I nod.', now: 485 };
const dialogue = (text = 'Lorne inclines his head. "Good morning."') => ({ protocol: 'scene_draft_v3',
    actions: [{ kind: 'gesture', status: 'resolved', effects: [], response: [{ text }] }] });
function compile(proposal, custom = {}) {
    const bound = binding.bind(proposal, { ...context, ...custom }, canonical);
    assert(bound.ok, JSON.stringify(bound.errors));
    const compiled = scene.compile(bound.draft, { input: custom.input ?? context.input,
        location: 'stone', playerStart: 'stone', present: ['lorne'], locations: ['stone', 'path'],
        now: 485, commitments: custom.commitments || [], linkedRequired: true, contract: canonical });
    assert(compiled.ok, JSON.stringify(compiled.errors));
    const session = structuredClone(custom.session || initial);
    const executed = linked.executeLinkedActions(compiled.linkedPlan, world, session,
        { worldActionIds: bound.binding.worldActionIds });
    return { bound, compiled, executed, session };
}
async function main() {
    const danceInput = 'I ask Lorne to dance with me, then I dance beside him.';
    const swallowedDance = { protocol: 'scene_draft_v3', actions: [{
        kind: 'speech', status: 'resolved', request: danceInput, effects: [],
        response: [{ text: 'Lorne watches you.' }] }] };
    assert(binding.bind(swallowedDance, { ...context, input: danceInput,
        singleRequest: false }, canonical).errors.some(error =>
        error.reason === 'request_coverage_mismatch'),
    'a speech action cannot swallow a later physical player action');
    const mislabelledDance = { protocol: 'scene_draft_v3', actions: [{
        request: 'I dance beside Lorne.', kind: 'gesture', status: 'attempted',
        effects: [], response: [{ text: 'You begin to dance.' }] }] };
    assert(binding.bind(mislabelledDance, { ...context,
        input: 'I dance beside Lorne.' }, canonical).errors.some(error =>
        error.reason === 'player_action_kind_mismatch'),
    'an explicit dance is a physical player action');
    const swallowedQuestion = { protocol: 'scene_draft_v3', actions: [{
        request: 'I hold Lorne’s hands, then let go and ask whether he will dance.',
        kind: 'physical', status: 'resolved', effects: [],
        response: [{ text: 'Lorne smiles.' }] }] };
    assert(binding.bind(swallowedQuestion, { ...context,
        input: swallowedQuestion.actions[0].request, singleRequest: false }, canonical)
        .errors.some(error => error.reason === 'request_coverage_mismatch'),
    'a physical action cannot swallow a later spoken question with an implied player subject');
    const uncreditedReply = { protocol: 'scene_draft_v3', actions: [{
        kind: 'speech', status: 'resolved', effects: [], response: [{
            text: 'Lorne smiles. “Yes,” he says.' }] }] };
    assert(binding.bind(uncreditedReply, { ...context, input: 'I ask Lorne.',
        references: [{ id: 'lorne', name: 'Lorne', type: 'npc' }] }, canonical)
        .errors.some(error => error.reason === 'missing_speech_attribution'),
    'an NPC quote cannot be committed without a speaker attribution');
    const uncreditedDuo = structuredClone(uncreditedReply);
    uncreditedDuo.actions[0].response[0].text = 'Lorne says “Yes.” Mira says “Wait.”';
    assert(binding.bind(uncreditedDuo, { ...context, input: 'I ask both.',
        references: [{ id: 'lorne', name: 'Lorne', type: 'npc' },
            { id: 'mira', name: 'Mira', type: 'npc' }] }, canonical)
        .errors.some(error => error.reason === 'missing_speech_attribution'),
    'two named NPC quotes also require speaker evidence');
    const commaQuote = structuredClone(uncreditedReply);
    commaQuote.actions[0].response[0].text = 'Lorne says “Yes,” and waits.';
    commaQuote.actions[0].response[0].speech = [{ speaker: 'lorne',
        listeners: ['player'], quote: 'Yes.' }];
    const alignedQuote = binding.bind(commaQuote, { ...context, input: 'I ask Lorne.',
        references: [{ id: 'lorne', name: 'Lorne', type: 'npc' }] }, canonical);
    assert(alignedQuote.ok, JSON.stringify(alignedQuote.errors));
    assert.equal(alignedQuote.draft.speech[0].quote, 'Yes,');
    assert(alignedQuote.binding.repairs.some(item =>
        item.type === 'align_quote_terminal_punctuation'));
    const contractedQuote = structuredClone(commaQuote);
    contractedQuote.actions[0].response[0].text = "Lorne says 'I'm ready,' and waits.";
    contractedQuote.actions[0].response[0].speech[0].quote = "I'm ready.";
    const alignedContraction = binding.bind(contractedQuote, { ...context,
        input: 'I ask Lorne.', references: [{ id: 'lorne', name: 'Lorne', type: 'npc' }] }, canonical);
    assert(alignedContraction.ok, JSON.stringify(alignedContraction.errors));
    assert.equal(alignedContraction.draft.speech[0].quote, "I'm ready,");
    assert(binding.schema(canonical, { requireRequest: true }).properties.actions.items
        .required.includes('request'), 'compound turns require a request excerpt');
    const scalarResponse = { protocol: 'scene_draft_v3', actions: [{
        kind: 'speech', status: 'resolved', response: 'Lorne answers.',
        action_id: 'model_action', response_id: 'model_passage', effects: [] }] };
    const repairedScalar = binding.bind(scalarResponse,
        { ...context, input: 'Hello.', references: [{ id: 'lorne', name: 'Lorne' }] }, canonical);
    assert(repairedScalar.ok, JSON.stringify(repairedScalar.errors));
    assert.equal(repairedScalar.draft.narrative[0].text, 'Lorne answers.');
    assert(repairedScalar.binding.repairs.some(item => item.type === 'wrap_response_text'));
    assert(repairedScalar.binding.repairs.some(item => item.type === 'discard_engine_link'));
    assert.equal(scalarResponse.actions[0].response, 'Lorne answers.',
        'local normalization must not mutate the provider draft');
    const namedActor = dialogue('Lorne sits beside the fire.');
    namedActor.actions[0].response[0].events = [{ type: 'activity', actor_id: 'Lorne',
        status: 'completed', activity: 'sitting', passage_id: 'model_passage' }];
    const resolvedActor = binding.bind(namedActor,
        { ...context, references: [{ id: 'lorne', name: 'Lorne' }] }, canonical);
    assert(resolvedActor.ok, JSON.stringify(resolvedActor.errors));
    assert.equal(resolvedActor.draft.events[0].actor_id, 'lorne');
    assert.equal(resolvedActor.draft.events[0].passage_id, resolvedActor.draft.narrative[0].id);
    const ambiguousActor = binding.bind(namedActor, { ...context, references: [
        { id: 'lorne', name: 'Lorne' }, { id: 'lorne_other', name: 'Lorne' }
    ] }, canonical);
    assert(ambiguousActor.ok);
    assert.equal(ambiguousActor.draft.events[0].actor_id, 'Lorne',
        'ambiguous names must not be assigned an invented actor');
    const namedItem = { protocol: 'scene_draft_v3', actions: [{ kind: 'physical',
        status: 'resolved', response: [{ text: 'You take the bronze key.',
            events: [{ type: 'inventory', actor_id: 'player', status: 'completed',
                item: 'Bronze key' }] }],
        effects: { item_transfer: [{ item_id: 'Bronze key', from_id: 'Stone',
            to_id: 'player' }] } }] };
    const resolvedItem = binding.bind(namedItem, { ...context, input: 'I take the bronze key.',
        references: [{ id: 'key_1', name: 'Bronze key' }, { id: 'stone', name: 'Stone' }] }, canonical);
    assert(resolvedItem.ok, JSON.stringify(resolvedItem.errors));
    assert.deepEqual(resolvedItem.draft.actions[0].action_effects.item_transfer,
        [{ item_id: 'key_1', from_id: 'stone', to_id: 'player' }]);
    const ownedItemFact = { protocol: 'scene_draft_v3', actions: [{
        kind: 'physical', status: 'attempted', effects: [],
        state_conditions: [{ fact: 'actor_at', subject_id: 'cuffs',
            operator: 'equals', target_id: 'player' }],
        response: [{ text: 'You reach for the handcuffs.' }] }] };
    const ownedItemBound = binding.bind(ownedItemFact, { ...context,
        input: 'I reach for the handcuffs.', references: [{ id: 'cuffs',
            name: 'Steel handcuffs', type: 'item' }] }, canonical);
    assert(ownedItemBound.ok, JSON.stringify(ownedItemBound.errors));
    assert.deepEqual(ownedItemBound.draft.actions[0].state_conditions[0], {
        fact: 'has_item', subject_id: 'player', operator: 'equals',
        value: 'Steel handcuffs' });
    const ambiguousOwnedItem = binding.bind(ownedItemFact, { ...context,
        input: 'I reach for the handcuffs.', references: [
            { id: 'cuffs', name: 'Steel handcuffs', type: 'item' },
            { id: 'cuffs_2', name: 'Steel handcuffs', type: 'item' }] }, canonical);
    assert.equal(ambiguousOwnedItem.draft.actions[0].state_conditions[0].fact, 'actor_at',
        'duplicate item names cannot be converted to an ownership fact');
    const verifiedNamedTransfer = [{ source: 'player', action_id: 'turn_stable_action_0',
        request: 'I take the bronze key.', effects: [{ type: 'item_transfer',
            payload: { item_id: 'key_1', from_id: 'stone', to_id: 'player' } }] }];
    assert.deepEqual(binding.repairLosses(verifiedNamedTransfer, namedItem, canonical,
        null, 'I take the bronze key.', [
            { id: 'key_1', name: 'Bronze key' }, { id: 'stone', name: 'Stone' }]), [],
    'a repair using unambiguous display names must preserve an ID-verified transfer');
    assert.equal(binding.repairLosses(verifiedNamedTransfer, namedItem, canonical,
        null, 'I take the bronze key.', [
            { id: 'key_1', name: 'Bronze key' }, { id: 'key_2', name: 'Bronze key' },
            { id: 'stone', name: 'Stone' }]).length, 1,
    'ambiguous item names cannot replace a verified object identity');
    const postconditionPickup = structuredClone(namedItem);
    postconditionPickup.actions[0].state_conditions = [{ fact: 'has_item',
        subject_id: 'player', operator: 'equals', value: 'Bronze key' }];
    const cleanedPickup = binding.bind(postconditionPickup, { ...context,
        input: 'I take the bronze key.', references: [
            { id: 'key_1', name: 'Bronze key' }, { id: 'stone', name: 'Stone' }] }, canonical);
    assert(cleanedPickup.ok, JSON.stringify(cleanedPickup.errors));
    assert.equal(cleanedPickup.draft.actions[0].state_conditions, undefined,
        'an item gained by this effect is not a precondition for that effect');
    assert(cleanedPickup.binding.repairs.some(item => item.type === 'discard_effect_postcondition'));
    const heldKey = { protocol: 'scene_draft_v3', actions: [{ kind: 'physical',
        status: 'resolved', response: [{ text: 'You hold your bronze key ready.' }], effects: [] }] };
    const heldKeyBinding = binding.bind(heldKey, { ...context,
        input: 'I take my bronze key.', references: [{ id: 'key_1', name: 'Bronze key' }] }, canonical);
    assert(heldKeyBinding.ok, JSON.stringify(heldKeyBinding.errors));
    const priorOwnership = structuredClone(postconditionPickup);
    priorOwnership.actions[0].effects.item_transfer[0].from_id = 'player';
    priorOwnership.actions[0].effects.item_transfer[0].to_id = 'lorne';
    const retainedGuard = binding.bind(priorOwnership, { ...context,
        input: 'I give the bronze key.', references: [
            { id: 'key_1', name: 'Bronze key' }, { id: 'lorne', name: 'Lorne' }] }, canonical);
    assert(retainedGuard.ok, JSON.stringify(retainedGuard.errors));
    assert.equal(retainedGuard.draft.actions[0].state_conditions.length, 1,
        'ownership before giving an item remains a meaningful guard');
    const placeholderDraft = structuredClone(namedItem);
    placeholderDraft.actions.push(...Array.from({ length: 31 }, () => ({ kind: 'physical',
        status: 'resolved', effects: [], response: [{ text: '.' }] })));
    const trimmedPlaceholders = binding.bind(placeholderDraft, { ...context,
        input: 'I take the bronze key.', references: [
            { id: 'key_1', name: 'Bronze key', type: 'item' },
            { id: 'stone', name: 'Stone', type: 'location' }] }, canonical);
    assert(trimmedPlaceholders.ok, JSON.stringify(trimmedPlaceholders.errors));
    assert.equal(trimmedPlaceholders.draft.actions.length, 1);
    assert(trimmedPlaceholders.binding.repairs.some(item =>
        item.type === 'discard_empty_action_placeholders'));
    const repeatedConsequence = structuredClone(namedItem);
    repeatedConsequence.actions.push({ kind: 'physical', status: 'resolved', effects: [],
        response: [{ text: 'The bronze key is now in your possession.' }] });
    const mergedConsequence = binding.bind(repeatedConsequence, { ...context,
        singleRequest: true, input: 'I take the bronze key.', references: [
            { id: 'key_1', name: 'Bronze key', type: 'item' },
            { id: 'stone', name: 'Stone', type: 'location' }] }, canonical);
    assert(mergedConsequence.ok, JSON.stringify(mergedConsequence.errors));
    assert.equal(mergedConsequence.draft.actions.length, 1);
    assert.equal(mergedConsequence.draft.narrative.length, 2);
    assert(mergedConsequence.binding.repairs.some(item =>
        item.type === 'merge_single_request_continuation'));
    assert(binding.bind(repeatedConsequence, { ...context,
        singleRequest: false, input: 'I take the bronze key.' }, canonical).errors.some(item =>
        item.reason === 'request_coverage_mismatch'),
    'compound or unverified requests still need explicit part coverage');
    const missingStatus = structuredClone(scalarResponse);
    delete missingStatus.actions[0].status;
    assert(binding.bind(missingStatus, context, canonical).errors.some(item =>
        item.reason === 'missing_bound_field' && item.detail === 'actions.0.status'));
    const unsupportedField = structuredClone(scalarResponse);
    unsupportedField.actions[0].unknown = 'value';
    assert(binding.bind(unsupportedField, context, canonical).errors.some(item =>
        item.reason === 'unsupported_bound_field' && item.detail === 'actions.0.unknown'));
    const aslan = `Aslan slowly raises his head, his faintly glowing golden eyes settling on the traveller.
"How observant. And here I was, hoping to pass for a particularly handsome pebble."
He shifts slightly on his sun-warmed stone.
"Tell me, traveller, do you often stop to insult the local wildlife, or am I receiving special treatment?"`;
    for (const input of ['Hi.', aslan, 'Tell me your story. '.repeat(180)]) {
        const proposal = dialogue('Lorne leans on his staff. "Special treatment, naturally. Most pebbles are less conversational."');
        proposal.actions[0].kind = 'speech';
        const result = compile(proposal, { input });
        assert(result.executed.ok, JSON.stringify(result.executed.errors));
        assert.deepEqual(result.compiled.commitments, []);
        assert.deepEqual(result.compiled.receipt.state_updates, {});
    }
    const gestures = compile(dialogue());
    assert(gestures.executed.ok, JSON.stringify(gestures.executed.errors));
    assert.equal(gestures.bound.draft.events[0].action_id, gestures.bound.draft.actions[0].action_id,
        'events.0.action_id is supplied by the host');
    for (const input of ['I walk toward the refrigerator.', 'Ich gehe zum Kühlschrank.',
        'I look out of the window.', 'Ich schaue aus dem Fenster.']) {
        const proposal = dialogue('You remain in the same room and notice the light outside.');
        proposal.actions[0].kind = input.includes('look') || input.includes('schaue')
            ? 'observation' : 'gesture';
        const result = compile(proposal, { input });
        assert(result.executed.ok, `${input}: ${JSON.stringify(result.executed.errors)}`);
        assert.equal(result.session.playerLocation, 'stone');
    }
    for (const [input, activity] of [
        ['Ich setze mich hin.', 'sitting'], ['I sit down.', 'sitting'],
        ['Ich stehe wieder auf.', 'standing'], ['I stand up.', 'standing']
    ]) {
        const proposal = { protocol: 'scene_draft_v3', actions: [{ kind: 'physical',
            status: 'resolved', effects: [], response: [{ text: `${activity} beside the table.`,
                events: [{ type: 'activity', actor_id: 'player', status: 'completed', activity }] }] }] };
        const result = compile(proposal, { input });
        assert(result.executed.ok, `${input}: ${JSON.stringify(result.executed.errors)}`);
        assert(result.executed.verifiedEvents.some(event => event.type === 'activity'
            && event.actor_id === 'player' && event.activity === activity));
        assert.equal(result.session.playerLocation, 'stone');
    }
    const unsupportedPickup = { protocol: 'scene_draft_v3', actions: [{ kind: 'physical',
        status: 'resolved', effects: [], response: [{ text: 'You pocket the cup.' }] }] };
    const pickupResult = compile(unsupportedPickup, { input: 'I take the cup.' });
    assert(pickupResult.executed.errors.some(error => error.reason === 'unverified_action_success'),
        'narration alone cannot prove an inventory transfer');
    const typo = compile(dialogue('Lorne considers the request.'),
        { input: 'Ich frgae Lorne nach dem Weg.' });
    assert(typo.executed.ok, 'one action retains the exact typo-containing player request');
    const combinedLocal = { protocol: 'scene_draft_v3', actions: [
        { request: 'Ich setze mich hin und ', kind: 'physical', status: 'resolved', effects: [],
            response: [{ text: 'You sit down.', events: [{ type: 'activity', actor_id: 'player',
                status: 'completed', activity: 'sitting' }] }] },
        { request: 'frage Lorne nach dem Weg.', kind: 'question', status: 'answered', effects: [],
            response: [{ text: 'Lorne points toward the path.' }] }
    ] };
    const combinedResult = compile(combinedLocal,
        { input: 'Ich setze mich hin und frage Lorne nach dem Weg.' });
    assert(combinedResult.executed.ok, JSON.stringify(combinedResult.executed.errors));
    assert.equal(combinedResult.executed.outcomes.size, 2);
    const answered = dialogue('Lorne says the map is in the archive.');
    answered.actions[0].kind = 'question'; answered.actions[0].status = 'answered';
    const answeredTurn = compile(answered, { input: 'Where is the map?' });
    assert(answeredTurn.executed.ok);
    assert.equal(answeredTurn.executed.outcomes.get(answeredTurn.bound.draft.actions[0].action_id), 'succeeded');
    assert.match(answeredTurn.executed.narrative, /archive/);
    const deferred = dialogue('Lorne says he does not know where the map is.');
    deferred.actions[0].kind = 'question'; deferred.actions[0].status = 'needs_clarification';
    const deferredTurn = compile(deferred, { input: 'Where is the map?' });
    assert(deferredTurn.executed.ok);
    assert.equal(deferredTurn.executed.outcomes.get(deferredTurn.bound.draft.actions[0].action_id),
        'unresolved', 'an unanswered question is not a confirmed answer');
    const irrelevant = dialogue('The curtains are blue.');
    irrelevant.actions[0].kind = 'question'; irrelevant.actions[0].status = 'answered';
    const irrelevantTurn = compile(irrelevant, { input: 'Where is the map?' });
    assert(irrelevantTurn.executed.ok,
        'the engine confirms structure and state, not arbitrary free-language relevance');
    assert(!/map|archive/u.test(irrelevantTurn.executed.narrative),
        'fixture oracle, unlike structural validation, detects this missing answer');
    const spoken = dialogue('You say: "The bridge is out." Lorne listens.');
    spoken.actions[0].kind = 'speech';
    spoken.actions[0].response[0].speech = [{ speaker: 'player', listeners: ['lorne'] }];
    const observed = compile(spoken, { input: '"The bridge is out."' });
    assert(observed.executed.ok, JSON.stringify(observed.executed.errors));
    assert.equal(observed.compiled.speech[0].statement, 'The bridge is out.',
        'only spoken words may enter NPC testimony from a mixed passage');
    const twoSpeakers = dialogue('Lorne says "Wait here." You see the door move. You answer "All right."');
    twoSpeakers.actions[0].kind = 'speech';
    twoSpeakers.actions[0].response[0].speech = [
        { speaker: 'lorne', listeners: ['player'], quote: 'Wait here.' },
        { speaker: 'player', listeners: ['lorne'], quote: 'All right.' }
    ];
    const attributed = compile(twoSpeakers, { input: 'I answer Lorne.' });
    assert(attributed.executed.ok, JSON.stringify(attributed.executed.errors));
    assert.deepEqual(attributed.compiled.speech.map(item => item.statement),
        ['Wait here.', 'All right.']);
    assert.deepEqual(attributed.compiled.linkedPlan.speech.map(item => item.statement),
        ['Wait here.', 'All right.']);
    assert(!attributed.compiled.speech.some(item => item.statement.includes('door move')),
        'observation prose must never become speaker testimony');
    const unsupportedSpeech = dialogue('Lorne watches the closed door.');
    unsupportedSpeech.actions[0].response[0].speech = [{ speaker: 'player', listeners: ['lorne'] }];
    assert(binding.bind(unsupportedSpeech, { ...context, input: 'I watch the door.' }, canonical)
        .errors.some(error => error.reason === 'missing_speech_quote'),
    'observation prose without a direct quote cannot prove player speech');
    const invitation = { protocol: 'scene_draft_v3', actions: [{ kind: 'speech',
        status: 'resolved', response: [{ text: 'You invite Lorne along.' }], effects: [] }],
    reactions: [{ text: 'Lorne says "Yes, I will come."',
        speech: [{ speaker: 'lorne', listeners: ['player'], quote: 'Yes, I will come.' }],
        effects: { npc_follow: [{ actor_id: 'lorne', following: true }] },
        events: [{ type: 'escort', actor_id: 'lorne', target_id: 'player',
            action: 'join', status: 'completed' }] }] };
    const invited = compile(invitation, { input: 'I ask Lorne to come.' });
    assert(invited.executed.ok, JSON.stringify(invited.executed.errors));
    assert.equal(invited.executed.working.getEntity('lorne').state.followingPlayer, true);
    const conditionalJourney = structuredClone(invitation);
    conditionalJourney.actions[0].request = 'I ask Lorne to come.';
    conditionalJourney.actions.push({ kind: 'travel', status: 'resolved',
        request: 'I walk to the path.',
        state_conditions: [{ fact: 'following_player', subject_id: 'lorne',
            operator: 'equals', value: 'true' }],
        effects: { actor_move: [{ actor_id: 'player', to_location_id: 'path',
            companion_ids: ['lorne'] }] },
        response: [{ text: 'You and Lorne walk to the path.', events: [
            { type: 'movement', actor_id: 'player', status: 'completed',
                from_location_id: 'stone', to_location_id: 'path' },
            { type: 'movement', actor_id: 'lorne', status: 'completed',
                from_location_id: 'stone', to_location_id: 'path' }] }] });
    conditionalJourney.reactions[0].after_action_index = 0;
    const journey = compile(conditionalJourney,
        { input: 'I ask Lorne to come. I walk to the path.' });
    assert(journey.executed.ok, JSON.stringify(journey.executed.errors));
    assert.deepEqual(journey.bound.draft.actions.map(item => item.action_id),
        ['turn_stable_action_0', 'turn_stable_world_0', 'turn_stable_action_1']);
    assert.equal(journey.executed.working.getEntity('lorne').state.location, 'path');
    assert.equal(journey.executed.working.getSession('playerLocation'), 'path');
    const refusal = structuredClone(conditionalJourney);
    refusal.reactions[0] = { text: 'Lorne says "I cannot come."',
        after_action_index: 0,
        speech: [{ speaker: 'lorne', listeners: ['player'], quote: 'I cannot come.' }],
        effects: [] };
    refusal.actions[1].request = 'I walk to the path if he agrees.';
    refusal.actions[1].status = 'blocked';
    refusal.actions[1].effects = [];
    refusal.actions[1].response = [{ text: 'You remain in the room because Lorne declines.' }];
    const declined = compile(refusal,
        { input: 'I ask Lorne to come. I walk to the path if he agrees.' });
    assert(declined.executed.ok, JSON.stringify(declined.executed.errors));
    assert.equal(declined.executed.working.getSession('playerLocation'), 'stone');
    assert.equal(declined.executed.working.getEntity('lorne').state.followingPlayer, undefined);
    assert.equal(declined.executed.outcomes.get('turn_stable_action_1'), 'blocked');
    assert(observed.executed.events.some(event => event.type === 'observation'
        && event.actor_id === 'lorne' && event.action_id === observed.bound.draft.actions[0].action_id),
    'derived NPC knowledge is kept in the linked receipt and cannot be treated as neutral');
    const conflictingEvent = dialogue('Lorne keeps working at the desk.');
    conflictingEvent.reactions = [{ text: 'Lorne keeps working at the desk.',
        events: [{ type: 'activity', actor_id: 'lorne', status: 'completed',
            activity: 'working at the desk', next_status: 'dead' }] }];
    const conflictingBound = binding.bind(conflictingEvent, context, canonical);
    assert(conflictingBound.ok, JSON.stringify(conflictingBound.errors));
    const conflictingCompiled = scene.compile(conflictingBound.draft, { input: context.input,
        location: 'stone', playerStart: 'stone', present: ['lorne'], locations: ['stone', 'path'],
        now: 485, commitments: [], linkedRequired: true, contract: canonical });
    assert(conflictingCompiled.errors.some(error => error.reason === 'event_field_type_conflict'),
        'a lifecycle change cannot be hidden inside an activity event');
    const droppedObservation = observed.compiled.receipt.events.filter(event => event.type !== 'observation');
    assert(binding.repairEventLosses(observed.executed.verifiedEvents, droppedObservation).length,
        'a verified NPC observation cannot be silently removed from a repair');
    const clarify = dialogue('Lorne asks which road you mean.');
    clarify.actions[0].kind = 'travel'; clarify.actions[0].status = 'needs_clarification';
    const clarification = compile(clarify, { input: 'I go there.' });
    assert(clarification.executed.ok);
    assert.match(clarification.executed.narrative, /which road/,
        'a clarification is a valid world reaction and must not disappear');
    const double = { protocol: 'scene_draft_v3', actions: [
        { kind: 'speech', status: 'resolved', request: 'First. ', effects: [], response: [{ text: 'Yes.' }] },
        { kind: 'speech', status: 'resolved', request: 'Second.', effects: [], response: [{ text: 'Yes.' }] }
    ] };
    const shared = compile(double, { input: 'First. Second.' });
    assert(shared.executed.ok, JSON.stringify(shared.executed.errors));
    assert.notEqual(shared.bound.draft.narrative[0].id, shared.bound.draft.narrative[1].id,
        'identical text has separate structural owners, never ambiguous_action_passage');
    assert.deepEqual(shared.bound.binding.actionSpans.map(span => [span.start, span.end]), [[0, 6], [7, 14]]);
    const omitted = structuredClone(double); omitted.actions[1].request = 'Third.';
    assert(binding.bind(omitted, { ...context, input: 'First. Second.' }, canonical).errors.some(error =>
        error.reason === 'request_coverage_mismatch'), 'a second player instruction cannot disappear or be replaced');
    const grammatical = { protocol: 'scene_draft_v3', actions: [
        { kind: 'question', status: 'answered', request: 'frage Lorne nach Weg', effects: [],
            response: [{ text: 'Lorne names the path.' }] },
        { kind: 'physical', status: 'attempted', request: 'nehme Tasse', effects: [],
            response: [{ text: 'You reach toward the cup.' }] }
    ] };
    const grammaticalInput = 'Ich frage Lorne nach dem Weg, und nehme die Tasse.';
    const grammaticalBound = binding.bind(grammatical,
        { ...context, input: grammaticalInput }, canonical);
    assert(grammaticalBound.ok, JSON.stringify(grammaticalBound.errors));
    assert.equal(grammaticalBound.draft.actions.map(action => action.request).join(''),
        grammaticalInput, 'binding restores the exact player wording after grammatical alignment');
    const negated = structuredClone(grammatical);
    assert(binding.bind(negated, { ...context,
        input: 'Ich frage Lorne nach dem Weg, und nehme die Tasse nicht.' }, canonical)
        .errors.some(error => error.reason === 'request_coverage_mismatch'),
    'omitted negation cannot be normalized away');
    const invented = structuredClone(grammatical);
    invented.actions[1].request = 'nehme Tasse und Schlüssel';
    assert(binding.bind(invented, { ...context, input: grammaticalInput }, canonical)
        .errors.some(error => error.reason === 'request_coverage_mismatch'),
    'an additional player action cannot be smuggled into coverage');
    const omittedMiddle = { protocol: 'scene_draft_v3', actions: [
        { kind: 'question', status: 'answered', request: 'I ask Lorne about the cup',
            effects: [], response: [{ text: 'Lorne describes it.' }] },
        { kind: 'gesture', status: 'resolved', request: 'leave',
            effects: [], response: [{ text: 'You wave goodbye.' }] }
    ] };
    assert(binding.bind(omittedMiddle, { ...context,
        input: 'I ask Lorne about the cup, then take it and leave.' }, canonical)
        .errors.some(error => error.reason === 'request_coverage_mismatch'),
    'conversational merging must not hide an omitted item action between anchors');
    const unanchored = structuredClone(omittedMiddle);
    unanchored.actions.forEach(action => { delete action.request; });
    assert(binding.bind(unanchored, { ...context,
        input: 'I ask Lorne about the cup, then take it and leave.' }, canonical)
        .errors.length, 'unanchored multi-action replies cannot certify the complete player request');
    const duplicated = structuredClone(double);
    duplicated.actions[0].request = 'First. Second.';
    duplicated.actions[1].request = 'Second.';
    const partitioned = compile(duplicated, { input: 'First. Second.' });
    assert.deepEqual(partitioned.bound.draft.actions.map(action => action.request),
        ['First. ', 'Second.'], 'a uniquely contained suffix is assigned once');
    duplicated.actions[1].request = 'First. Second.';
    assert(binding.bind(duplicated, { ...context, input: 'First. Second.' }, canonical).errors.some(error =>
        error.reason === 'request_coverage_mismatch'),
    'identical whole-input requests cannot be assigned to distinct actions');
    const rawInput = 'I nod to Lorne, ask where the map went, and ask him to walk to path.';
    const rawOverlap = { protocol: 'scene_draft_v3', actions: [
        { kind: 'speech', status: 'resolved', request: rawInput, effects: [],
            response: [{ text: 'Lorne says the map went to the archive.' }] },
        { kind: 'speech', status: 'pending_check', request: 'ask him to walk to path', effects: [],
            response: [{ text: 'Lorne considers the trip.' }] }
    ] };
    assert(binding.bind(rawOverlap, { ...context, input: rawInput }, canonical).errors.some(error =>
        error.reason === 'invalid_bound_field' && error.detail === 'actions.1.status'));
    const checkCanonical = scene.schema({ events: { type: 'array', items: { type: 'object',
        properties: fields, required: ['type', 'actor_id', 'status'] } },
    checks: { type: 'array', maxItems: 1,
        items: { type: 'object', properties: { label: { type: 'string' },
            difficulty: { type: 'integer', minimum: 2, maximum: 30 } },
        required: ['label', 'difficulty'], additionalProperties: false } } },
    'scene_draft_v3', { linkedRequired: true });
    const checkContract = binding.schema(checkCanonical);
    assert(checkContract.properties.actions.items.properties.status.enum.includes('pending_check'));
    assert.match(checkContract.properties.actions.items.properties.status.description, /exactly one|one real/u);
    const savedDraft = (file, callIndex) => {
        const saved = JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8'))[0].calls[callIndex].response;
        const raw = saved.startsWith('data:') ? saved.split(/\r?\n/u).filter(line => line.startsWith('data: {'))
            .map(line => JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || '').join('')
            : JSON.parse(saved).choices[0].message.content;
        return JSON.parse(raw);
    };
    for (const file of ['world_p28_qwen_t08.json', 'world_p28_qwen_t08_after_coverage.json']) {
        const original = savedDraft(file, 0);
        const final = savedDraft(file, 2);
        for (const draft of [original, final]) {
            const bound = binding.bind(draft, { ...context, input: 'I take Linda to the Round Room.' },
                checkCanonical);
            assert(bound.errors.some(error => error.reason === 'request_coverage_mismatch'),
            'competing Qwen outcomes cannot share the same complete player request');
            assert(new Set(draft.actions.map(action => JSON.stringify(action.response))).size > 1,
                'the saved Qwen actions are distinct proposals, not identical duplicates');
            if (draft.actions.every(action => action.request === 'I take Linda to the Round Room.'))
                assert(bound.errors.some(error => /distinct responses/u.test(error.detail)));
        }
    }
    const rawBound = binding.bind(rawOverlap, { ...context, input: rawInput }, checkCanonical);
    assert(rawBound.ok, JSON.stringify(rawBound.errors));
    assert.equal(rawBound.draft.actions[1].request, 'ask him to walk to path.');
    const rawCompiled = scene.compile(rawBound.draft, { input: rawInput,
        location: 'stone', playerStart: 'stone', present: ['lorne'],
        locations: ['stone', 'path'], now: 485, commitments: [],
        linkedRequired: true, contract: checkCanonical });
    assert(rawCompiled.errors.some(error => error.reason === 'pending_action_requires_check'),
        'a model check status without a registered check stays rejected after request repair');
    const supportedCheck = structuredClone(rawOverlap);
    supportedCheck.actions[1].effects = { checks: [{ label: 'Uncertain route', difficulty: 11 }] };
    const checkedBound = binding.bind(supportedCheck, { ...context, input: rawInput }, checkCanonical);
    assert(checkedBound.ok, JSON.stringify(checkedBound.errors));
    const checkedCompiled = scene.compile(checkedBound.draft, { input: rawInput,
        location: 'stone', playerStart: 'stone', present: ['lorne'],
        locations: ['stone', 'path'], now: 485, commitments: [], effectKeys: ['checks'],
        linkedRequired: true, contract: checkCanonical });
    assert(checkedCompiled.ok, JSON.stringify(checkedCompiled.errors));
    const wrongCheckStatus = structuredClone(supportedCheck);
    wrongCheckStatus.actions[1].status = 'resolved';
    const wrongCheckBound = binding.bind(wrongCheckStatus,
        { ...context, input: rawInput }, checkCanonical);
    assert(wrongCheckBound.ok);
    assert(scene.compile(wrongCheckBound.draft, { input: rawInput,
        location: 'stone', playerStart: 'stone', present: ['lorne'],
        locations: ['stone', 'path'], now: 485, commitments: [], effectKeys: ['checks'],
        linkedRequired: true, contract: checkCanonical }).errors.some(error =>
        error.reason === 'check_requires_pending_action'));
    const twoQuestions = dialogue('Lorne says the map is in the archive.');
    twoQuestions.actions[0].kind = 'question';
    twoQuestions.actions[0].status = 'resolved';
    twoQuestions.actions[0].response.push({ text: 'He does not know who drew it.' });
    const questions = compile(twoQuestions, { input: 'Where is the map, and who drew it?' });
    assert(questions.executed.ok);
    assert.equal(questions.bound.draft.narrative.length, 2,
        'distinct answers or explicit deferrals remain in the same conversational action');
    const liftRequest = `Aslan speaks of sick orchards, glances at his short legs, makes a joke and asks Lorne: "Since you're heading to Millbrook anyway, perhaps you wouldn't mind giving an elderly toad a lift? I promise to be excellent company."`;
    const lift = { protocol: 'scene_draft_v3', actions: [
        { kind: 'speech', status: 'resolved', request: 'Aslan speaks of sick orchards', effects: [],
            response: [{ text: 'Lorne listens to the story of the orchards.' }] },
        { kind: 'gesture', status: 'resolved', request: 'glances at his short legs makes a joke and', effects: [],
            response: [{ text: 'Lorne notices the glance and smiles.' }] },
        { kind: 'question', status: 'answered', request: 'asks Lorne: "Since you\'re heading to Millbrook anyway, perhaps you wouldn\'t mind giving an elderly toad a lift? I promise to be excellent company."', effects: [],
            response: [{ text: '"I can give you a lift," Lorne replies.' }] }
    ] };
    const lifted = compile(lift, { input: liftRequest });
    assert(lifted.executed.ok, JSON.stringify(lifted.executed.errors));
    assert.equal(lifted.bound.draft.actions.length, 1,
        'nonmechanical dialogue and gestures share the complete player turn');
    assert.equal(lifted.bound.draft.actions[0].request, liftRequest);
    assert.equal(lifted.bound.draft.narrative.length, 3,
        'normalization preserves every model response paragraph');
    assert(lifted.bound.binding.repairs.some(repair => repair.type === 'merge_conversational_actions'));
    const falseAppointment = dialogue('Lorne smiles. "I can give you a lift to Millbrook."');
    falseAppointment.actions[0].kind = 'speech';
    falseAppointment.actions[0].response[0].commitments = [{ title: 'Take Aslan to Millbrook',
        day: 2, minute_of_day: 480, location_id: 'stone', status: 'scheduled',
        source_quote: 'Since you are heading to Millbrook' }];
    const offeredLift = compile(falseAppointment, { input: liftRequest });
    assert(offeredLift.executed.ok, JSON.stringify(offeredLift.executed.errors));
    assert.deepEqual(offeredLift.compiled.commitments, []);
    assert(offeredLift.bound.binding.repairs.some(repair =>
        repair.type === 'discard_unsupported_new_commitment'));
    assert.match(offeredLift.executed.narrative, /give you a lift/);
    const cancellation = dialogue('Lorne acknowledges the cancellation.');
    cancellation.actions[0].kind = 'speech';
    cancellation.actions[0].response[0].commitments = [{ existing_id: 'meeting',
        title: 'Cancelled meeting', day: 2, minute_of_day: 510,
        location_id: 'stone', status: 'cancelled', source_quote: 'I cancel our meeting.' }];
    const retainedCancellation = binding.bind(cancellation, { ...context,
        input: 'I cancel our meeting.', commitmentIds: ['meeting'] }, canonical);
    assert(retainedCancellation.ok, JSON.stringify(retainedCancellation.errors));
    assert.equal(retainedCancellation.draft.commitments[0].id, 'meeting',
        'an existing deadline may be cancelled without repeating its clock time');
    const forged = dialogue(); forged.actions[0].action_id = 'guessed';
    const relinked = binding.bind(forged, context, canonical);
    assert(relinked.ok, JSON.stringify(relinked.errors));
    assert.notEqual(relinked.draft.actions[0].action_id, 'guessed',
        'the host replaces a model-authored action ID');
    assert(relinked.binding.repairs.some(item => item.type === 'discard_engine_link'));
    const autonomous = dialogue();
    autonomous.reactions = [{ text: 'Lorne steps onto the path.',
        effects: { actor_move: [{ actor_id: 'lorne', to_location_id: 'path' }] },
        events: [{ type: 'movement', actor_id: 'lorne', status: 'completed',
            from_location_id: 'stone', to_location_id: 'path' }] }];
    const moved = compile(autonomous);
    assert(moved.executed.ok, JSON.stringify(moved.executed.errors));
    assert.equal(moved.executed.working.prepare().session.entityStates.lorne.location, 'path');
    assert.equal(moved.session.entityStates.lorne.location, 'stone', 'no canonical mutation before commit');
    assert.equal(moved.executed.verifiedEffects[0].source, 'reaction',
        'an autonomous NPC action has a world provenance without player authorization');
    assert(moved.executed.confirmedEffects.some(effect => effect.source === 'reaction'
        && effect.type === 'actor_move' && effect.result === 'changed'
        && effect.event_indices.some(index => moved.executed.events[index]?.type === 'movement')));
    const departure = structuredClone(autonomous);
    departure.reactions[0].text = 'Lorne sets off toward the path.';
    departure.reactions[0].effects.actor_move[0].mode = 'journey';
    departure.reactions[0].events[0].type = 'activity';
    departure.reactions[0].events[0].activity = 'travelling';
    delete departure.reactions[0].events[0].from_location_id;
    const boundDeparture = binding.bind(departure, context, canonical);
    assert(boundDeparture.ok, JSON.stringify(boundDeparture.errors));
    const compiledDeparture = scene.compile(boundDeparture.draft, {
        input: context.input, location: 'stone', playerStart: 'stone',
        present: ['lorne'], locations: ['stone', 'path'], now: 485,
        commitments: [], linkedRequired: true, contract: canonical });
    assert(compiledDeparture.ok, JSON.stringify(compiledDeparture.errors));
    assert.equal(compiledDeparture.linkedPlan.actions[1].action_effects.actor_move[0].mode, 'journey');
    const missingNpcEvent = structuredClone(autonomous);
    delete missingNpcEvent.reactions[0].events;
    const missingWitness = compile(missingNpcEvent);
    assert.equal(missingWitness.executed.ok, false);
    assert.equal(missingWitness.executed.errors[0].reason, 'unwitnessed_companion_or_actor_move');
    assert.equal(missingWitness.session.entityStates.lorne.location, 'stone');
    const wrongActor = structuredClone(autonomous);
    wrongActor.reactions[0].events[0].actor_id = 'player';
    const wrongActorResult = compile(wrongActor);
    assert.equal(wrongActorResult.executed.ok, false);
    assert.equal(wrongActorResult.executed.errors[0].reason, 'unwitnessed_companion_or_actor_move');
    const unreachable = structuredClone(autonomous);
    unreachable.reactions[0].effects.actor_move[0].to_location_id = 'unknown_place';
    const unreachableResult = compile(unreachable);
    assert.equal(unreachableResult.executed.ok, false);
    assert.equal(unreachableResult.session.entityStates.lorne.location, 'stone');
    const wrongOrigin = structuredClone(autonomous);
    wrongOrigin.reactions[0].events[0].from_location_id = 'path';
    assert.equal(compile(wrongOrigin).executed.errors[0].reason,
        'unwitnessed_companion_or_actor_move');
    const falseRelation = dialogue();
    falseRelation.reactions = [{ text: 'Lorne speaks warmly.',
        effects: { relation_set: [{ subject_id: 'lorne', target_id: 'player', value: 50 }] },
        events: [{ type: 'relationship', actor_id: 'lorne', target_id: 'other',
            status: 'completed', change: 5 }] }];
    const contradictory = compile(falseRelation);
    assert.equal(contradictory.executed.errors[0].reason, 'unwitnessed_relation_effect');
    assert.deepEqual(contradictory.executed.verifiedEffects, [],
        'an executable reducer with a contradictory event never gains repair protection');
    assert.deepEqual(contradictory.session.npcRelationships, {},
        'the detached relation change is rolled back');
    const matchedRelation = structuredClone(falseRelation);
    matchedRelation.reactions[0].events[0].target_id = 'player';
    matchedRelation.reactions[0].events[0].change = 50;
    const related = compile(matchedRelation);
    assert(related.executed.ok, JSON.stringify(related.executed.errors));
    assert.equal(related.executed.verifiedEffects[0].source, 'reaction');
    const wrongMagnitude = structuredClone(matchedRelation);
    wrongMagnitude.reactions[0].events[0].change = 5;
    assert.equal(compile(wrongMagnitude).executed.errors[0].reason,
        'unwitnessed_relation_effect', 'the event must match the actual absolute score change');
    const emptyNpc = dialogue(); emptyNpc.reactions = [{ text: 'Lorne smiles.', effects: [] }];
    assert(compile(emptyNpc).executed.ok, 'an autonomous NPC reaction needs no invented effect');
    const unrequested = dialogue(); unrequested.reactions = [{ text: 'You decide to leave.',
        effects: { actor_move: [{ actor_id: 'player', to_location_id: 'path' }] } }];
    assert(binding.bind(unrequested, context, canonical).errors.some(error =>
        error.reason === 'unrequested_player_movement'), 'autonomous NPC reactions cannot decide voluntary player travel');
    const changed = dialogue('Lorne notices the red cloak.');
    changed.actions[0].kind = 'physical';
    changed.actions[0].effects = { outfit_set: [{ actor_id: 'player', outfit: 'red cloak' }] };
    changed.actions[0].response[0].events = [{ type: 'outfit', actor_id: 'player',
        status: 'completed', outfit: 'red cloak' }];
    const dressed = compile(changed, { input: 'I put on the cloak.' });
    assert(dressed.executed.ok, JSON.stringify(dressed.executed.errors));
    assert.equal(dressed.executed.working.prepare().session.outfit, 'red cloak');
    assert.equal(dressed.executed.verifiedEffects.length, 1);
    assert(dressed.executed.confirmedEffects.some(effect => effect.type === 'outfit_set'
        && effect.payload.outfit === 'red cloak' && effect.result === 'changed'
        && effect.event_indices.some(index => dressed.executed.events[index]?.type === 'outfit')));
    const unchangedOutfit = compile(changed, { input: 'I put on the cloak.',
        session: { ...structuredClone(initial), outfit: 'red cloak' } });
    assert(unchangedOutfit.executed.ok);
    assert.deepEqual(unchangedOutfit.executed.verifiedEffects, [],
        'a reducer write with no actual persistent result grants no repair protection');
    assert(unchangedOutfit.executed.confirmedEffects.some(effect => effect.type === 'outfit_set'
        && effect.result === 'no_change'), 'executed no-ops remain visible without claiming a state change');
    const noChangeMemory = turnContext.sceneMemory({
        action_results: [...unchangedOutfit.executed.outcomes].map(([action_id, outcome]) =>
            ({ action_id, outcome })), confirmed_effects: unchangedOutfit.executed.confirmedEffects,
        events: unchangedOutfit.executed.events, speech_attributions: [] }, 'no_change', 'stone', 1);
    assert(noChangeMemory.records.some(record => record.kind === 'effect'
        && record.result === 'no_change'));
    const mixedInput = 'I put on the cloak. I nod.';
    const mixedTurn = { protocol: 'scene_draft_v3', actions: [
        { ...structuredClone(changed.actions[0]), request: 'I put on the cloak.' },
        { kind: 'gesture', status: 'resolved', request: 'I nod.', effects: [],
            response: [{ text: 'Lorne nods back.' }] }
    ], reactions: [{ text: 'Lorne tries to leave.',
        effects: { actor_move: [{ actor_id: 'lorne', to_location_id: 'path' }] } }] };
    const mixedFailure = compile(mixedTurn, { input: mixedInput });
    const overlapping = structuredClone(mixedTurn);
    overlapping.actions[0].request = 'I put on the cloak. I';
    overlapping.reactions[0].effects = [];
    const aligned = compile(overlapping, { input: mixedInput });
    assert(aligned.executed.ok, JSON.stringify(aligned.executed.errors));
    assert.deepEqual(aligned.bound.draft.actions.slice(0, 2).map(action => action.request),
        ['I put on the cloak. ', 'I nod.']);
    assert.equal(aligned.executed.verifiedEffects.length, 1,
        'unique request partition preserves the independent outfit effect');
    assert.equal(aligned.bound.binding.worldActionIds.length, 1,
        'independent NPC reaction survives request normalization');
    assert(aligned.bound.binding.repairs.some(repair => repair.type === 'partition_overlapping_requests'));
    assert.deepEqual(binding.repairLosses(aligned.executed.verifiedEffects, overlapping,
        canonical, null, mixedInput), [],
    'an overlap repair keeps its verified effect under the same unique request partition');
    const dependentOverlap = structuredClone(overlapping);
    dependentOverlap.actions[1].depends_on = [{ action_index: 0, outcome: 'succeeded' }];
    const dependent = compile(dependentOverlap, { input: mixedInput });
    assert(dependent.executed.ok);
    assert.deepEqual(dependent.bound.draft.actions[1].depends_on,
        [{ action_id: 'turn_stable_action_0', outcome: 'succeeded' }],
    'normalization retains dependencies');
    const missingPart = structuredClone(overlapping);
    missingPart.actions[1].request = 'I smile.';
    assert(binding.bind(missingPart, { ...context, input: mixedInput }, canonical).errors.some(error =>
        error.reason === 'request_coverage_mismatch'));
    assert.equal(mixedFailure.executed.ok, false);
    assert.equal(mixedFailure.executed.errors[0].reason, 'unwitnessed_companion_or_actor_move');
    assert.equal(mixedFailure.executed.verifiedEffects.length, 1,
        'only the earlier player action has a verified chain');
    assert.deepEqual(mixedFailure.executed.confirmedEffects, [],
        'a rejected transaction exposes no committed effect trace');
    const mixedRepair = structuredClone(mixedTurn);
    mixedRepair.reactions[0].effects = [];
    assert.deepEqual(binding.repairLosses(mixedFailure.executed.verifiedEffects,
        mixedRepair, canonical), []);
    const mixedFixed = compile(mixedRepair, { input: mixedInput });
    assert(mixedFixed.executed.ok,
        'the gesture and verified world action both survive the local repair');
    assert.deepEqual(binding.repairEventLosses(mixedFailure.executed.verifiedEvents,
        mixedFixed.compiled.receipt.events), []);
    const droppedMixedEffect = structuredClone(mixedRepair);
    droppedMixedEffect.actions[0].effects = [];
    assert.equal(binding.repairLosses(mixedFailure.executed.verifiedEffects,
        droppedMixedEffect, canonical)[0].reason, 'repair_dropped_verified_effect');
    const shiftedEffect = structuredClone(mixedRepair);
    shiftedEffect.actions[0].effects = [];
    shiftedEffect.reactions[0].effects = structuredClone(changed.actions[0].effects);
    assert(binding.repairLosses(mixedFailure.executed.verifiedEffects, shiftedEffect, canonical).length,
        'moving a player effect into an NPC reaction does not authorize it');
    const skippedDependency = linked.executeLinkedActions({ actions: [
        { action_id: 'first', kind: 'physical', status: 'attempted', request: 'I try.',
            response_id: 'first_reply', action_effects: {} },
        { action_id: 'second', kind: 'physical', status: 'resolved', request: 'Then I change.',
            response_id: 'second_reply', depends_on: [{ action_id: 'first', outcome: 'succeeded' }],
            action_effects: { outfit_set: [{ actor_id: 'player', outfit: 'silver cloak' }] } }
    ], narrative: [{ id: 'first_reply', action_id: 'first', text: 'The attempt fails.' },
        { id: 'second_reply', action_id: 'second', text: 'The cloak changes.' }],
    events: [{ type: 'outfit', actor_id: 'player', status: 'completed', action_id: 'second',
        passage_id: 'second_reply', outfit: 'silver cloak' }] }, world, structuredClone(initial));
    assert(skippedDependency.ok);
    assert.equal(skippedDependency.outcomes.get('second'), 'skipped');
    assert.deepEqual(skippedDependency.verifiedEffects, [],
        'an effect behind a failed dependency was never executed or protected');
    assert.deepEqual(skippedDependency.confirmedEffects, [],
        'an effect behind a failed dependency cannot enter the confirmed trace');
    const waited = dialogue('Ten minutes pass.'); waited.actions[0].kind = 'wait';
    waited.actions[0].effects = { time_skip_minutes: 10 };
    const boundWait = compile(waited, { input: 'I wait ten minutes.' });
    assert(boundWait.executed.ok, JSON.stringify(boundWait.executed.errors));
    assert.deepEqual(boundWait.bound.draft.actions[0].action_effects, { time_advance: [{ minutes: 10 }] });
    const nativeWait = structuredClone(waited); nativeWait.actions[0].effects = { time_advance: [{ minutes: 10 }] };
    assert.deepEqual(binding.repairLosses([], nativeWait, canonical), []);
    const meeting = structuredClone(nativeWait);
    meeting.actions[0].response[0].text = 'After ten minutes, Lorne rings the meeting bell.';
    meeting.actions[0].response[0].events = [{ type: 'environment', actor_id: 'lorne',
        status: 'completed', action: 'rings the meeting bell' }];
    meeting.actions[0].response[0].resolutions = [{ id: 'meeting', event_index: 0 }];
    const meetingResult = compile(meeting, { input: 'I wait ten minutes.', commitments: [{
        id: 'meeting', status: 'scheduled', dueMinute: 490, locationId: 'stone' }] });
    assert(meetingResult.executed.ok, JSON.stringify(meetingResult.executed.errors));
    assert.equal(meetingResult.compiled.resolutions.length, 1,
        'a typed wait can reach a real deadline without inventing a duplicate time event');
    const longWait = linked.executeLinkedActions({ actions: [{ action_id: 'long_wait',
        kind: 'wait', status: 'resolved', request: 'I wait several weeks.', response_id: 'long_reply',
        action_effects: { time_skip_minutes: 20000 } }], events: [],
        narrative: [{ id: 'long_reply', action_id: 'long_wait', text: 'Several weeks pass.' }] },
    world, structuredClone(initial), { legacyEffectKeys: ['time_skip_minutes'], includedTurnMinutes: 5,
        applyLegacyEffect(_type, payload, working) { working.writeTime('bonusTimeMinutes', field => {
            field.value = (field.value || 0) + payload;
        }); } });
    assert(longWait.ok, JSON.stringify(longWait.errors));
    assert.equal(longWait.working.prepare().session.bonusTimeMinutes, 19995,
        'long legacy waits preserve their duration and include the ordinary turn step once');
    const deadline = structuredClone(changed);
    deadline.actions[0].response[0].commitments = [{ title: 'Invented appointment', day: 1,
        minute_of_day: 480, location_id: 'stone', status: 'scheduled',
        source_quote: 'I agree to meet tomorrow at 08:30.' }];
    assert(binding.bind(deadline, { ...context, input: 'I agree to meet tomorrow at 08:30.' }, canonical)
        .errors.some(error => error.reason === 'deadline_before_world_time'));
    const noAuthorization = structuredClone(deadline);
    noAuthorization.actions[0].response[0].commitments[0].source_quote = 'not in player input';
    assert(binding.bind(noAuthorization, { ...context, input: 'I agree to meet tomorrow at 08:30.' }, canonical)
        .errors.some(error => error.reason === 'unsupported_commitment'));
    const repaired = structuredClone(changed);
    assert.deepEqual(binding.repairLosses(dressed.executed.verifiedEffects, repaired, canonical), [],
        'verified outfit survives optional deadline repair');
    const lost = structuredClone(repaired); lost.actions[0].effects = [];
    assert.equal(binding.repairLosses(dressed.executed.verifiedEffects, lost, canonical)[0].reason,
        'repair_dropped_verified_effect');
    assert.deepEqual(binding.repairLosses([], lost, canonical), [],
        'a formally valid but unverified model effect remains removable');
    const neutralized = structuredClone(lost); neutralized.actions[0].kind = 'gesture';
    assert.equal(binding.repairLosses([], neutralized, canonical, changed)[0].reason,
        'unverified_action_reclassification',
        'an executable player request cannot become neutral by model relabelling');
    const spuriousGesture = dialogue();
    spuriousGesture.actions[0].effects = structuredClone(changed.actions[0].effects);
    assert.deepEqual(binding.repairLosses([], dialogue(), canonical, spuriousGesture), [],
        'an unverified effect on an already narrative gesture may be removed');
    const reordered = structuredClone(changed);
    reordered.actions[0].effects.outfit_set[0] = { outfit: 'red cloak', actor_id: 'player' };
    assert.deepEqual(binding.repairLosses(dressed.executed.verifiedEffects, reordered, canonical), [],
        'JSON property order is not an effect change');
    const twice = structuredClone(changed);
    twice.actions[0].effects.outfit_set.push(structuredClone(twice.actions[0].effects.outfit_set[0]));
    assert(binding.repairLosses([{ ...dressed.executed.verifiedEffects[0], effects: [
        ...dressed.executed.verifiedEffects[0].effects,
        ...dressed.executed.verifiedEffects[0].effects] }], changed, canonical).length,
        'duplicate operations have multiplicity and cannot silently collapse');
    const quest = dialogue(); quest.actions[0].kind = 'speech';
    quest.actions[0].effects = { quests_update: [{ title: 'Invented job' }] };
    assert(binding.bind(quest, context, canonical).errors.some(error => error.reason === 'unsupported_new_quest'));
    quest.actions[0].authorization_quote = 'I accept the job.';
    assert(binding.bind(quest, { ...context, input: 'I accept the job.' }, canonical).ok);
    const mixed = dialogue(); mixed.actions[0].effects = { quests_update: [{ id: 'existing' }, { title: 'unsupported' }] };
    const repairedMixed = structuredClone(mixed); repairedMixed.actions[0].effects.quests_update.pop();
    assert.deepEqual(binding.repairLosses([], repairedMixed, canonical), []);
    repairedMixed.actions[0].effects = [];
    assert.deepEqual(binding.repairLosses([], repairedMixed, canonical), [],
        'unverified sibling effects are never conserved by schema validity alone');
    assert(!binding.schema(canonical, { allowCommitments: false }).properties.actions.items
        .properties.response.items.properties.commitments, 'disabled mechanics are not proposed');
    const placeholder = structuredClone(changed); placeholder.actions[0].effects.unneeded_deadline = [];
    const cleaned = compile(placeholder, { input: 'I put on the cloak.' });
    assert(cleaned.executed.ok);
    assert.equal(cleaned.bound.binding.repairs[0].type, 'discard_empty_optional_effect');
    assert.equal(cleaned.executed.working.prepare().session.outfit, 'red cloak');
    const unsafe = structuredClone(placeholder); unsafe.actions[0].effects.unneeded_deadline = [{ day: 1 }];
    assert.equal(binding.bind(unsafe, context, canonical).ok, false, 'nonempty proposals are never silently discarded');
    assert.equal(scene.completionFailureReason('length'), 'truncated_receipt');
    assert.equal(scene.decode('{"protocol":"scene_draft_v3","actions":['), null);
    const workerContext = { worldId: 'test', sessionId: 'save', version: 1,
        nonce: 'retry-stable', input: context.input, now: 485 };
    const invoke = custom => {
        const child = spawnSync(process.execPath, [path.join(__dirname, '../worlds/turn-binding-worker.js')],
            { input: JSON.stringify({ draft: dialogue(), context: { ...workerContext, ...custom }, canonical }), encoding: 'utf8' });
        assert.equal(child.status, 0, child.stderr);
        return JSON.parse(child.stdout);
    };
    assert.equal(invoke({}).binding.turnId, invoke({}).binding.turnId);
    assert.notEqual(invoke({}).binding.turnId, invoke({ version: 2 }).binding.turnId);
    const before = structuredClone(dressed.session);
    await assert.rejects(dressed.executed.working.commit(async () => { throw Error('storage failure'); }, 1));
    assert.deepEqual(dressed.session, before, 'failed persistence preserves narrative, time and state');
    assert.throws(() => workingApi.assertReceiptMatchesCandidate({ scene: { player_location_id: 'stone' },
        clock: { absolute_minutes: 486 } }, { world, session: initial }), /clock/);
    console.log('PASS server-owned IDs, long/short dialogue, gestures, Aslan/Lorne, autonomous NPC movement, effects, deadlines, truncation, repair preservation and rollback');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
