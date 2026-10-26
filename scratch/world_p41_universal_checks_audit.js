'use strict';
const assert = require('node:assert/strict');
const { executeLinkedActions } = require('../worlds/linked-world-actions');
const checkApi = require('../worlds/universal-checks');
const rule = { id: 'focus', name: 'Focus', match: { kind: 'physical', requestIncludes: 'focus' },
    values: [{ subject: 'actor', source: 'stat', key: 'focus' }], difficulty: 7,
    results: [{ id: 'pass', kind: 'success', minMargin: 0, effects: [] },
        { id: 'mixed', kind: 'partial', minMargin: -2, effects: [] },
        { id: 'fail', kind: 'failure', minMargin: -100, effects: [] }] };
const world = enabled => ({ id: 'fixture', locations: [{ id: 'room', name: 'Room', exits: [] }],
    entities: [{ id: 'npc_a', type: 'npc', name: 'A', stats: { focus: 9 } }],
    gameRules: { universalChecks: { enabled, rules: [rule] } } });
const session = focus => ({ id: 'timeline', turnCount: 2, playerLocation: 'room',
    playerStats: { focus }, playerIdentity: { skills: [] }, entityStates: { npc_a: { location: 'room' } } });
const action = status => ({ action_id: 'a', kind: 'physical', request: 'focus on the inscription', status,
    response_id: 'p', action_effects: {} });
const plan = status => ({ actions: [action(status)], events: status === 'resolved'
    ? [{ id: 'e', type: 'interaction', actor_id: 'player', action_id: 'a', passage_id: 'p', status: 'completed' }] : [],
    narrative: [{ id: 'p', action_id: 'a', text: 'The inscription responds.' }] });
for (const [focus, status, kind] of [[9, 'resolved', 'success'], [6, 'resolved', 'partial'],
    [3, 'attempted', 'failure']]) {
    const result = executeLinkedActions(plan(status), world(true), session(focus));
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.checkResults[0].kind, kind);
}
const disabled = executeLinkedActions(plan('resolved'), world(false), session(3));
assert.equal(disabled.ok, true, JSON.stringify(disabled.errors));
assert.equal(disabled.checkResults.length, 0);
const ordinary = plan('resolved');
ordinary.actions[0].request = 'read the inscription';
assert.equal(executeLinkedActions(ordinary, world(true), session(3)).checkResults.length, 0);
const blockedWorld = world(true);
blockedWorld.gameRules.universalChecks.rules[0] = { ...rule,
    when: { subject: 'actor', source: 'skill', key: 'missing_skill', operator: 'exists' } };
const blocked = executeLinkedActions(plan('blocked'), blockedWorld, session(9));
assert.equal(blocked.ok, true, JSON.stringify(blocked.errors));
assert.equal(blocked.checkResults[0].kind, 'blocked');
const inconsistent = executeLinkedActions(plan('resolved'), world(true), session(3));
assert.equal(inconsistent.ok, false);
assert.equal(inconsistent.errors[0].reason, 'check_outcome_status_mismatch');
const effectPlan = plan('resolved');
effectPlan.actions[0].action_effects = { condition_change: [{ target_id: 'player', condition: 'focused', action: 'add' }] };
effectPlan.events = [{ id: 'condition_e', action_id: 'a', type: 'condition', actor_id: 'player',
    condition: 'focused', status: 'completed', passage_id: 'p' }];
const unauthorized = executeLinkedActions(effectPlan, world(true), session(9));
assert.equal(unauthorized.ok, false);
assert.equal(unauthorized.errors[0].reason, 'check_effect_not_allowed');
assert.equal(session(9).playerSceneConditions, undefined);
const allowedWorld = world(true);
allowedWorld.gameRules.universalChecks.rules[0] = { ...rule,
    results: [{ ...rule.results[0], effects: ['condition_change'] }, ...rule.results.slice(1)] };
const authorized = executeLinkedActions(effectPlan, allowedWorld, session(9));
assert.equal(authorized.ok, true, JSON.stringify(authorized.errors));
assert.deepEqual(authorized.working.prepare().session.playerSceneConditions, ['focused']);
assert.deepEqual(authorized.checkResults[0].effect_types, ['condition_change']);
const badRule = { ...rule, results: [{ id: 'pass', kind: 'success', minMargin: 0,
    effects: ['not_registered'] }, rule.results[2]] };
assert.throws(() => checkApi.validateRules({ enabled: true, rules: [badRule] }, new Set()));
const npc = checkApi.evaluate({ ...rule, actor: 'event_actor' }, action('resolved'),
    [{ action_id: 'a', actor_id: 'npc_a' }], require('../worlds/working-state')
        .createWorkingState(world(true), session(3)), () => 0);
assert.equal(npc.total, 9);
const randomRule = { ...rule, random: { min: 1, max: 6 } };
const first = checkApi.evaluate(randomRule, action('resolved'), [],
    require('../worlds/working-state').createWorkingState(world(true), session(3)), () => 4);
assert.equal(first.random, 4);
const randomWorld = world(true);
randomWorld.gameRules.universalChecks.rules[0] = { ...randomRule, difficulty: 0 };
const firstPlan = plan('resolved');
const secondPlan = plan('resolved');
secondPlan.actions[0].action_id = 'model_renamed_this';
secondPlan.events[0].action_id = 'model_renamed_this';
secondPlan.narrative[0].action_id = 'model_renamed_this';
const firstRoll = executeLinkedActions(firstPlan, randomWorld, session(9));
const renamedRoll = executeLinkedActions(secondPlan, randomWorld, session(9));
assert.equal(firstRoll.ok, true, JSON.stringify(firstRoll.errors));
assert.equal(renamedRoll.ok, true, JSON.stringify(renamedRoll.errors));
assert.equal(firstRoll.checkResults[0].random, renamedRoll.checkResults[0].random);
console.log('PASS P4.1 linked success, partial, failure, blocked, disabled, ordinary, effect gate, rollback, NPC, stable reroll');
