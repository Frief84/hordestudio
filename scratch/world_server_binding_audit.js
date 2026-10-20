'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const scene = require('../worlds/scene-draft');
const binding = require('../worlds/turn-binding');
const linked = require('../worlds/linked-world-actions');
const workingApi = require('../worlds/working-state');
const fields = Object.fromEntries(['type', 'actor_id', 'status', 'action', 'item', 'outfit',
    'from_location_id', 'to_location_id', 'activity', 'condition', 'next_status',
    'target_id', 'change']
    .map(key => [key, { type: 'string', maxLength: 1000 }]));
fields.change = { type: 'integer' };
const canonical = scene.schema({ events: { type: 'array', items: { type: 'object',
    properties: fields, required: ['type', 'actor_id', 'status'] } },
quests_update: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, title: { type: 'string' } }, additionalProperties: false } },
time_skip_minutes: { type: 'integer', minimum: 1 } }, 'scene_draft_v3',
{ linkedRequired: true });
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
    const spoken = dialogue('You say: "The bridge is out." Lorne listens.');
    spoken.actions[0].kind = 'speech';
    spoken.actions[0].response[0].speech = [{ speaker: 'player', listeners: ['lorne'] }];
    const observed = compile(spoken, { input: '"The bridge is out."' });
    assert(observed.executed.ok, JSON.stringify(observed.executed.errors));
    assert(observed.executed.events.some(event => event.type === 'observation'
        && event.actor_id === 'lorne' && event.action_id === observed.bound.draft.actions[0].action_id),
    'derived NPC knowledge is kept in the linked receipt and cannot be treated as neutral');
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
    const liftRequest = `Aslan speaks of sick orchards, glances at his short legs, makes a joke and asks Lorne: "Since you're heading to Millbrook anyway, perhaps you wouldn't mind giving an elderly toad a lift? I promise to be excellent company."`;
    const lift = { protocol: 'scene_draft_v3', actions: [
        { kind: 'speech', status: 'resolved', request: 'Aslan speaks of sick orchards', effects: [],
            response: [{ text: 'Lorne listens to the story of the orchards.' }] },
        { kind: 'gesture', status: 'resolved', request: 'glances at his short legs', effects: [],
            response: [{ text: 'Lorne notices the glance and smiles.' }] },
        { kind: 'question', status: 'answered', request: 'asks Lorne:', effects: [],
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
    assert(binding.bind(forged, context, canonical).errors.some(error => error.reason === 'engine_owned_binding_required'));
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
    const missingNpcEvent = structuredClone(autonomous);
    delete missingNpcEvent.reactions[0].events;
    const missingWitness = compile(missingNpcEvent);
    assert.equal(missingWitness.executed.ok, false);
    assert.equal(missingWitness.executed.errors[0].reason, 'unwitnessed_world_effect');
    assert.equal(missingWitness.session.entityStates.lorne.location, 'stone');
    const wrongActor = structuredClone(autonomous);
    wrongActor.reactions[0].events[0].actor_id = 'player';
    const wrongActorResult = compile(wrongActor);
    assert.equal(wrongActorResult.executed.ok, false);
    assert.equal(wrongActorResult.executed.errors[0].reason, 'unlinked_movement_event');
    const unreachable = structuredClone(autonomous);
    unreachable.reactions[0].effects.actor_move[0].to_location_id = 'unknown_place';
    const unreachableResult = compile(unreachable);
    assert.equal(unreachableResult.executed.ok, false);
    assert.equal(unreachableResult.session.entityStates.lorne.location, 'stone');
    const wrongOrigin = structuredClone(autonomous);
    wrongOrigin.reactions[0].events[0].from_location_id = 'path';
    assert.equal(compile(wrongOrigin).executed.errors[0].reason,
        'event_movement_origin_mismatch');
    const falseRelation = dialogue();
    falseRelation.reactions = [{ text: 'Lorne speaks warmly.',
        effects: { relation_set: [{ subject_id: 'lorne', target_id: 'player', value: 50 }] },
        events: [{ type: 'relationship', actor_id: 'lorne', target_id: 'other',
            status: 'completed', change: 5 }] }];
    const contradictory = compile(falseRelation);
    assert.equal(contradictory.executed.errors[0].reason, 'unwitnessed_world_effect');
    assert.deepEqual(contradictory.executed.verifiedEffects, [],
        'an executable reducer with a contradictory event never gains repair protection');
    assert.deepEqual(contradictory.session.npcRelationships, {},
        'the detached relation change is rolled back');
    const matchedRelation = structuredClone(falseRelation);
    matchedRelation.reactions[0].events[0].target_id = 'player';
    const related = compile(matchedRelation);
    assert(related.executed.ok, JSON.stringify(related.executed.errors));
    assert.equal(related.executed.verifiedEffects[0].source, 'reaction');
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
    const unchangedOutfit = compile(changed, { input: 'I put on the cloak.',
        session: { ...structuredClone(initial), outfit: 'red cloak' } });
    assert(unchangedOutfit.executed.ok);
    assert.deepEqual(unchangedOutfit.executed.verifiedEffects, [],
        'a reducer write with no actual persistent result grants no repair protection');
    const mixedInput = 'I put on the cloak. I nod.';
    const mixedTurn = { protocol: 'scene_draft_v3', actions: [
        { ...structuredClone(changed.actions[0]), request: 'I put on the cloak.' },
        { kind: 'gesture', status: 'resolved', request: 'I nod.', effects: [],
            response: [{ text: 'Lorne nods back.' }] }
    ], reactions: [{ text: 'Lorne tries to leave.',
        effects: { actor_move: [{ actor_id: 'lorne', to_location_id: 'path' }] } }] };
    const mixedFailure = compile(mixedTurn, { input: mixedInput });
    assert.equal(mixedFailure.executed.ok, false);
    assert.equal(mixedFailure.executed.errors[0].reason, 'unwitnessed_world_effect');
    assert.equal(mixedFailure.executed.verifiedEffects.length, 1,
        'only the earlier player action has a verified chain');
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
