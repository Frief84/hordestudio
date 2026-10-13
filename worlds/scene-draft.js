/* Model proposals have no write authority. Compile them into engine receipts.
 * Pure module: no DOM, storage, network, clock reads, or model calls. */
(function (root) {
'use strict';
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const copy = v => JSON.parse(JSON.stringify(v));
const kinds = ['physical', 'speech', 'question', 'observation', 'travel', 'wait', 'other'];
const statuses = ['resolved', 'answered', 'attempted', 'pending_check', 'blocked', 'needs_clarification'];
const text = (description, maxLength = 2000) => ({ type: 'string', description, maxLength });
const list = items => ({ type: 'array', items, maxItems: 32 });
const shape = (properties, required = Object.keys(properties)) =>
    ({ type: 'object', properties, required, additionalProperties: false });
function closeDeclaredObjectFields(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'object' && object(node.properties)
        && Object.keys(node.properties).length && node.additionalProperties === undefined)
        node.additionalProperties = false;
    Object.values(node).forEach(closeDeclaredObjectFields);
}
function rejectUnknownFields(value, spec, path, fail) {
    if (!spec || typeof spec !== 'object') return;
    if (Array.isArray(value)) {
        value.forEach((entry, index) => rejectUnknownFields(entry, spec.items, `${path}.${index}`, fail));
        return;
    }
    if (!object(value) || !object(spec.properties)) return;
    Object.entries(value).forEach(([key, entry]) => {
        const childPath = path ? `${path}.${key}` : key;
        if (Object.prototype.hasOwnProperty.call(spec.properties, key))
            rejectUnknownFields(entry, spec.properties[key], childPath, fail);
        else if (spec.additionalProperties === false)
            fail(childPath, childPath.startsWith('effects.') ? 'unsupported_draft_effect' : 'unsupported_draft_field');
        else if (object(spec.additionalProperties))
            rejectUnknownFields(entry, spec.additionalProperties, childPath, fail);
    });
}

// Models often omit punctuation, articles or the repeated subject when they
// split a compound player instruction. Compare the meaningful words in order
// instead of requiring an exact character-for-character echo. Direction,
// negation, actors and verbs remain mandatory.
function requestWords(value, stripLeadingSubject = false) {
    const optional = new Set(['a', 'an', 'the', 'and', 'then', 'ein', 'eine', 'einen',
        'der', 'die', 'das', 'den', 'dem', 'und', 'dann']);
    const subjects = new Set(['i', 'you', 'we', 'ich', 'du', 'wir']);
    const words = [...String(value || '').matchAll(/[\p{L}\p{N}]+/gu)]
        .map(match => ({ word: match[0].normalize('NFKC').toLocaleLowerCase(), index: match.index }));
    if (stripLeadingSubject && subjects.has(words[0]?.word)) words.shift();
    return words.filter(entry => !optional.has(entry.word));
}
function playerRequestCoverage(input, actions) {
    const expected = requestWords(input, true);
    const actual = actions.flatMap(action => requestWords(action?.request, true));
    const mismatch = expected.findIndex((entry, index) => entry.word !== actual[index]?.word);
    if (mismatch < 0 && expected.length === actual.length) return { ok: true };
    const index = mismatch < 0 ? expected.length : mismatch;
    const excerpt = String(input || '').slice(expected[index]?.index ?? Math.max(0, String(input || '').length - 100)).trim().slice(0, 120);
    return { ok: false, excerpt };
}

function schema(legacy, protocol = 'scene_draft_v2', options = {}) {
    const excluded = new Set(['summary', 'scene', 'events', 'entity_updates', 'state_updates',
        'action_resolution', 'npc_observations', 'world_events']);
    const effects = copy(Object.fromEntries(Object.entries(legacy).filter(([key]) => !excluded.has(key))));
    if (effects.checks?.items?.properties) {
        effects.checks.description = 'Request one engine-resolved check. Put all lasting consequences in typed on_success/on_failure operations. Do not provide success_text/failure_text or branch ledger prose. The engine derives the outcome from applied state changes.';
        const fields = effects.checks.items.properties;
        delete fields.success_text;
        delete fields.failure_text;
        for (const branch of ['on_success','on_failure']) if (fields[branch]) {
            if (fields[branch].properties) for (const key of ['ledger_update','memory_write']) delete fields[branch].properties[key];
            fields[branch].description = 'Typed lasting consequences for this branch. Equipment loss needs inventory_remove; a blocked route needs location_state_updates; an opened gate needs exit_unlocks. No free-form ledger or outcome prose. Use {} for no lasting change.';
        }
    }
    if (effects.npc_introduced?.items) {
        effects.npc_introduced.items.required = ['id', 'name', 'persona'];
        effects.npc_introduced.items.additionalProperties = false;
        effects.npc_introduced.items.properties.id.description = 'New stable actor ID used in speech/events, e.g. npc_examiner. Required for named or role-identified speakers not already registered.';
    }
    if (effects.location_introduced?.items) {
        effects.location_introduced.description = 'Introduce a genuinely new mapped place only when the scene visits it. Give it a stable ID and an exact existing connects_to ID; a separate actor-scoped movement event records any completed arrival.';
        effects.location_introduced.items.required = ['id', 'name', 'connects_to'];
        effects.location_introduced.items.additionalProperties = false;
        effects.location_introduced.items.properties.connects_to.description = 'Exact existing location ID to connect to. Do not introduce locations merely mentioned in speech.';
    }
    const passage = text('Copy the exact, case-sensitive id from one narrative[].id. Never invent, rename, or paraphrase passage IDs; do not repeat passage text.', 80);
    const events = copy(legacy.events);
    if (events?.items?.properties) {
        // Tool-only providers may treat this as advice; JSON-schema transports
        // enforce it so invented event keys never enter a scene proposal.
        events.items.additionalProperties = false;
        if (events.items.properties.type) events.items.properties.type.description =
            'Required. Use exactly one canonical event type: movement, escort, activity, interaction, outfit, inventory, condition, time, observation, status, relationship, quest, discovery, environment, dialogue, other. A movement event means changing mapped places: include exact actor_id, from_location_id and to_location_id from WORLD LORE movementOptions. Ordinary movement within the current room/place needs no location event or ID and may be narrated normally. If no mapped destination is allowed, do not emit a place-to-place movement event or narrate an arrival at another place. Do not invent types such as door, lock, open, close, travel, speech, gain, take or posture. Precommitted player key-door opening and re-locking are engine-owned; describe the committed result without adding an invented door event or effect. For check-unlockable exits, effects.exit_unlocks belongs inside a successful check. Describe a momentary pose in narrative; for a completed pose that must persist as current NPC state, use type activity with actor_id, status completed and activity describing the pose. Use type inventory with action add/gain/take/remove/lose/consume/give/drop for item transfers; use dialogue for speech.';
        if (events.items.properties.from_location_id) events.items.properties.from_location_id.description =
            'Movement only: exact current location ID for this actor, as shown in WORLD LORE movementOptions.';
        if (events.items.properties.to_location_id) events.items.properties.to_location_id.description =
            'Required only when changing mapped places: exact allowed destination ID from this actor’s WORLD LORE movementOptions. Ordinary movement within the current room/place needs no movement event.';
        if (events.items.properties.activity) events.items.properties.activity.description =
            'For type activity: the actor’s resulting ongoing activity or completed lasting pose, e.g. sitting at the desk. Momentary posture and gestures belong in narrative without a state event.';
        if (events.items.properties.next_status) events.items.properties.next_status.description =
            'Only for type status: the NPC lifecycle value alive, dead or gone. Do not use a status event for an activity, pose, mood or temporary condition.';
        if (events.items.properties.outfit) events.items.properties.outfit.description =
            'Required for an outfit event. Describe the resulting complete outfit. If no outfit is established and the scene establishes or changes clothing, invent a plausible outfit consistent with the character, setting, weather and story; never leave blank.';
        delete events.items.properties.evidence;
        events.items.properties.passage_id = passage;
        events.items.required = [...new Set([...(events.items.required || []).filter(k => k !== 'evidence'), 'actor_id', 'passage_id'])];
        if (events.items.properties.action) events.items.properties.action.description =
            'Required for inventory events: add/gain/take or remove/lose/consume/give/drop. Other events may describe the action. Never record an offered-but-unaccepted item as gained.';
    }
    const contract = shape({
        protocol: { type: 'string', enum: ['scene_draft_v2'] },
        narrative: { type: 'array', minItems: 1, maxItems: 16,
            description: 'The complete player-facing scene in ordered passages. Write each passage once and reference its ID below. For a pending check stop before its outcome.',
            items: shape({ id: text('Unique passage ID, e.g. p1. Copy this exact string into every response_id or passage_id reference.', 80), text: text('One paragraph of player-facing narrative or dialogue.', 4000) }) },
        actions: list(shape({
            request: text('Exact contiguous excerpt of the player input. In order, requests must cover the complete input; split compound actions where useful.'),
            kind: { type: 'string', enum: kinds },
            status: { type: 'string', enum: statuses },
            response_id: { ...passage, description: 'Passage that RESPONDS to this request: the answer, refusal, result or check setup. Not a passage merely repeating the player’s question.' }
        })),
        events,
        effects: { ...shape(effects, []),
            description: 'Only changed fields listed in this effects schema are supported. Use {} for no lasting change. Put actor movement, inventory and outfit changes in events, not in invented effect keys.' },
        speech: list(shape({
            speaker: text('Exact present NPC ID or player', 120),
            listeners: list(text('Exact present listener ID or player', 120)),
            passage_id: passage
        })),
        commitments: list(shape({
            id: text('Stable event ID; reuse to acknowledge an existing commitment', 80),
            title: text('Player-facing commitment', 120),
            description: text('What is due and why', 500),
            day: { type: 'integer', minimum: 1, description: 'Absolute world day, starting at 1. Never a relative duration.' },
            minute_of_day: { type: 'integer', minimum: 0, maximum: 1439, description: '24-hour time: 17:00 is 1020.' },
            location_id: text('Registered location ID', 120),
            status: { type: 'string', enum: ['scheduled', 'cancelled'] },
            reschedule: { type: 'boolean', description: 'True only for an explicitly agreed change, not when repeating a deadline.' },
            passage_id: passage
        }, ['id','title','day','minute_of_day','location_id','status','passage_id'])),
        resolutions: list(shape({
            id: text('ID of a reached commitment being resolved', 80),
            passage_id: passage,
            event_index: { type: 'integer', minimum: 0, description: 'Index of its completed, evidenced event in events. Declare any lasting mechanical changes in effects as well.' }
        }))
    }, ['protocol', 'narrative', 'actions', 'events', 'effects', 'speech', 'commitments']);
    // Preserve schema-defined dynamic maps while closing every object with
    // named fields. A constrained backend can then block unknown nested keys.
    closeDeclaredObjectFields(contract);
    if (protocol === 'scene_draft_v3') {
        contract.properties.protocol.enum = [protocol];
        contract.required = ['protocol', 'narrative', 'actions'];
        contract.properties.actions.items.required = ['kind', 'status', 'response_id'];
        contract.properties.actions.items.properties.request.description =
            'Omit only for one simple action. For compound input, copy contiguous excerpts covering the full request in order.';
        if (String(options.input || '').trim() && !simpleRequest(options.input)) {
            contract.properties.actions.items.required.push('request');
            contract.properties.actions.items.properties.request.description =
                'Required for this compound input. Copy contiguous excerpts covering every step in order, including negations; do not omit any step.';
        }
        // Keep semantic guidance for domain fields; the shared instructions
        // carry the repetitive transport and paragraph rules just once.
        contract.properties.narrative.description = 'Ordered scene passages; reference their IDs without repeating prose.';
        if (contract.properties.events?.items?.properties?.type)
            contract.properties.events.items.properties.type.description =
                'Canonical event type. Movement changes mapped places; gestures and showing held items do not. Use inventory for transfers, activity for lasting poses, status only for alive/dead/gone.';
        contract.properties.effects.description = 'Changed enabled fields only. Omit when nothing changes.';
    }
    return contract;
}

function isDraft(value) { return object(value) && ['scene_draft_v2', 'scene_draft_v3'].includes(value.protocol); }
function simpleRequest(input) {
    // Deliberately conservative: uncertain or multilingual compound requests
    // keep explicit coverage rather than silently assigning their first step.
    return !!String(input || '').trim() && !/[\n;,&]|[.!?]\s+\S|\b(?:and|then|after|before|while|also|und|dann|danach|bevor|nachdem|sowie)\b/i.test(input);
}

function localInteraction(request, context) {
    const normalize = s => String(s || '').normalize('NFKC').toLocaleLowerCase().trim()
        .replace(/[.!?]+$/, '').replace(/^(?:the|a|an|my|den|die|das|einen|eine|mein(?:en|e)?)\s+/, '');
    const input = String(request || '').trim().replace(/[.!?]+$/, '');
    if (!simpleRequest(input) || /\b(?:not|never|nicht|kein\w*)\b/i.test(input)) return false;
    const actors = (context.actors || []).filter(actor => (context.present || []).includes(actor.id));
    const names = actors.flatMap(actor => [actor.name, actor.id]).filter(Boolean).map(normalize);
    let match = input.match(/^(?:I|you)\s+show\s+(.+?)\s+to\s+(.+)$/i);
    if (!match) for (const name of names.sort((a, b) => b.length - a.length)) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const indirect = input.match(new RegExp(`^(?:(?:I|you)\\s+show|(?:Ich|Du)\\s+zeig(?:e|st))\\s+(${escaped})\\s+(.+)$`, 'i'));
        if (indirect) { match = [indirect[0], indirect[2], indirect[1]]; break; }
    }
    if (match) return names.includes(normalize(match[2])) && (context.inventory || []).some(item =>
        (typeof item === 'string' || item?.quantity === undefined || Number(item.quantity) > 0)
            && normalize(typeof item === 'string' ? item : item?.name) === normalize(match[1]));
    match = input.match(/^(?:I|you)\s+(?:walk up to|approach|wave to|wave at|nod to|nod at)\s+(.+)$/i)
        || input.match(/^(?:Ich|Du)\s+(?:geh(?:e|st) zu|wink(?:e|st))\s+(.+)$/i);
    if (match) return names.includes(normalize(match[1]));
    return /^(?:(?:I|you)\s+(?:wave|nod|smile)|(?:Ich|Du)\s+(?:wink(?:e|st)|nick(?:e|st)|lächel(?:e|st)))$/i.test(input);
}
function decode(value) {
    if (object(value)) return value;
    let source = String(value).trim();
    // An exact enclosing Markdown fence is a transport wrapper, not prose to
    // recover. Never scan for braces or repair malformed JSON inside it.
    if (source.endsWith('```')) {
        if (source.startsWith('```json\n')) source = source.slice(8, -3).trim();
        else if (source.startsWith('```\n')) source = source.slice(4, -3).trim();
    }
    if (source.startsWith('<world_turn_receipt>') && source.endsWith('</world_turn_receipt>'))
        source = source.slice('<world_turn_receipt>'.length, -'</world_turn_receipt>'.length).trim();
    try {
        const result = JSON.parse(source);
        if (result?.protocol === 'scene_draft_v3' && streamValidator(null).push(source)) return null;
        return object(result) ? result : null;
    }
    catch { return null; }
}

// Migration adapter for engine-owned instructions, not a parser for model prose.
// Keep one protocol authoritative while the legacy replay path is supported.
function alignInstructions(value) {
    return value
        .replace('Even when nothing changes, submit the ending scene checksum with empty events and entity updates for the on-screen cast.',
            'Submit narrative, actions, events, effects, speech and commitments as scene_draft_v2, including when nothing changes. The engine derives the ending scene; never supply a checksum or entity_updates.')
        .replace('and give the complete ending cast in scene.present_character_ids',
            'only; the engine computes the ending cast')
        .replace('entity_updates reports what each on-screen person is wearing now.',
            'Do not add entity_updates; outfit events carry the changes.')
        .replace('and in state_updates.time_skip_minutes when applicable', 'without also duplicating elapsed time in effects')
        .replaceAll('Put prose-only possible consequences in success_text/failure_text at the check root, NEVER in on_success.summary or on_failure.summary.',
            'All lasting check consequences require typed on_success/on_failure operations. Omit success_text/failure_text: the engine derives the outcome from the applied state delta. Never use branch ledger prose as a substitute for a mechanical change.')
        .replaceAll('state_updates.', 'effects.');
}

function compile(draft, context) {
    const errors = [];
    const fail = (path, reason, explanation = '') => errors.push({ type: 'scene_draft', reason,
        detail: explanation ? `${path}: ${explanation}` : path });
    if (!isDraft(draft)) return { ok: false, errors: [{ reason: 'invalid_scene_protocol' }] };
    draft = copy(draft);
    if (draft.protocol === 'scene_draft_v3') {
        for (const key of ['events', 'speech', 'commitments', 'resolutions'])
            if (draft[key] === undefined) draft[key] = [];
        if (draft.effects === undefined) draft.effects = {};
        if (Array.isArray(draft.actions)) draft.actions.forEach((action, index) => {
            if (!object(action) || action.request !== undefined) return;
            if (draft.actions.length === 1 && simpleRequest(context.input)) action.request = context.input;
            else fail(`actions.${index}.request`, 'explicit_request_coverage_required');
        });
    }
    // One recorded provider typo has an exact, lossless destination. Keep the
    // witness IDs; do not guess when both spellings are present or malformed.
    (Array.isArray(draft.events) ? draft.events : []).forEach((event, index) => {
        if (!object(event) || !Object.prototype.hasOwnProperty.call(event, 'witnessed_by__')) return;
        if (Object.prototype.hasOwnProperty.call(event, 'witnessed_by')) {
            fail(`events.${index}.witnessed_by__`, 'conflicting_event_field');
            return;
        }
        if (!Array.isArray(event.witnessed_by__)
            || event.witnessed_by__.some(id => typeof id !== 'string')) return;
        event.witnessed_by = event.witnessed_by__;
        delete event.witnessed_by__;
    });
    (Array.isArray(draft.events) ? draft.events : []).forEach(event => {
        if (!object(event) || event.type !== 'posture' || event.status !== 'completed'
            || typeof event.actor_id !== 'string' || !event.actor_id.trim()
            || !Object.keys(event).every(key => [
                'id', 'type', 'actor_id', 'status', 'activity', 'posture', 'action',
                'passage_id', 'participants', 'witnessed_by', 'visibility'
            ].includes(key))) return;
        const descriptions = [event.activity, event.posture, event.action]
            .filter(value => typeof value === 'string' && value.trim());
        if (descriptions.length !== 1) return;
        event.type = 'activity';
        event.activity = descriptions[0].trim();
        if (Object.prototype.hasOwnProperty.call(event, 'posture')) delete event.posture;
    });
    if (errors.length) return { ok: false, errors };
    // Older drafts carried alternative outcome prose. It has never been state
    // authority; strip it before schema checking as well as before compiling
    // typed consequences. Lasting branch effects are still validated below.
    if (Array.isArray(draft.effects?.checks)) for (const check of draft.effects.checks) {
        if (!object(check)) continue;
        delete check.success_text;
        delete check.failure_text;
    }
    if (context.contract) {
        rejectUnknownFields(draft, context.contract, '', fail);
        if (errors.length) return { ok: false, errors };
    }
    // Some compatible providers flatten explicitly named effect fields at the
    // root. This is a structural adapter, never a prose inference: relocate only
    // enabled, known fields, reject conflicting duplicates, and validate every
    // proposed mutation through the same reducer below. Unknown fields stay
    // errors rather than being silently discarded.
    if (object(draft.effects)) for (const key of context.effectKeys || []) {
        if (['npc_observations', 'world_events'].includes(key)
            || !Object.prototype.hasOwnProperty.call(draft, key)) continue;
        if (Object.prototype.hasOwnProperty.call(draft.effects, key)
            && JSON.stringify(draft.effects[key]) !== JSON.stringify(draft[key]))
            fail(`effects.${key}`, 'conflicting_effect_placement');
        else draft.effects[key] = draft[key];
        delete draft[key];
    }
    // IDs bind mechanics to the exact prose that will be shown. No fuzzy text
    // matching, quote duplication, or model-generated end-state checksum.
    if (Array.isArray(draft.narrative)) {
        const passages = new Map();
        const passageAliases = new Map();
        if (!draft.narrative.length || draft.narrative.length > 16) fail('narrative', 'invalid_passages');
        for (const p of draft.narrative) {
            if (!object(p) || typeof p.id !== 'string' || !p.id.trim() || p.id.length > 80
                || passages.has(p.id.trim()) || passageAliases.has(p.id.trim().toLowerCase())
                || typeof p.text !== 'string' || !p.text.trim() || p.text.length > 4000)
                fail('narrative', 'invalid_passage');
            else {
                const id = p.id.trim();
                passages.set(id, p.text.trim());
                passageAliases.set(id.toLowerCase(), id);
            }
        }
        const bind = (items, source, target, path) => {
            if (!Array.isArray(items)) return;
            items.forEach((item, i) => {
                if (!object(item)) { fail(`${path}.${i}`, 'unknown_passage_id'); return; }
                const reference = typeof item[source] === 'string' ? item[source].trim() : '';
                // Providers occasionally alter the passage token while copying
                // the rest of a valid one-passage draft. In that case there is
                // exactly one possible target, so bind locally instead of
                // spending another model call or rejecting the complete turn.
                const resolvedId = passageAliases.get(reference.toLowerCase())
                    || (passages.size === 1 ? passages.keys().next().value : null);
                if (!resolvedId) { fail(`${path}.${i}`, 'unknown_passage_id'); return; }
                item[target] = passages.get(resolvedId);
                delete item[source];
            });
        };
        bind(draft.actions, 'response_id', 'response', 'actions');
        bind(draft.events, 'passage_id', 'evidence', 'events');
        bind(draft.speech, 'passage_id', 'statement', 'speech');
        bind(draft.commitments, 'passage_id', 'evidence', 'commitments');
        bind(draft.resolutions, 'passage_id', 'response', 'resolutions');
        draft.narrative = [...passages.values()].join('\n\n');
        if (errors.length) return { ok: false, errors };
    }
    const allowed = new Set(['protocol', 'narrative', 'actions', 'events', 'effects', 'speech', 'commitments', 'resolutions']);
    Object.keys(draft).forEach(key => { if (!allowed.has(key)) fail(key, 'unsupported_draft_field'); });
    const narrative = typeof draft.narrative === 'string' ? draft.narrative.trim() : '';
    if (!narrative || narrative.length > 16000) fail('narrative', 'invalid_scene_narrative');
    for (const key of ['actions', 'events', 'speech', 'commitments']) {
        if (!Array.isArray(draft[key]) || draft[key].length > 32) fail(key, 'invalid_draft_list');
    }
    if (!object(draft.effects)) fail('effects', 'invalid_draft_effects');
    if (draft.resolutions !== undefined && (!Array.isArray(draft.resolutions) || draft.resolutions.length > 32))
        fail('resolutions', 'invalid_draft_list');
    if (errors.length) return { ok: false, errors };
    const effects = copy(draft.effects);
    const effectKeys = new Set(context.effectKeys || []);
    Object.keys(effects).forEach(key => {
        if (!effectKeys.has(key) || ['npc_observations', 'world_events'].includes(key))
            fail(`effects.${key}`, 'unsupported_draft_effect');
    });
    const actions = draft.actions;
    // This exemption is derived from the submitted request and current engine
    // inventory/cast, never from a model's assertion of success. Other events
    // and all narrative conflicts still pass through the domain validator.
    actions.forEach(action => {
        if (object(action)) delete action.verifiedLocalInteraction;
        if (object(action) && action.kind === 'physical' && action.status === 'resolved'
            && localInteraction(action.request, context)) action.verifiedLocalInteraction = true;
    });
    const coverage = playerRequestCoverage(context.input, actions);
    // An omitted clause is an incomplete response, not permission to invent
    // that clause's effect and not a reason to discard independently verified
    // events. The caller surfaces the gap while the reducer applies only the
    // changes that were actually proposed and validated.
    if (String(context.input || '').trim() && !actions.length) fail('actions', 'missing_player_response');
    actions.forEach((action, index) => {
        if (!object(action) || !kinds.includes(action.kind) || !statuses.includes(action.status)) {
            fail(`actions.${index}`, 'invalid_action_disposition'); return;
        }
        if (typeof action.request !== 'string') fail(`actions.${index}.request`, 'invalid_action_request');
        if (typeof action.response !== 'string' || action.response.trim().length < 8
            || !narrative.includes(action.response.trim())) fail(`actions.${index}.response`, 'response_missing_from_scene');
    });
    if (errors.length) return { ok: false, errors };
    const checks = Array.isArray(effects.checks) ? effects.checks : [];
    // A speculative attempt's ledger sentence is presentation, not a lasting
    // check consequence. The source-linked scene retains the attempt; the
    // selected typed branch is the only source of its mechanical outcome.
    if (checks.length) delete effects.ledger_update;
    for (const [i, check] of checks.entries()) {
        if (!object(check)) continue;
        // Model-authored branch prose is never a state authority. Compatibility
        // fields are discarded; the engine renders the actual selected delta.
        delete check.success_text;
        delete check.failure_text;
        for (const branch of ['on_success','on_failure']) {
            if (object(check[branch]) && ['ledger_update','memory_write'].some(key => key in check[branch]))
                fail(`effects.checks.${i}.${branch}`, 'untyped_check_consequence',
                    'Use typed inventory, route, condition, quest or relationship changes, not ledger_update/memory_write. Use {} if nothing lasting changes.');
        }
        check.outcome_contract = 'state_delta_v1';
    }
    const pendingActions = actions.filter(action => action?.status === 'pending_check');
    if (checks.length && (checks.length !== 1 || !pendingActions.length
        || new Set(pendingActions.map(action => action.response)).size !== 1))
        fail('actions', 'check_requires_one_pending_action',
            'One check may cover multiple clauses only when they reference the same pending-attempt passage. Independent attempts require separate turns.');
    if (pendingActions.length && checks.length !== 1)
        fail('effects.checks', 'pending_action_requires_check');
    const locations = new Set(context.locations || []);
    const introductions = effects.location_introduced || [];
    if (Array.isArray(introductions)) introductions.forEach((location, index) => {
        if (!location?.id || !locations.has(location.connects_to || location.parent_location_id))
            fail(`effects.location_introduced.${index}`, 'location_requires_registered_connection');
        else {
            locations.add(location.id);
            // The existing graph reducer consumes connects_to. Preserve the
            // explicit parent connection rather than falling back elsewhere.
            if (!location.connects_to) location.connects_to = location.parent_location_id;
        }
    });
    if (Array.isArray(effects.quests_update)) effects.quests_update.forEach((quest, qi) => {
        (Array.isArray(quest?.objectives) ? quest.objectives : []).forEach((objective, oi) => {
            if (objective?.type === 'location' && !locations.has(objective.target))
                fail(`effects.quests_update.${qi}.objectives.${oi}`, 'unknown_quest_location');
        });
    });
    const present = new Set(['player', ...(context.present || [])]);
    if (Array.isArray(effects.npc_introduced)) effects.npc_introduced.forEach(npc => { if (npc?.id) present.add(npc.id); });
    const events = copy(draft.events);
    // The action entry already identifies an exact player request and a
    // linked narrative passage. If the model marks a physical attempt but
    // forgets its informational event, record that attempt locally. It grants
    // no success or state change and still passes through receipt validation.
    for (const action of actions) if (action.kind === 'physical' && action.status === 'attempted'
        && !events.some(event => event?.actor_id === 'player'
            && ['attempted', 'in_progress', 'failed'].includes(event.status))
        && !checks.length) events.push({ type: 'interaction', actor_id: 'player', status: 'attempted',
            action: action.request.slice(0, 180), evidence: action.response.slice(0, 400) });
    // A precise vocabulary alias, not an inferred event from prose. Both mean
    // a spoken interaction; the domain reducer still validates actor/status.
    for (const event of events) if (event?.type === 'speech') event.type = 'dialogue';
    const neutralEventKeys = new Set(['id','actor_id','status','action','target_id',
        'evidence','witnessed_by','visibility']);
    const timeEventKeys = new Set([...neutralEventKeys,'cause','minutes_elapsed']);
    for (const event of events) if (object(event) && !event.type
        && Number.isInteger(event.minutes_elapsed) && event.minutes_elapsed > 0
        && Object.keys(event).every(key => timeEventKeys.has(key))) event.type = 'time';
    for (const event of events) if (object(event) && !event.type
        && Object.keys(event).every(key => neutralEventKeys.has(key))) {
        // An otherwise explicit narrative annotation has no state operation
        // to infer. Record it as a neutral event. Never guess a missing type
        // for a movement, item, time, condition or other mechanical payload.
        event.type = 'other';
    }
    draft.speech.forEach((speech, index) => {
        const listeners = speech?.listeners;
        if (!object(speech) || !present.has(speech.speaker) || !Array.isArray(listeners)
            || !listeners.length || listeners.length > 32 || listeners.some(id => !present.has(id))
            || typeof speech.statement !== 'string' || !speech.statement.trim()
            || !narrative.includes(speech.statement)) {
            fail(`speech.${index}`, 'invalid_witnessed_speech'); return;
        }
        for (const listener of new Set(listeners)) {
            if (listener === 'player' || listener === speech.speaker) continue;
            events.push({ type: 'observation', actor_id: listener, status: 'completed',
                observation: speech.statement, source_type: 'told', source_npc_id: speech.speaker,
                confidence: 1, visibility: 'private', allowed_to_share: true,
                witnessed_by: [listener], evidence: speech.statement });
        }
    });
    const commitments = [];
    const ids = new Set();
    draft.commitments.forEach((rawItem, index) => {
        const item = object(rawItem) ? { ...rawItem,
            description: rawItem.description ?? String(rawItem.evidence || rawItem.title || '').slice(0,500),
            reschedule: rawItem.reschedule ?? false } : rawItem;
        const path = `commitments.${index}`;
        if (!object(item) || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 80
            || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 120
            || typeof item.description !== 'string' || item.description.length > 500
            || ids.has(item.id) || !Number.isInteger(item.day) || item.day < 1
            || !Number.isInteger(item.minute_of_day) || item.minute_of_day < 0 || item.minute_of_day > 1439
            || !locations.has(item.location_id) || !['scheduled', 'cancelled'].includes(item.status)
            || typeof item.reschedule !== 'boolean' || !item.evidence || !narrative.includes(item.evidence)) {
            fail(path, 'invalid_commitment'); return;
        }
        ids.add(item.id);
        const dueMinute = (item.day - 1) * 1440 + item.minute_of_day;
        const previous = (context.commitments || []).find(event => event.id === item.id);
        if (previous && !item.reschedule && previous.dueMinute !== dueMinute)
            fail(path, 'commitment_time_changed_without_reschedule',
                `Existing ${item.id} is day ${Math.floor(previous.dueMinute / 1440) + 1}, minute_of_day ${previous.dueMinute % 1440}. Omit unchanged commitments. Do not recalculate or shift the deadline.`);
        if ((!previous || item.reschedule) && item.status === 'scheduled' && dueMinute <= context.now)
            fail(path, 'new_commitment_in_past');
        if (previous && previous.status !== 'scheduled' && item.status === 'scheduled' && !item.reschedule)
            fail(path, 'resolved_commitment_rearmed');
        commitments.push({ ...copy(item), dueMinute });
    });
    if (commitments.length) effects.world_events = commitments.map(item => ({
        id: item.id, title: item.title, description: item.description,
        status: item.status, urgent: true, location_id: item.location_id,
        // Exact engine-owned timestamp is applied by the adapter, never read
        // from model-provided legacy state fields.
        due_in_minutes: Math.max(1, item.dueMinute - context.now)
    }));
    const resolutions = [];
    const proposedElapsed = Math.max(0, Number(effects.time_skip_minutes) || 0,
        ...events.filter(event => event.type === 'time' && event.status === 'completed')
            .map(event => Number(event.minutes_elapsed) || 0));
    for (const [index, resolution] of (draft.resolutions || []).entries()) {
        const previous = (context.commitments || []).find(event => event.id === resolution?.id);
        const event = Number.isInteger(resolution?.event_index) ? events[resolution.event_index] : null;
        // A wait can reach the deadline and witness its consequence in this
        // very scene. The elapsed-time operation still has to pass the reducer;
        // do not force a second turn just because the pre-turn timer is scheduled.
        const reached = previous?.status === 'triggered' || previous?.status === 'scheduled'
            && Number.isFinite(previous.dueMinute) && proposedElapsed > 0
            && previous.dueMinute <= context.now + proposedElapsed;
        if (!previous || !reached || previous.sceneResolution
            || (previous.locationId && previous.locationId !== context.location)
            || typeof resolution.response !== 'string' || !resolution.response.trim()
            || !narrative.includes(resolution.response) || event?.status !== 'completed'
            || event.type === 'time'
            || typeof event.evidence !== 'string' || !event.evidence.trim() || !narrative.includes(event.evidence)
            || !(event.evidence.includes(resolution.response) || resolution.response.includes(event.evidence))
            || resolutions.some(item => item.id === resolution.id)) {
            fail(`resolutions.${index}`, 'unverified_commitment_resolution'); continue;
        }
        resolutions.push(copy(resolution));
    }
    for (const event of context.commitments || []) {
        if (event.sourceReceiptId && event.status === 'triggered' && !event.sceneResolution
            && (!event.locationId || event.locationId === context.location)
            && !resolutions.some(item => item.id === event.id)) fail(`resolutions.${event.id}`, 'reached_commitment_needs_scene_resolution');
    }
    if (events.length > 100) fail('speech', 'too_many_compiled_events');
    if (errors.length) return { ok: false, errors };
    const first = actions[0];
    return { ok: true, narrative, actions: copy(actions), speech: copy(draft.speech), commitments, resolutions,
        unaddressedRequest: coverage.ok ? '' : coverage.excerpt,
        receipt: {
            summary: actions.map(action => action.response).join(' ').slice(0, 300),
            action_resolution: first ? { kind: first.kind, status: first.status, outcome: first.response } : null,
            scene: { player_location_id: context.location,
                player_location_changed: context.location !== context.playerStart,
                present_character_ids: [...(context.present || [])] },
            events, entity_updates: [], state_updates: effects
        }
    };
}

// A lexical streaming reader, not a partial JSON repairer. Only closed values
// are inspected. Missing keys and cross-passage references wait for compile().
// Unknown/legacy field aliases also wait for the normal compatibility adapter.
function streamValidator(contract) {
    let source = '', pos = 0, tokenStart = -1, quoted = false, escaped = false;
    let error = null, started = false, finished = false;
    const stack = [];
    const fail = (path, reason) => { error ||= { type: 'scene_draft', reason, detail: path }; };
    const slot = () => {
        const parent = stack[stack.length - 1];
        if (!parent) return { path: '', spec: contract };
        const key = parent.array ? parent.count : parent.key;
        return { path: parent.path ? `${parent.path}.${key}` : String(key),
            spec: parent.array ? parent.spec?.items : parent.spec?.properties?.[key] };
    };
    const accept = (value, target) => {
        const { spec, path } = target;
        // These aliases have lossless existing compiler adapters.
        const compatible = path === 'protocol' && ['scene_draft_v2', 'scene_draft_v3'].includes(value)
            || /^events\.\d+\.type$/.test(path) && ['speech', 'posture'].includes(value);
        if (spec?.enum && !compatible && !spec.enum.includes(value)) fail(path, 'invalid_stream_enum');
        const parent = stack[stack.length - 1];
        if (parent) { parent.state = 'comma'; parent.count++; }
        else finished = true;
    };
    const literal = (raw, target) => {
        try { accept(JSON.parse(raw), target); }
        catch { fail(target.path, 'invalid_stream_json'); }
    };
    function push(chunk) {
        source += String(chunk || '');
        if (error || finished) return error;
        // Tagged and fenced fallback channels are supported without searching
        // arbitrary prose for a brace. Wait until their opening is complete.
        if (!started) {
            const trimmed = source.trimStart();
            const wrappers = ['<world_turn_receipt>', '```json\n', '```\n'];
            const wrapper = wrappers.find(prefix => trimmed.startsWith(prefix));
            if (wrapper) pos = source.length - trimmed.length + wrapper.length;
            else if (wrappers.some(prefix => prefix.startsWith(trimmed))) return null;
            else if (!trimmed.startsWith('{')) return null;
            else pos = source.length - trimmed.length;
            started = true;
        }
        while (pos < source.length && !error && !finished) {
            const ch = source[pos];
            const parent = stack[stack.length - 1];
            if (quoted) {
                pos++;
                if (escaped) { escaped = false; continue; }
                if (ch === '\\') { escaped = true; continue; }
                if (ch !== '"') continue;
                quoted = false;
                let value;
                try { value = JSON.parse(source.slice(tokenStart, pos)); }
                catch { fail(slot().path, 'invalid_stream_json'); break; }
                tokenStart = -1;
                if (parent?.state === 'key') {
                    if (parent.keys.has(value)) { fail(parent.path, 'duplicate_stream_key'); break; }
                    parent.keys.add(value); parent.key = value; parent.state = 'colon';
                } else accept(value, slot());
                continue;
            }
            if (tokenStart >= 0) {
                if (!/[\s,}\]]/.test(ch)) { pos++; continue; }
                literal(source.slice(tokenStart, pos), slot()); tokenStart = -1;
                continue;
            }
            if (/\s/.test(ch)) { pos++; continue; }
            if (ch === '}' || ch === ']') {
                if (!parent || (ch === ']') !== parent.array || !['key', 'value', 'comma'].includes(parent.state)) {
                    fail(slot().path, 'invalid_stream_json'); break;
                }
                // Full JSON parsing at commit still catches trailing commas.
                stack.pop(); pos++;
                accept(parent.array ? [] : {}, parent);
                continue;
            }
            if (parent?.state === 'colon') {
                if (ch !== ':') { fail(parent.path, 'invalid_stream_json'); break; }
                parent.state = 'value'; pos++; continue;
            }
            if (parent?.state === 'comma') {
                if (ch !== ',') { fail(parent.path, 'invalid_stream_json'); break; }
                parent.state = parent.array ? 'value' : 'key'; pos++; continue;
            }
            if (ch === '"') { tokenStart = pos++; quoted = true; continue; }
            if (parent?.state === 'key') { fail(parent.path, 'invalid_stream_json'); break; }
            if (ch === '{' || ch === '[') {
                stack.push({ ...slot(), array: ch === '[', count: 0, keys: new Set(),
                    state: ch === '[' ? 'value' : 'key' });
                pos++; continue;
            }
            tokenStart = pos++;
        }
        return error;
    }
    return { push };
}

root.HordeWorldSceneDraft = { schema, compile, isDraft, decode, alignInstructions, streamValidator, simpleRequest, localInteraction };
if (typeof module !== 'undefined') module.exports = root.HordeWorldSceneDraft;
})(globalThis);
