/** P4.2 cost transactions through the authoritative linked World executor. */
'use strict';
const assert = require('node:assert/strict');
const { executeLinkedActions } = require('../worlds/linked-world-actions');
const registry = require('../worlds/effect-registry');

const costs = amount => [{ resourceId: 'energy', amount }];
const rule = ({ id = 'focus', kind = 'physical', actor, target } = {}) => ({
    id, name: 'Focus', match: { kind, requestIncludes: 'focus' },
    ...(actor ? { actor } : {}), ...(target ? { target } : {}),
    values: [{ subject: 'actor', source: 'stat', key: 'focus' }], difficulty: 7,
    results: [
        { id: 'pass', kind: 'success', minMargin: 0, effects: [], costs: costs(2) },
        { id: 'mixed', kind: 'partial', minMargin: -2, effects: [], costs: costs(1) },
        { id: 'fail', kind: 'failure', minMargin: -100, effects: [], costs: costs(1) }
    ]
});
const world = (rules = [rule()], enabled = true) => ({ id: 'p42_world',
    locations: [{ id: 'room', name: 'Room', exits: [] }],
    entities: [{ id: 'npc_a', type: 'npc', name: 'A', stats: { focus: 9 } }],
    gameRules: { universalChecks: { enabled, rules } } });
const session = (focus = 9, energy = 5) => ({ id: 'timeline', turnCount: 2,
    playerLocation: 'room', playerStats: { focus, energy },
    playerIdentity: { skills: [] }, entityStates: {
        npc_a: { location: 'room', resources: { energy: 5 } }
    } });
const action = (id, status = 'resolved', actor = 'player', kind = 'physical') => ({
    action_id: id, kind, request: 'focus on the inscription', status,
    response_id: `p_${id}`, action_effects: {}
});
const plan = (statuses = ['resolved'], actor = 'player', kind = 'physical') => ({
    actions: statuses.map((status, index) => action(`a_${index}`, status, actor, kind)),
    narrative: statuses.map((_status, index) => ({ id: `p_a_${index}`,
        action_id: `a_${index}`, text: 'The inscription responds.' })),
    events: statuses.flatMap((status, index) => status === 'resolved'
        ? [{ id: `e_${index}`, type: actor === 'player' ? 'interaction' : 'dialogue',
            actor_id: actor, action_id: `a_${index}`, passage_id: `p_a_${index}`,
            status: 'completed' }]
        : actor !== 'player' ? [{ id: `e_${index}`, type: 'dialogue', actor_id: actor,
            action_id: `a_${index}`, passage_id: `p_a_${index}`, status: 'attempted' }] : [])
});
const run = (w, s, p) => executeLinkedActions(p, w, s);
const costProof = (result, expected) => {
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const changes = result.confirmedEffects.filter(effect => effect.type === 'resource_cost');
    assert.equal(changes.length, expected);
    for (const change of changes) {
        assert.equal(change.origin, 'engine');
        assert.equal(change.result, 'changed');
        assert.equal(change.event_indices.length, 1);
        const event = result.events[change.event_indices[0]];
        assert.equal(event.type, 'resource_cost');
        assert.equal(event.status, 'completed');
        assert.equal(event.actor_id, change.payload.actor_id);
        assert.equal(event.rule_id, change.payload.rule_id);
        assert.equal(event.result_id, change.payload.result_id);
    }
};

assert.equal(registry.capabilities().names.includes('resource_cost'), false,
    'internal costs must not enlarge the model effect schema');
for (const [focus, expectedKind, expectedEnergy] of [
    [9, 'success', 3], [6, 'partial', 4], [3, 'failure', 4]
]) {
    const s = session(focus);
    const p = plan([expectedKind === 'failure' ? 'attempted' : 'resolved']);
    const result = run(world(), s, p);
    costProof(result, 1);
    assert.equal(result.checkResults[0].kind, expectedKind);
    assert.equal(result.checkResults[0].cost_changes[0].event_id,
        result.events.find(event => event.type === 'resource_cost').id);
    assert.equal(result.working.prepare().session.playerStats.energy, expectedEnergy);
    assert.equal(s.playerStats.energy, 5, 'canonical state changed before commit');
}

const rejectedKnowledgeShare = plan();
rejectedKnowledgeShare.actions[0].action_effects.knowledge_share = [{}];
const unchanged = session();
const deniedCheckEffect = run(world(), unchanged, rejectedKnowledgeShare);
assert.equal(deniedCheckEffect.ok, false);
assert.equal(deniedCheckEffect.errors[0].reason, 'check_effect_not_allowed');
assert.equal(deniedCheckEffect.errors[0].action_id, 'a_0');
assert.equal(deniedCheckEffect.errors[0].rejected_effect, 'knowledge_share');
assert.deepEqual(deniedCheckEffect.errors[0].check_rules, [{
    rule_id: 'focus', result_id: 'pass', kind: 'success', allowed_effects: []
}]);
assert.equal(unchanged.playerStats.energy, 5);
assert.equal(unchanged.resourceCostLedger, undefined);
assert.equal(deniedCheckEffect.confirmedEffects?.length || 0, 0);

const disabled = run(world([rule()], false), session(), plan());
costProof(disabled, 0);
assert.equal(disabled.checkResults.length, 0);
assert.equal(disabled.working.prepare().session.resourceCostLedger, undefined);
const oldRule = rule();
oldRule.results.forEach(result => { delete result.costs; });
const legacy = run(world([oldRule]), session(), plan());
costProof(legacy, 0);
assert.equal(legacy.working.prepare().session.resourceCostLedger, undefined);
assert.equal(legacy.checkResults[0].cost_changes, undefined);
const oldWorld = world();
delete oldWorld.gameRules.universalChecks;
const noConfig = run(oldWorld, session(), plan());
costProof(noConfig, 0);
assert.equal(noConfig.working.prepare().session.resourceCostLedger, undefined);

const insufficient = run(world(), session(9, 1), plan(['blocked']));
costProof(insufficient, 0);
assert.equal(insufficient.outcomes.get('a_0'), 'blocked');
assert.equal(insufficient.blockedReasons.get('a_0'), 'insufficient_resource');
assert.equal(insufficient.working.prepare().session.playerStats.energy, 1);
const unknown = session();
delete unknown.playerStats.energy;
const unknownResult = run(world(), unknown, plan());
assert.equal(unknownResult.ok, false);
assert.equal(unknownResult.errors[0].reason, 'unknown_resource');
assert.equal(unknown.resourceCostLedger, undefined);
const invalidTarget = run(world([rule({ target: 'ghost' })]), session(), plan());
assert.equal(invalidTarget.ok, false);
assert.equal(invalidTarget.errors[0].reason, 'invalid_resource_check_target');
const eventTargetRule = rule({ target: 'event_target' });
const invalidEventTarget = plan();
invalidEventTarget.events[0].target_id = 'missing_target';
assert.equal(run(world([eventTargetRule]), session(), invalidEventTarget)
    .errors[0].reason, 'invalid_resource_check_target');
const invalidRule = rule();
invalidRule.results[0].costs[0].resourceId = 'bad resource';
const badConfig = run(world([invalidRule]), session(), plan());
assert.equal(badConfig.ok, false);
assert.equal(badConfig.errors[0].stage, 'check_rule_validation');
const fractionalRule = rule();
fractionalRule.results[0].costs[0].amount = 0.0000001;
const fractional = run(world([fractionalRule]), session(), plan());
costProof(fractional, 1);
assert(Math.abs(fractional.working.prepare().session.playerStats.energy
    - 4.9999999) < 1e-12);
const blockedRule = rule();
blockedRule.when = { subject: 'actor', source: 'skill', key: 'absent',
    operator: 'exists' };
const prerequisite = run(world([blockedRule]), session(), plan(['blocked']));
costProof(prerequisite, 0);
assert.equal(prerequisite.checkResults[0].kind, 'blocked');
assert.equal(prerequisite.working.prepare().session.playerStats.energy, 5);

const twoRules = run(world([rule({ id: 'first' }), rule({ id: 'second' })]),
    session(9, 4), plan());
costProof(twoRules, 2);
assert.equal(twoRules.working.prepare().session.playerStats.energy, 0);
assert.deepEqual(twoRules.checkResults.map(check => check.rule_id), ['first', 'second']);
const twoRulesShort = run(world([rule({ id: 'first' }), rule({ id: 'second' })]),
    session(9, 3), plan(['blocked']));
costProof(twoRulesShort, 0);

const chain = run(world(), session(9, 4), plan(['resolved', 'resolved']));
costProof(chain, 2);
assert.equal(chain.working.prepare().session.playerStats.energy, 0);
const chainShort = session(9, 3);
const rejectedChain = run(world(), chainShort, plan(['resolved', 'resolved']));
assert.equal(rejectedChain.ok, false, 'the second action cannot spend unreserved stock');
assert.equal(chainShort.playerStats.energy, 3, 'a rejected turn charged the first action');
const invalidEffectPlan = plan();
invalidEffectPlan.actions[0].action_effects.not_registered = [{}];
const invalidEffectSession = session();
const invalidEffect = run(world(), invalidEffectSession, invalidEffectPlan);
assert.equal(invalidEffect.ok, false);
assert.equal(invalidEffectSession.playerStats.energy, 5,
    'a technical effect failure kept a provisional cost');
const partialChain = run(world(), session(9, 3), plan(['resolved', 'blocked']));
costProof(partialChain, 1);
assert.equal(partialChain.working.prepare().session.playerStats.energy, 1);

const committed = chain.working.prepare().session;
const replay = run(world(), structuredClone(committed), plan(['resolved', 'resolved']));
assert.equal(replay.ok, false, 'replay charged a committed action again');
assert.equal(replay.errors[0].reason, 'action_outcome_mismatch');
assert.equal(replay.errors[0].cause, 'insufficient_resource');
const one = run(world(), session(9, 4), plan());
const reloaded = structuredClone(one.working.prepare().session);
const duplicate = run(world(), reloaded, plan());
assert.equal(duplicate.ok, false);
assert.equal(duplicate.errors[0].reason, 'duplicate_resource_cost');
assert.equal(reloaded.playerStats.energy, 2);
const bound = executeLinkedActions(plan(), world(), session(9, 4),
    { turnId: 'stable_turn' });
costProof(bound, 1);
const later = structuredClone(bound.working.prepare().session);
later.turnCount++;
const oldTurnReplay = executeLinkedActions(plan(), world(), later,
    { turnId: 'stable_turn' });
assert.equal(oldTurnReplay.ok, false);
assert.equal(oldTurnReplay.errors[0].reason, 'duplicate_resource_cost');
assert.equal(later.playerStats.energy, 2);
const rewound = structuredClone(session(9, 4));
const reroll = run(world(), rewound, plan());
costProof(reroll, 1);
assert.equal(reroll.working.prepare().session.playerStats.energy, 2);
assert.equal(reroll.checkResults[0].cost_changes[0].event_id,
    one.checkResults[0].cost_changes[0].event_id);

const npcRule = rule({ kind: 'speech', actor: 'event_actor' });
const npcSession = session(9, 5);
const npc = run(world([npcRule]), npcSession, plan(['resolved'], 'npc_a', 'speech'));
costProof(npc, 1);
assert.equal(npc.working.prepare().session.entityStates.npc_a.resources.energy, 3);
assert.equal(npc.working.prepare().session.playerStats.energy, 5);
assert.equal(npc.confirmedEffects[0].payload.actor_id, 'npc_a');
const ambiguous = plan(['resolved'], 'npc_a', 'speech');
ambiguous.events.push({ id: 'other_actor', type: 'dialogue', actor_id: 'player',
    action_id: 'a_0', passage_id: 'p_a_0', status: 'completed' });
const ambiguousActor = run(world([npcRule]), session(), ambiguous);
assert.equal(ambiguousActor.ok, false);
assert.equal(ambiguousActor.errors[0].reason, 'ambiguous_resource_actor');
const invalidActor = plan(['resolved'], 'npc_a', 'speech');
invalidActor.events[0].actor_id = 'bad actor';
assert.equal(run(world([npcRule]), session(), invalidActor)
    .errors[0].reason, 'invalid_resource_actor');

const injection = plan();
injection.actions[0].action_effects.resource_cost = [{ actor_id: 'player',
    resource_id: 'energy', amount: 2, rule_id: 'focus', result_id: 'pass',
    transaction_id: 'forged' }];
const forbidden = run(world(), session(), injection);
assert.equal(forbidden.ok, false);
assert.equal(forbidden.errors[0].reason, 'unauthorized_resource_cost');
console.log('PASS P4.2 outcome costs, provenance, shared Working State, rollback, replay, NPC and legacy compatibility');
