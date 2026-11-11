/* Structural model transport. Only the host assigns action/passage IDs.
 * Shared by the HTTP worker and offline tests; it never mutates game state. */
(function (root) {
'use strict';
const clone = value => JSON.parse(JSON.stringify(value));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const stable = value => JSON.stringify(value, function (_key, item) {
    return object(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
});
function normalizedEffects(value) {
    const result = object(value) ? clone(value) : {};
    if (Number.isInteger(result.time_skip_minutes) && result.time_skip_minutes > 0
        && result.time_skip_minutes <= 10080
        && result.time_advance === undefined) {
        result.time_advance = [{ minutes: result.time_skip_minutes }];
        delete result.time_skip_minutes;
    }
    return result;
}
const shape = (properties, required = []) => ({ type: 'object', properties,
    required, additionalProperties: false });
const list = (items, maxItems = 32) => ({ type: 'array', items, maxItems });
function schema(canonical, options = {}) {
    const source = clone(canonical.properties);
    const withoutLinks = (spec, keepId = false) => {
        const result = clone(spec);
        for (const key of ['action_id', 'passage_id', 'response_id', ...(keepId ? [] : ['id'])]) {
            delete result.properties?.[key];
            if (result.required) result.required = result.required.filter(item => item !== key);
        }
        return result;
    };
    const hasChecks = !!source.actions.items.properties.action_effects.properties?.checks;
    const effects = { anyOf: [source.actions.items.properties.action_effects,
        { type: 'array', maxItems: 0 }],
        description: hasChecks
            ? 'Typed changes or exactly one checks entry for a pending_check action. A check must describe a real unresolved risk and use its registered fields; [] means no effect or check.'
            : 'Only real lasting changes, using the supported typed operations. [] means no change.' };
    const paragraph = shape({ text: { type: 'string', minLength: 1, maxLength: 5200 },
        events: list(withoutLinks(source.events.items)),
        speech: list(withoutLinks(source.speech.items)),
        commitments: list({ ...withoutLinks(source.commitments.items),
            properties: { ...withoutLinks(source.commitments.items).properties,
                existing_id: { type: 'string', maxLength: 80,
                    description: 'Exact existing commitment ID only when acknowledging, cancelling or rescheduling it.' },
                source_quote: { type: 'string', minLength: 1, maxLength: 1200,
                    description: 'Exact current player words authorizing this timed obligation; omit the obligation if none.' } },
            required: [...withoutLinks(source.commitments.items).required, 'source_quote'] })
    }, ['text']);
    if (options.allowCommitments === false) delete paragraph.properties.commitments;
    if (source.resolutions) paragraph.properties.resolutions = list(withoutLinks(source.resolutions.items, true));
    const action = source.actions.items.properties;
    return shape({ protocol: source.protocol,
        actions: { ...list(shape({ request: action.request, kind: { ...action.kind,
            enum: [...action.kind.enum, 'gesture'] }, status: action.status,
            response: { ...list(paragraph, 16), minItems: 1 }, effects,
            authorization_quote: { type: 'string', minLength: 1, maxLength: 1200,
                description: 'For a new quest only: exact current player words accepting or stating that objective. An NPC offer is not acceptance.' },
            depends_on: list(shape({ action_index: { type: 'integer', minimum: 0, maximum: 31 },
                outcome: { type: 'string', enum: ['succeeded', 'failed', 'blocked'] }
            }, ['action_index', 'outcome'])), state_conditions: action.state_conditions
        }, [...(options.requireRequest ? ['request'] : []), 'kind', 'status', 'response'])),
        description: 'Responses belong inside their action. No action_id, passage_id or response_id: the server creates all links. Use one action for a dialogue with incidental gestures and questions. Split only independently resolved player actions; their request excerpts must cover the player message in order without duplicated wording.' },
        reactions: list(shape({ ...paragraph.properties, effects,
            after_action_index: { type: 'integer', minimum: 0, maximum: 31,
                description: 'Insert this NPC/world response immediately after the indexed player action, before later player actions.' }
        }, ['text']), 16)
    }, ['protocol', 'actions']);
}
function validate(value, spec, path = '', errors = []) {
    if (!spec) return errors;
    if (spec.anyOf) {
        const typed = spec.anyOf.find(option => option.type === 'object' && object(value)
            || option.type === 'array' && Array.isArray(value));
        if (typed) validate(value, typed, path, errors);
        else errors.push({ reason: 'invalid_bound_field', detail: path });
        return errors;
    }
    const valid = spec.type === 'object' ? object(value) : spec.type === 'array' ? Array.isArray(value)
        : spec.type === 'integer' ? Number.isInteger(value) : spec.type === 'number' ? Number.isFinite(value)
            : spec.type === 'string' ? typeof value === 'string'
                : spec.type === 'boolean' ? typeof value === 'boolean' : true;
    if (!valid || spec.enum && !spec.enum.includes(value)) {
        errors.push({ reason: 'invalid_bound_field', detail: path }); return errors;
    }
    if (typeof value === 'string' && (value.length > (spec.maxLength ?? Infinity)
        || value.length < (spec.minLength ?? 0))
        || typeof value === 'number' && (value < (spec.minimum ?? -Infinity)
            || value > (spec.maximum ?? Infinity)))
        errors.push({ reason: 'invalid_bound_field', detail: path });
    if (Array.isArray(value)) {
        if (value.length > (spec.maxItems ?? Infinity) || value.length < (spec.minItems ?? 0))
            errors.push({ reason: 'invalid_bound_field', detail: path });
        value.forEach((item, index) => validate(item, spec.items, `${path}.${index}`, errors));
    } else if (object(value)) {
        for (const key of spec.required || []) if (!Object.hasOwn(value, key))
            errors.push({ reason: 'missing_bound_field', detail: `${path}.${key}` });
        for (const [key, item] of Object.entries(value)) {
            const child = spec.properties?.[key];
            if (!child && spec.additionalProperties === false)
                errors.push({ reason: ['action_id', 'passage_id', 'response_id'].includes(key)
                    ? 'engine_owned_binding_required' : 'unsupported_bound_field', detail: `${path}.${key}` });
            else validate(item, child || (object(spec.additionalProperties) ? spec.additionalProperties : null),
                path ? `${path}.${key}` : key, errors);
        }
    }
    return errors;
}
// Align exact model excerpts with the player text. Overlapping excerpts are
// safe to partition only when their ordered placement is unique and each
// action retains its own nonempty part of the request.
function alignRequests(input, actions) {
    const candidates = actions.map(action => {
        const excerpt = String(action.request || '').trim();
        if (!excerpt) return [];
        const positions = [];
        for (let start = input.indexOf(excerpt); start >= 0; start = input.indexOf(excerpt, start + 1))
            positions.push({ start, end: start + excerpt.length });
        return positions;
    });
    const solutions = [];
    const visit = (index, placed) => {
        if (solutions.length > 1) return;
        if (index === candidates.length) {
            const coveredEnd = Math.max(...placed.map(match => match.end));
            if (input.slice(coveredEnd).trim()) return;
            const spans = placed.map((match, i) => ({ start: match.start,
                end: i + 1 < placed.length && placed[i + 1].start < match.end
                    ? placed[i + 1].start : i + 1 === placed.length ? coveredEnd : match.end }));
            if (spans.every((span, i) => input.slice(span.start, span.end).trim()
                && (i + 1 === spans.length || placed[i].end >= spans[i + 1].start
                    || !input.slice(placed[i].end, spans[i + 1].start).trim())
                && /^[\s\p{P}\p{S}]*$/u.test(input.slice(placed[i].end, span.end))))
                solutions.push(spans);
            return;
        }
        for (const match of candidates[index]) {
            const previous = placed.at(-1);
            if (!previous) {
                if (input.slice(0, match.start).trim()) continue;
            } else {
                if (match.start <= previous.start
                    || input.slice(Math.max(...placed.map(item => item.end)), match.start).trim()
                    || match.start < previous.end && /[\p{L}\p{N}]/u.test(input[match.start - 1] || '')
                        && /[\p{L}\p{N}]/u.test(input[match.start] || '')) continue;
            }
            visit(index + 1, [...placed, match]);
            if (solutions.length > 1) return;
        }
    };
    visit(0, []);
    if (solutions.length) return solutions.length === 1 ? solutions[0] : null;
    // The model may omit grammatical glue when naming independent clauses.
    // Compare every substantive word in order, including negation, actors,
    // destinations and object names. The host still binds the original text.
    const optional = new Set(['i', 'ich', 'we', 'wir', 'you', 'du', 'a', 'an', 'the',
        'der', 'die', 'das', 'den', 'dem', 'ein', 'eine', 'einen', 'einem', 'and',
        'und', 'then', 'dann']);
    const words = source => [...String(source || '').matchAll(/[\p{L}\p{N}]+/gu)]
        .map(match => ({ word: match[0].normalize('NFKC').toLocaleLowerCase(),
            start: match.index, end: match.index + match[0].length }))
        .filter(entry => !optional.has(entry.word));
    const sourceWords = words(input);
    const requestWords = actions.map(action => words(action.request));
    if (requestWords.some(group => !group.length)
        || requestWords.reduce((count, group) => count + group.length, 0) !== sourceWords.length
        || requestWords.flat().some((entry, index) => entry.word !== sourceWords[index].word))
        return null;
    let offset = 0;
    return requestWords.map((group, index) => {
        const start = index === 0 ? 0 : sourceWords[offset].start;
        offset += group.length;
        return { start, end: index === requestWords.length - 1
            ? input.length : sourceWords[offset].start };
    });
}
// Only explicit first-person acts can override a model's disposition. Keep
// quoted speech, negation, questions and instructions to another actor out of
// this guard; uncertain requests remain subject to the normal proof checks.
function directPlayerAct(request) {
    const source = String(request || '').trim().replace(/^(?:then|and then|dann|und dann)\s+/iu, '');
    if (!/^(?:I|Ich)\s+/iu.test(source) || /\?\s*$/u.test(source)) return null;
    const body = source.replace(/^(?:I|Ich)\s+/iu, '')
        .replace(/^(?:try|attempt)\s+to\s+/iu, '');
    if (/\b(?:not|nicht|never|kein|keine|keinen|keinem|keiner)\b/iu.test(body)
        || /^(?:don't|won't)\b/iu.test(body)
        || /^(?:say|tell|ask|quote|sage|frage|erzähle|bitte)\b/iu.test(body))
        return null;
    const pickup = /^(?:take|pick\s+up|grab|collect|nehme|nimm|hebe\s+auf|greife)\b/iu.test(body);
    const travel = /^(?:walk|go|move|travel|enter|gehe|laufe|betrete|reise)\b/iu.test(body);
    return { body, pickup, travel };
}
// The server may witness a bodily activity directly from a player's request
// when its named support is uniquely present and reachable. This never
// authorizes an object mutation or an inventory/location change.
function groundedLocalActivity(request, references, playerLocation, priorTarget = null) {
    const source = String(request || '').replace(/["„“«][^"“”»]*["“”»]/gu, ' ').trim();
    if (/\b(?:not|never|nicht|kein\w*|try|attempt|versuch\w*)\b/iu.test(source)) return null;
    const pose = [
        { name: 'sitting', pattern: /\b(?:sit(?:s|ting)?|setz(?:e|t|en|te|ten)?\s+(?:mich|dich|sich|uns)|sitz\w*)\b/iu },
        { name: 'standing', pattern: /\b(?:stand(?:s|ing)?|steh\w*)\b/iu },
        { name: 'kneeling', pattern: /\b(?:kneel(?:s|ing)?|knie\w*)\b/iu }
    ].find(entry => entry.pattern.test(source));
    if (!pose) return null;
    if (/\b(?:darauf|on it|onto it)\b/iu.test(source))
        return priorTarget?.reachable !== false && priorTarget?.locationId === playerLocation
            && (priorTarget?.supportsActivities || []).includes(pose.name) ? pose.name : null;
    const support = source.match(/\b(?:on|onto|upon|auf)\s+(?:(?:a|an|the|einen?|einem|eine|einer|den|die|das|dem)\s+)?([\p{L}\p{N}-]+)\b/iu)?.[1];
    if (!support) return pose.name === 'sitting' || pose.name === 'standing'
        || pose.name === 'kneeling' ? pose.name : null;
    const key = value => String(value || '').normalize('NFKC').toLocaleLowerCase();
    const matches = (references || []).filter(ref => ref.type === 'item'
        && [ref.name, ...(ref.aliases || [])].some(name => key(name).split(/\s+/u).includes(key(support))));
    if (matches.length !== 1 || matches[0].locationId !== playerLocation
        || matches[0].reachable === false) return null;
    return pose.name;
}
function playerIntentErrors(input, actions, spans, context) {
    const references = Array.isArray(context.references) ? context.references : [];
    const norm = value => String(value || '').normalize('NFKC').toLocaleLowerCase();
    const mentions = (source, type) => references.filter(ref => ref.type === type
        && [ref.name, ref.id, ...String(ref.name || '').split(/\s+/u).slice(-1)]
            .some(name => name && new RegExp(`(?:^|[^\\p{L}\\p{N}])${String(name)
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'iu')
                .test(source)));
    const errors = [];
    actions.forEach((action, index) => {
        const request = input.slice(spans[index].start, spans[index].end).trim();
        const act = directPlayerAct(request);
        if (!act) return;
        if (/^(?:(?:try|attempt)\s+to\s+)?(?:dance|hold|restrain|bind|tie|release|tanze|halte|fessele|binde|lasse\s+los)\b/iu.test(act.body)
            && action.kind !== 'physical')
            errors.push({ reason: 'player_action_kind_mismatch', detail: `actions.${index}.kind`,
                expected: 'physical', request });
        const heldObject = act.pickup && /^(?:take|pick\s+up|grab|collect|nehme|nimm|hebe\s+auf|greife)\s+(?:my|mein(?:e|en|em|es)?)\s+/iu.test(act.body)
            && !/\b(?:from|off|aus|von|vom)\b/iu.test(act.body);
        const pickupObject = act.pickup && !heldObject ? act.body.replace(/^(?:take|pick\s+up|grab|collect|nehme|nimm|hebe\s+auf|greife)\s+/iu, '')
            .replace(/^(?:the|a|an|den|die|das|einen|eine|dem)\s+/iu, '') : '';
        const itemMatches = pickupObject ? mentions(pickupObject.split(/\s+(?:from|off|on|at|about|of|aus|von|vom|über|und|and|then|dann)\b/iu)[0], 'item') : [];
        if (itemMatches.length === 1 && !['physical', 'travel'].includes(action.kind))
            errors.push({ reason: 'player_action_kind_mismatch', detail: `actions.${index}.kind`,
                expected: 'physical', request });
        if (itemMatches.length === 1 && ['resolved', 'answered'].includes(action.status)
            && !(normalizedEffects(action.effects).item_transfer || []).some(effect =>
                effect.item_id === itemMatches[0].id && effect.to_id === 'player')
            && !(action.response || []).some(paragraph => (paragraph.events || []).some(event =>
                event.type === 'inventory' && event.actor_id === 'player'
                && event.status === 'completed')))
            errors.push({ reason: 'missing_player_pickup_proof', detail: `actions.${index}.effects.item_transfer`,
                item_id: itemMatches[0].id, request });
        const destinationPhrase = act.travel
            ? act.body.match(/\b(?:to|into|through|in|nach|zu|zum|zur|durch|in\s+den|in\s+die)\s+(.+)$/iu)?.[1] || '' : '';
        const namedPlaces = act.travel
            ? mentions(destinationPhrase || act.body, 'location') : [];
        const otherPlaces = namedPlaces.filter(place => place.id !== context.playerLocation);
        const destinations = otherPlaces.length ? otherPlaces : namedPlaces;
        if (destinations.length === 1 && action.kind !== 'travel')
            errors.push({ reason: 'player_action_kind_mismatch', detail: `actions.${index}.kind`,
                expected: 'travel', request });
        if (destinations.length === 1 && ['resolved', 'answered'].includes(action.status)
            && destinations[0].id !== context.playerLocation
            && !(normalizedEffects(action.effects).actor_move || []).some(effect =>
                effect.actor_id === 'player' && effect.to_location_id === destinations[0].id))
            errors.push({ reason: 'missing_player_movement_proof', detail: `actions.${index}.effects.actor_move`,
                to_location_id: destinations[0].id, request });
        for (const rule of context.universalCheckRules || []) {
            const phrase = norm(rule?.match?.requestIncludes);
            if (!phrase || !norm(request).includes(phrase) || !rule.match?.kind) continue;
            const firstVerb = norm(act.body).split(/\s+/u)[0];
            if (!phrase.startsWith(firstVerb) || action.kind === rule.match.kind) continue;
            errors.push({ reason: 'universal_check_kind_mismatch', detail: `actions.${index}.kind`,
                rule_id: rule.id, expected: rule.match.kind, request });
        }
    });
    return errors;
}
// Split a model action only when independent typed evidence and a unique
// source anchor identify both sides. Event and speech objects are moved, not
// copied; mechanical effects remain with their non-speech witnesses.
function splitWitnessedSpeech(proposal, input, spans, repairs) {
    for (let index = 0; index < proposal.actions.length; index++) {
        const action = proposal.actions[index];
        const paragraph = action?.response?.length === 1 ? action.response[0] : null;
        if (!paragraph || !['resolved', 'answered'].includes(action.status)
            || paragraph.commitments?.length || paragraph.resolutions?.length
            || action.authorization_quote || action.state_conditions?.length
            || proposal.actions.length >= 32) continue;
        const speeches = (paragraph.speech || []).filter(item => item?.speaker === 'player'
            && String(item.quote || '').trim());
        const events = paragraph.events || [];
        if (speeches.length !== 1 || speeches.length !== (paragraph.speech || []).length
            || events.some(item => item.type !== 'dialogue' && item.actor_id !== 'player')) continue;
        const quote = speeches[0].quote;
        const source = input.slice(spans[index].start, spans[index].end);
        const sourceAt = source.indexOf(quote);
        const textAt = paragraph.text.indexOf(quote);
        if (sourceAt < 0 || source.indexOf(quote, sourceAt + 1) >= 0
            || textAt < 0 || paragraph.text.indexOf(quote, textAt + 1) >= 0) continue;
        let speechEnd = spans[index].end;
        let nextStart = spans[index + 1]?.start;
        const remainder = source.slice(sourceAt + quote.length);
        if (!/^[\s\p{P}\p{S}]*$/u.test(remainder)) {
            const trailingWords = [...remainder.matchAll(/[\p{L}\p{N}]+/gu)];
            const nextWords = String(proposal.actions[index + 1]?.request || '')
                .match(/[\p{L}\p{N}]+/gu) || [];
            if (!trailingWords.length || trailingWords.length > nextWords.length
                || trailingWords.some((match, at) => match[0].normalize('NFKC')
                    .toLocaleLowerCase() !== nextWords[at].normalize('NFKC')
                        .toLocaleLowerCase())
                || !/^[\s\p{P}\p{S}]*$/u.test(remainder.slice(0, trailingWords[0].index))
                || !/^[\s\p{P}\p{S}]*$/u.test(remainder.slice(trailingWords.at(-1).index
                    + trailingWords.at(-1)[0].length))) continue;
            speechEnd = spans[index].start + sourceAt + quote.length
                + trailingWords[0].index;
            nextStart = speechEnd;
        }
        if (!/^[\s\p{P}\p{S}]*$/u.test(paragraph.text.slice(textAt + quote.length)))
            continue;
        const sourceWords = [...source.matchAll(/[\p{L}\p{N}]+/gu)];
        const candidates = events.filter(item => item.actor_id === 'player'
            && item.status === 'completed' && ['dialogue', 'interaction'].includes(item.type))
            .flatMap(item => {
                const label = String(item.action || item.activity || item.label || '')
                    .match(/[\p{L}\p{N}]+/u)?.[0];
                if (!label) return [];
                const anchors = sourceWords.filter(match => match[0].normalize('NFKC')
                    .toLocaleLowerCase() === label.normalize('NFKC').toLocaleLowerCase()
                    && match.index < sourceAt
                    && /^[\s\p{P}\p{S}]*$/u.test(source.slice(match.index + match[0].length,
                        sourceAt)));
                return anchors.length === 1 ? [{ item, anchor: anchors[0] }] : [];
            });
        if (candidates.length !== 1) continue;
        const speechEvent = candidates[0].item;
        const physical = events.filter(item => item?.actor_id === 'player'
            && item.status === 'completed' && item !== speechEvent
            && item.type !== 'dialogue');
        if (!physical.length || !source.slice(0, candidates[0].anchor.index).trim()) continue;
        if (events.some(item => item.type === 'dialogue' && item.actor_id === 'player'
            && item !== speechEvent)) continue;
        const boundary = spans[index].start + candidates[0].anchor.index;
        const opening = textAt > 0 && /["“„«'‘]/u.test(paragraph.text[textAt - 1])
            ? textAt - 1 : textAt;
        const physicalText = paragraph.text.slice(0, opening).trim();
        const speechText = paragraph.text.slice(opening).trim();
        if (!physicalText || !speechText || !speechText.includes(quote)) continue;
        const dependent = proposal.actions.slice(index + 1).flatMap(entry =>
            entry.depends_on || []).filter(item => item.action_index === index);
        if (dependent.some(item => item.outcome !== 'succeeded')) continue;
        const physicalParagraph = { ...paragraph, text: physicalText,
            events: events.filter(item => item !== speechEvent && item.type !== 'dialogue') };
        delete physicalParagraph.speech;
        const speechParagraph = { text: speechText,
            events: events.filter(item => item === speechEvent || item.type === 'dialogue')
                .map(item => item === speechEvent && item.type === 'interaction'
                    ? { ...item, type: 'dialogue' } : item),
            speech: paragraph.speech.filter(item => item.speaker === 'player') };
        const speechAction = { request: input.slice(boundary, speechEnd),
            kind: 'speech', status: action.status, effects: [],
            response: [speechParagraph],
            ...(action.depends_on?.length ? { depends_on: clone(action.depends_on) } : {}) };
        action.request = input.slice(spans[index].start, boundary);
        action.response = [physicalParagraph];
        if (action.kind === 'speech' || action.kind === 'question') action.kind = 'physical';
        proposal.actions.splice(index + 1, 0, speechAction);
        const oldEnd = speechEnd;
        spans[index].end = boundary;
        spans.splice(index + 1, 0, { start: boundary, end: oldEnd });
        if (nextStart !== undefined && spans[index + 2]) spans[index + 2].start = nextStart;
        for (const [at, entry] of proposal.actions.entries()) {
            if (at <= index + 1 || !entry.depends_on) continue;
            entry.depends_on = entry.depends_on.flatMap(dependency => {
                if (dependency.action_index > index) return [{ ...dependency,
                    action_index: dependency.action_index + 1 }];
                if (dependency.action_index === index) return [dependency,
                    { ...dependency, action_index: index + 1 }];
                return [dependency];
            });
        }
        for (const reaction of proposal.reactions || []) if (reaction.after_action_index !== undefined
            && reaction.after_action_index >= index) reaction.after_action_index++;
        repairs.push({ type: 'split_witnessed_speech_action', detail: `actions.${index}` });
        index++;
    }
}
function bind(proposal, context, canonical) {
    proposal = clone(proposal);
    const repairs = [];
    const speechEvidenceErrors = [];
    if (!context || !/^[a-z][a-z0-9_]{1,47}$/.test(context.turnId || '')
        || typeof context.input !== 'string') throw new TypeError('invalid_turn_binding_context');
    // The host owns links and knows the IDs behind current World names. Repair
    // only unambiguous structure and projections of an explicit typed effect;
    // the schema and reducer still decide whether an action can commit.
    const references = Array.isArray(context.references) ? context.references.filter(item =>
        object(item) && typeof item.id === 'string' && typeof item.name === 'string') : [];
    const key = value => String(value).normalize('NFKC').trim().toLocaleLowerCase();
    const knownIds = new Set(['player', ...references.map(item => item.id)]);
    const resolve = (value, path) => {
        if (typeof value !== 'string' || knownIds.has(value)) return value;
        if (context.playerName && key(value) === key(context.playerName)
            && !references.some(item => key(item.name) === key(value))) {
            repairs.push({ type: 'player_persona_reference', detail: path,
                from: value, to: 'player' });
            return 'player';
        }
        const matches = [...new Set(references.filter(item => key(item.name) === key(value))
            .map(item => item.id))];
        if (matches.length !== 1) return value;
        repairs.push({ type: 'known_reference_id', detail: path, from: value, to: matches[0] });
        return matches[0];
    };
    const normalizeParagraph = (paragraph, path) => {
        if (!object(paragraph)) return;
        for (const field of ['action_id', 'passage_id', 'response_id'])
            if (Object.hasOwn(paragraph, field)) {
                delete paragraph[field];
                repairs.push({ type: 'discard_engine_link', detail: `${path}.${field}` });
            }
        for (const [index, event] of (Array.isArray(paragraph.events) ? paragraph.events : []).entries()) {
            if (!object(event)) continue;
            // Some transports put the concrete activity in the generic event
            // label. This is an unambiguous field normalization, not evidence
            // for a state change or a different event type.
            if (event.type === 'activity' && !String(event.activity || '').trim()
                && typeof event.label === 'string' && event.label.trim()) {
                event.activity = event.label.trim();
                repairs.push({ type: 'normalize_activity_label',
                    detail: `${path}.events.${index}.activity` });
            }
            for (const field of ['action_id', 'passage_id', 'response_id'])
                if (Object.hasOwn(event, field)) {
                    delete event[field];
                    repairs.push({ type: 'discard_engine_link', detail: `${path}.events.${index}.${field}` });
                }
            for (const field of ['actor_id', 'target_id'])
                if (Object.hasOwn(event, field)) event[field] = resolve(event[field],
                    `${path}.events.${index}.${field}`);
        }
        if (Array.isArray(paragraph.speech) && typeof paragraph.text === 'string'
            && ![...paragraph.text.matchAll(/[“"„«]([^”"»]{2,500})[”"»]|‘([^’]{2,500})’|(?<![\p{L}\p{N}])'((?:[^']|'(?=[\p{L}\p{N}])){2,500})'(?![\p{L}\p{N}])/gu)].length) {
            const before = paragraph.speech.length;
            paragraph.speech = paragraph.speech.filter(item =>
                String(item?.quote || '').trim()
                    ? paragraph.text.includes(item.quote)
                        || item.speaker === 'player' && context.input.includes(item.quote)
                    : item?.speaker !== 'self');
            if (paragraph.speech.length !== before) repairs.push({
                type: 'discard_unspoken_quote', detail: `${path}.speech` });
        }
        for (const [index, speech] of (Array.isArray(paragraph.speech) ? paragraph.speech : []).entries()) {
            if (!object(speech)) continue;
            for (const field of ['action_id', 'passage_id', 'response_id'])
                if (Object.hasOwn(speech, field)) {
                    delete speech[field];
                    repairs.push({ type: 'discard_engine_link', detail: `${path}.speech.${index}.${field}` });
                }
            if (Object.hasOwn(speech, 'speaker')) speech.speaker = resolve(speech.speaker,
                `${path}.speech.${index}.speaker`);
            if (Array.isArray(speech.listeners)) speech.listeners = speech.listeners.map((listener, i) =>
                resolve(listener, `${path}.speech.${index}.listeners.${i}`));
            if (typeof paragraph.text === 'string') {
                const quotes = [...paragraph.text.matchAll(/["“„«]([^"”»]{1,1200})["”»]|‘([^’]{1,1200})’|(?<![\p{L}\p{N}])'((?:[^']|'(?=[\p{L}\p{N}])){1,1200})'(?![\p{L}\p{N}])/gu)];
                if (quotes.length === 1 && paragraph.speech.length === 1) {
                    const spoken = quotes[0][1] || quotes[0][2] || quotes[0][3];
                    if (!speech.quote) {
                        speech.quote = spoken;
                        repairs.push({ type: 'extract_spoken_quote', detail: `${path}.speech.${index}` });
                    } else if (!paragraph.text.includes(speech.quote)
                        && speech.quote.replace(/[.,!?;:]+$/u, '').trim() === spoken
                            .replace(/[.,!?;:]+$/u, '').trim()) {
                        speech.quote = spoken;
                        repairs.push({ type: 'align_quote_terminal_punctuation',
                            detail: `${path}.speech.${index}` });
                    }
                }
            }
            if (!String(speech.quote || '').trim()) speechEvidenceErrors.push({
                reason: 'missing_speech_quote', detail: `${path}.speech.${index}.quote` });
        }
        // A provider may join two separately quoted stretches from the same
        // speaker into one quote. Split only when the exact word sequence has
        // one unclaimed, ordered match in the passage. The compiler still
        // verifies each resulting quote against its own passage.
        if (Array.isArray(paragraph.speech) && typeof paragraph.text === 'string') {
            const spans = [...paragraph.text.matchAll(/["“„«]([^"“”»]{1,1200})["“”»]/gu)]
                .map(match => match[1]);
            const words = value => (String(value || '').normalize('NFKC')
                .toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || []).join(' ');
            const replacements = [];
            paragraph.speech.forEach((speech, index) => {
                if (spans.length > 16 || !object(speech) || !String(speech.quote || '').trim()
                    || paragraph.text.includes(speech.quote)) return;
                const occupied = new Set(spans.flatMap((span, spanIndex) =>
                    paragraph.speech.some((other, otherIndex) => otherIndex !== index
                        && other?.quote === span) ? [spanIndex] : []));
                const matches = [];
                for (let start = 0; start < spans.length; start++) {
                    if (occupied.has(start)) continue;
                    for (let end = start + 2; end <= spans.length; end++) {
                        if (Array.from({ length: end - start }, (_, offset) =>
                            start + offset).some(spanIndex => occupied.has(spanIndex))) break;
                        if (words(spans.slice(start, end).join(' ')) === words(speech.quote))
                            matches.push(spans.slice(start, end));
                    }
                }
                if (matches.length === 1) replacements.push({ index, quotes: matches[0], speech });
            });
            for (const item of replacements.reverse()) {
                paragraph.speech.splice(item.index, 1, ...item.quotes.map(quote => ({
                    ...item.speech, quote })));
                repairs.push({ type: 'split_joined_speech_quote', detail: `${path}.speech.${item.index}` });
            }
        }
        if (!paragraph.speech?.length && typeof paragraph.text === 'string') {
            const npcNames = references.filter(item => item.type === 'npc'
                && new RegExp(`\\b${item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'iu')
                    .test(paragraph.text));
            const quoted = [...paragraph.text.matchAll(/[“"„«]([^”"»]{2,500})[”"»]|‘([^’]{2,500})’|(?<![\p{L}\p{N}])'((?:[^']|'(?=[\p{L}\p{N}])){2,500})'(?![\p{L}\p{N}])/gu)];
            const attribution = /\b(?:she|he|they|sie|er)\s+(?:says?|asks?|replies|whispers?|sagt|fragt|antwortet)\b/iu;
            if (quoted.some(match => {
                const before = paragraph.text.slice(Math.max(0, match.index - 80), match.index);
                const after = paragraph.text.slice(match.index + match[0].length,
                    match.index + match[0].length + 80);
                return npcNames.length === 1 && attribution.test(after)
                    || npcNames.some(npc => {
                        const name = npc.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        return new RegExp(`\\b${name}\\s+(?:says?|asks?|replies|whispers?|sagt|fragt|antwortet)\\s*$`, 'iu').test(before)
                            || new RegExp(`^\\s*,?\\s*${name}\\s+(?:says?|asks?|replies|whispers?|sagt|fragt|antwortet)\\b`, 'iu').test(after);
                    });
            }))
                speechEvidenceErrors.push({ reason: 'missing_speech_attribution', detail: `${path}.speech` });
        }
    };
    const referenceFields = new Set(['actor_id', 'target_id', 'from_id', 'to_id',
        'item_id', 'recipient_id', 'subject_id', 'source_id', 'location_id',
        'from_location_id', 'to_location_id']);
    const normalizeEffectRefs = (value, path) => {
        if (Array.isArray(value)) {
            value.forEach((item, index) => normalizeEffectRefs(item, `${path}.${index}`));
        } else if (object(value)) for (const [field, item] of Object.entries(value)) {
            if (referenceFields.has(field)) value[field] = resolve(item, `${path}.${field}`);
            else if (field === 'companion_ids' && Array.isArray(item))
                value[field] = item.map((id, index) => resolve(id, `${path}.${field}.${index}`));
            else normalizeEffectRefs(item, `${path}.${field}`);
        }
    };
    for (const [index, action] of (Array.isArray(proposal?.actions) ? proposal.actions : []).entries()) {
        if (!object(action)) continue;
        for (const field of ['action_id', 'passage_id', 'response_id'])
            if (Object.hasOwn(action, field)) {
                delete action[field];
                repairs.push({ type: 'discard_engine_link', detail: `actions.${index}.${field}` });
            }
        if (typeof action.response === 'string' && action.response.trim()) {
            action.response = [{ text: action.response }];
            repairs.push({ type: 'wrap_response_text', detail: `actions.${index}.response` });
        } else if (object(action.response) && typeof action.response.text === 'string') {
            action.response = [action.response];
            repairs.push({ type: 'wrap_response_paragraph', detail: `actions.${index}.response` });
        }
        if (Array.isArray(action.response)) action.response = action.response.map((paragraph, i) => {
            if (typeof paragraph === 'string' && paragraph.trim()) {
                repairs.push({ type: 'wrap_response_text', detail: `actions.${index}.response.${i}` });
                return { text: paragraph };
            }
            return paragraph;
        });
        // One response paragraph has a unique owner for action-level speech.
        // Move the model's evidence to that paragraph; the canonical schema
        // and World compiler still validate every speaker and listener.
        if (Array.isArray(action.speech) && action.response?.length === 1
            && object(action.response[0]) && action.response[0].speech === undefined) {
            action.response[0].speech = action.speech;
            delete action.speech;
            repairs.push({ type: 'nest_action_speech', detail: `actions.${index}.response.0.speech` });
        }
        (Array.isArray(action.response) ? action.response : []).forEach((paragraph, i) =>
            normalizeParagraph(paragraph, `actions.${index}.response.${i}`));
        // A teleport requires a matching completed event with an explicit
        // cause. A bare effect label is not teleport evidence. An ordinary
        // movement witness (including one with no mode label) instead goes
        // through the normal directed-route and access checks in the reducer.
        for (const [moveIndex, move] of (Array.isArray(action.effects?.actor_move)
            ? action.effects.actor_move : []).entries()) {
            if (move?.actor_id !== 'player' || move.mode !== 'teleport') continue;
            const events = (action.response || []).flatMap(paragraph => paragraph?.events || []);
            if (events.some(event => event?.type === 'movement'
                && event.actor_id === 'player' && event.status === 'completed'
                && (event.movement_mode === 'voluntary'
                    || event.movement_mode === undefined)
                && event.to_location_id === move.to_location_id
                && !!event.from_location_id
                && !String(event.cause || '').trim())) {
                delete move.mode;
                repairs.push({ type: 'ordinary_move_mode',
                    detail: `actions.${index}.effects.actor_move.${moveIndex}.mode` });
            }
        }
        if (action.kind === 'physical'
            && !Object.values(normalizedEffects(action.effects)).some(value =>
                !Array.isArray(value) || value.length)) {
            const paragraphs = Array.isArray(action.response) ? action.response : [];
            const spoken = paragraphs.flatMap(paragraph => paragraph?.speech || [])
                .filter(item => item?.speaker === 'player' && String(item.quote || '').trim()
                    && context.input.includes(item.quote));
            const completed = paragraphs.flatMap(paragraph => paragraph?.events || [])
                .filter(item => item?.actor_id === 'player' && item?.status === 'completed');
            if (spoken.length && completed.length && completed.every(item =>
                item.type === 'interaction' && !String(item.action || '').trim()
                    && !item.item_id && !item.item)) {
                for (const event of completed) event.type = 'dialogue';
                action.kind = 'speech';
                repairs.push({ type: 'classify_untyped_spoken_interaction',
                    detail: `actions.${index}` });
            }
        }
        if (Array.isArray(action.state_conditions)
            && !Object.values(normalizedEffects(action.effects)).some(value =>
                !Array.isArray(value) || value.length)) {
            const before = action.state_conditions.length;
            action.state_conditions = action.state_conditions.filter(condition => {
                const subject = references.find(ref => ref.id === condition?.subject_id);
                const value = references.find(ref => ref.id === condition?.value);
                return !(condition?.fact === 'interactable_state'
                    && (condition.subject_id === 'player'
                        || subject && subject.type !== 'item'))
                    && !(condition?.fact === 'has_item'
                        && (condition.value === 'player'
                            || value && value.type !== 'item'));
            });
            if (action.state_conditions.length !== before) repairs.push({
                type: 'discard_impossible_fact_reference',
                detail: `actions.${index}.state_conditions` });
            if (before && !action.state_conditions.length) delete action.state_conditions;
        }
        if (['speech', 'question', 'other'].includes(action.kind)
            && !/["„“«]/u.test(action.request || '')) {
            const completed = (action.response || []).flatMap(paragraph => paragraph?.events || [])
                .filter(event => event?.actor_id === 'player' && event?.status === 'completed');
            const bodilyActivity = completed.some(event => event.type === 'activity'
                && !/^(?:speak|speaking|talk|talking|say|saying)$/iu.test(event.activity || ''));
            const gesture = completed.some(event => event.type === 'interaction'
                && /^(?:wave|waving|nod|nodding|smile|smiling|bow|bowing)$/iu
                    .test(event.action || ''));
            if (bodilyActivity || gesture) {
                action.kind = bodilyActivity ? 'physical' : 'gesture';
                repairs.push({ type: 'classify_completed_bodily_action',
                    detail: `actions.${index}.kind` });
            }
        }
        if (action.status === undefined && Array.isArray(action.response)) {
            const completedProof = action.response.some(paragraph =>
                (paragraph?.events || []).some(event => event?.status === 'completed'
                    && event?.actor_id === 'player'));
            const proposedEffects = normalizedEffects(action.effects);
            const hasEffects = Object.values(proposedEffects).some(value =>
                Array.isArray(value) && value.length || !Array.isArray(value) && !!value);
            if (completedProof || hasEffects || ['speech', 'question', 'observation', 'other']
                .includes(action.kind) && action.response.some(paragraph =>
                    typeof paragraph?.text === 'string' && paragraph.text.trim())) {
                action.status = action.kind === 'question' ? 'answered' : 'resolved';
                repairs.push({ type: 'derive_status_from_typed_evidence',
                    detail: `actions.${index}.status` });
            }
        }
        normalizeEffectRefs(action.effects, `actions.${index}.effects`);
        normalizeEffectRefs(action.state_conditions, `actions.${index}.state_conditions`);
        if (Array.isArray(action.state_conditions)) action.state_conditions = action.state_conditions
            .map((condition, conditionIndex) => {
                const item = references.find(reference => reference.type === 'item'
                    && reference.id === condition?.subject_id);
                const owner = condition?.target_id;
                if (!item || references.filter(reference => reference.type === 'item'
                    && key(reference.name) === key(item.name)).length !== 1
                    || condition.fact !== 'actor_at' || condition.operator !== 'equals'
                    || condition.value !== undefined
                    || !(owner === 'player' || references.some(reference =>
                        reference.type === 'npc' && reference.id === owner))) return condition;
                repairs.push({ type: 'item_ownership_fact',
                    detail: `actions.${index}.state_conditions.${conditionIndex}` });
                return { fact: 'has_item', subject_id: owner, operator: 'equals', value: item.name };
            });
        if (Array.isArray(action.state_conditions) && Array.isArray(action.effects?.item_transfer)) {
            // A transfer's new owner is an outcome, never a fact required
            // before that same transfer. The reducer still proves source
            // ownership and reachability; remove only this exact postcondition.
            action.state_conditions = action.state_conditions.filter((condition, conditionIndex) => {
                if (condition?.fact !== 'has_item' || condition.operator !== 'equals') return true;
                const value = String(condition.value || '');
                const matchingId = action.effects.item_transfer.find(transfer =>
                    transfer?.to_id === condition.subject_id && transfer?.item_id
                    && (transfer.item_id === value || references.filter(item =>
                        key(item.name) === key(value)).length === 1
                        && references.some(item => item.id === transfer.item_id
                            && key(item.name) === key(value))));
                if (!matchingId) return true;
                repairs.push({ type: 'discard_effect_postcondition',
                    detail: `actions.${index}.state_conditions.${conditionIndex}` });
                return false;
            });
            if (!action.state_conditions.length) delete action.state_conditions;
        }
        if (action.kind === 'physical' && action.status === 'resolved'
            && Array.isArray(action.response) && Array.isArray(action.effects?.item_transfer)
            && !action.response.some(paragraph => Array.isArray(paragraph?.events)
                && paragraph.events.some(event => event?.type === 'inventory'))) {
            for (const [transferIndex, transfer] of action.effects.item_transfer.entries()) {
                if (!object(transfer) || transfer.to_id !== 'player' && transfer.from_id !== 'player') continue;
                const item = references.find(reference => reference.type === 'item'
                    && reference.id === transfer.item_id);
                if (!item || references.filter(reference => key(reference.name) === key(item.name)).length !== 1)
                    continue;
                const mentioning = action.response.filter(paragraph => object(paragraph)
                    && typeof paragraph.text === 'string' && key(paragraph.text).includes(key(item.name)));
                if (mentioning.length !== 1) continue;
                const paragraph = mentioning[0];
                if (paragraph.events !== undefined && !Array.isArray(paragraph.events)) continue;
                paragraph.events ||= [];
                paragraph.events.push({ type: 'inventory', actor_id: 'player', status: 'completed',
                    action: transfer.to_id === 'player' ? 'add' : 'remove', item: item.name });
                repairs.push({ type: 'project_inventory_event',
                    detail: `actions.${index}.effects.item_transfer.${transferIndex}` });
            }
        }
    }
    (Array.isArray(proposal?.reactions) ? proposal.reactions : []).forEach((reaction, i) => {
        normalizeParagraph(reaction, `reactions.${i}`);
        normalizeEffectRefs(reaction?.effects, `reactions.${i}.effects`);
    });
    if (Array.isArray(proposal?.actions) && proposal.actions.length > 1) {
        const [first, ...tail] = proposal.actions;
        const emptyAction = action => object(action)
            && Object.keys(action).every(field => ['kind', 'status', 'request', 'depends_on',
                'state_conditions', 'effects', 'response'].includes(field))
            && !String(action.request || '').trim()
            && (!Object.hasOwn(action, 'depends_on')
                || Array.isArray(action.depends_on) && !action.depends_on.length)
            && (!Object.hasOwn(action, 'state_conditions')
                || Array.isArray(action.state_conditions) && !action.state_conditions.length)
            && (!action.effects || Array.isArray(action.effects) && !action.effects.length
                || object(action.effects) && !Object.keys(action.effects).length)
            && Array.isArray(action.response) && action.response.length === 1
            && object(action.response[0])
            && Object.keys(action.response[0]).every(field => field === 'text')
            && /^[\s\p{P}\p{S}]{1,3}$/u.test(action.response[0].text);
        if (object(first) && Array.isArray(first.response)
            && first.response.some(paragraph => /[\p{L}\p{N}]/u.test(String(paragraph?.text || '')))
            && (!String(first.request || '').trim()
            || String(first.request).trim() === context.input.trim())
            && tail.every(emptyAction)) {
            proposal.actions = [first];
            repairs.push({ type: 'discard_empty_action_placeholders',
                detail: `${tail.length} punctuation-only actions` });
        }
    }
    if (context.singleRequest === true && Array.isArray(proposal?.actions)
        && proposal.actions.length > 1) {
        const [first, ...tail] = proposal.actions;
        const continuation = action => object(action)
            && Object.keys(action).every(field => ['kind', 'status', 'request', 'depends_on',
                'state_conditions', 'effects', 'response'].includes(field))
            && !String(action.request || '').trim()
            && ['resolved', 'answered'].includes(action.status)
            && (!action.effects || Array.isArray(action.effects) && !action.effects.length
                || object(action.effects) && !Object.keys(action.effects).length)
            && (!Object.hasOwn(action, 'depends_on')
                || Array.isArray(action.depends_on) && !action.depends_on.length)
            && (!Object.hasOwn(action, 'state_conditions')
                || Array.isArray(action.state_conditions) && !action.state_conditions.length)
            && Array.isArray(action.response)
            && action.response.length && action.response.every(paragraph => object(paragraph)
                && typeof paragraph.text === 'string' && paragraph.text.trim()
                && !paragraph.events?.length && !paragraph.commitments?.length
                && !paragraph.resolutions?.length);
        if (object(first) && ['resolved', 'answered', 'attempted'].includes(first.status)
            && (!String(first.request || '').trim()
                || String(first.request).trim() === context.input.trim())
            && Array.isArray(first.response) && tail.every(continuation)
            && first.response.length + tail.reduce((count, action) => count + action.response.length, 0) <= 16) {
            first.response.push(...tail.flatMap(action => action.response));
            proposal.actions = [first];
            repairs.push({ type: 'merge_single_request_continuation',
                detail: `${tail.length} effect-free response actions` });
        }
    }
    // A new clock obligation needs some time cue in the player request or its
    // linked response. Drop only optional entries when both lack one; existing
    // commitments may still be cancelled without repeating their due time.
    const deadlineCue = /[\p{N}]|\b(?:today|tomorrow|tonight|noon|midnight|morning|afternoon|evening|night|dawn|dusk|hour|hours|minute|minutes|o'clock|day|days|week|weeks|month|months|year|years|heute|morgen|mittag|mitternacht|abend|nacht|stunde|stunden|minute|minuten|tag|tage|woche|wochen|monat|monate|jahr|jahre|uhr)\b/iu;
    if (!deadlineCue.test(context.input)) for (const [group, entries] of [['actions', proposal?.actions],
        ['reactions', proposal?.reactions]]) {
        if (!Array.isArray(entries)) continue;
        entries.forEach((entry, entryIndex) => {
            const paragraphs = group === 'reactions' ? [entry]
                : Array.isArray(entry?.response) ? entry.response : [];
            paragraphs.forEach((paragraph, paragraphIndex) => {
                if (!Array.isArray(paragraph?.commitments)) return;
                const kept = paragraph.commitments.filter((item, itemIndex) => {
                    if (item?.existing_id || deadlineCue.test(String(paragraph.text || ''))) return true;
                    repairs.push({ type: 'discard_unsupported_new_commitment',
                        detail: `${group}.${entryIndex}.response.${paragraphIndex}.commitments.${itemIndex}` });
                    return false;
                });
                if (kept.length) paragraph.commitments = kept;
                else delete paragraph.commitments;
            });
        });
    }
    const effectTypes = canonical.properties.actions.items.properties.action_effects.properties;
    for (const [group, entries] of [['actions', proposal?.actions], ['reactions', proposal?.reactions]]) {
        if (!Array.isArray(entries)) continue;
        entries.forEach((entry, index) => {
            if (!object(entry?.effects)) return;
            for (const [key, value] of Object.entries(entry.effects)) {
                if (!Object.hasOwn(effectTypes, key) && (value === null
                    || Array.isArray(value) && !value.length || object(value) && !Object.keys(value).length)) {
                    delete entry.effects[key];
                    repairs.push({ type: 'discard_empty_optional_effect', detail: `${group}.${index}.effects.${key}` });
                }
            }
        });
    }
    const errors = validate(proposal, schema(canonical, context));
    errors.push(...speechEvidenceErrors);
    // A single unquoted speech request can be answered by an NPC while the
    // player's own utterance is silently omitted. Do not commit that as a
    // completed speech action: the response must bind actual player words.
    const spokenWords = value => (String(value || '').normalize('NFKC')
        .toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || []).join(' ');
    if (proposal.actions?.length === 1 && proposal.actions[0]?.kind === 'speech'
        && ['resolved', 'answered'].includes(proposal.actions[0].status)
        && directPlayerAct(context.input)
        && /[,;.!?]\s+\S/u.test(context.input)
        && !/["“„«][^"“”»]+["“”»]/u.test(context.input)
        && spokenWords((proposal.actions[0].response || []).flatMap(paragraph =>
            (paragraph?.speech || []).filter(item => item.speaker === 'player')
                .map(item => item.quote)).join(' ')) !== spokenWords(context.input))
        errors.push({ reason: 'missing_player_speech_evidence',
            detail: 'actions.0.response.speech', request: context.input });
    if (errors.some(error => error.reason !== 'missing_player_speech_evidence'))
        return { ok: false, errors };
    if (proposal.actions.length === 1 && !context.singleRequest
        && !(['speech', 'question'].includes(proposal.actions[0].kind)
            && proposal.actions[0].response?.some(paragraph => paragraph?.speech?.some(item =>
                item.speaker === 'player' && String(item.quote || '').trim()
                    && context.input.includes(item.quote))))
        && /[,;.!?]\s+\S/u.test(context.input)
        && /^(?:i|ich|you|du)\b/iu.test(context.input.trim())
        && !/["“„«][^"”»]+["”»]/u.test(context.input)
        && !(proposal.actions[0].response || []).some(paragraph =>
            paragraph?.speech?.length || paragraph?.events?.some(event =>
                event?.actor_id === 'player' && event.status === 'completed'))
        && !Object.values(normalizedEffects(proposal.actions[0].effects)).some(value =>
            !Array.isArray(value) || value.length))
        errors.push({ reason: 'request_coverage_mismatch',
            detail: 'one action cannot certify multiple unproved input clauses' });
    if (errors.length) return { ok: false, errors };
    // Keep separately anchored model actions as separate graph nodes. Their
    // request spans are still checked against the complete player input below.
    const requestAnchors = proposal.actions.map(action => String(action.request || '').trim());
    // Inspect each original clause before the conversational normalizer can
    // collapse several model-labelled speech actions into one.
    const originalSpans = proposal.actions.length > 1
        ? alignRequests(context.input, proposal.actions) : null;
    // Reuse the canonical-reference intent guard for an attempted mapped
    // place change. The model's physical/travel label is interpretation, not
    // authority over whether the engine checks movement.
    if (originalSpans) {
        for (const error of playerIntentErrors(context.input, proposal.actions,
            originalSpans, context)) {
            const index = /^actions\.(\d+)\.kind$/.exec(error.detail || '')?.[1];
            if (error.expected !== 'travel' || index === undefined
                || proposal.actions[Number(index)]?.kind === 'travel'
                || /["“”„]/u.test(context.input.slice(originalSpans[Number(index)].start,
                    originalSpans[Number(index)].end))) continue;
            proposal.actions[Number(index)].kind = 'travel';
            repairs.push({ type: 'classify_canonical_travel', detail: error.detail });
        }
    }
    if (originalSpans && context.prepareCertainEffects !== true) errors.push(...playerIntentErrors(context.input,
        proposal.actions, originalSpans, context));
    if (errors.length) return { ok: false, errors };
    const requestSpans = proposal.actions.length === 1
        ? [{ start: 0, end: context.input.length }]
        : proposal.actions.length ? alignRequests(context.input, proposal.actions) : [];
    if (!requestSpans) {
        const repeatedWholeInput = proposal.actions.length > 1
            && requestAnchors.every(anchor => anchor === context.input.trim());
        errors.push({ reason: 'request_coverage_mismatch',
            detail: repeatedWholeInput
                ? `actions: ${proposal.actions.length} copies of the full player request with ${new Set(
                    proposal.actions.map(action => JSON.stringify(action.response))).size} distinct responses`
                : 'actions' });
    }
    if (errors.length) return { ok: false, errors };
    // A model can attach dialogue to a physical action and then omit the
    // spoken words. Preserve exact source quotations independently of kind;
    // they are evidence of player speech, never proof of physical success.
    const playerName = String(context.playerName || '').trim();
    const playerNarration = /^(?:i|ich|you|du)\b/iu.test(context.input.trim())
        || !!playerName && context.input.trim().toLocaleLowerCase()
            .startsWith(playerName.toLocaleLowerCase());
    proposal.actions.forEach((action, index) => {
        if (!Array.isArray(action.response) || !action.response.length) return;
        const source = context.input.slice(requestSpans[index].start, requestSpans[index].end).trim();
        const quotations = playerNarration || /^["„“«]/u.test(context.input.trim())
            ? [...source.matchAll(/["„“«]([^"“”»]{1,1200})["“”»]/gu)]
            .filter(match => !(context.references || []).some(ref => ref.type === 'npc'
                && [ref.name, ...(ref.aliases || [])].some(name => {
                    if (!name) return false;
                    const before = source.slice(Math.max(0, match.index - 100), match.index)
                        .toLocaleLowerCase();
                    const after = source.slice(match.index + match[0].length,
                        match.index + match[0].length + 100).toLocaleLowerCase();
                    const actor = String(name).toLocaleLowerCase();
                    const beforeCue = before.match(/(?:says?|said|asks?|asked|sagt?|sagte|fragt?|fragte)\s*[:,]?\s*$/iu);
                    const afterCue = after.match(/^\s*,?\s*(?:says?|said|asks?|asked|sagt?|sagte|fragt?|fragte)\s+([\p{L}\p{N} ]+)/iu);
                    return !!beforeCue && before.slice(0, beforeCue.index).trimEnd().endsWith(actor)
                        || !!afterCue && afterCue[1].trimStart().startsWith(actor);
                })))
            .map(match => match[1].trim()).filter(Boolean)
            : [];
        let spoken = quotations.length ? quotations : ['speech', 'question'].includes(action.kind)
            && index > 0 && /^(?:ich|i)\s+/iu.test(source)
            ? [source] : [];
        if (!spoken.length && proposal.actions.length === 1 && action.kind === 'speech'
            && directPlayerAct(source) && /[,;.!?]\s+\S/u.test(source)) {
            const explicit = action.response.flatMap(paragraph => (paragraph?.speech || [])
                .filter(item => item.speaker === 'player')
                .map(item => String(item.quote || '').trim())).filter(Boolean);
            if (explicit.length && spokenWords(explicit.join(' ')) === spokenWords(source))
                spoken = explicit;
        }
        if (!spoken.length) return;
        const paragraph = action.response[0];
        if (!object(paragraph) || typeof paragraph.text !== 'string') return;
        paragraph.speech = Array.isArray(paragraph.speech) ? paragraph.speech : [];
        for (const quote of spoken) {
            for (const item of paragraph.speech) if (item?.speaker === 'self'
                && item.quote === quote) {
                item.speaker = 'player';
                repairs.push({ type: 'source_bound_player_speaker',
                    detail: `actions.${index}` });
            }
            if (!paragraph.text.includes(quote)) {
                const spoken = ({ de: `Du sagst: „${quote}“`,
                    en: `You say, “${quote}”`,
                    fr: `Vous dites : « ${quote} »`,
                    es: `Dices: «${quote}»` })[context.outputLanguage] || `You say, “${quote}”`;
                paragraph.text = `${spoken}\n\n${paragraph.text}`;
            }
            if (!paragraph.speech.some(item => item?.speaker === 'player' && item.quote === quote))
                paragraph.speech.push({ speaker: 'player',
                    listeners: [...new Set(['player', ...(context.presentActorIds || [])])], quote });
        }
        repairs.push({ type: 'preserve_player_source_speech', detail: `actions.${index}` });
    });
    // A response that only revoices an independently anchored player clause
    // cannot certify that clause as completed. This catches model transports
    // that label a bodily step as speech without emitting any action witness.
    if (proposal.actions.length > 1) proposal.actions.forEach((action, index) => {
        if (!['speech', 'question', 'other'].includes(action.kind)
            || !['resolved', 'answered'].includes(action.status)
            || (action.response || []).some(paragraph => paragraph?.speech?.length
                || paragraph?.events?.some(event => event?.status === 'completed'))
            || Object.values(normalizedEffects(action.effects)).some(value =>
                !Array.isArray(value) || value.length)) return;
        const words = value => (String(value || '').normalize('NFKC')
            .toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
        const request = words(context.input.slice(requestSpans[index].start,
            requestSpans[index].end));
        const reply = words((action.response || []).map(item => item?.text || '').join(' '));
        const shared = request.filter(word => reply.includes(word)).length;
        const novel = reply.filter(word => !request.includes(word)).length;
        if (request.length && reply.length <= request.length + 2
            && shared >= Math.ceil(request.length / 2) && novel <= 1)
            errors.push({ reason: 'unverified_echoed_action',
                detail: `actions.${index}.response` });
    });
    if (errors.length) return { ok: false, errors };
    if (context.prepareCertainEffects === true && requestSpans.length === proposal.actions.length) {
        const references = Array.isArray(context.references) ? context.references : [];
        const uniqueMention = (phrase, type) => {
            const normalized = String(phrase || '').normalize('NFKC').toLocaleLowerCase();
            const matches = references.filter(item => item.type === type && item.name
                && normalized.includes(String(item.name).normalize('NFKC').toLocaleLowerCase()));
            return matches.length === 1 ? matches[0] : null;
        };
        let playerPlace = String(context.playerLocation || '');
        let priorTransition = null;
        const presentFollowers = [...new Set(Array.isArray(context.followingPlayerIds)
            ? context.followingPlayerIds : [])].filter(id =>
            typeof id === 'string' && (context.presentActorIds || []).includes(id)
            && references.some(ref => ref.type === 'npc' && ref.id === id));
        proposal.actions.forEach((action, index) => {
            if (!['resolved', 'answered'].includes(action.status)) return;
            const request = context.input.slice(requestSpans[index].start, requestSpans[index].end)
                .trim().replace(/^(?:and|then|and then|und|dann|und dann)\s+/iu, '');
            const phrase = request.replace(/^(?:I|Ich)\s+/iu, '');
            if (/\b(?:if|wenn|falls|provided|sofern)\b/iu.test(phrase)
                || /\b(?:not|nicht|never|kein|keine|keinen)\b/iu.test(phrase)) return;
            action.effects = normalizedEffects(action.effects);
            const response = Array.isArray(action.response) ? action.response[0] : null;
            if (!response) return;
            response.events = Array.isArray(response.events) ? response.events : [];
            if (action.kind === 'physical' && !(action.effects.interactable_transition || []).length) {
                const normalizedRequest = request.normalize('NFKC').toLocaleLowerCase();
                const candidates = references.filter(ref => ref.type === 'item'
                    && ref.locationId === playerPlace && ref.reachable !== false
                    && [ref.name, ...(ref.aliases || [])].some(name =>
                        name && normalizedRequest.includes(String(name).normalize('NFKC').toLocaleLowerCase())))
                    .flatMap(ref => (ref.interactable?.transitions || [])
                        .filter(transition => transition.from === ref.interactableState
                            && Array.isArray(transition.triggers)
                            && transition.triggers.some(trigger => trigger
                                && normalizedRequest.includes(String(trigger).normalize('NFKC').toLocaleLowerCase())))
                        .map(transition => ({ ref, transition })));
                if (candidates.length === 1) {
                    const { ref, transition } = candidates[0];
                    action.effects.interactable_transition = [{ target_id: ref.id,
                        to_state: transition.to, actor_id: 'player' }];
                    if (!response.events.some(event => event.type === 'environment'
                        && event.target_id === ref.id && event.status === 'completed'))
                        response.events.push({ type: 'environment', actor_id: 'player',
                            target_id: ref.id, status: 'completed', action: transition.to });
                    repairs.push({ type: 'prepare_authored_object_transition',
                        detail: `actions.${index}`, target_id: ref.id, to_state: transition.to });
                    priorTransition = { ref, index };
                }
            }
            if (priorTransition?.index === index - 1
                && ['speech', 'physical'].includes(action.kind)
                && /\b(?:darauf|on it|onto it)\b/iu.test(request)) {
                const activity = groundedLocalActivity(request, references, playerPlace,
                    priorTransition.ref);
                if (activity && !response.events.some(event => event.type === 'activity'
                    && event.actor_id === 'player' && event.status === 'completed')) {
                    response.events.push({ type: 'activity', actor_id: 'player',
                        status: 'completed', activity });
                    action.depends_on = [...(action.depends_on || []),
                        { action_index: priorTransition.index, outcome: 'succeeded' }];
                    repairs.push({ type: 'execute_supported_followup_activity',
                        detail: `actions.${index}`, activity });
                }
            }
            if (context.dynamicDiscovery?.enabled === true
                && ['physical', 'observation', 'speech', 'question', 'other'].includes(action.kind)
                && !(action.effects.item_introduce || []).length
                && !(action.effects.item_transfer || []).length) {
                const match = request.match(/\b(?:search|durchsuche|suche)\b[\s\S]{0,100}?\b(?:for|nach)\s+(?:(?:a|an|the|eine|einen|einem|ein|der|die|das)\s+)?([\p{L}\p{N}][\p{L}\p{N} -]{1,80})[.!?]?$/iu)
                    || request.match(/\b(?:look\s+for|suche\s+nach)\s+(?:(?:a|an|the|eine|einen|einem|ein|der|die|das)\s+)?([\p{L}\p{N}][\p{L}\p{N} -]{1,80})[.!?]?$/iu);
                const candidate = match?.[1]?.trim().replace(/[.!?]+$/, '')
                    .replace(/\s+(?:in|inside|im|in der|aus der)\s+.+$/iu, '').trim();
                const containers = (context.dynamicDiscovery.containers || []).filter(item =>
                    item?.id && item?.name && request.toLocaleLowerCase()
                        .includes(String(item.name).toLocaleLowerCase()));
                if (candidate && !/^(?:something|anything|etwas|irgendwas|nichts)\b/iu.test(candidate)
                    && candidate.split(/\s+/).length <= 5 && containers.length <= 1) {
                    const slug = candidate.normalize('NFKD').toLowerCase()
                        .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
                        .slice(0, 35) || 'object';
                    const id = `discovery_${String(context.turnId || 'turn').slice(-16)}_${index}_${slug}`;
                    action.kind = 'observation';
                    delete action.state_conditions;
                    action.effects.item_introduce = [{ id, name: candidate,
                        location_id: playerPlace,
                        ...(containers.length === 1 ? { container_id: containers[0].id } : {}),
                        actor_id: 'player', cause: 'discovery' }];
                    response.events = response.events.filter(event => event.type !== 'discovery'
                        && event.type !== 'inventory');
                    response.events.push({ type: 'discovery', actor_id: 'player',
                        status: 'completed', target_id: id, item: candidate });
                    response.text = /\b(?:suche|durchsuche)\b/iu.test(request)
                        ? containers.length ? 'Du durchsuchst den Behälter.' : 'Du suchst in der Umgebung.'
                        : containers.length ? 'You search the container.' : 'You search the area.';
                    action.response = [response];
                    repairs.push({ type: 'prepare_dynamic_discovery', detail: `actions.${index}` });
                }
            }
            const inventoryEvent = response.events.find(event => event.type === 'inventory'
                && event.actor_id === 'player' && event.status === 'completed'
                && ['take', 'pickup', 'add', 'gain'].includes(event.action));
            const movementEvent = response.events.find(event => event.type === 'movement'
                && event.actor_id === 'player' && event.status === 'completed');
            const pickup = action.kind === 'physical'
                && (/^(?:take|pick\s+up|grab|collect|nehme|nimm|hebe\s+auf|greife|schnappe\s+mir)\b/iu.test(phrase)
                    || !!inventoryEvent);
            const travel = ['travel', 'physical'].includes(action.kind)
                && (/^(?:walk|go|move|travel|enter|gehe|laufe|betrete|reise)\b/iu.test(phrase)
                    || !!movementEvent && !pickup);
            if (travel && action.kind === 'physical') {
                action.kind = 'travel';
                repairs.push({ type: 'classify_certain_travel', detail: `actions.${index}` });
            }
            if (pickup && !(action.effects.item_transfer || []).length) {
                const item = uniqueMention(inventoryEvent?.item || phrase, 'item')
                    || uniqueMention(phrase, 'item');
                if (item && item.locationId === playerPlace && item.reachable !== false) {
                    action.effects.item_transfer = [{ actor_id: 'player', item_id: item.id,
                        from_id: playerPlace, to_id: 'player' }];
                    if (!response.events.some(event => event.type === 'inventory'
                        && event.actor_id === 'player'
                        && [item.id, item.name].includes(event.item)))
                        response.events.push({ type: 'inventory', actor_id: 'player',
                            status: 'completed', action: 'take', item: item.id });
                    repairs.push({ type: 'prepare_certain_pickup', detail: `actions.${index}` });
                } else if (context.dynamicDiscovery?.enabled === true) {
                    const match = phrase.match(/^(?:take|pick\s+up|grab|nehme|nimm)\s+(?:(?:a|an|the|einen|eine|ein|den|die|das)\s+)?([\p{L}\p{N}][\p{L}\p{N} -]{1,80}?)(?:\s+(?:and|then|und|dann)\b|[.!?]|$)/iu);
                    const name = match?.[1]?.trim();
                    if (name && name.split(/\s+/).length <= 5) {
                        const slug = name.normalize('NFKD').toLowerCase()
                            .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
                            .slice(0, 35) || 'object';
                        const id = `discovery_${String(context.turnId || 'turn').slice(-16)}_${index}_${slug}`;
                        action.effects.item_introduce = [{ id, name,
                            location_id: playerPlace, actor_id: 'player', cause: 'discovery' }];
                        action.effects.item_transfer = [{ actor_id: 'player', item_id: id,
                            from_id: playerPlace, to_id: 'player' }];
                        response.events = response.events.filter(event => event.type !== 'inventory'
                            && event.type !== 'discovery');
                        response.events.push({ type: 'discovery', actor_id: 'player',
                            status: 'completed', target_id: id, item: name },
                        { type: 'inventory', actor_id: 'player', status: 'completed',
                            action: 'take', item: name });
                        response.text = /^(?:nehme|nimm)/iu.test(phrase)
                            ? 'Du greifst nach dem Gegenstand.' : 'You reach for the object.';
                        action.response = [response];
                        repairs.push({ type: 'prepare_dynamic_pickup', detail: `actions.${index}` });
                    }
                }
            }
            if (travel && !(action.effects.actor_move || []).length
                && !response.events.some(event => event.type === 'movement'
                    && event.actor_id && event.actor_id !== 'player')) {
                const destination = references.find(item => item.type === 'location'
                    && item.id === movementEvent?.to_location_id)
                    || uniqueMention(phrase, 'location');
                if (destination && playerPlace && destination.id !== playerPlace) {
                    action.effects.actor_move = [{ actor_id: 'player',
                        to_location_id: destination.id }];
                    if (!response.events.some(event => event.type === 'movement'
                        && event.actor_id === 'player'
                        && event.to_location_id === destination.id))
                        response.events.push({ type: 'movement', actor_id: 'player',
                            status: 'completed', from_location_id: playerPlace,
                            to_location_id: destination.id });
                    repairs.push({ type: 'prepare_certain_movement', detail: `actions.${index}` });
                }
            }
            for (const move of action.effects.actor_move || []) {
                if (move.actor_id !== 'player' || move.companion_ids?.length
                    || !playerPlace || !move.to_location_id) continue;
                if (!response.events.some(event => event.type === 'movement'
                    && event.actor_id === 'player'
                    && event.to_location_id === move.to_location_id)) {
                    response.events.push({ type: 'movement', actor_id: 'player',
                        status: 'completed', from_location_id: playerPlace,
                        to_location_id: move.to_location_id });
                    repairs.push({ type: 'witness_verified_movement', detail: `actions.${index}` });
                }
                // The Linked reducer moves co-located canonical followers with
                // the player. Witness that reducer-owned consequence instead
                // of treating a model's "follows behind" escort event as a
                // second npc_follow action.
                if ((action.effects.actor_move || []).length === 1
                    && proposal.actions.filter(candidate =>
                        (normalizedEffects(candidate.effects).actor_move || []).length).length === 1) {
                    for (const followerId of presentFollowers) {
                        const existing = response.events.findIndex(event =>
                            event.actor_id === followerId && event.type === 'movement'
                            && event.to_location_id === move.to_location_id);
                        if (existing >= 0) continue;
                        const escort = response.events.findIndex(event =>
                            event.actor_id === followerId && event.type === 'escort'
                            && event.target_id === 'player' && event.status === 'completed');
                        const witness = { type: 'movement', actor_id: followerId,
                            status: 'completed', from_location_id: playerPlace,
                            to_location_id: move.to_location_id };
                        if (escort >= 0) response.events.splice(escort, 1, witness);
                        else response.events.push(witness);
                        repairs.push({ type: 'witness_canonical_follower_move',
                            detail: `actions.${index}`, actor_id: followerId });
                    }
                }
                playerPlace = move.to_location_id;
            }
            for (const transfer of action.effects.item_transfer || []) {
                if (transfer.to_id !== 'player' || !transfer.item_id) continue;
                if (!response.events.some(event => event.type === 'inventory'
                    && event.actor_id === 'player'
                    && [transfer.item_id, references.find(item => item.id === transfer.item_id)?.name,
                        (action.effects.item_introduce || []).find(item =>
                            item.id === transfer.item_id)?.name]
                        .includes(event.item))) {
                    response.events.push({ type: 'inventory', actor_id: 'player',
                        status: 'completed', action: 'take', item: transfer.item_id });
                    repairs.push({ type: 'witness_verified_transfer', detail: `actions.${index}` });
                }
            }
            const completeMoves = response.events.filter(event => event.type === 'movement'
                && event.status === 'completed' && event.actor_id
                && event.from_location_id && event.to_location_id);
            if (completeMoves.length) {
                const before = response.events.length;
                response.events = response.events.filter(event => event.type !== 'movement'
                    || !completeMoves.some(complete => complete.actor_id === event.actor_id)
                    || event.from_location_id && event.to_location_id);
                if (response.events.length !== before) repairs.push({
                    type: 'discard_incomplete_duplicate_movement', detail: `actions.${index}` });
            }
            if (Array.isArray(action.state_conditions) && action.effects.item_transfer?.length) {
                action.state_conditions = action.state_conditions.filter(condition =>
                    !action.effects.item_transfer.some(transfer => condition.fact === 'has_item'
                        && condition.operator === 'equals'
                        && condition.subject_id === transfer.to_id
                        && [transfer.item_id, references.find(item => item.id === transfer.item_id)?.name]
                            .includes(condition.value)));
                if (!action.state_conditions.length) delete action.state_conditions;
            }
            if (Array.isArray(action.state_conditions) && action.effects.actor_move?.length) {
                const before = action.state_conditions.length;
                action.state_conditions = action.state_conditions.filter(condition =>
                    !action.effects.actor_move.some(move => condition.fact === 'actor_at'
                        && condition.operator === 'equals'
                        && condition.subject_id === move.actor_id
                        && condition.value === move.to_location_id));
                if (action.state_conditions.length !== before) repairs.push({
                    type: 'discard_movement_postcondition', detail: `actions.${index}` });
                if (!action.state_conditions.length) delete action.state_conditions;
            }
        });
        for (const [index, action] of proposal.actions.entries()) {
            if ((action.effects?.actor_move || []).length) continue;
            for (const response of action.response || []) {
                if (!Array.isArray(response.events)) continue;
                const before = response.events.length;
                response.events = response.events.filter(event => event.type !== 'movement'
                    || !proposal.actions.some((other, otherIndex) => otherIndex !== index
                        && (other.effects?.actor_move || []).some(move =>
                            move.actor_id === event.actor_id
                            && move.to_location_id === event.to_location_id)
                        && (other.response || []).some(paragraph =>
                            (paragraph.events || []).some(witness => witness.type === 'movement'
                                && witness.actor_id === event.actor_id
                                && witness.to_location_id === event.to_location_id))));
                if (response.events.length !== before) repairs.push({
                    type: 'discard_misattributed_duplicate_movement',
                    detail: `actions.${index}` });
            }
        }
    }
    // Preparation can add the missing ordinary movement witness after the
    // first normalization pass. Reconcile the effect mode once more against
    // that completed witness before the canonical schema is built. The
    // executor still decides whether the directed route is actually open.
    proposal.actions.forEach((action, index) => {
        const source = context.input.slice(requestSpans[index].start, requestSpans[index].end);
        const effectFree = !Object.values(normalizedEffects(action.effects)).some(value =>
            Array.isArray(value) ? value.length : !!value);
        if (effectFree && action.kind === 'physical') for (const paragraph of action.response || [])
            for (const event of paragraph.events || []) {
                if (event?.type !== 'interaction' || event.actor_id !== 'player'
                    || event.status !== 'completed' || String(event.action || '').trim()) continue;
                event.action = source.trim().slice(0, 180);
                repairs.push({ type: 'bind_completed_interaction_action',
                    detail: `actions.${index}.response.events.action` });
            }
        if (effectFree && ['speech', 'question'].includes(action.kind))
            for (const paragraph of action.response || []) {
                if (!Array.isArray(paragraph.events)) continue;
                const before = paragraph.events.length;
                paragraph.events = paragraph.events.filter(event =>
                    !(event?.type === 'relationship' && event.status === 'completed'
                        && event.change === 0 && event.value === undefined));
                if (paragraph.events.length !== before) repairs.push({
                    type: 'discard_zero_change_relationship_event',
                    detail: `actions.${index}.response.events` });
            }
    });
    proposal.actions.forEach((action, index) => {
        if (action.kind !== 'travel' || !['resolved', 'answered'].includes(action.status)) return;
        const source = context.input.slice(requestSpans[index].start, requestSpans[index].end);
        if (/\b(?:teleport\w*|beam\w*|materializ\w*|portiere\w*)\b/iu.test(source)) return;
        const events = (action.response || []).flatMap(paragraph => paragraph?.events || []);
        (action.effects?.actor_move || []).forEach((move, moveIndex) => {
            if (move?.actor_id !== 'player' || move.mode !== 'teleport') return;
            if (!events.some(event => event?.type === 'movement'
                && event.actor_id === 'player' && event.status === 'completed'
                && event.to_location_id === move.to_location_id
                && !!event.from_location_id
                && (event.movement_mode === undefined || event.movement_mode === 'voluntary')
                && !String(event.cause || '').trim())) return;
            delete move.mode;
            repairs.push({ type: 'ordinary_move_mode',
                detail: `actions.${index}.effects.actor_move.${moveIndex}.mode` });
        });
    });
    splitWitnessedSpeech(proposal, context.input, requestSpans, repairs);
    errors.push(...validate(proposal, schema(canonical, context)));
    if (requestSpans.length === proposal.actions.length)
        errors.push(...playerIntentErrors(context.input, proposal.actions, requestSpans, context));
    if (errors.length) return { ok: false, errors };
    if (proposal.actions.length > 1 && requestSpans.some((span, index) =>
        String(proposal.actions[index].request).trim() !== context.input.slice(span.start, span.end).trim()))
        repairs.push({ type: 'partition_overlapping_requests', detail: 'unique ordered excerpts' });
    const draft = { protocol: 'scene_draft_v3', actions: [], narrative: [], events: [],
        effects: {}, speech: [], commitments: [], resolutions: [] };
    const worldActionIds = [], gestureActionIds = [];
    const append = (entry, index, world = false) => {
        const actionId = `${context.turnId}_${world ? 'world' : 'action'}_${index}`;
        const paragraphs = world ? [entry] : entry.response;
        const kind = world ? 'other' : entry.kind === 'gesture' ? 'physical' : entry.kind;
        if (!world && entry.kind === 'gesture') gestureActionIds.push(actionId);
        if (world) worldActionIds.push(actionId);
        const action = { action_id: actionId, kind, status: world ? 'resolved' : entry.status,
            request: world ? '' : context.input.slice(requestSpans[index].start, requestSpans[index].end),
            response_id: `${actionId}_p0`, action_effects: normalizedEffects(entry.effects) };
        const hasWorldEffects = Object.values(action.action_effects)
            .some(value => !Array.isArray(value) || value.length);
        if (world && (action.action_effects.actor_move || []).some(move => move.actor_id === 'player'
            || (move.companion_ids || []).includes('player'))
            && !(entry.events || []).some(event => event.type === 'movement' && event.actor_id === 'player'
                && ['forced', 'carried', 'vehicle', 'fall', 'teleport'].includes(event.movement_mode)))
            errors.push({ reason: 'unrequested_player_movement', detail: `reactions.${index}.effects.actor_move` });
        if (entry.effects?.time_skip_minutes !== undefined && entry.effects?.time_advance !== undefined)
            errors.push({ reason: 'conflicting_time_effects', effect: 'time_skip_minutes',
                detail: `${world ? 'reactions' : 'actions'}.${index}.effects.time_skip_minutes` });
        if (entry.effects?.time_skip_minutes !== undefined && action.action_effects.time_skip_minutes === undefined)
            repairs.push({ type: 'time_effect_alias', action_id: actionId,
                detail: 'time_skip_minutes is executed once through time_advance.' });
        for (const [qi, quest] of (action.action_effects.quests_update || []).entries()) {
            if (!(context.questIds || []).includes(quest.id) && (world
                || !String(entry.authorization_quote || '').trim()
                || !context.input.includes(entry.authorization_quote)))
                errors.push({ reason: 'unsupported_new_quest', detail: `actions.${index}.effects.quests_update.${qi}` });
        }
        if (entry.state_conditions) action.state_conditions = clone(entry.state_conditions);
        if (entry.depends_on) action.depends_on = entry.depends_on.map(dependency => {
            if (dependency.action_index >= index) errors.push({ reason: 'forward_action_dependency',
                detail: `actions.${index}.depends_on` });
            return { action_id: `${context.turnId}_action_${dependency.action_index}`, outcome: dependency.outcome };
        });
        draft.actions.push(action);
        paragraphs.forEach((paragraph, passageIndex) => {
            const passageId = `${actionId}_p${passageIndex}`;
            const eventOffset = draft.events.length;
            draft.narrative.push({ id: passageId, action_id: actionId, text: paragraph.text });
            for (const event of paragraph.events || []) draft.events.push({ ...clone(event),
                action_id: actionId, passage_id: passageId });
            for (const speech of paragraph.speech || []) draft.speech.push({ ...clone(speech),
                action_id: actionId, passage_id: passageId });
            for (const [ci, commitment] of (paragraph.commitments || []).entries()) {
                // A model-authored wish or timestamp cannot authorize a player obligation.
                if (!commitment.source_quote.trim() || !context.input.includes(commitment.source_quote)) {
                    errors.push({ reason: 'unsupported_commitment', detail: `${passageId}.commitments.${ci}` });
                    continue;
                }
                const item = clone(commitment);
                delete item.source_quote;
                if (item.existing_id && !(context.commitmentIds || []).includes(item.existing_id))
                    errors.push({ reason: 'unknown_commitment_id', detail: `${passageId}.commitments.${ci}` });
                const existingCommitment = !!item.existing_id;
                const commitmentId = item.existing_id || `${passageId}_deadline_${ci}`;
                delete item.existing_id;
                const due = (item.day - 1) * 1440 + item.minute_of_day;
                if ((!existingCommitment || item.reschedule) && item.status === 'scheduled' && due <= context.now)
                    errors.push({ reason: 'deadline_before_world_time', detail: `${passageId}.commitments.${ci}` });
                draft.commitments.push({ ...item, id: commitmentId,
                    action_id: actionId, passage_id: passageId });
            }
            for (const resolution of paragraph.resolutions || []) draft.resolutions.push({
                ...clone(resolution), event_index: eventOffset + resolution.event_index,
                action_id: actionId, passage_id: passageId });
        });
        if (!world && kind === 'physical' && entry.status === 'resolved'
            && !hasWorldEffects && !draft.events.some(event => event.action_id === actionId
                && event.actor_id === 'player' && event.status === 'completed')) {
            const activity = groundedLocalActivity(action.request, context.references,
                context.playerLocation);
            if (activity) {
                draft.events.push({ type: 'activity', actor_id: 'player', status: 'completed',
                    activity, action_id: actionId, passage_id: action.response_id });
                repairs.push({ type: 'execute_grounded_local_activity',
                    detail: `actions.${index}`, activity });
            }
        }
        if (!world && entry.kind === 'gesture' && !hasWorldEffects
            && ['resolved', 'answered'].includes(entry.status)
            && !draft.events.some(event => event.action_id === actionId && event.actor_id === 'player'
                && event.status === 'completed')) draft.events.push({ type: 'interaction',
            actor_id: 'player', status: 'completed', action: action.request.slice(0, 180),
            action_id: actionId, passage_id: action.response_id });
    };
    (proposal.reactions || []).forEach((reaction, index) => {
        if (reaction.after_action_index !== undefined
            && reaction.after_action_index >= proposal.actions.length)
            errors.push({ reason: 'invalid_reaction_position',
                detail: `reactions.${index}.after_action_index` });
    });
    proposal.actions.forEach((action, index) => {
        append(action, index);
        (proposal.reactions || []).forEach((reaction, reactionIndex) => {
            if (reaction.after_action_index === index) append(reaction, reactionIndex, true);
        });
    });
    (proposal.reactions || []).forEach((reaction, index) => {
        if (reaction.after_action_index === undefined) append(reaction, index, true);
    });
    if (context.input.trim() && !proposal.actions.length)
        errors.push({ reason: 'missing_player_response', detail: 'actions' });
    if (!draft.narrative.length) errors.push({ reason: 'missing_scene_response', detail: 'actions' });
    if (draft.actions.length > 32 || draft.narrative.length > 16 || draft.events.length > 100)
        errors.push({ reason: 'oversized_bound_turn', detail: 'actions' });
    return errors.length ? { ok: false, errors } : { ok: true, draft,
        binding: { turnId: context.turnId, worldActionIds, gestureActionIds, repairs,
            actionSpans: requestSpans.map((span, index) => ({ ...span,
                action_id: `${context.turnId}_action_${index}` })) } };
}
// The caller supplies only effects with an Engine verification trace. Schema
// validity or a successful reducer call alone never grants repair protection.
function repairLosses(verified, next, canonical, previous = null, input = '', references = [], playerLocation = '') {
    if (!Array.isArray(verified) || !object(next) || !Array.isArray(next.actions)) return [];
    const effects = canonical.properties.actions.items.properties.action_effects.properties;
    const result = [];
    const key = value => String(value).normalize('NFKC').trim().toLocaleLowerCase();
    const knownIds = new Set(['player', ...references.map(item => item.id)]);
    const refFields = new Set(['actor_id', 'target_id', 'from_id', 'to_id', 'item_id',
        'recipient_id', 'subject_id', 'source_id', 'location_id',
        'from_location_id', 'to_location_id']);
    const canonicalizeRefs = value => {
        if (Array.isArray(value)) value.forEach(canonicalizeRefs);
        else if (object(value)) for (const [field, item] of Object.entries(value)) {
            if (refFields.has(field) && typeof item === 'string' && !knownIds.has(item)) {
                const ids = [...new Set(references.filter(reference =>
                    key(reference.name) === key(item)).map(reference => reference.id))];
                if (ids.length === 1) value[field] = ids[0];
            } else if (field === 'companion_ids' && Array.isArray(item))
                value[field] = item.map(id => {
                    if (knownIds.has(id)) return id;
                    const ids = [...new Set(references.filter(reference =>
                        key(reference.name) === key(id)).map(reference => reference.id))];
                    return ids.length === 1 ? ids[0] : id;
                });
            else canonicalizeRefs(item);
        }
    };
    const spans = input && next.actions.length > 1 ? alignRequests(input, next.actions) : null;
    for (const proof of verified) {
        if (!object(proof) || !['player', 'reaction'].includes(proof.source)
            || !Array.isArray(proof.effects) || !proof.action_id) continue;
        const group = proof.source === 'player' ? 'actions' : 'reactions';
        const suffix = proof.source === 'player' ? '_action_' : '_world_';
        if (!proof.action_id.includes(suffix)) continue;
        const index = Number(proof.action_id.slice(proof.action_id.lastIndexOf(suffix) + suffix.length));
        if (!Number.isInteger(index) || index < 0) continue;
        const action = next[group]?.[index];
        const request = spans?.[index] ? input.slice(spans[index].start, spans[index].end)
            : action?.request;
        const sameSource = object(action) && (proof.source === 'reaction'
            || !request || request.trim() === String(proof.request || '').trim());
        const remaining = normalizedEffects(action?.effects);
        canonicalizeRefs(remaining);
        for (const operation of proof.effects) {
            const spec = effects[operation.type];
            const wholeArray = Array.isArray(operation.payload) && spec?.type === 'array';
            if (!spec || validate(operation.payload, wholeArray ? spec : spec.items || spec).length) continue;
            const values = remaining[operation.type];
            const match = !wholeArray && Array.isArray(values)
                ? values.findIndex(value => stable(value) === stable(operation.payload)) : -1;
            const restoredTransition = operation.type === 'interactable_transition'
                && sameSource && action?.kind === 'physical'
                && ['resolved', 'answered'].includes(action.status)
                && references.some(ref => ref.type === 'item'
                    && ref.id === operation.payload?.target_id
                    && ref.locationId === playerLocation && ref.reachable !== false
                    && ref.interactableState && (ref.interactable?.transitions || [])
                        .some(transition => transition.from === ref.interactableState
                            && transition.to === operation.payload.to_state
                            && (transition.triggers || []).some(trigger => trigger
                                && key(request).includes(key(trigger))))
                    && [ref.name, ...(ref.aliases || [])].some(name => name
                        && key(request).includes(key(name))));
            if (sameSource && (wholeArray ? stable(values) === stable(operation.payload) : match >= 0)) {
                if (wholeArray) delete remaining[operation.type];
                else values.splice(match, 1);
            } else if (!restoredTransition) result.push({ reason: 'repair_dropped_verified_effect',
                detail: `${group}.${index}.effects.${operation.type}`, action_id: proof.action_id });
        }
    }
    // A repair cannot turn an unresolved executable request into a neutral
    // gesture or line of dialogue merely by changing the model's label.
    // An effect-bearing replacement is still executable and must pass the
    // usual binding, event and reducer checks; verified effects were checked
    // for loss above.
    if (object(previous) && Array.isArray(previous.actions))
        previous.actions.forEach((action, index) => {
            const replacement = next.actions[index];
            if (!object(action) || !object(replacement)
                || !['physical', 'travel', 'wait'].includes(action.kind)
                || !['resolved', 'answered'].includes(action.status)
                || !['gesture', 'speech', 'question', 'observation', 'other'].includes(replacement.kind)
                || Object.values(normalizedEffects(replacement.effects))
                    .some(value => !Array.isArray(value) || value.length)) return;
            result.push({ reason: 'unverified_action_reclassification',
                detail: `actions.${index}.kind` });
        });
    return result;
}
function repairEventLosses(verified, events) {
    if (!Array.isArray(verified) || !verified.length) return [];
    const substantive = event => {
        const item = clone(event);
        for (const key of ['id', 'evidence', 'passage_id', 'visibility', 'witnessed_by'])
            delete item[key];
        return stable(item);
    };
    const remainingEvents = Array.isArray(events) ? [...events] : [];
    const remaining = remainingEvents.map(substantive);
    return verified.flatMap(event => {
        const index = remaining.indexOf(substantive(event));
        if (index >= 0) { remaining.splice(index, 1); remainingEvents.splice(index, 1); return []; }
        // A later repair may express the same completed, nonpersistent player
        // action as activity rather than interaction. Both still need to pass
        // the full compiler and executor; mechanical events stay exact.
        const localProof = item => item?.actor_id === 'player' && item.status === 'completed'
            && ['activity', 'interaction'].includes(item.type)
            && !Object.keys(item).some(key => ['target_id', 'item_id', 'condition',
                'from_location_id', 'to_location_id', 'action_effects'].includes(key));
        const equivalent = localProof(event) ? remainingEvents.findIndex(item =>
            localProof(item) && item.action_id === event.action_id
                && item.passage_id === event.passage_id) : -1;
        if (equivalent >= 0) {
            remaining.splice(equivalent, 1); remainingEvents.splice(equivalent, 1);
            return [];
        }
        return [{ reason: 'repair_dropped_verified_event',
            detail: event.action_id || event.type || 'events' }];
    });
}
const api = { schema, bind, validate, repairLosses, repairEventLosses };
if (typeof module !== 'undefined') module.exports = api;
root.HordeWorldTurnBinding = api;
})(globalThis);
