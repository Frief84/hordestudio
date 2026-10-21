/** World Agent proposals must save atomically or leave no new world state. */
'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildContext } = require('./app_source.js');

(async () => {
    const world = { id: 'w', entities: [] };
    const session = { id: 's', turnCount: 10, _worldEpoch: 0, marker: 'before', worldNews: [] };
    const state = { worldInstances: { w: { sessions: [session] } } };
    let saves = 0;
    let feedback = 0;
    let rejectActions = false;
    let failSave = false;
    let staleResponse = false;
    let persisted = null;
    let payload = { developments: [{ summary: 'An NPC plans a meeting.' }],
        world_events: [{ id: 'meeting', title: 'Meeting', due_turn: 12 }] };
    const context = buildContext(vm, ['runWorldAgent', 'attemptWorldStateMutation',
        'shouldRunWorldAgent'], {
        state, worldTurnInProgress: false, worldMutationInProgress: false,
        normalizeWorldAgentConfig: () => ({ model: 'fixture/model', enabled: true, intervalTurns: 8 }),
        normalizeWorldGameRules: () => ({ modules: { livingWorld: true } }),
        buildWorldAgentDigest: () => 'fixture world',
        authHeaders: () => ({}),
        fetchWorldObservedJSON: async () => {
            if (staleResponse) state.worldInstances.w.sessions[0]._worldEpoch++;
            return ({
            response: { ok: true },
            data: { choices: [{ message: { content: JSON.stringify(payload) } }] }, diagnostic: () => null
        }); },
        parseWorldAgentPayload: JSON.parse,
        sanitizeWorldAgentActions: parsed => ({ actions: { world_events: parsed.world_events }, dropped: 0 }),
        normalizeLivingWorldState: () => {}, normalizePlayerRulesState: () => {},
        processStructuredActions: (actions, _world, sess) => {
            if (actions.world_events[0].id === 'unchanged') return { moduleRejections: [], feedback: [] };
            if (actions.world_events[0].id === 'denied') return { moduleRejections: [{ reason: 'invalid' }], feedback: [] };
            sess.marker = 'tentative';
            world.entities.push({ id: 'new_person', sessionOrigin: sess.id });
            return { moduleRejections: rejectActions ? [{ reason: 'invalid' }] : [], feedback: [] };
        },
        addWorldNews: (sess, summary) => sess.worldNews.push(summary),
        captureWorldTurnState: (_world, sess) => ({ session: { marker: sess.marker,
            worldNews: [...sess.worldNews] }, world: { entities: JSON.parse(JSON.stringify(world.entities)) } }),
        restoreWorldTurnState: (_world, sess, snapshot) => {
            sess.marker = snapshot.session.marker;
            sess.worldNews = [...snapshot.session.worldNews];
            world.entities = JSON.parse(JSON.stringify(snapshot.world.entities));
            return true;
        },
        saveWorldsState: async () => { saves++; if (failSave) throw new Error('disk failed');
            persisted = JSON.parse(JSON.stringify({ session: state.worldInstances.w.sessions[0],
                entities: world.entities })); },
        flushWorldActionFeedback: () => { feedback++; }
    });

    rejectActions = true;
    const rejected = await context.runWorldAgent(world, session);
    assert.equal(rejected.applied, false);
    assert.equal(rejected.rejected.length, 1);
    assert.equal(session.marker, 'before');
    assert.deepEqual(world.entities, []);
    assert.deepEqual(session.worldNews, []);
    assert.equal(feedback, 0);
    assert.equal(saves, 1, 'a rejected proposal only persists the attempted interval');
    assert.equal(context.worldMutationInProgress, false);

    rejectActions = false;
    failSave = true;
    await assert.rejects(context.runWorldAgent(world, session), /disk failed/);
    assert.equal(session.marker, 'before');
    assert.deepEqual(world.entities, []);
    assert.deepEqual(session.worldNews, []);
    assert.equal(feedback, 0);
    assert.equal(context.worldMutationInProgress, false);

    failSave = false;
    const accepted = await context.runWorldAgent(world, session);
    assert.equal(accepted.applied, true);
    assert.equal(session.marker, 'tentative');
    assert.equal(world.entities[0].id, 'new_person');
    assert.deepEqual(session.worldNews, ['World update confirmed: world_events (world_events_0).']);
    assert(!session.worldNews.includes('An NPC plans a meeting.'), 'unbound model prose is never published');
    assert.equal(feedback, 1, 'feedback occurs after the save succeeds');
    assert.equal(context.worldMutationInProgress, false);
    assert.deepEqual(persisted.session.worldNews, session.worldNews, 'save contains the confirmed news');
    const reloaded = JSON.parse(JSON.stringify(persisted.session));
    state.worldInstances.w.sessions = [reloaded];
    assert.equal(context.shouldRunWorldAgent(world, reloaded), false,
        'a saved interval does not automatically replay after reload');

    const reset = () => {
        world.entities = [];
        const next = { id: 's', turnCount: 11, _worldEpoch: 0,
            marker: 'before', worldNews: [] };
        state.worldInstances.w.sessions = [next];
        return next;
    };
    let current = reset();
    payload = { developments: [{ summary: 'A false success.' }],
        world_events: [{ id: 'unchanged', title: 'No effect' }] };
    const noEffect = await context.runWorldAgent(world, current);
    assert.equal(noEffect.applied, false);
    assert.equal(noEffect.outcomes[0].outcome, 'unresolved');
    assert.deepEqual(current.worldNews, []);

    current = reset();
    payload = { developments: [{ summary: 'Both changes succeeded.' }], world_events: [
        { id: 'denied', action_id: 'first' },
        { id: 'accepted', action_id: 'second' }
    ] };
    const independent = await context.runWorldAgent(world, current);
    assert.equal(independent.applied, true);
    assert.deepEqual(Array.from(independent.outcomes, item => item.outcome), ['blocked', 'succeeded']);
    assert.equal(world.entities.length, 1, 'accepted independent action survives in one save');
    assert.deepEqual(current.worldNews,
        ['World update confirmed: world_events (second).']);
    assert.equal(persisted.entities.length, 1);

    current = reset();
    payload = { world_events: [
        { id: 'first_effect', action_id: 'joint' },
        { id: 'second_effect', action_id: 'joint' }
    ] };
    const grouped = await context.runWorldAgent(world, current);
    assert.equal(grouped.applied, true);
    assert.equal(grouped.outcomes.length, 1, 'effects of one action share one receipt');
    assert.equal(current.worldNews.length, 1, 'one grouped action publishes once');

    current = reset();
    payload = { world_events: [
        { id: 'denied', action_id: 'first' },
        { id: 'accepted', action_id: 'second',
            depends_on: [{ action_id: 'first', outcome: 'succeeded' }] }
    ] };
    const dependent = await context.runWorldAgent(world, current);
    assert.equal(dependent.applied, false);
    assert.deepEqual(Array.from(dependent.outcomes, item => item.outcome), ['blocked', 'skipped']);
    assert.deepEqual(world.entities, []);
    assert.deepEqual(current.worldNews, []);

    current = reset();
    staleResponse = true;
    const stale = await context.runWorldAgent(world, current);
    staleResponse = false;
    assert.equal(stale.stale, true);
    assert.deepEqual(world.entities, []);
    assert.deepEqual(current.worldNews, []);
    console.log('✓ World Agent confirms only saved effects; independent, dependent, stale and rollback cases pass');
})().catch(error => { console.error(error); process.exitCode = 1; });
