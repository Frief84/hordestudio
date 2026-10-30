(function (root) {
'use strict';
const linked = typeof module !== 'undefined' && module.exports
    ? require('./linked-world-actions') : root.HordeLinkedWorldActions;
const registry = typeof module !== 'undefined' && module.exports
    ? require('./effect-registry') : root.HordeEffectRegistry;

const GOAL_FIELDS = ['goal', 'goalStatus', 'goalProgress', 'goalDifficulty',
    'goalAutonomy', 'goalMotivation', 'goalSteps', 'goalStepIndex',
    'goalStepReported', 'goalActionIndex', 'goalActionGoal',
    'goalActionProposal', 'goalActionProgress', 'goalBlockedReason',
    'goalWaitStatus',
    'goalCompletion', 'goalCompletionProof', 'goalDeadlineTurn',
    'goalResolvedTurn', 'goalLastAction'];
const copy = value => value === undefined ? undefined : structuredClone(value);
const clamp = value => Math.max(0, Math.min(100, Number(value) || 0));
function priorityRuleScore(rules, npc, state, world, session) {
    const now = session.worldClock?.absoluteMinutes;
    const minute = Number.isFinite(now) ? ((now % 1440) + 1440) % 1440 : null;
    let score = 0;
    const matched = [];
    for (const rule of (Array.isArray(rules) ? rules : []).slice(0, 12)) {
        const key = String(rule?.key || '').slice(0, 120);
        const weight = Math.max(-50, Math.min(50, Number(rule?.weight) || 0));
        let value;
        if (rule?.source === 'need') value = (state.needs || npc.needs || {})[key];
        if (rule?.source === 'personality') value = npc.personalityTraits?.[key];
        if (rule?.source === 'relationship') {
            const relation = Object.entries(session.npcRelationships || {})
                .find(([pair]) => pair.split('|').includes(npc.id)
                    && pair.split('|').includes(key))?.[1];
            value = typeof relation === 'number' ? relation : relation?.score;
        }
        if (rule?.source === 'obligation') value = (npc.obligations || [])
            .some(item => (typeof item === 'string' ? item : item?.id) === key);
        if (rule?.source === 'motivation') value = (npc.motivations || {})[key];
        if (rule?.source === 'local_danger') value =
            session.locationStates?.[state.location]?.danger;
        if (rule?.source === 'known_news') value = (session.worldNews || [])
            .slice(-80).some(item => item.id === key
                && (item.knownBy == null || item.knownBy.includes(npc.id)));
        if (rule?.source === 'time_window' && minute !== null) {
            const start = Number(rule.fromMinute), end = Number(rule.toMinute);
            value = Number.isFinite(start) && Number.isFinite(end)
                && (start <= end ? minute >= start && minute <= end
                    : minute >= start || minute <= end);
        }
        const threshold = Number(rule?.atLeast);
        const yes = typeof value === 'boolean' ? value
            : Number.isFinite(Number(value)) && Number(value) >=
                (Number.isFinite(threshold) ? threshold : 1);
        if (yes) { score += weight; matched.push({ source: rule.source, key, weight }); }
    }
    return { score, matched };
}
// Reaction rules use the same structured predicates as goal priority rules.
// Observation prose and the underlying event are deliberately not inputs.
function evaluateObservationReactions(npc, world, session, turn) {
    const state = session.entityStates?.[npc?.id];
    if (!state || !Array.isArray(world.reactionRules) || !world.reactionRules.length)
        return { evaluated: 0, added: 0 };
    const seen = new Set(state.reactionProcessedObservationIds || []);
    let evaluated = 0, added = 0;
    for (const observation of (state.observations || []).filter(item =>
        item?.id && (item.eventId || item.deliveryEventId)
        && (item.sourceType === 'witnessed' && item.evidenceMode === 'direct'
            || item.sourceType === 'told' && item.evidenceMode === 'hearsay')
        && Number(item.turn) < turn
        && !seen.has(item.id)).slice(0, 16)) {
        seen.add(observation.id);
        evaluated++;
        for (const rule of world.reactionRules.slice(0, 32)) {
            const on = rule?.on;
            if (!on || typeof on !== 'object' || Array.isArray(on)
                || !Object.keys(on).length || !Object.entries(on).every(([key, value]) =>
                    key === 'tag' ? observation.tags?.includes(value)
                        : ['channel', 'kind', 'sourceType', 'evidenceMode'].includes(key)
                            && observation[key] === value)
                || observation.sourceType === 'told' && on.sourceType !== 'told') continue;
            const when = Array.isArray(rule.when) ? rule.when : [];
            if (when.length > 12 || priorityRuleScore(when, npc, state, world,
                session).matched.length !== when.length) continue;
            const template = typeof rule.goal === 'string'
                ? { goal: rule.goal } : rule.goal;
            const name = String(template?.goal || '').trim().slice(0, 200);
            if (!name || name === state.goal) continue;
            state.goalPool ||= [];
            const existing = state.goalPool.find(entry =>
                (typeof entry === 'string' ? entry : entry?.goal) === name);
            if (existing || (npc.goalPool || []).some(entry =>
                (typeof entry === 'string' ? entry : entry?.goal) === name)
                || name === String(npc.goal || npc.agenda || '').trim()
                || state.goalPool.length >= 20) continue;
            const definition = { goal: name,
                priority: clamp(template.priority ?? 40),
                urgency: clamp(template.urgency ?? 0),
                priorityRules: Array.isArray(template.priorityRules)
                    ? copy(template.priorityRules.slice(0, 12)) : [],
                completion: copy(template.completion),
                sourceObservationId: observation.id,
                sourceEventId: observation.eventId,
                reactionRuleId: String(rule.id || '').slice(0, 100),
                createdTurn: turn };
            const expires = Number(rule.expiresAfterTurns);
            if (Number.isInteger(expires) && expires > 0)
                definition.deadlineTurn = turn + Math.min(expires, 10000);
            state.goalPool.push(definition);
            added++;
        }
    }
    if (evaluated) state.reactionProcessedObservationIds = [...seen];
    return { evaluated, added };
}
const goalDefinition = (npc, goal, state = null) => {
    const primary = String(npc.goal || npc.agenda || '').trim();
    if (goal === primary) return { goal, priority: npc.goalPriority ?? 50,
        urgency: npc.goalUrgency, motivation: npc.goalMotivation,
        priorityRules: npc.goalPriorityRules,
        actionSteps: npc.goalActionSteps, completion: npc.goalCompletion };
    return [...(npc.goalPool || []), ...(state?.goalPool || [])]
        .map(entry => typeof entry === 'string' ? { goal: entry } : entry)
        .find(entry => String(entry?.goal || '').trim() === goal);
};
function snapshotGoal(state) {
    const snapshot = {};
    for (const field of GOAL_FIELDS) if (state[field] !== undefined)
        snapshot[field] = copy(state[field]);
    return snapshot;
}
function rememberNpcGoal(state) {
    if (!state?.goal) return;
    state.goalStates = Object.assign(Object.create(null), state.goalStates || {});
    state.goalStates[state.goal] = snapshotGoal(state);
}
function selectNpcGoal(npc, world, session, turn, context = {}) {
    const state = session.entityStates?.[npc?.id];
    if (!state || state.goalAutonomy === 'paused') return null;
    const primary = String(npc.goal || npc.agenda || '').trim();
    const definitions = [{ goal: primary }, ...(npc.goalPool || []),
        ...(state.goalPool || [])].map(entry => typeof entry === 'string'
        ? { goal: entry } : entry).filter(entry => entry?.goal)
        .filter((entry, index, all) => all.findIndex(other =>
            String(other.goal).trim() === String(entry.goal).trim()) === index);
    if (state.goal && !definitions.some(entry => String(entry.goal).trim() === state.goal))
        definitions.unshift({ goal: state.goal });
    rememberNpcGoal(state);
    state.goalStates ||= Object.create(null);
    const options = npcGoalOptions(npc, world, session, context);
    const ranks = definitions.slice(0, 20).map((raw, order) => {
        const goal = String(raw.goal).trim().slice(0, 200);
        const definition = { ...goalDefinition(npc, goal, state), ...raw };
        const saved = state.goalStates[goal] || {};
        const status = saved.goalStatus || 'active';
        if (['completed', 'failed', 'abandoned'].includes(status)) return null;
        if (definition.deadlineTurn && turn > definition.deadlineTurn) {
            state.goalStates[goal] = { ...saved, goal, goalStatus: 'failed',
                goalResolvedTurn: turn };
            return null;
        }
        const progress = clamp(saved.goalProgress);
        const urgency = clamp(definition.urgency ?? definition.priorityUrgency);
        const priority = clamp(definition.priority ?? (goal === primary ? 50 : 40));
        const deadline = Number(saved.goalDeadlineTurn ?? definition.deadlineTurn);
        const deadlineBoost = Number.isFinite(deadline) && deadline > 0
            ? Math.max(0, 25 - Math.max(0, deadline - turn) * 3) : 0;
        const actionSteps = definition.actionSteps || [];
        const next = actionSteps[saved.goalActionIndex || 0];
        const named = options.some(option => {
            const target = world.locations?.find(item => item.id === option.targetId)
                || world.entities?.find(item => item.id === option.targetId);
            return target?.name?.length >= 3 && goal.toLocaleLowerCase()
                .includes(target.name.toLocaleLowerCase());
        });
        const executable = !!next || named || !!saved.goalActionProposal;
        const rules = priorityRuleScore(definition.priorityRules, npc,
            { ...state, ...saved }, world, session);
        const blocked = status === 'blocked' && (!saved.goalActionProgress?.effect ||
            goalStepKey(npc, { effect: saved.goalActionProgress.effect }, world,
                { ...session, entityStates: { ...session.entityStates,
                    [npc.id]: { ...state, ...saved } } }) === saved.goalActionProgress.key);
        const score = priority + urgency * 0.6 + deadlineBoost + rules.score
            + progress * 0.04 + (goal === state.goal ? 8 : 0)
            - (blocked ? 120 : 0) - (!executable ? 12 : 0);
        return { goal, definition, saved, status, score, order, blocked,
            factors: { priority, urgency, deadlineBoost, progress,
                ruleScore: rules.score, matchedRules: rules.matched,
                currentBonus: goal === state.goal ? 8 : 0, executable, blocked } };
    }).filter(Boolean).sort((a, b) => b.score - a.score || a.order - b.order);
    const winner = ranks[0];
    state.goalSelection = { turn, selectedGoal: winner?.goal || '',
        candidates: ranks.slice(0, 5).map(entry => ({ goal: entry.goal,
            score: entry.score, factors: entry.factors })) };
    if (!winner || winner.goal === state.goal) return winner || null;
    const current = ranks.find(entry => entry.goal === state.goal);
    if (current && winner.score < current.score + 4) {
        state.goalSelection.selectedGoal = current.goal;
        return current;
    }
    if (state.goal && state.goalStates[state.goal]?.goalStatus === 'active') {
        state.goalStates[state.goal].goalStatus = 'interrupted';
        const progressState = state.goalStates[state.goal].goalActionProgress;
        if (progressState && progressState.status !== 'interrupted') {
            progressState.resumeStatus = progressState.status;
            progressState.status = 'interrupted';
        }
    }
    for (const field of GOAL_FIELDS) delete state[field];
    Object.assign(state, copy(winner.saved));
    state.goal = winner.goal;
    state.goalStatus = ['interrupted', 'blocked'].includes(state.goalStatus)
        ? 'active' : (state.goalStatus || 'active');
    if (state.goalActionProgress?.status === 'interrupted') {
        state.goalActionProgress.status = state.goalActionProgress.resumeStatus || 'proposed';
        delete state.goalActionProgress.resumeStatus;
    }
    state.goalProgress ??= 0;
    state.goalDifficulty ??= clamp(winner.definition.difficulty ?? 50);
    state.goalAutonomy ||= winner.definition.autonomy || 'medium';
    state.goalMotivation ||= winner.definition.motivation || '';
    state.goalSteps ||= (winner.definition.steps || []).slice(0, 20);
    state.goalStepIndex ??= 0;
    state.goalStepReported ??= -1;
    state.goalActionIndex ??= 0;
    state.goalCompletion ||= copy(winner.definition.completion);
    state.goalDeadlineTurn ??= winner.definition.deadlineTurn;
    return winner;
}

// A decision is an ordinary goal step plus its provenance. The catalogue is
// deliberately limited to facts available at the actor's current place.
function npcGoalOptions(npc, world, session, context = {}) {
    const actor = npc?.id, state = session.entityStates?.[actor];
    const place = state?.location;
    if (!actor || !place) return [];
    const options = [];
    const add = (label, type, payload, targetId, prerequisites = []) => options.push({
        label, effect: { type, payload }, targetId, prerequisites,
        source: 'npc_local_state', goal: state.goal, actorId: actor
    });
    const current = world.locations?.find(item => item.id === place);
    for (const exit of current?.exits || []) {
        const target = world.locations?.find(item => item.id ===
            (typeof exit === 'string' ? exit : exit.targetLocationId || exit.to));
        if (!target || context.knowsPlace?.(actor, target.id) === false) continue;
        // A closed, configured door needs its own confirmed transition before
        // a named destination can become an immediately executable move.
        const closedDoor = typeof exit === 'object' && exit.doorId
            && (exit.requiredItem || exit.allowCheckUnlock || exit.lockState === 'locked')
            && session.unlockedExits?.[exit.doorId] !== true;
        if (!closedDoor) add(`go to ${target.name || target.id}`, 'actor_move',
            { actor_id: actor, to_location_id: target.id }, target.id,
            ['known_route', 'access', 'travel_time']);
        if (closedDoor)
            add(`open ${exit.doorId}`, 'interactable_transition',
                { actor_id: actor, target_id: exit.doorId, to_state: 'open' },
                exit.doorId, ['adjacent_door', 'required_item', 'access']);
    }
    for (const item of world.entities || []) {
        if (item.type !== 'item') continue;
        const itemState = session.entityStates?.[item.id];
        const location = itemState?.location ?? item.locationId ?? item.location;
        const opened = id => !id || (() => {
            const barrier = world.entities?.find(candidate => candidate.id === id);
            return !!barrier && ['open', 'removed', 'cleared', 'broken'].includes(
                session.entityStates?.[id]?.interactableState
                || barrier.interactable?.initialState);
        })();
        if (location !== place || itemState?.expired
            || !opened(itemState?.containerId || item.properties?.containerId)
            || !opened(itemState?.blockedBy || item.properties?.blockedBy)
            || itemState?.reachable === false
            || itemState?.hidden === true || item.properties?.hidden === true
            || item.properties?.reachable === false) continue;
        add(`take ${item.name || item.id}`, 'item_transfer',
            { actor_id: actor, item_id: item.id, from_id: place, to_id: actor },
            item.id, ['observed_local_item', 'reachable', 'unowned']);
    }
    // Optional NPC metadata belongs to the registered effect. A provider must
    // supply local candidates and a matching event witness; the linked reducer
    // remains the final authority for permissions and resource use.
    for (const descriptor of registry.technicalEffects.values()) {
        if (!descriptor.npcAction || typeof descriptor.npcAction.options !== 'function') continue;
        const candidates = descriptor.npcAction.options({ npc, world, session,
            locationId: place, context }) || [];
        for (const candidate of candidates.slice(0, 16)) {
            if (!candidate?.payload || candidate.payload.actor_id !== actor) continue;
            add(String(candidate.label || descriptor.name), descriptor.name,
                candidate.payload, candidate.targetId || '',
                candidate.prerequisites || []);
        }
    }
    return options;
}

function decideNpcGoalStep(npc, world, session, context = {}) {
    const state = session.entityStates?.[npc?.id];
    if (!state?.goal || state.goalStatus !== 'active') return null;
    const options = npcGoalOptions(npc, world, session, context);
    const pending = state.goalActionProposal;
    if (pending?.goal === state.goal) {
        const selected = options.find(option => option.effect.type === pending.effect?.type
            && JSON.stringify(option.effect.payload) === JSON.stringify(pending.effect?.payload));
        if (selected) return { ...selected,
            source: pending.source || 'world_agent', reason: pending.reason || '' };
    }
    // Exact named targets offer a deterministic choice without interpreting
    // arbitrary language as a promise of success. Ambiguity waits for the agent.
    const goal = state.goal.normalize('NFKC').toLocaleLowerCase();
    const matches = options.filter(option => {
        const target = world.locations?.find(item => item.id === option.targetId)
            || world.entities?.find(item => item.id === option.targetId);
        const name = String(target?.name || '').normalize('NFKC').toLocaleLowerCase();
        return name.length >= 3 && goal.includes(name);
    }).filter(option => option.effect.type !== 'interactable_transition');
    return matches.length === 1 ? { ...matches[0], source: 'exact_named_target' } : null;
}

function acceptNpcGoalProposal(npc, proposal, world, session, context = {}) {
    const state = session.entityStates?.[npc?.id];
    if (!state?.goal || !['active', 'waiting'].includes(state.goalStatus)
        || proposal?.goal !== state.goal || proposal?.npc_id !== npc.id) return false;
    const selected = npcGoalOptions(npc, world, session, context).find(option =>
        option.effect.type === proposal.effect?.type
        && JSON.stringify(option.effect.payload) === JSON.stringify(proposal.effect?.payload));
    if (!selected) return false;
    const old = state.goalActionProgress;
    if (old?.status === 'blocked'
        && old.key === goalStepKey(npc, selected, world, session)
        && JSON.stringify(old.effect) === JSON.stringify(selected.effect)) return false;
    state.goalActionProposal = { goal: state.goal, effect: selected.effect,
        label: selected.label,
        source: 'world_agent', reason: String(proposal.reason || '').slice(0, 200) };
    state.goalActionProgress = { npcId: npc.id, goal: state.goal,
        effect: selected.effect, actorId: npc.id, targetId: selected.targetId,
        status: 'proposed', key: goalStepKey(npc, selected, world, session) };
    state.goalBlockedReason = '';
    delete state.goalWaitStatus;
    state.goalStatus = 'active';
    return true;
}

// Only facts that can invalidate this actor's next step belong in the retry
// key. It is saved with the goal, so a blocked action stays quiet across reloads
// and becomes eligible again when the local world actually changes.
function goalStepKey(npc, step, world, session) {
    const actor = npc?.id, state = session.entityStates?.[actor] || {};
    const effect = step?.effect || {}, payload = effect.payload || {};
    const place = world.locations?.find(item => item.id === state.location);
    const target = session.entityStates?.[payload.item_id || payload.target_id
        || payload.container_id] || {};
    const exit = (place?.exits || []).find(item => typeof item === 'object'
        && (item.doorId === payload.target_id || item.targetLocationId === payload.to_location_id));
    return JSON.stringify({ goal: state.goal, effect, location: state.location,
        inventory: state.inventory, target, exit,
        unlocked: exit?.doorId ? session.unlockedExits?.[exit.doorId] === true : null });
}

function npcGoalStepSatisfied(npc, step, world, session) {
    const state = session.entityStates?.[npc?.id], effect = step?.effect;
    const payload = effect?.payload || {};
    if (!state || payload.actor_id !== npc.id) return false;
    if (effect.type === 'actor_move')
        return state.location === payload.to_location_id;
    if (effect.type === 'interactable_transition')
        return payload.to_state === 'open'
            && session.unlockedExits?.[payload.target_id] === true;
    if (effect.type === 'item_transfer' && payload.to_id === npc.id) {
        const item = world.entities?.find(entry => entry.id === payload.item_id);
        return (state.inventory || []).some(entry => [
            typeof entry === 'string' ? entry : entry.id,
            typeof entry === 'string' ? entry : entry.name
        ].includes(payload.item_id) || !!item && [
            typeof entry === 'string' ? entry : entry.name
        ].includes(item.name));
    }
    const satisfied = registry.technicalEffects.get(effect.type)?.npcAction?.satisfied;
    if (typeof satisfied === 'function') return !!satisfied({ npc, step, world, session });
    return false;
}

function inspectNpcGoalStep(npc, step, world, session, turn, context = {}) {
    const state = session.entityStates?.[npc?.id];
    if (!state?.goal || !step) return { ok: false, reason: 'missing_goal_step' };
    const previous = state.goalActionProgress;
    if (previous?.goal === state.goal && previous.lastCheckedTurn === turn)
        return { ok: false, reason: 'already_checked_this_turn' };
    const key = goalStepKey(npc, step, world, session);
    if (previous?.goal === state.goal && previous.status === 'blocked'
        && previous.key === key && JSON.stringify(previous.effect) === JSON.stringify(step.effect))
        return { ok: false, reason: 'unchanged_blockage', key };
    if (step.source && !npcGoalOptions(npc, world, session, context).some(option =>
        option.effect.type === step.effect?.type
        && JSON.stringify(option.effect.payload) === JSON.stringify(step.effect?.payload)))
        return { ok: false, reason: 'stale_goal_proposal', key };
    return { ok: true, key };
}

function recordNpcGoalStep(npc, step, session, turn, inspection, result) {
    const state = session.entityStates?.[npc.id];
    if (!state) return;
    state.goalActionProgress = { npcId: npc.id, goal: state.goal,
        index: state.goalActionIndex || 0, effect: step.effect,
        actorId: npc.id, targetId: step.targetId || step.effect?.payload?.target_id
            || step.effect?.payload?.item_id || step.effect?.payload?.to_location_id || '',
        status: result.ok ? 'executed' : 'blocked',
        lastResult: result.ok ? 'confirmed' : result.reason,
        blockedReason: result.ok ? '' : result.reason,
        lastCheckedTurn: turn, key: inspection.key,
        eventId: result.ok ? result.event?.id || '' : '' };
}

function relevantNpcMemories(state, news, npcId, options = [], limit = 3) {
    const common = new Set(['the', 'and', 'for', 'with', 'from', 'this',
        'that', 'was', 'are', 'ist', 'und', 'der', 'die', 'das', 'ein', 'eine',
        'den', 'dem', 'des', 'von', 'mit', 'auf']);
    const words = value => new Set(String(value || '').normalize('NFKC')
        .toLocaleLowerCase().match(/[\p{L}\p{N}_]{3,}/gu)?.filter(word =>
            !common.has(word)) || []);
    const topic = words([state.goal, state.goalMotivation,
        ...options.map(option => `${option.label} ${option.targetId || ''}`)].join(' '));
    const observations = (state.observations || []).slice(-80).map((item, index) => ({
        item, source: 'observation', order: index + 80,
        text: typeof item === 'string' ? item : item.text || '' }));
    const knownNews = (news || []).filter(item => item.knownBy == null
        || item.knownBy?.includes(npcId)).slice(-80).map((item, index) => ({
        item, source: 'report', order: index + 80, text: item.text || '' }));
    const rank = entries => entries.map(entry => {
        const overlap = [...words(entry.text)].filter(word => topic.has(word)).length;
        const confidence = Number(entry.item?.confidence);
        return { ...entry, score: overlap * 10 + entry.order / 1000
            + (Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0) };
    }).sort((a, b) => b.score - a.score || b.order - a.order)
        .slice(0, limit).map(({ item, source, text }) => ({
            ...(item && typeof item === 'object' ? item : {}), text,
            source: source === 'report' ? 'reported_news'
                : item?.source || 'observation' }));
    return { observations: rank(observations), knownNews: rank(knownNews) };
}

function goalCompletionProof(npc, step, world, session, event) {
    const state = session.entityStates?.[npc.id];
    const rule = state?.goalCompletion || (state?.goal === String(npc.goal || npc.agenda || '').trim()
        ? npc.goalCompletion : null);
    if (!state?.goal || !event?.id || event.actor_id !== npc.id) return null;
    // Rules describe verified state or a witnessed event. They cannot apply an
    // effect; callers evaluate them only after the linked executor commits.
    const matches = condition => {
        if (!condition || typeof condition !== 'object') return false;
        if (Array.isArray(condition.all)) return condition.all.length > 0
            && condition.all.every(matches);
        if (Array.isArray(condition.any)) return condition.any.length > 0
            && condition.any.some(matches);
        if (condition.type === 'actor_location')
            return state.location === condition.locationId;
        if (condition.type === 'inventory_contains')
            return (state.inventory || []).some(item => {
                const wanted = world.entities?.find(entity => entity.id === condition.itemId);
                return [typeof item === 'string' ? item : item.id,
                    typeof item === 'string' ? item : item.name]
                    .includes(condition.itemId)
                    || !!wanted && [typeof item === 'string' ? item : item.name]
                        .includes(wanted.name);
            });
        if (condition.type === 'exit_open')
            return session.unlockedExits?.[condition.doorId] === true;
        if (condition.type === 'confirmed_event')
            return event.type === condition.eventType
                && (!condition.targetId || event.target_id === condition.targetId
                    || event.item === condition.targetId);
        return false;
    };
    if (rule && matches(rule)) return { eventId: event.id, condition: rule };
    if (rule) return null;
    // Legacy authored sequences retain their final confirmed action as proof.
    const authoredSteps = goalDefinition(npc, state.goal, state)?.actionSteps;
    if (authoredSteps?.length
        && state.goalActionIndex === authoredSteps.length)
        return { eventId: event.id, condition: { type: 'authored_final_step' } };
    const target = world.locations?.find(place => place.id === state.location);
    if (step.effect?.type === 'actor_move' && target?.name?.length >= 3
        && state.goal.toLocaleLowerCase().includes(target.name.toLocaleLowerCase()))
        return { eventId: event.id, condition:
            { type: 'actor_location', locationId: state.location } };
    return null;
}

// Authored NPC plans contain only ordinary, state-changing linked operations.
// Each tick attempts one step against the current world; a blocked step stays pending.
function executeNpcGoalStep(npc, step, world, session, context = {}) {
    const actor = npc?.id;
    const effect = step?.effect;
    const payload = effect?.payload;
    const location = session.entityStates?.[actor]?.location;
    if (!actor || !location || !payload || typeof payload !== 'object'
        || Array.isArray(payload) || payload.actor_id !== actor
        || !(['item_transfer', 'interactable_transition', 'actor_move'].includes(effect.type)
            || !!registry.technicalEffects.get(effect.type)?.npcAction?.event))
        return { ok: false, reason: 'invalid_goal_action' };
    if (effect.type === 'item_transfer'
        && (payload.from_id !== location || payload.to_id !== actor))
        return { ok: false, reason: 'invalid_goal_transfer' };
    if (effect.type === 'actor_move'
        && (payload.mode || payload.companion_ids?.length || !payload.to_location_id))
        return { ok: false, reason: 'invalid_goal_move' };
    if (effect.type === 'interactable_transition'
        && (!payload.target_id || !payload.to_state))
        return { ok: false, reason: 'invalid_goal_transition' };
    const actionId = `npc_goal_${actor}_${context.simulationMinute ?? session.turnCount ?? 1}_${
        session.entityStates?.[actor]?.goalActionIndex || 0}`;
    const passageId = `${actionId}_passage`;
    const event = { id: `${actionId}_event`, action_id: actionId,
        passage_id: passageId, actor_id: actor, status: 'completed' };
    if (effect.type === 'item_transfer') Object.assign(event,
        { type: 'inventory', action: 'pickup', item: payload.item_id });
    if (effect.type === 'interactable_transition') Object.assign(event,
        { type: 'environment', target_id: payload.target_id, action: payload.to_state });
    if (effect.type === 'actor_move') Object.assign(event,
        { type: 'movement', from_location_id: location,
            to_location_id: payload.to_location_id });
    const extension = registry.technicalEffects.get(effect.type)?.npcAction;
    if (extension) Object.assign(event, extension.event({ npc, step, world,
        session, locationId: location }) || {});
    // Extension metadata may add witness fields, but cannot change provenance.
    Object.assign(event, { id: `${actionId}_event`, action_id: actionId,
        passage_id: passageId, actor_id: actor, status: 'completed' });
    const plan = { actions: [{ action_id: actionId, kind: 'physical',
        status: 'resolved', request: String(step.label || effect.type),
        response_id: passageId, action_effects: { [effect.type]: [payload] } }],
    events: [event], narrative: [{ id: passageId, action_id: actionId,
        text: String(step.label || effect.type) }] };
    const result = linked.executeLinkedActions(plan, world, session,
        { ...context, requireEffectWitnesses: true });
    if (effect.type === 'item_introduce' && result.ok
        && result.outcomes.get(actionId) === 'failed')
        return { ok: false, reason: 'discovery_not_found',
            candidate: result.working.prepare() };
    if (!result.ok || result.outcomes.get(actionId) !== 'succeeded'
        || result.verifiedEffects.length !== 1
        || !result.verifiedEvents.some(proof => proof.id === event.id))
        return { ok: false, reason: result.outcomes?.get(actionId) === 'blocked'
            ? 'goal_action_blocked' : result.errors?.[0]?.reason || 'goal_action_blocked' };
    return { ok: true, candidate: result.working.prepare(), event,
        events: result.verifiedEvents };
}
const api = { executeNpcGoalStep, npcGoalOptions, decideNpcGoalStep,
    selectNpcGoal, rememberNpcGoal, goalDefinition, evaluateObservationReactions,
    acceptNpcGoalProposal, goalStepKey, inspectNpcGoalStep, recordNpcGoalStep,
    relevantNpcMemories, goalCompletionProof, npcGoalStepSatisfied };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.HordeNpcGoalActions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
