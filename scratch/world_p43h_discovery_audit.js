'use strict';
const assert = require('node:assert/strict');
const discovery = require('../worlds/dynamic-object-discovery');
const checks = require('../worlds/universal-checks');
const workingApi = require('../worlds/working-state');
const { executeLinkedActions } = require('../worlds/linked-world-actions');
const npcGoals = require('../worlds/npc-goal-actions');
const scene = require('../worlds/scene-draft');
const binding = require('../worlds/turn-binding');
const rule = discovery.defaultRule(11);
assert.equal(discovery.validateNodeDefinition(), true);
checks.validateRules({ enabled: true, rules: [rule] }, new Set(['item_introduce']));
const world = (era = 'modern') => ({ id: 'p43h', description: `${era} household`,
    locations: [{ id: 'kitchen', name: 'Kitchen', description: 'A furnished kitchen with chairs beside the table.',
        items: [] }], entities: [
        { id: 'drawer', type: 'interactable', name: 'Drawer', description: 'A household drawer.',
            locationId: 'kitchen', interactable: { initialState: 'open' } },
        { id: 'linda', type: 'npc', name: 'Linda', locationId: 'kitchen' }],
    gameRules: { dynamicObjectDiscovery: { enabled: true },
        universalChecks: { enabled: true, rules: [rule] } } });
const session = () => ({ id: 'session', turnCount: 1, playerLocation: 'kitchen',
    entityStates: { drawer: { location: 'kitchen', interactableState: 'open' },
        linda: { location: 'kitchen', inventory: [] } }, inventory: [] });
function resolve(w, s, name, die, actor = 'player') {
    const working = workingApi.createWorkingState(w, s);
    const result = discovery.resolveDynamicObjectDiscovery({
        request: { id: `new_${name.replace(/\W/g, '_')}`, name }, actor,
        location: w.locations[0], container: { id: 'drawer' },
        world: w, worldRules: w.gameRules, workingState: working,
        roll: () => die,
        evaluateCheck: (selectedRule, checkActor, roll) => checks.evaluate(selectedRule,
            { action_id: 'search', kind: 'observation', request: `search for ${name}` },
            [{ action_id: 'search', actor_id: checkActor }], working, roll)
    });
    return { result, working };
}
{
    const w = world('medieval');
    const { result, working } = resolve(w, session(), 'flashlight', 20);
    assert.equal(result.type, 'blocked');
    assert.equal(result.reason, 'technology_conflict');
    assert.equal(working.getSession('discoveryDecisions'), undefined);
}
{
    const w = world();
    w.locations[0].description = 'An ordinary kitchen with a drawer.';
    w.entities[0].contentsMode = 'fixed';
    assert.equal(resolve(w, session(), 'flashlight', 20).result.reason, 'container_fixed');
    w.entities[0].contentsMode = 'empty';
    assert.equal(resolve(w, session(), 'flashlight', 20).result.reason, 'container_empty');
}
{
    const w = world();
    const s = session();
    assert.equal(resolve(w, s, 'machine gun', 20).result.reason, 'unsupported_weapon');
    const first = resolve(w, s, 'flashlight', 1);
    assert.equal(first.result.type, 'failure');
    const persisted = JSON.parse(JSON.stringify(first.working.prepare().session));
    const again = resolve(w, persisted, 'Taschenlampe', 20);
    assert.equal(again.result.type, 'failure');
    assert.equal(again.result.repeated, true);
}
{
    const w = world();
    const first = resolve(w, session(), 'flashlight', 20, 'linda');
    assert.equal(first.result.type, 'success');
    assert.equal(first.result.check.actor_id, 'linda');
    assert.equal(first.working.prepare().session.discoveryDecisions[first.result.question].objectId,
        'new_flashlight');
}
{
    const w = world();
    const working = workingApi.createWorkingState(w, session());
    const result = discovery.resolveDynamicObjectDiscovery({ request: { id: 'chair_1', name: 'chair' },
        actor: 'player', location: w.locations[0], world: w, worldRules: w.gameRules,
        workingState: working });
    assert.equal(result.type, 'success');
    assert.equal(result.ambient, true);
    assert.equal(discovery.resolveDynamicObjectDiscovery({ request: { id: 'chair_2', name: 'chair' },
        actor: 'player', location: w.locations[0], world: w, worldRules: w.gameRules,
        workingState: working }).reason, 'ambient_already_concretized');
}
{
    const w = world();
    w.locations[0].discoveryExclusions = ['chair'];
    const working = workingApi.createWorkingState(w, session());
    const result = discovery.resolveDynamicObjectDiscovery({ request: { id: 'chair_excluded', name: 'chair' },
        actor: 'player', location: w.locations[0], world: w, worldRules: w.gameRules,
        workingState: working });
    assert.equal(result.type, 'blocked');
    assert.equal(result.reason, 'authored_exclusion');
    assert.equal(working.getSession('discoveryDecisions'), undefined);
}
const proposal = () => ({ actions: [{ action_id: 'search', kind: 'observation',
    request: 'I search the drawer for a flashlight.', status: 'resolved',
    response_id: 'p', action_effects: { item_introduce: [{ id: 'found_light',
        name: 'flashlight', location_id: 'kitchen', container_id: 'drawer',
        actor_id: 'player', cause: 'discovery' }] } }],
    events: [{ id: 'found_event', type: 'discovery', action_id: 'search',
        passage_id: 'p', actor_id: 'player', target_id: 'found_light',
        item: 'flashlight', status: 'completed' }],
    narrative: [{ id: 'p', action_id: 'search', text: 'You find a flashlight.' }] });
{
    const w = world();
    w.gameRules.universalChecks.rules = [discovery.defaultRule(1)];
    const result = executeLinkedActions(proposal(), w, session());
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.outcomes.get('search'), 'succeeded');
    assert.equal(result.working.getEntity('found_light').state.containerId, 'drawer');
    assert.equal(result.checkResults[0].check_type, 'existence');
    const persisted = JSON.parse(JSON.stringify(result.working.prepare()));
    assert.equal(persisted.world.entities.filter(item => item.id === 'found_light').length, 1);
    assert.equal(persisted.session.discoveryDecisions['["drawer","electric light"]'].success, true);
}
{
    const w = world();
    w.gameRules.universalChecks.rules = [discovery.defaultRule(21)];
    const result = executeLinkedActions(proposal(), w, session());
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.outcomes.get('search'), 'failed');
    assert.equal(result.working.getEntity('found_light').definition, undefined);
    assert.equal(result.events.length, 0);
    assert.equal(result.working.getSession('discoveryDecisions')['["drawer","electric light"]'].success, false);
}
{
    const w = world();
    w.entities.push({ id: 'authored_light', type: 'item', name: 'flashlight',
        startLocation: 'kitchen', properties: { containerId: 'drawer' } });
    const s = session();
    s.entityStates.authored_light = { location: 'kitchen', containerId: 'drawer' };
    const result = executeLinkedActions(proposal(), w, s);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.working.prepare().world.entities.filter(item =>
        item.name === 'flashlight').length, 1);
    assert.equal(result.checkResults.length, 0);
    assert.match(result.narrative, /existing flashlight/);
}
{
    const w = world('medieval');
    w.entities[0].contentsMode = 'fixed';
    w.entities.push({ id: 'authored_light', type: 'item', name: 'flashlight',
        startLocation: 'kitchen', properties: { containerId: 'drawer' } });
    const s = session();
    s.entityStates.authored_light = { location: 'kitchen', containerId: 'drawer' };
    const { result } = resolve(w, s, 'flashlight', 1);
    assert.equal(result.type, 'existing', 'authored exception outranks generic era');
    assert.equal(result.objectId, 'authored_light');
}
{
    const w = world();
    w.gameRules.universalChecks.rules = [discovery.defaultRule(1)];
    const s = session();
    s.entityStates.linda.goal = 'find a flashlight';
    s.entityStates.linda.goalStatus = 'active';
    const option = npcGoals.npcGoalOptions(w.entities[1], w, s)
        .find(item => item.effect.type === 'item_introduce');
    assert(option);
    const result = npcGoals.executeNpcGoalStep(w.entities[1], option, w, s);
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.candidate.world.entities.some(item => item.id === option.effect.payload.id), true);
    assert.equal(result.candidate.session.entityStates[option.effect.payload.id].containerId, 'drawer');
    assert.equal(s.discoveryDecisions, undefined, 'uncommitted NPC state must remain isolated');
    const reloaded = JSON.parse(JSON.stringify(result.candidate));
    const pickup = npcGoals.npcGoalOptions(w.entities[1], reloaded.world, reloaded.session)
        .find(item => item.effect.type === 'item_transfer'
            && item.effect.payload.item_id === option.effect.payload.id);
    assert(pickup, 'NPC can later take the same registered instance');
}
{
    const w = world();
    w.gameRules.universalChecks.rules = [discovery.defaultRule(1)];
    const input = 'I search the drawer for a flashlight.';
    const fields = Object.fromEntries(['type', 'actor_id', 'status', 'item', 'target_id']
        .map(key => [key, { type: 'string' }]));
    const canonical = scene.schema({ events: { type: 'array', items: { type: 'object',
        properties: fields, required: ['type', 'actor_id', 'status'] } } },
        'scene_draft_v3', { linkedRequired: true });
    const proposal = { protocol: 'scene_draft_v3', actions: [{ kind: 'physical',
        status: 'resolved', effects: [], response: [{ text: 'The drawer has no flashlight.' }] }] };
    const bound = binding.bind(proposal, { turnId: 'turn_p43h', input, playerLocation: 'kitchen',
        references: [{ id: 'drawer', name: 'drawer', type: 'item', locationId: 'kitchen' }],
        dynamicDiscovery: { enabled: true, containers: [{ id: 'drawer', name: 'drawer' }] },
        prepareCertainEffects: true }, canonical);
    assert.equal(bound.ok, true, JSON.stringify(bound.errors));
    assert.equal(bound.draft.actions[0].action_effects.item_introduce.length, 1);
    const compiled = scene.compile(bound.draft, { input, location: 'kitchen',
        playerStart: 'kitchen', present: ['linda'], locations: ['kitchen'],
        linkedRequired: true, contract: canonical });
    assert.equal(compiled.ok, true, JSON.stringify(compiled.errors));
    const executed = executeLinkedActions(compiled.linkedPlan, w, session());
    assert.equal(executed.ok, true, JSON.stringify(executed.errors));
    assert.equal(executed.outcomes.get(compiled.linkedPlan.actions[0].action_id), 'succeeded');
    assert.match(executed.narrative, /find a flashlight/);
}
{
    const input = 'I look for a flashlight in the drawer.';
    const fields = Object.fromEntries(['type', 'actor_id', 'status', 'item', 'target_id']
        .map(key => [key, { type: 'string' }]));
    const canonical = scene.schema({ events: { type: 'array', items: { type: 'object',
        properties: fields, required: ['type', 'actor_id', 'status'] } } }, 'scene_draft_v3');
    const bound = binding.bind({ protocol: 'scene_draft_v3', actions: [{ kind: 'observation',
        status: 'resolved', effects: [], response: [{ text: 'You look.' }] }] },
    { turnId: 'look_synonym', input, playerLocation: 'kitchen',
        references: [], prepareCertainEffects: true,
        dynamicDiscovery: { enabled: true, containers: [{ id: 'drawer', name: 'drawer' }] } },
    canonical);
    assert.equal(bound.ok, true, JSON.stringify(bound.errors));
    assert.equal(bound.draft.actions[0].action_effects.item_introduce[0].name, 'flashlight');
}
{
    const w = world();
    const input = 'I take the chair.';
    const fields = Object.fromEntries(['type', 'actor_id', 'status', 'item', 'target_id', 'action']
        .map(key => [key, { type: 'string' }]));
    const canonical = scene.schema({ events: { type: 'array', items: { type: 'object',
        properties: fields, required: ['type', 'actor_id', 'status'] } } },
        'scene_draft_v3', { linkedRequired: true });
    const proposal = { protocol: 'scene_draft_v3', actions: [{ kind: 'physical',
        status: 'resolved', effects: [], response: [{ text: 'You take the chair.' }] }] };
    const bound = binding.bind(proposal, { turnId: 'turn_ambient', input,
        playerLocation: 'kitchen', references: [], prepareCertainEffects: true,
        dynamicDiscovery: { enabled: true, locationDescription: w.locations[0].description,
            containers: [] } }, canonical);
    assert.equal(bound.ok, true, JSON.stringify(bound.errors));
    assert.equal(bound.draft.events.filter(event => event.type === 'inventory').length, 1);
    const compiled = scene.compile(bound.draft, { input, location: 'kitchen',
        playerStart: 'kitchen', present: ['linda'], locations: ['kitchen'],
        linkedRequired: true, contract: canonical });
    assert.equal(compiled.ok, true, JSON.stringify(compiled.errors));
    const executed = executeLinkedActions(compiled.linkedPlan, w, session());
    assert.equal(executed.ok, true, JSON.stringify(executed.errors));
    assert.equal(executed.working.getSession('inventory').length, 1);
    assert.equal(executed.checkResults.length, 0, 'grounded ambient object needs no existence roll');
    assert.equal(executed.working.prepare().world.entities.filter(item => item.name === 'chair').length, 1);
}
console.log('PASS P4.3h plausibility, container modes, d20, NPC, repeat, ambient');
