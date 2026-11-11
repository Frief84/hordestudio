'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const binding = require('../worlds/turn-binding');
const scene = require('../worlds/scene-draft');
const linked = require('../worlds/linked-world-actions');
const root = path.resolve(__dirname, '..');
const captured = require('./world-chair-c-engine-2026-11-01-r5.json')[0];
const fixture = JSON.parse(captured.bindingResponses[0].request);
const defaultInput = 'I kneel, then wave to Linda and say "Hello."';
const input = process.env.HORDE_NODE_LIVE_INPUT || defaultInput;
const context = { ...fixture.context, worldId: 'node_live_multi_action',
    sessionId: 'isolated_node_live', nonce: crypto.randomUUID(), input,
    playerName: '', singleRequest: false, prepareCertainEffects: true };
context.references = fixture.context.references.filter(ref => ref.id !== 'chair');
const canonical = fixture.canonical;
const model = process.env.HORDE_LIVE_MODEL || 'gemma4:31b-it-q4_K_M';
const outputPath = process.env.HORDE_LIVE_OUTPUT || path.join(root, 'scratch',
    'world-multi-action-node-live-2026-11-01.json');
(async () => {
    const started = Date.now();
    const schema = binding.schema(canonical, { requireRequest: true, allowCommitments: false });
    schema.properties.actions.items.properties.status.enum = schema.properties.actions.items
        .properties.status.enum.filter(status => status !== 'pending_check');
    const prompt = `World: a simple kitchen. Linda is present and can observe the player. `
        + `The player is in the kitchen. Ground ordinary gestures and postures; do not invent `
        + `object state changes. Split independent steps in order. Each request is an exact `
        + `consecutive excerpt of the input. A completed local pose or gesture requires an `
        + `actor-scoped completed activity or interaction event. Preserve quoted speech `
        + `exactly in response text and speech evidence. Use status resolved and effects:[] `
        + `for completed ordinary steps. Use activity for a pose and action for an `
        + `interaction; do not use event label. Input: ${input}`;
    const response = await fetch('http://127.0.0.1:11434/v1/chat/completions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, stream: false, max_tokens: 4096,
            messages: [{ role: 'system', content: prompt },
                { role: 'user', content: input }],
            response_format: { type: 'json_schema', json_schema: {
                name: 'scene_draft_v3', schema } } }),
        signal: AbortSignal.timeout(300000)
    });
    const payload = await response.json();
    const generationMs = Date.now() - started;
    const content = payload.choices?.[0]?.message?.content || '';
    let proposal, bound, compiled, executed;
    const validationStarted = Date.now();
    try {
        proposal = JSON.parse(content);
        const turnId = 'turn_' + crypto.createHash('sha256').update(JSON.stringify([
            context.worldId, context.sessionId, context.version, context.nonce, context.input
        ])).digest('hex').slice(0, 24);
        bound = binding.bind(proposal, { ...context, turnId }, canonical);
        if (bound.ok) {
            compiled = scene.compile(bound.draft, { input, location: 'foyer',
                playerStart: 'foyer', present: ['linda'], locations: ['foyer', 'round'],
                now: 485, linkedRequired: true, contract: canonical });
            if (compiled.ok) {
                const world = { id: context.worldId,
                    locations: [{ id: 'foyer', exits: [] }, { id: 'round', exits: [] }],
                    entities: [{ id: 'linda', type: 'npc', name: 'Linda' }] };
                const session = { id: context.sessionId, playerLocation: 'foyer',
                    turnCount: 0, inventory: [], entityStates: { linda: { location: 'foyer' } },
                    locationStates: {}, npcRelationships: {}, engineEvents: [],
                    worldStateVersion: 1, worldClock: { absoluteMinutes: 485,
                        turnCount: 0, bonusTimeMinutes: 0 } };
                executed = linked.executeLinkedActions(compiled.linkedPlan, world, session,
                    { worldActionIds: bound.binding.worldActionIds });
            }
        }
    } catch (error) { executed = { error: String(error) }; }
    const output = { model, input, generationMs,
        validationMs: Date.now() - validationStarted,
        durationMs: Date.now() - started,
        httpStatus: response.status, usage: payload.usage || null, proposal,
        repairCount: bound?.binding?.repairs?.length || 0,
        boundErrors: bound?.errors, compiledErrors: compiled?.errors,
        executorErrors: executed?.errors, executorOk: executed?.ok,
        actions: bound?.draft?.actions, events: bound?.draft?.events,
        speech: bound?.draft?.speech, error: executed?.error,
        content: proposal ? undefined : content };
    const playerActions = (output.actions || []).filter(action =>
        String(action.request || '').trim());
    output.complete = input !== defaultInput ? undefined : !!executed?.ok
        && playerActions.length === 3
        && playerActions[0].kind === 'physical'
        && playerActions[1].kind === 'physical'
        && playerActions[2].kind === 'speech'
        && playerActions.slice(0, 2).every(action => output.events?.some(event =>
            event.action_id === action.action_id && event.actor_id === 'player'
            && event.status === 'completed'
            && ['activity', 'interaction'].includes(event.type)))
        && output.speech?.length === 1 && output.speech[0].quote === 'Hello.'
        && output.speech[0].action_id === playerActions[2].action_id;
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(JSON.stringify({ file: outputPath, generationMs: output.generationMs,
        validationMs: output.validationMs, durationMs: output.durationMs,
        httpStatus: output.httpStatus, usage: output.usage,
        repairCount: output.repairCount,
        actions: output.actions?.length, events: output.events?.length,
        speech: output.speech?.length, boundErrors: output.boundErrors,
        compiledErrors: output.compiledErrors, executorErrors: output.executorErrors,
        executorOk: output.executorOk, complete: output.complete,
        error: output.error }));
    if (!response.ok || !executed?.ok || output.complete === false) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
