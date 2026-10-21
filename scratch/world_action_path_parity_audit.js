/** P0b.2a: identical Living Worlds state through agent, scheduler and linked actions. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext();
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname !== 'world-action-parity.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
                return route.fulfill({ status: 404, body: '' });
            const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream';
            return route.fulfill({ contentType: mime, body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        await page.goto('https://world-action-parity.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer,
            null, { timeout: 30000 });
        const result = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            const world = {
                id: 'action_parity', name: 'Action parity', startLocationId: 'a',
                hudConfig: { timeStep: 0, startTimeHours: 8, enableSchedules: true },
                locations: [
                    { id: 'a', name: 'A', exits: [{ targetLocationId: 'b', travelTime: 60 }] },
                    { id: 'b', name: 'B', exits: [{ targetLocationId: 'a', travelTime: 60 }] }
                ],
                entities: [
                    { id: 'n', name: 'N', type: 'npc', startLocation: 'a',
                        schedule: [{ time: '09:00', locationId: 'b', activity: 'visiting' }] },
                    { id: 'm', name: 'M', type: 'npc', startLocation: 'a' }
                ]
            };
            const base = { id: 'action_session', history: [], turnCount: 1,
                playerLocation: 'a', worldClock: { absoluteMinutes: 540,
                    turnCount: 1, bonusTimeMinutes: 0 },
                entityStates: { n: { location: 'a' }, m: { location: 'a' } },
                placeDiscoveries: { n: ['b'] }, worldStateVersion: 1 };
            normalizeLivingWorldState(world, base);
            const clone = value => structuredClone(value);
            const worldAgentFields = sanitizeWorldAgentActions({
                npc_moves: [{ npc_id: 'n', location_id: 'b' }], location_id: 'b'
            });
            const agent = clone(base);
            const agentResult = processStructuredActions(worldAgentFields.actions, clone(world), agent,
                { deferFeedback: true });
            const scheduled = clone(base);
            const scheduleResult = syncNPCSchedules(clone(world), scheduled);
            const plan = { actions: [{ action_id: 'move_n', kind: 'other', status: 'resolved',
                response_id: 'move_p', action_effects: { actor_move: [
                    { actor_id: 'n', to_location_id: 'b' }] } }],
            events: [{ action_id: 'move_n', passage_id: 'move_p', type: 'movement',
                actor_id: 'n', status: 'completed', from_location_id: 'a', to_location_id: 'b' }],
            narrative: [{ id: 'move_p', action_id: 'move_n', text: 'N travels to B.' }] };
            const canMove = (candidateWorld, candidateSession, actorId, fromId, toId,
                options) => worldLinkedMovementVerdict(candidateWorld, candidateSession,
                    actorId, fromId, toId, options, 540);
            const movementContext = { canMove, startJourney: startLinkedNpcJourney,
                syncClockEffects: working => working.applyDetached((candidateWorld, candidateSession) =>
                    runLivingWorldTick(structuredClone(candidateWorld), candidateSession,
                        { clockOnly: true })),
                worldActionIds: ['move_n'], requireEffectWitnesses: true };
            const linked = HordeLinkedWorldActions.executeLinkedActions(plan, world, clone(base),
                movementContext);
            const journeyPlan = clone(plan);
            journeyPlan.actions[0].action_effects.actor_move[0].mode = 'journey';
            journeyPlan.events[0].type = 'activity';
            delete journeyPlan.events[0].from_location_id;
            const journey = HordeLinkedWorldActions.executeLinkedActions(journeyPlan,
                world, clone(base), movementContext);
            if (!journey.ok) throw new Error(JSON.stringify(journey.errors));
            const journeyAtThirty = clone(journey.working.prepare().session);
            HordeWorldTime.advanceMinutes(world, journeyAtThirty, 30);
            syncNPCSchedules(world, journeyAtThirty);
            const journeyAtSixty = clone(journeyAtThirty);
            HordeWorldTime.advanceMinutes(world, journeyAtSixty, 30);
            syncNPCSchedules(world, journeyAtSixty);
            const backgroundWorld = clone(world);
            backgroundWorld.hudConfig.timeStep = 5;
            backgroundWorld.settings = { timeAdvancesWhenAway: true };
            const backgroundStart = clone(journey.working.prepare().session);
            backgroundStart.lastBackgroundSeenAt = 1000000;
            const backgroundArrival = HordeBackgroundSim.catchUp(backgroundWorld,
                backgroundStart, 1600000, false, (candidateWorld, candidateSession) => {
                    syncNPCSchedules(candidateWorld, candidateSession);
                    return [];
                });
            const interrupted = clone(journeyAtThirty);
            interrupted.locationStates.b = { conditions: [{ id: 'closed', label: 'closed route',
                blocksTravel: true }] };
            HordeWorldTime.advanceMinutes(world, interrupted, 30);
            syncNPCSchedules(world, interrupted);
            const noWitness = HordeLinkedWorldActions.executeLinkedActions({ ...journeyPlan, events: [] },
                world, clone(base), movementContext);
            const unknownPlace = clone(base);
            unknownPlace.placeDiscoveries = {};
            const unknownWorld = clone(world);
            unknownWorld.entities[0].schedule = [];
            const unknownAgent = processStructuredActions({ npc_moves: [
                { npc_id: 'n', location_id: 'b' }] }, unknownWorld, unknownPlace, { deferFeedback: true });
            const unknownLinked = HordeLinkedWorldActions.executeLinkedActions(journeyPlan, unknownWorld,
                clone(unknownPlace), movementContext);
            const deniedWorld = clone(world);
            deniedWorld.locations[1].access = { default: 'restricted', npcs: { n: 'deny' } };
            const deniedAgent = processStructuredActions({ npc_moves: [
                { npc_id: 'n', location_id: 'b' }] }, deniedWorld, clone(base), { deferFeedback: true });
            const deniedLinked = HordeLinkedWorldActions.executeLinkedActions(journeyPlan, deniedWorld,
                clone(base), movementContext);
            const blockedJourneyPlan = clone(journeyPlan);
            blockedJourneyPlan.actions[0].status = 'blocked';
            blockedJourneyPlan.events = [];
            const blockedJourney = HordeLinkedWorldActions.executeLinkedActions(blockedJourneyPlan,
                deniedWorld, clone(base), movementContext);
            const lockedWorld = clone(world);
            lockedWorld.locations[0].exits[0].requiredItem = 'key';
            const lockedAgent = processStructuredActions({ npc_moves: [
                { npc_id: 'n', location_id: 'b' }] }, lockedWorld, clone(base), { deferFeedback: true });
            const lockedLinked = HordeLinkedWorldActions.executeLinkedActions(journeyPlan, lockedWorld,
                clone(base), movementContext);
            const elapsedPlan = clone(plan);
            elapsedPlan.actions.unshift({ action_id: 'elapsed', kind: 'wait', status: 'resolved',
                response_id: 'elapsed_p', action_effects: { time_advance: [{ minutes: 60 }] } });
            elapsedPlan.narrative.unshift({ id: 'elapsed_p', action_id: 'elapsed', text: 'An hour passes.' });
            const afterTime = HordeLinkedWorldActions.executeLinkedActions(elapsedPlan,
                world, clone(base), movementContext);
            const closureSession = clone(base);
            closureSession.lastLivingWorldMinute = 540;
            closureSession.scheduledEvents = [{ id: 'route_closes', title: 'Route closes',
                description: 'The path is blocked.', locationId: 'b',
                conditionOnTrigger: 'impassable', dueMinute: 600, status: 'scheduled' }];
            const closurePlan = clone(elapsedPlan);
            closurePlan.actions[1].status = 'blocked';
            closurePlan.events = [];
            const dueClosure = HordeLinkedWorldActions.executeLinkedActions(closurePlan,
                world, closureSession, movementContext);
            const teleportPlan = clone(plan);
            teleportPlan.actions[0].action_effects.actor_move[0].mode = 'teleport';
            teleportPlan.events[0].movement_mode = 'teleport';
            teleportPlan.events[0].cause = 'An explicit portal opens.';
            const direct = HordeLinkedWorldActions.executeLinkedActions(teleportPlan,
                world, clone(base), movementContext);
            const directDuringJourney = HordeLinkedWorldActions.executeLinkedActions(teleportPlan,
                world, clone(journey.working.prepare().session), movementContext);
            const directAcrossLock = HordeLinkedWorldActions.executeLinkedActions(teleportPlan,
                lockedWorld, clone(base), movementContext);
            const directAcrossDenial = HordeLinkedWorldActions.executeLinkedActions(teleportPlan,
                deniedWorld, clone(base), movementContext);
            const unprovedTeleport = clone(teleportPlan);
            delete unprovedTeleport.events[0].cause;
            const directWithoutCause = HordeLinkedWorldActions.executeLinkedActions(
                unprovedTeleport, world, clone(base), movementContext);
            const keyedWorld = clone(lockedWorld);
            const keyedSession = clone(base);
            keyedSession.entityStates.n.inventory = ['key'];
            const keyedLinked = HordeLinkedWorldActions.executeLinkedActions(journeyPlan,
                keyedWorld, keyedSession, movementContext);
            const exploringPlan = clone(journeyPlan);
            exploringPlan.actions[0].action_effects.actor_move[0].explore = true;
            exploringPlan.events[0].explore = true;
            const explored = HordeLinkedWorldActions.executeLinkedActions(exploringPlan,
                unknownWorld, clone(unknownPlace), movementContext);
            const multiWorld = clone(world);
            multiWorld.locations[1].exits.push({ targetLocationId: 'c', travelTime: 30 });
            multiWorld.locations.push({ id: 'c', name: 'C', exits: [
                { targetLocationId: 'b', travelTime: 30 }] });
            multiWorld.entities[0].schedule[0].locationId = 'c';
            const multiBase = clone(base);
            multiBase.placeDiscoveries.n = ['b', 'c'];
            const multiAgent = clone(multiBase);
            processStructuredActions({ npc_moves: [{ npc_id: 'n', location_id: 'c' }] },
                multiWorld, multiAgent, { deferFeedback: true });
            const multiSchedule = clone(multiBase);
            syncNPCSchedules(multiWorld, multiSchedule);
            const multiJourneyPlan = clone(journeyPlan);
            multiJourneyPlan.actions[0].action_effects.actor_move[0].to_location_id = 'c';
            multiJourneyPlan.events[0].to_location_id = 'c';
            const multiLinked = HordeLinkedWorldActions.executeLinkedActions(multiJourneyPlan,
                multiWorld, clone(multiBase), movementContext);
            const twoLegs = clone(elapsedPlan);
            twoLegs.actions.push({ action_id: 'move_c', kind: 'other', status: 'resolved',
                response_id: 'move_c_p', action_effects: { actor_move: [
                    { actor_id: 'n', to_location_id: 'c' }] } });
            twoLegs.events.push({ action_id: 'move_c', passage_id: 'move_c_p', type: 'movement',
                actor_id: 'n', status: 'completed', from_location_id: 'b', to_location_id: 'c' });
            twoLegs.narrative.push({ id: 'move_c_p', action_id: 'move_c', text: 'N reaches C.' });
            const twoLegContext = { ...movementContext, worldActionIds: ['move_n', 'move_c'] };
            const earlySecondLeg = HordeLinkedWorldActions.executeLinkedActions(twoLegs,
                multiWorld, clone(multiBase), twoLegContext);
            const enoughForBoth = clone(twoLegs);
            enoughForBoth.actions.splice(2, 0, { action_id: 'more_time', kind: 'wait',
                status: 'resolved', response_id: 'more_time_p',
                action_effects: { time_advance: [{ minutes: 30 }] } });
            enoughForBoth.narrative.push({ id: 'more_time_p', action_id: 'more_time',
                text: 'Another half hour passes.' });
            const completedTwoLegs = HordeLinkedWorldActions.executeLinkedActions(enoughForBoth,
                multiWorld, clone(multiBase), twoLegContext);
            const companionWorld = clone(world);
            companionWorld.entities.push({ id: 'c', name: 'C', type: 'npc', startLocation: 'a' });
            const companionSession = clone(base);
            companionSession.entityStates.c = { location: 'a', followingPlayer: true };
            const companionPlan = clone(elapsedPlan);
            companionPlan.actions[1].action_effects.actor_move[0].actor_id = 'player';
            companionPlan.actions[1].action_effects.actor_move[0].companion_ids = ['c'];
            companionPlan.events[0].actor_id = 'player';
            const accompanied = HordeLinkedWorldActions.executeLinkedActions(companionPlan,
                companionWorld, companionSession, movementContext);
            const keyedCompanionWorld = clone(companionWorld);
            keyedCompanionWorld.locations[0].exits[0].requiredItem = 'key';
            const keyedCompanionSession = clone(companionSession);
            keyedCompanionSession.inventory = ['key'];
            const keyedCompanion = HordeLinkedWorldActions.executeLinkedActions(companionPlan,
                keyedCompanionWorld, keyedCompanionSession, movementContext);
            const dependent = HordeLinkedWorldActions.executeLinkedActions({
                actions: [
                    { ...plan.actions[0], status: 'blocked' },
                    { action_id: 'after_move', kind: 'other', status: 'resolved',
                        depends_on: [{ action_id: 'move_n', outcome: 'succeeded' }],
                        action_effects: { relation_set: [
                            { subject_id: 'n', target_id: 'm', value: 20 }] } }
                ], events: [], narrative: []
            }, deniedWorld, clone(base), { canMove, worldActionIds: ['move_n', 'after_move'] });

            const disabledWorld = clone(world);
            disabledWorld.gameRules = { profileId: 'custom', modules: { relationships: false } };
            const structuredRelation = clone(base);
            const structuredRelationResult = processStructuredActions({ npc_relationship_updates: [
                { source_npc_id: 'n', target_npc_id: 'm', change: 20, reason: 'A shared event.' }
            ] }, disabledWorld, structuredRelation, { deferFeedback: true });
            const relationPlan = { actions: [{ action_id: 'relate', kind: 'other', status: 'resolved',
                response_id: 'relate_p', action_effects: { relation_set: [
                    { subject_id: 'n', target_id: 'm', value: 20 }] } }],
            events: [{ action_id: 'relate', passage_id: 'relate_p', type: 'relationship',
                actor_id: 'n', target_id: 'm', status: 'completed' }],
            narrative: [{ id: 'relate_p', action_id: 'relate', text: 'Their relationship changes.' }] };
            const linkedRelation = HordeLinkedWorldActions.executeLinkedActions(relationPlan,
                disabledWorld, clone(base), { worldActionIds: ['relate'], requireEffectWitnesses: true });
            const unwitnessedRelation = clone(base);
            const unwitnessedStructured = processStructuredActions({ npc_relationship_updates: [
                { source_npc_id: 'n', target_npc_id: 'm', change: 20 }
            ] }, clone(world), unwitnessedRelation, { deferFeedback: true });
            const unwitnessedLinked = HordeLinkedWorldActions.executeLinkedActions(
                { ...relationPlan, events: [] }, world, clone(base),
                { worldActionIds: ['relate'], requireEffectWitnesses: true });
            const missingReference = clone(base);
            const missingStructured = processStructuredActions({ npc_relationship_updates: [
                { source_npc_id: 'missing_npc', target_npc_id: 'm', change: 20 }
            ] }, clone(world), missingReference, { deferFeedback: true });
            const missingPlan = clone(relationPlan);
            missingPlan.actions[0].action_effects.relation_set[0].subject_id = 'missing_npc';
            missingPlan.events[0].actor_id = 'missing_npc';
            const missingLinked = HordeLinkedWorldActions.executeLinkedActions(missingPlan,
                world, clone(base), { worldActionIds: ['relate'], requireEffectWitnesses: true });
            const relationStart = clone(base);
            relationStart.npcRelationships['m|n'] = { score: 10 };
            const validRelationEvent = { ...relationPlan.events[0], change: 20,
                cause: 'N and M cooperated.' };
            const relativeSession = clone(relationStart);
            const relativeResult = processStructuredActions({ npc_relationship_updates: [
                { source_npc_id: 'n', target_npc_id: 'm', change: 20,
                    reason: 'N and M cooperated.' }
            ] }, clone(world), relativeSession, { deferFeedback: true,
                relationshipEvents: [validRelationEvent] });
            const v2Session = clone(relationStart);
            const v2Receipt = commitWorldTurnReceipt(clone(world), v2Session, {
                version: 2, turn_id: 'relation_v2', summary: 'N and M cooperated.',
                scene: { player_location_id: 'a', player_location_changed: false,
                    present_character_ids: ['n', 'm'] },
                events: [{ type: 'relationship', actor_id: 'n', target_id: 'm',
                    status: 'completed', change: 20, cause: 'N and M cooperated.' }],
                entity_updates: [], state_updates: {}
            }, { deferFeedback: true }, 'fixture');
            const v2UnwitnessedSession = clone(relationStart);
            const v2Unwitnessed = commitWorldTurnReceipt(clone(world),
                v2UnwitnessedSession, {
                    version: 2, turn_id: 'relation_without_event',
                    scene: { player_location_id: 'a', player_location_changed: false,
                        present_character_ids: ['n', 'm'] },
                    events: [], entity_updates: [], state_updates: {
                        npc_relationship_updates: [{ source_npc_id: 'n',
                            target_npc_id: 'm', change: 20 }]
                    }
                }, { deferFeedback: true }, 'fixture');
            const absolutePlan = clone(relationPlan);
            absolutePlan.actions[0].action_effects.relation_set[0].value = 30;
            absolutePlan.events = [validRelationEvent];
            const absoluteResult = HordeLinkedWorldActions.executeLinkedActions(absolutePlan,
                world, clone(relationStart), { worldActionIds: ['relate'],
                    requireEffectWitnesses: true });
            const wrongChangePlan = clone(absolutePlan);
            wrongChangePlan.events[0].change = 19;
            const wrongChange = HordeLinkedWorldActions.executeLinkedActions(wrongChangePlan,
                world, clone(relationStart), { worldActionIds: ['relate'],
                    requireEffectWitnesses: true });
            const reusedWitnessPlan = clone(absolutePlan);
            reusedWitnessPlan.actions[0].action_effects.relation_set.push({
                subject_id: 'n', target_id: 'm', value: 50 });
            const reusedWitness = HordeLinkedWorldActions.executeLinkedActions(
                reusedWitnessPlan, world, clone(relationStart),
                { worldActionIds: ['relate'], requireEffectWitnesses: true });
            const wrongTypeWorld = clone(world);
            wrongTypeWorld.entities.push({ id: 'object_1', name: 'Object', type: 'item',
                startLocation: 'a' });
            const wrongTypePlan = clone(absolutePlan);
            wrongTypePlan.actions[0].action_effects.relation_set[0].subject_id = 'object_1';
            wrongTypePlan.events[0].actor_id = 'object_1';
            const wrongType = HordeLinkedWorldActions.executeLinkedActions(wrongTypePlan,
                wrongTypeWorld, clone(relationStart), { worldActionIds: ['relate'],
                    requireEffectWitnesses: true });
            const playerFeelingPlan = clone(absolutePlan);
            playerFeelingPlan.actions[0].action_effects.relation_set[0].subject_id = 'player';
            playerFeelingPlan.events[0].actor_id = 'player';
            const playerFeeling = HordeLinkedWorldActions.executeLinkedActions(
                playerFeelingPlan, world, clone(relationStart),
                { worldActionIds: ['relate'], requireEffectWitnesses: true });
            const factionSession = clone(base);
            factionSession.factions = [{ id: 'faction_a', relations: [] },
                { id: 'faction_b', relations: [] }];
            const factionPlan = clone(relationPlan);
            factionPlan.actions[0].action_effects.relation_set[0] = {
                subject_id: 'faction_a', target_id: 'faction_b', value: 20 };
            factionPlan.events[0] = { ...factionPlan.events[0],
                actor_id: 'faction_a', target_id: 'faction_b', change: 20 };
            const factionAllowed = HordeLinkedWorldActions.executeLinkedActions(
                factionPlan, disabledWorld, clone(factionSession),
                { worldActionIds: ['relate'], requireEffectWitnesses: true });
            const factionOffWorld = clone(world);
            factionOffWorld.gameRules = { profileId: 'custom',
                modules: { relationships: true, livingWorld: false } };
            const factionDenied = HordeLinkedWorldActions.executeLinkedActions(
                factionPlan, factionOffWorld, clone(factionSession),
                { worldActionIds: ['relate'], requireEffectWitnesses: true });
            const wrongTypeStructured = processStructuredActions({ npc_relationship_updates: [
                { source_npc_id: 'object_1', target_npc_id: 'm', change: 20 }
            ] }, wrongTypeWorld, clone(relationStart), { deferFeedback: true,
                relationshipEvents: [{ ...validRelationEvent, actor_id: 'object_1' }] });
            const unknownGoal = processStructuredActions({ npc_goal_updates: [
                { npc_id: 'missing_npc', goal: 'Protect the route.' }
            ] }, clone(world), clone(base), { deferFeedback: true });
            const unknownWorldRefs = processStructuredActions({
                location_state_updates: [{ location_id: 'missing_place', danger_change: 1 }],
                economy_updates: [{ location_id: 'missing_place', item: 'grain' }],
                npc_observations: [{ npc_id: 'missing_npc', observation: 'A fact.' },
                    { npc_id: 'n', source_npc_id: 'missing_npc', observation: 'Another fact.' }],
                faction_updates: [{ id: 'faction_a', name: 'A', relations: [
                    { faction_id: 'missing_faction', change: 1 }] }]
            }, clone(world), clone(base), { deferFeedback: true });
            const transferPlan = { actions: [{ action_id: 'give', kind: 'other',
                status: 'resolved', response_id: 'give_p', action_effects: { item_transfer: [
                    { item_id: 'token', from_id: 'player', to_id: 'm' }] } }],
            events: [{ action_id: 'give', passage_id: 'give_p', type: 'inventory',
                actor_id: 'player', status: 'completed', item: 'token' }],
            narrative: [{ id: 'give_p', action_id: 'give', text: 'A token changes hands.' }] };
            const transferStart = clone(base);
            transferStart.inventory = ['token'];
            const disabledInventoryWorld = clone(world);
            disabledInventoryWorld.gameRules = { profileId: 'custom',
                modules: { inventory: false } };
            const disabledStructuredInventory = processStructuredActions({
                inventory_add: ['token'] }, disabledInventoryWorld, clone(base),
            { deferFeedback: true });
            const disabledLinkedInventory = HordeLinkedWorldActions.executeLinkedActions(
                transferPlan, disabledInventoryWorld, clone(transferStart),
                { worldActionIds: ['give'], requireEffectWitnesses: true });
            const validTransfer = HordeLinkedWorldActions.executeLinkedActions(transferPlan,
                world, clone(transferStart), { worldActionIds: ['give'],
                    requireEffectWitnesses: true });
            const wrongEndpointPlan = clone(transferPlan);
            wrongEndpointPlan.actions[0].action_effects.item_transfer[0].to_id = 'object_1';
            const wrongEndpoint = HordeLinkedWorldActions.executeLinkedActions(
                wrongEndpointPlan, wrongTypeWorld, clone(transferStart),
                { worldActionIds: ['give'], requireEffectWitnesses: true });
            const missingSourcePlan = clone(transferPlan);
            missingSourcePlan.actions[0].action_effects.item_transfer[0].from_id = 'missing_actor';
            const missingSource = HordeLinkedWorldActions.executeLinkedActions(
                missingSourcePlan, world, clone(transferStart),
                { worldActionIds: ['give'], requireEffectWitnesses: true });
            const independentPlan = { actions: [
                { ...plan.actions[0], status: 'blocked' },
                absolutePlan.actions[0]
            ], events: absolutePlan.events, narrative: absolutePlan.narrative };
            const independent = HordeLinkedWorldActions.executeLinkedActions(independentPlan,
                deniedWorld, clone(relationStart), { canMove,
                    worldActionIds: ['move_n', 'relate'], requireEffectWitnesses: true });
            const rollbackPlan = clone(absolutePlan);
            const invalidSecond = clone(absolutePlan.actions[0]);
            invalidSecond.action_id = 'bad_relation';
            invalidSecond.response_id = 'bad_relation_p';
            invalidSecond.action_effects.relation_set[0].target_id = 'missing_npc';
            rollbackPlan.actions.push(invalidSecond);
            rollbackPlan.events.push({ ...validRelationEvent, action_id: 'bad_relation',
                passage_id: 'bad_relation_p', target_id: 'missing_npc' });
            rollbackPlan.narrative.push({ id: 'bad_relation_p', action_id: 'bad_relation',
                text: 'An invalid relation is claimed.' });
            const rollbackSession = clone(relationStart);
            const relationRollback = HordeLinkedWorldActions.executeLinkedActions(rollbackPlan,
                world, rollbackSession, { worldActionIds: ['relate', 'bad_relation'],
                    requireEffectWitnesses: true });
            const agentSession = clone(base);
            const agentWorld = clone(world);
            agentWorld.worldAgent = { model: 'fixture/model' };
            state.worldInstances[agentWorld.id] = { activeSessionId: agentSession.id,
                sessions: [agentSession] };
            const originalFetch = fetchWorldObservedJSON;
            const originalSave = saveWorldsState;
            let agentSaves = 0, agentCommit;
            try {
                fetchWorldObservedJSON = async () => ({ response: { ok: true },
                    data: { choices: [{ message: { content: JSON.stringify({
                        developments: [{ summary: 'An unseen relationship changed.' }],
                        npc_relationship_updates: [{ source_npc_id: 'missing_npc',
                            target_npc_id: 'm', change: 20 }]
                    }) } }] }, diagnostic: () => null });
                saveWorldsState = async () => { agentSaves++; };
                agentCommit = await runWorldAgent(agentWorld, agentSession);
            } finally {
                fetchWorldObservedJSON = originalFetch;
                saveWorldsState = originalSave;
                delete state.worldInstances[agentWorld.id];
            }
            const unwitnessedAgentSession = clone(relationStart);
            state.worldInstances[agentWorld.id] = { activeSessionId: unwitnessedAgentSession.id,
                sessions: [unwitnessedAgentSession] };
            let unwitnessedAgentCommit;
            try {
                fetchWorldObservedJSON = async () => ({ response: { ok: true },
                    data: { choices: [{ message: { content: JSON.stringify({
                        developments: [{ summary: 'N and M cooperated.' }],
                        npc_goal_updates: [{ npc_id: 'n', goal: 'Reach B.' }],
                        npc_relationship_updates: [{ action_id: 'cooperate',
                            source_npc_id: 'n', target_npc_id: 'm', change: 20,
                            reason: 'N and M cooperated.' }]
                    }) } }] }, diagnostic: () => null });
                saveWorldsState = async () => {};
                unwitnessedAgentCommit = await runWorldAgent(agentWorld,
                    unwitnessedAgentSession);
            } finally {
                fetchWorldObservedJSON = originalFetch;
                saveWorldsState = originalSave;
                delete state.worldInstances[agentWorld.id];
            }
            const dependentAgentSession = clone(relationStart);
            state.worldInstances[agentWorld.id] = { activeSessionId: dependentAgentSession.id,
                sessions: [dependentAgentSession] };
            let dependentAgentCommit;
            try {
                fetchWorldObservedJSON = async () => ({ response: { ok: true },
                    data: { choices: [{ message: { content: JSON.stringify({
                        npc_relationship_updates: [{ action_id: 'cooperate',
                            source_npc_id: 'n', target_npc_id: 'm', change: 20 }],
                        npc_goal_updates: [{ action_id: 'follow_up', npc_id: 'n',
                            goal: 'Follow M.', depends_on: [
                                { action_id: 'cooperate', outcome: 'succeeded' }] }]
                    }) } }] }, diagnostic: () => null });
                saveWorldsState = async () => {};
                dependentAgentCommit = await runWorldAgent(agentWorld, dependentAgentSession);
            } finally {
                fetchWorldObservedJSON = originalFetch;
                saveWorldsState = originalSave;
                delete state.worldInstances[agentWorld.id];
            }
            const validAgentSession = clone(relationStart);
            const validAgentWorld = clone(world);
            validAgentWorld.worldAgent = { model: 'fixture/model' };
            state.worldInstances[validAgentWorld.id] = { activeSessionId: validAgentSession.id,
                sessions: [validAgentSession] };
            let validAgentCommit;
            try {
                fetchWorldObservedJSON = async () => ({ response: { ok: true },
                    data: { choices: [{ message: { content: JSON.stringify({
                        developments: [{ summary: 'N and M cooperated.' }],
                        npc_relationship_updates: [{ action_id: 'cooperate',
                            source_npc_id: 'n', target_npc_id: 'm', change: 20,
                            reason: 'N and M cooperated.' }],
                        events: [{ ...validRelationEvent, action_id: 'cooperate' }]
                    }) } }] }, diagnostic: () => null });
                saveWorldsState = async () => {};
                validAgentCommit = await runWorldAgent(validAgentWorld, validAgentSession);
            } finally {
                fetchWorldObservedJSON = originalFetch;
                saveWorldsState = originalSave;
                delete state.worldInstances[validAgentWorld.id];
            }
            const disabledAgentSession = clone(relationStart);
            const disabledAgentWorld = clone(disabledWorld);
            disabledAgentWorld.worldAgent = { model: 'fixture/model' };
            state.worldInstances[disabledAgentWorld.id] = {
                activeSessionId: disabledAgentSession.id, sessions: [disabledAgentSession] };
            let disabledAgentCommit;
            try {
                fetchWorldObservedJSON = async () => ({ response: { ok: true },
                    data: { choices: [{ message: { content: JSON.stringify({
                        npc_relationship_updates: [{ action_id: 'cooperate',
                            source_npc_id: 'n', target_npc_id: 'm', change: 20 }],
                        events: [{ ...validRelationEvent, action_id: 'cooperate' }]
                    }) } }] }, diagnostic: () => null });
                saveWorldsState = async () => {};
                disabledAgentCommit = await runWorldAgent(disabledAgentWorld,
                    disabledAgentSession);
            } finally {
                fetchWorldObservedJSON = originalFetch;
                saveWorldsState = originalSave;
                delete state.worldInstances[disabledAgentWorld.id];
            }
            const persistWorld = clone(world);
            persistWorld.id = 'action_parity_persist';
            const persistSession = clone(base);
            persistSession.id = 'action_parity_saved_session';
            state.worlds.push(persistWorld);
            state.worldInstances[persistWorld.id] = { activeSessionId: persistSession.id,
                sessions: [persistSession] };
            const originalCommit = commitWorldMigrationAware;
            let failedPersistence = false;
            try {
                commitWorldMigrationAware = async () => { throw new Error('fixture save failure'); };
                const pending = HordeLinkedWorldActions.executeLinkedActions(journeyPlan,
                    persistWorld, persistSession, movementContext);
                await persistPreparedWorldTurn(persistWorld, persistSession, pending.working);
            } catch (error) {
                failedPersistence = error.message === 'fixture save failure';
            } finally {
                commitWorldMigrationAware = originalCommit;
            }
            const rolledBackLocation = persistSession.entityStates.n.location;
            const rolledBackJourney = persistSession.entityStates.n.journey || null;
            const retry = HordeLinkedWorldActions.executeLinkedActions(journeyPlan,
                persistWorld, persistSession, movementContext);
            await persistPreparedWorldTurn(persistWorld, persistSession, retry.working);
            const storedJourney = (await HordeDB.get(`worldInstance:${persistWorld.id}`))
                .sessions[0].entityStates.n.journey?.legTravelMinutes;
            const persistedRelation = HordeLinkedWorldActions.executeLinkedActions(relationPlan,
                persistWorld, persistSession, { worldActionIds: ['relate'],
                    requireEffectWitnesses: true });
            if (!persistedRelation.ok) throw new Error(JSON.stringify(persistedRelation.errors));
            await persistPreparedWorldTurn(persistWorld, persistSession,
                persistedRelation.working);
            const storedRelation = (await HordeDB.get(`worldInstance:${persistWorld.id}`))
                .sessions[0].npcRelationships['m|n']?.score;
            const mixedV2 = commitWorldTurnReceipt(persistWorld, persistSession, {
                version: 2, turn_id: 'mixed_relation_v2', summary: 'A letter changes their rapport.',
                scene: { player_location_id: 'a', player_location_changed: false,
                    present_character_ids: ['m'] },
                events: [{ type: 'relationship', actor_id: 'n', target_id: 'm',
                    status: 'completed', change: 5, cause: 'A letter arrives.' }],
                entity_updates: [], state_updates: {}
            }, { deferFeedback: true }, 'fixture');
            if (mixedV2.actionResult.moduleRejections.length
                || mixedV2.validation.rejectedEvents.length)
                throw new Error(JSON.stringify({ effect: mixedV2.actionResult.moduleRejections,
                    events: mixedV2.validation.rejectedEvents }));
            await saveWorldsState({ worldId: persistWorld.id });
            const storedMixedRelation = (await HordeDB.get(`worldInstance:${persistWorld.id}`))
                .sessions[0].npcRelationships['m|n']?.score;
            persistWorld.worldAgent = { enabled: true, intervalTurns: 8, model: 'fixture/model' };
            let savedAgent;
            try {
                fetchWorldObservedJSON = async () => ({ response: { ok: true },
                    data: { choices: [{ message: { content: JSON.stringify({
                        developments: [{ summary: 'N arrived at B, although no move occurred.' }],
                        npc_goal_updates: [{ npc_id: 'n', goal: 'Keep watch.' }]
                    }) } }] }, diagnostic: () => null });
                savedAgent = await runWorldAgent(persistWorld, persistSession);
            } finally {
                fetchWorldObservedJSON = originalFetch;
            }
            const savedAgentSession = (await HordeDB.get(`worldInstance:${persistWorld.id}`))
                .sessions.find(item => item.id === persistSession.id);
            return {
                worldAgentFields: Object.keys(worldAgentFields.actions),
                agentRejections: agentResult.moduleRejections,
                agentLocation: agent.entityStates.n.location,
                agentJourneyMinutes: agent.entityStates.n.journey?.legTravelMinutes,
                scheduleMoves: scheduleResult.moves,
                scheduleLocation: scheduled.entityStates.n.location,
                scheduleJourneyMinutes: scheduled.entityStates.n.journey?.legTravelMinutes,
                linkedOk: linked.ok, linkedErrors: linked.errors,
                journeyOk: journey.ok, journeyErrors: journey.errors,
                journeyLocation: journey.ok && journey.working.getEntity('n').state.location,
                journeyMinutes: journey.ok && journey.working.getEntity('n').state.journey?.legTravelMinutes,
                journeyAtThirty: journeyAtThirty.entityStates.n.location,
                journeyAtSixty: journeyAtSixty.entityStates.n.location,
                backgroundTicks: backgroundArrival.ticks,
                backgroundLocation: backgroundArrival.session.entityStates.n.location,
                interruptedLocation: interrupted.entityStates.n.location,
                interruptedJourney: interrupted.entityStates.n.journey || null,
                afterTimeOk: afterTime.ok, afterTimeErrors: afterTime.errors,
                afterTimeLocation: afterTime.ok && afterTime.working.getEntity('n').state.location,
                dueClosureOk: dueClosure.ok, dueClosureErrors: dueClosure.errors,
                dueClosureOutcome: dueClosure.outcomes.get('move_n'),
                dueClosureLocation: dueClosure.ok && dueClosure.working.getEntity('n').state.location,
                dueClosureStatus: dueClosure.ok && dueClosure.working.getSession('scheduledEvents')[0].status,
                dueClosureCondition: dueClosure.ok && dueClosure.working.getLocation('b')
                    .state?.conditions?.some(item => item.label === 'impassable'),
                directOk: direct.ok, directErrors: direct.errors,
                directLocation: direct.ok && direct.working.getEntity('n').state.location,
                directDuringJourneyOk: directDuringJourney.ok,
                directDuringJourneyErrors: directDuringJourney.errors,
                directDuringJourneyLocation: directDuringJourney.ok
                    && directDuringJourney.working.getEntity('n').state.location,
                directDuringJourneyPending: directDuringJourney.ok
                    && directDuringJourney.working.getEntity('n').state.journey || null,
                directAcrossLockOk: directAcrossLock.ok,
                directAcrossDenialOk: directAcrossDenial.ok,
                directWithoutCauseOk: directWithoutCause.ok,
                keyedLinkedOk: keyedLinked.ok, keyedLinkedErrors: keyedLinked.errors,
                exploredOk: explored.ok, exploredErrors: explored.errors,
                accompaniedOk: accompanied.ok, accompaniedErrors: accompanied.errors,
                accompaniedPlayer: accompanied.ok && accompanied.working.getSession('playerLocation'),
                accompaniedNpc: accompanied.ok && accompanied.working.getEntity('c').state.location,
                keyedCompanionOk: keyedCompanion.ok,
                multiAgentLegs: multiAgent.entityStates.n.journey?.legTravelMinutes,
                multiScheduleLegs: multiSchedule.entityStates.n.journey?.legTravelMinutes,
                multiLinkedOk: multiLinked.ok, multiLinkedErrors: multiLinked.errors,
                multiLinkedLegs: multiLinked.ok && multiLinked.working.getEntity('n').state.journey?.legTravelMinutes,
                earlySecondLegOk: earlySecondLeg.ok,
                completedTwoLegsOk: completedTwoLegs.ok,
                completedTwoLegsErrors: completedTwoLegs.errors,
                completedTwoLegsLocation: completedTwoLegs.ok && completedTwoLegs.working.getEntity('n').state.location,
                canonicalLocation: base.entityStates.n.location,
                noWitnessOk: noWitness.ok, noWitnessErrors: noWitness.errors,
                unknownAgentRejections: unknownAgent.moduleRejections,
                unknownLinkedOk: unknownLinked.ok,
                deniedAgentRejections: deniedAgent.moduleRejections,
                deniedLinkedOk: deniedLinked.ok,
                blockedJourneyOk: blockedJourney.ok,
                blockedJourneyOutcome: blockedJourney.outcomes.get('move_n'),
                lockedAgentRejections: lockedAgent.moduleRejections,
                lockedLinkedOk: lockedLinked.ok,
                dependentOk: dependent.ok,
                dependentOutcomes: [...dependent.outcomes],
                dependentRelation: dependent.ok && dependent.working.getSession('npcRelationships')['m|n'],
                structuredRelationRejections: structuredRelationResult.moduleRejections,
                structuredRelationValue: structuredRelation.npcRelationships['m|n'],
                linkedRelationOk: linkedRelation.ok, linkedRelationErrors: linkedRelation.errors,
                linkedRelationValue: linkedRelation.ok && linkedRelation.working.getSession('npcRelationships')['m|n']?.score,
                unwitnessedStructuredRejections: unwitnessedStructured.moduleRejections,
                unwitnessedStructuredValue: unwitnessedRelation.npcRelationships['m|n']?.score,
                unwitnessedLinkedOk: unwitnessedLinked.ok,
                unwitnessedLinkedErrors: unwitnessedLinked.errors,
                missingStructuredRejections: missingStructured.moduleRejections,
                missingStructuredRelations: missingReference.npcRelationships,
                missingLinkedOk: missingLinked.ok, missingLinkedErrors: missingLinked.errors,
                relativeRejections: relativeResult.moduleRejections,
                relativeScore: relativeSession.npcRelationships['m|n'].score,
                v2ReceiptRejections: v2Receipt.actionResult.moduleRejections,
                v2ReceiptEventRejections: v2Receipt.validation.rejectedEvents,
                v2ReceiptScore: v2Session.npcRelationships['m|n']?.score,
                v2UnwitnessedRejections: v2Unwitnessed.actionResult.moduleRejections,
                v2UnwitnessedScore: v2UnwitnessedSession.npcRelationships['m|n'].score,
                absoluteOk: absoluteResult.ok, absoluteErrors: absoluteResult.errors,
                absoluteScore: absoluteResult.ok
                    && absoluteResult.working.getSession('npcRelationships')['m|n'].score,
                wrongChangeOk: wrongChange.ok, wrongChangeErrors: wrongChange.errors,
                reusedWitnessOk: reusedWitness.ok,
                reusedWitnessErrors: reusedWitness.errors,
                wrongTypeOk: wrongType.ok, wrongTypeErrors: wrongType.errors,
                playerFeelingOk: playerFeeling.ok,
                playerFeelingErrors: playerFeeling.errors,
                factionAllowedOk: factionAllowed.ok,
                factionAllowedErrors: factionAllowed.errors,
                factionAllowedScore: factionAllowed.ok
                    && factionAllowed.working.getSession('factions')[0].relations[0]?.score,
                factionDeniedOk: factionDenied.ok,
                factionDeniedErrors: factionDenied.errors,
                wrongTypeStructuredRejections: wrongTypeStructured.moduleRejections,
                unknownGoalRejections: unknownGoal.moduleRejections,
                unknownWorldRefReasons: unknownWorldRefs.moduleRejections.map(item => item.reason),
                disabledStructuredInventoryRejections: disabledStructuredInventory.moduleRejections,
                disabledLinkedInventoryOk: disabledLinkedInventory.ok,
                disabledLinkedInventoryErrors: disabledLinkedInventory.errors,
                validTransferOk: validTransfer.ok, validTransferErrors: validTransfer.errors,
                validTransferInventory: validTransfer.ok
                    && validTransfer.working.getEntity('m').state.inventory,
                wrongEndpointOk: wrongEndpoint.ok, wrongEndpointErrors: wrongEndpoint.errors,
                missingSourceOk: missingSource.ok, missingSourceErrors: missingSource.errors,
                independentOk: independent.ok, independentOutcomes: [...independent.outcomes],
                independentScore: independent.ok
                    && independent.working.getSession('npcRelationships')['m|n'].score,
                relationRollbackOk: relationRollback.ok,
                relationRollbackScore: rollbackSession.npcRelationships['m|n'].score,
                validAgentApplied: validAgentCommit.applied,
                validAgentScore: validAgentSession.npcRelationships['m|n'].score,
                validAgentEvents: validAgentSession.engineEvents.filter(event =>
                    event.type === 'relationship').length,
                validAgentNews: validAgentSession.worldNews.map(item => item.text),
                unwitnessedAgentApplied: unwitnessedAgentCommit.applied,
                unwitnessedAgentOutcomes: unwitnessedAgentCommit.outcomes.map(item => item.outcome),
                unwitnessedAgentScore: unwitnessedAgentSession.npcRelationships['m|n'].score,
                unwitnessedAgentNews: unwitnessedAgentSession.worldNews?.length || 0,
                unwitnessedAgentGoal: unwitnessedAgentSession.entityStates.n.goal || '',
                dependentAgentApplied: dependentAgentCommit.applied,
                dependentAgentOutcomes: dependentAgentCommit.outcomes.map(item => item.outcome),
                dependentAgentGoal: dependentAgentSession.entityStates.n.goal || '',
                dependentAgentNews: dependentAgentSession.worldNews?.length || 0,
                disabledAgentApplied: disabledAgentCommit.applied,
                disabledAgentNews: disabledAgentSession.worldNews?.length || 0,
                disabledAgentScore: disabledAgentSession.npcRelationships['m|n'].score,
                agentNoopApplied: agentCommit.applied, agentNoopSaves: agentSaves,
                agentNoopNews: agentSession.worldNews.map(item => item.text),
                agentNoopRelations: agentSession.npcRelationships,
                persistedId: persistWorld.id, failedPersistence,
                rolledBackLocation, rolledBackJourney, storedJourney, storedRelation,
                storedMixedRelation, savedAgentApplied: savedAgent.applied,
                savedAgentGoal: savedAgentSession.entityStates.n.goal,
                savedAgentNews: savedAgentSession.worldNews.map(item => item.text),
                savedAgentTurn: savedAgentSession.lastWorldAgentTurn,
                agentReplayDue: shouldRunWorldAgent(persistWorld, clone(savedAgentSession))
            };
        });
        assert.deepEqual(result.worldAgentFields, ['npc_moves'], 'agent cannot mutate the player');
        assert.deepEqual(result.agentRejections, []);
        assert.equal(result.agentLocation, null, 'the agent starts a timed journey');
        assert.deepEqual(result.agentJourneyMinutes, [60]);
        assert.equal(result.scheduleLocation, null, 'the scheduler starts the same timed journey');
        assert.deepEqual(result.scheduleJourneyMinutes, [60]);
        assert.equal(result.linkedOk, false, 'a timed arrival without elapsed time is rejected');
        assert.equal(result.journeyOk, true, JSON.stringify(result.journeyErrors));
        assert.deepEqual([result.journeyLocation, result.journeyMinutes], [null, [60]]);
        assert.equal(result.journeyAtThirty, null);
        assert.equal(result.journeyAtSixty, 'b');
        assert.deepEqual([result.backgroundTicks, result.backgroundLocation], [1, 'b']);
        assert.equal(result.interruptedLocation, 'a');
        assert.equal(result.interruptedJourney, null);
        assert.equal(result.afterTimeOk, true, JSON.stringify(result.afterTimeErrors));
        assert.equal(result.afterTimeLocation, 'b');
        assert.equal(result.dueClosureOk, true, JSON.stringify(result.dueClosureErrors));
        assert.deepEqual([result.dueClosureOutcome, result.dueClosureLocation,
            result.dueClosureStatus, result.dueClosureCondition],
        ['blocked', 'a', 'triggered', true]);
        assert.equal(result.directOk, true, JSON.stringify(result.directErrors));
        assert.equal(result.directLocation, 'b');
        assert.equal(result.directDuringJourneyOk, true,
            JSON.stringify(result.directDuringJourneyErrors));
        assert.deepEqual([result.directDuringJourneyLocation,
            result.directDuringJourneyPending], ['b', null]);
        assert.equal(result.directAcrossLockOk, true, 'explicit teleport can bypass a physical lock');
        assert.equal(result.directAcrossDenialOk, false, 'teleport still respects NPC access');
        assert.equal(result.directWithoutCauseOk, false);
        assert.equal(result.keyedLinkedOk, true, JSON.stringify(result.keyedLinkedErrors));
        assert.equal(result.exploredOk, true, JSON.stringify(result.exploredErrors));
        assert.equal(result.accompaniedOk, true, JSON.stringify(result.accompaniedErrors));
        assert.deepEqual([result.accompaniedPlayer, result.accompaniedNpc], ['b', 'b']);
        assert.equal(result.keyedCompanionOk, true, 'the player key authorizes their accompanying NPC');
        assert.deepEqual(result.multiAgentLegs, [60, 30]);
        assert.deepEqual(result.multiScheduleLegs, [60, 30]);
        assert.equal(result.multiLinkedOk, true, JSON.stringify(result.multiLinkedErrors));
        assert.deepEqual(result.multiLinkedLegs, [60, 30]);
        assert.equal(result.earlySecondLegOk, false, 'elapsed time cannot pay for two legs twice');
        assert.equal(result.completedTwoLegsOk, true, JSON.stringify(result.completedTwoLegsErrors));
        assert.equal(result.completedTwoLegsLocation, 'c');
        assert.equal(result.canonicalLocation, 'a');
        assert.equal(result.noWitnessOk, false);
        assert.equal(result.noWitnessErrors[0].reason, 'unverified_journey_start');
        assert(result.unknownAgentRejections.some(item => item.reason === 'npc_access_denied'));
        assert.equal(result.unknownLinkedOk, false, 'linked travel checks personal place knowledge');
        assert(result.deniedAgentRejections.some(item => item.reason === 'npc_access_denied'));
        assert.equal(result.deniedLinkedOk, false, 'both paths refuse explicit NPC access denial');
        assert.deepEqual([result.blockedJourneyOk, result.blockedJourneyOutcome], [true, 'blocked']);
        assert(result.lockedAgentRejections.some(item => ['npc_access_denied',
            'unreachable_npc_destination'].includes(item.reason)));
        assert.equal(result.lockedLinkedOk, false, 'linked travel checks the required item');
        assert.equal(result.dependentOk, true);
        assert.deepEqual(result.dependentOutcomes, [['move_n', 'blocked'], ['after_move', 'skipped']]);
        assert.equal(result.dependentRelation, undefined);
        assert(result.structuredRelationRejections.some(item => item.reason === 'module_disabled'));
        assert.equal(result.structuredRelationValue, undefined);
        assert.equal(result.linkedRelationOk, false, 'linked relation respects the disabled module');
        assert.equal(result.linkedRelationErrors[0].reason, 'module_disabled');
        assert.equal(result.linkedRelationValue, false);
        assert(result.unwitnessedStructuredRejections.some(item =>
            item.reason === 'unwitnessed_relation_effect'));
        assert.equal(result.unwitnessedStructuredValue, undefined);
        assert.equal(result.unwitnessedLinkedOk, false);
        assert.equal(result.unwitnessedLinkedErrors[0].reason, 'unwitnessed_relation_effect');
        assert(result.missingStructuredRejections.some(item =>
            item.reason === 'unknown_relation_target'));
        assert.deepEqual(result.missingStructuredRelations, {});
        assert.equal(result.missingLinkedOk, false);
        assert.equal(result.missingLinkedErrors[0].reason, 'unknown_relation_target');
        assert.deepEqual(result.relativeRejections, []);
        assert.equal(result.relativeScore, 30, 'a relative update adds to the prior score');
        assert.deepEqual(result.v2ReceiptRejections, []);
        assert.deepEqual(result.v2ReceiptEventRejections, []);
        assert.equal(result.v2ReceiptScore, 30);
        assert(result.v2UnwitnessedRejections.some(item =>
            item.reason === 'unwitnessed_relation_effect'));
        assert.equal(result.v2UnwitnessedScore, 10);
        assert.equal(result.absoluteOk, true, JSON.stringify(result.absoluteErrors));
        assert.equal(result.absoluteScore, 30, 'an absolute set reaches the same result');
        assert.equal(result.wrongChangeOk, false);
        assert.equal(result.wrongChangeErrors[0].reason, 'unwitnessed_relation_effect');
        assert.equal(result.reusedWitnessOk, false);
        assert.equal(result.reusedWitnessErrors[0].reason, 'unwitnessed_relation_effect');
        assert.equal(result.wrongTypeOk, false);
        assert.equal(result.wrongTypeErrors[0].reason, 'unknown_relation_target');
        assert.equal(result.playerFeelingOk, false);
        assert.equal(result.playerFeelingErrors[0].reason,
            'player_feelings_not_engine_controlled');
        assert.equal(result.factionAllowedOk, true,
            JSON.stringify(result.factionAllowedErrors));
        assert.equal(result.factionAllowedScore, 20);
        assert.equal(result.factionDeniedOk, false);
        assert.equal(result.factionDeniedErrors[0].reason, 'module_disabled');
        assert(result.wrongTypeStructuredRejections.some(item =>
            item.reason === 'unknown_relation_target'));
        assert(result.unknownGoalRejections.some(item => item.reason === 'unknown_npc'));
        assert.deepEqual(result.unknownWorldRefReasons.sort(),
            ['unknown_faction', 'unknown_location', 'unknown_location',
                'unknown_npc', 'unknown_source_npc'].sort());
        assert(result.disabledStructuredInventoryRejections.some(item =>
            item.reason === 'module_disabled'));
        assert.equal(result.disabledLinkedInventoryOk, false);
        assert.equal(result.disabledLinkedInventoryErrors[0].reason, 'module_disabled');
        assert.equal(result.validTransferOk, true, JSON.stringify(result.validTransferErrors));
        assert.deepEqual(result.validTransferInventory, ['token']);
        assert.equal(result.wrongEndpointOk, false);
        assert.equal(result.wrongEndpointErrors[0].reason, 'unknown_transfer_destination');
        assert.equal(result.missingSourceOk, false);
        assert.equal(result.missingSourceErrors[0].reason, 'unknown_transfer_source');
        assert.equal(result.independentOk, true);
        assert.deepEqual(result.independentOutcomes,
            [['move_n', 'blocked'], ['relate', 'succeeded']]);
        assert.equal(result.independentScore, 30);
        assert.equal(result.relationRollbackOk, false);
        assert.equal(result.relationRollbackScore, 10, 'failed action chains do not change the session');
        assert.equal(result.validAgentApplied, true);
        assert.equal(result.validAgentScore, 30);
        assert.equal(result.validAgentEvents, 1);
        assert.equal(result.validAgentNews.length, 1, 'only the confirmed relationship effect is logged');
        assert.equal(result.unwitnessedAgentApplied, true,
            'an independent valid goal survives the rejected relationship update');
        assert.deepEqual(result.unwitnessedAgentOutcomes, ['succeeded', 'blocked']);
        assert.equal(result.unwitnessedAgentScore, 10);
        assert.equal(result.unwitnessedAgentNews, 1);
        assert.equal(result.unwitnessedAgentGoal, 'Reach B.');
        assert.equal(result.dependentAgentApplied, false);
        assert.deepEqual(result.dependentAgentOutcomes, ['blocked', 'skipped']);
        assert.equal(result.dependentAgentGoal, '');
        assert.equal(result.dependentAgentNews, 0);
        assert.equal(result.disabledAgentApplied, false);
        assert.equal(result.disabledAgentScore, 10);
        assert.equal(result.disabledAgentNews, 0);
        assert.equal(result.agentNoopApplied, false,
            'the agent rejects a proposal whose referenced effect cannot apply');
        assert.equal(result.agentNoopSaves, 1);
        assert.deepEqual(result.agentNoopRelations, {});
        assert.deepEqual(result.agentNoopNews, []);
        assert.equal(result.failedPersistence, true);
        assert.deepEqual([result.rolledBackLocation, result.rolledBackJourney], ['a', null]);
        assert.deepEqual(result.storedJourney, [60]);
        assert.equal(result.storedRelation, 20);
        assert.equal(result.storedMixedRelation, 25);
        assert.equal(result.savedAgentApplied, true);
        assert.equal(result.savedAgentGoal, 'Keep watch.');
        assert.equal(result.savedAgentNews.length, 1);
        assert(!result.savedAgentNews[0].includes('arrived at B'),
            'unverified model prose is absent from the saved author log');
        assert.equal(result.savedAgentTurn, 1);
        assert.equal(result.agentReplayDue, false, 'reload does not repeat the saved agent interval');
        await page.reload();
        await page.waitForFunction(id => state.worldInstances?.[id]?.sessions?.[0],
            result.persistedId, { timeout: 30000 });
        const restored = await page.evaluate(async id => {
            const world = state.worlds.find(item => item.id === id);
            const sess = state.worldInstances[id].sessions[0];
            const before = sess.entityStates.n.journey?.legTravelMinutes;
            HordeWorldTime.advanceMinutes(world, sess, 30);
            syncNPCSchedules(world, sess);
            const halfway = sess.entityStates.n.location;
            HordeWorldTime.advanceMinutes(world, sess, 30);
            syncNPCSchedules(world, sess);
            await saveWorldsState({ worldId: id });
            return { before, halfway, arrived: sess.entityStates.n.location,
                relation: sess.npcRelationships['m|n']?.score,
                saved: (await HordeDB.get(`worldInstance:${id}`)).sessions[0].entityStates.n.location };
        }, result.persistedId);
        assert.deepEqual(restored, { before: [60], halfway: null, arrived: 'b',
            relation: 25, saved: 'b' });
        await page.reload();
        await page.waitForFunction(id => state.worldInstances?.[id]?.sessions?.[0],
            result.persistedId, { timeout: 30000 });
        assert.equal(await page.evaluate(id => state.worldInstances[id].sessions[0].entityStates.n.location,
            result.persistedId), 'b');
        console.log('PASS P0b.2a-c path parity: movement, modules, references, confirmed agent outcomes, rollback and reload');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
