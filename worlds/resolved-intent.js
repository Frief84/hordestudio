/* Minimal, model-neutral interpretation contract for World turns.
 * It carries ordered source spans and references only; it has no state-write
 * authority. Execution remains owned by the existing linked action engine. */
(function (root) {
'use strict';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const kinds = ['travel', 'interaction', 'transfer', 'speech', 'question', 'observation',
    'wait', 'gesture', 'appearance', 'activity', 'other', 'context'];
const operations = ['move', 'take', 'drop', 'give', 'consume', 'open', 'close', 'lock',
    'unlock', 'use', 'interact', 'speak', 'ask', 'observe', 'wait', 'gesture', 'other'];
const fieldsByKind = {
    travel: ['actor_id', 'destination_id', 'exit_index'],
    interaction: ['actor_id', 'target_id', 'operation', 'to_state'],
    transfer: ['actor_id', 'item_id', 'operation', 'recipient_id', 'quantity'],
    speech: ['actor_id', 'target_ids', 'recipient_id', 'utterance'],
    question: ['actor_id', 'target_ids', 'recipient_id', 'utterance'],
    observation: ['actor_id', 'target_id', 'target_ids'],
    wait: ['actor_id', 'minutes', 'target_ids'], gesture: ['actor_id', 'target_ids'],
    appearance: ['actor_id', 'outfit'], activity: ['actor_id', 'activity'],
    other: ['actor_id'], context: []
};
const id = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,119}$/.test(value);
// Match typography/whitespace only; never translate or paraphrase source text.
// The result always uses the player's original spelling and Unicode characters.
function sourceSpan(input, quote, cursor = 0) {
    if (typeof quote !== 'string' || !quote.trim()) return null;
    const exact = input.indexOf(quote, cursor);
    if (exact >= 0) return { start: exact, end: exact + quote.length };
    const fold = text => {
        let value = ''; const starts = [], ends = [];
        for (const match of text.matchAll(/[^\r\n]\p{M}*|[\r\n]/gu)) {
            const part = match[0].normalize('NFC').replace(/[“”„«»]/gu, '"')
                .replace(/[‘’]/gu, "'").replace(/\s/gu, ' ');
            if (part === ' ' && value.endsWith(' ')) { ends[ends.length - 1] = match.index + match[0].length; continue; }
            for (const char of part) {
                value += char;
                for (let unit = 0; unit < char.length; unit++) {
                    starts.push(match.index); ends.push(match.index + match[0].length);
                }
            }
        }
        return { value, starts, ends };
    };
    const source = fold(input.slice(cursor)), target = fold(quote).value;
    const at = source.value.indexOf(target);
    if (at < 0 || source.value.indexOf(target, at + 1) >= 0) return null;
    return { start: cursor + source.starts[at], end: cursor + source.ends[at + target.length - 1] };
}
function normalizeProposal(proposal, context = {}) {
    if (!object(proposal) || !Array.isArray(proposal.steps)) return proposal;
    const originalIndexes = new Map();
    let quoteCursor = 0;
    proposal = { ...proposal, steps: proposal.steps.map(step => {
        if (!object(step)) return step;
        const span = sourceSpan(String(context.input || ''), step.source_quote, quoteCursor);
        if (!span) return { ...step };
        quoteCursor = span.end;
        const source_quote = String(context.input || '').slice(span.start, span.end);
        const utteranceSpan = sourceSpan(source_quote, step.utterance);
        return { ...step, source_quote, ...(utteranceSpan ? {
            utterance: source_quote.slice(utteranceSpan.start, utteranceSpan.end) } : {}) };
    }) };
    const travelQuotes = new Set(proposal.steps.filter(step => object(step)
        && step.kind === 'travel').map(step => String(step.source_quote || '')));
    const knownItems = new Set((context.references || []).filter(object)
        .filter(item => item.type === 'item' || item.kind === 'item' || item.item === true)
        .flatMap(item => [item.id, item.name].filter(value => typeof value === 'string')
            .map(value => value.normalize('NFKC').toLocaleLowerCase())));
    const people = (context.people || []).filter(person => object(person) && id(person.id)
        && typeof person.name === 'string' && person.name.trim());
    const contextQuotesContainedByAction = new Set(proposal.steps.filter(step => object(step)
        && step.kind !== 'context').map(step => String(step.source_quote || '')));
    const steps = proposal.steps.filter(step => !(object(step) && step.kind === 'transfer'
        && travelQuotes.has(String(step.source_quote || ''))
        && !knownItems.has(String(step.item_id || '').normalize('NFKC').toLocaleLowerCase()))
        && !(object(step) && step.kind === 'interaction'
            && travelQuotes.has(String(step.source_quote || '')))
        && !(object(step) && step.kind === 'context'
            && [...contextQuotesContainedByAction].some(quote => quote !== step.source_quote
                && quote.includes(step.source_quote))))
        .map(step => {
        if (!object(step)) return step;
        const originalIndex = proposal.steps.indexOf(step);
        if (step.kind === 'other' && typeof step.source_quote === 'string') {
            const attireCue = /\b(?:put\s+on|wear|dress\s+in|change\s+into|don|equip|trage|ponte|ponerse|vístete|vistete|vestir|indossa)\s+(.+)|\b(?:zieh(?:e|st|t)?|kleide(?:st)?|metti)\s+(.+?)\s+(?:an|addosso)\b/iu.exec(step.source_quote);
            if (attireCue) {
                const outfit = (attireCue.slice(1).find(Boolean)
                    || step.source_quote.slice(attireCue.index + attireCue[0].length))
                    .replace(/^[\s,;:]+/u, '').replace(/[.!?]+$/u, '')
                    .replace(/^(?:the|a|an|den|die|das|einen|eine|un|une|el|la)\s+/iu, '').trim();
                if (outfit) step = { ...step, kind: 'appearance', outfit };
            }
        }
        const next = Object.fromEntries(['source_quote', 'kind',
            ...(fieldsByKind[step.kind] || []), 'depends_on']
            .filter(key => step[key] !== undefined && (step[key] !== null || key === 'depends_on'))
            .map(key => [key, step[key]]));
        originalIndexes.set(next, originalIndex);
        if (next.kind === 'travel' && !next.destination_id && id(step.target_id))
            next.destination_id = step.target_id;
        if (next.kind === 'transfer' && !next.item_id && id(step.target_id))
            next.item_id = step.target_id;
        if (next.kind === 'transfer' && !next.operation) {
            const text = ` ${String(next.source_quote || '').toLocaleLowerCase()} `;
            const operationCues = [
                ['take', /\b(?:take|pick\s+up|grab|collect|gather|lift|nehmen|nimm|aufheben|einsammeln|prendre|ramasser|recueillir|tomar|recoger|levantar)\b/iu],
                ['drop', /\b(?:drop|put\s+down|leave|discard|ablegen|hinlegen|fallen\s+lassen|déposer|laisser|dejar|soltar)\b/iu],
                ['give', /\b(?:give|hand\s+(?:over)?|pass\s+(?:over)?|geben|überreichen|donner|remettre|dar|entregar)\b/iu],
                ['consume', /\b(?:consume|eat|drink|use\s+up|verbrauchen|essen|trinken|consommer|manger|boire|consumir|comer|beber)\b/iu]
            ].filter(([, pattern]) => pattern.test(text));
            if (operationCues.length === 1) next.operation = operationCues[0][0];
        }
        // Only give has a recipient. Take/drop/consume destinations are owned
        // by the engine; unused provider fields must not reject valid actions.
        if (next.kind === 'transfer' && ['take', 'drop', 'consume'].includes(next.operation))
            delete next.recipient_id;
        if (next.kind === 'activity' && (typeof next.activity !== 'string'
            || !String(next.source_quote || '').includes(next.activity)))
            next.activity = String(next.source_quote || '')
                .replace(/^\s*(?:and\s+then|then|and|dann|danach|und\s+dann|et\s+puis|puis|y\s+luego|luego)\s+/iu, '')
                .trim();
        // Dependencies are remapped after removing redundant context; invalid
        // dependencies must fail validation, never become unconditional actions.
        const quote = String(step.source_quote || '');
        if (['speech', 'question'].includes(step.kind) && typeof step.utterance === 'string') {
            const quoted = [...quote.matchAll(/"([^"\r\n]{1,1200})"|“([^”\r\n]{1,1200})”|„([^“\r\n]{1,1200})“|«([^»\r\n]{1,1200})»|'([^'\r\n]{1,1200})'/gu)]
                .map(match => match.slice(1).find(Boolean)).filter(Boolean);
            if (quoted.length === 1 && (step.utterance === quoted[0]
                || step.utterance === quote.match(/(["“„«'])([^"”»'\r\n]{1,1200})["”»']/u)?.[0]))
                next.utterance = quoted[0];
        }
        if (['speech', 'question'].includes(step.kind) && !Array.isArray(step.target_ids)) {
            const matched = people.filter(person => quote.toLocaleLowerCase()
                .includes(person.name.toLocaleLowerCase()))
                .sort((left, right) => right.name.length - left.name.length);
            if (matched.length) next.target_ids = [...new Set(matched.map(person => person.id))];
        }
        return next;
        });
    const input = String(context.input || '');
    let speechAnchorCursor = 0;
    for (const step of steps) {
        if (!['speech', 'question'].includes(step?.kind)
            || typeof step.utterance !== 'string' || !step.utterance) continue;
        const quoteAt = input.indexOf(step.source_quote, speechAnchorCursor);
        if (quoteAt >= 0) {
            speechAnchorCursor = quoteAt + step.source_quote.length;
            continue;
        }
        const utteranceAt = input.indexOf(step.utterance, speechAnchorCursor);
        if (utteranceAt < 0) continue;
        const rawPrefix = String(step.source_quote || '').split(step.utterance, 1)[0];
        const prefixWords = rawPrefix.match(/[\p{L}\p{N}]+/gu) || [];
        const preceding = input.slice(speechAnchorCursor, utteranceAt);
        const precedingWords = [...preceding.matchAll(/[\p{L}\p{N}]+/gu)];
        let matchedWords = 0;
        while (matchedWords < prefixWords.length && matchedWords < precedingWords.length
            && prefixWords[prefixWords.length - matchedWords - 1].toLocaleLowerCase()
                === precedingWords[precedingWords.length - matchedWords - 1][0].toLocaleLowerCase())
            matchedWords++;
        const start = matchedWords ? speechAnchorCursor
            + precedingWords[precedingWords.length - matchedWords].index : utteranceAt;
        const end = utteranceAt + step.utterance.length;
        step.source_quote = input.slice(start, end);
        speechAnchorCursor = end;
    }
    let actionCursor = 0;
    for (const step of steps) {
        if (!['speech', 'question'].includes(step?.kind)
            || typeof step.source_quote !== 'string') continue;
        const start = input.indexOf(step.source_quote, actionCursor);
        if (start < 0) continue;
        const gap = input.slice(actionCursor, start);
        const cue = [...gap.matchAll(/\b(?:tell|tells|told|say|says|said|speak|speaks|ask|asks|asked|question|questions|frage|fragen|fragte|frag|pregunta|preguntar)\b/giu)].at(-1);
        if (cue) step.source_quote = input.slice(actionCursor + cue.index,
            start + step.source_quote.length);
        actionCursor = start + step.source_quote.length;
    }
    for (const step of steps) {
        if (!['speech', 'question'].includes(step?.kind)) continue;
        const quote = String(step.source_quote || '');
        const quoted = [...quote.matchAll(/"([^"\r\n]{1,1200})"|“([^”\r\n]{1,1200})”|„([^“\r\n]{1,1200})“|«([^»\r\n]{1,1200})»|'([^'\r\n]{1,1200})'/gu)]
            .map(match => match.slice(1).find(Boolean)).filter(Boolean);
        if (quoted.length === 1) step.utterance = quoted[0];
        else if (typeof step.utterance === 'string' && !quote.includes(step.utterance)
            && !String(context.input || '').includes(step.utterance))
            step.utterance = quote;
        if (step.kind === 'speech' && /\b(?:ask|asks|asked|question|questions|frage|fragen|fragte|frag|pregunta|preguntar)\b/iu.test(quote))
            step.kind = 'question';
    }
    let speechCursor = 0;
    for (let index = 0; index < steps.length; index++) {
        const step = steps[index];
        if (!['speech', 'question'].includes(step?.kind)
            || typeof step.source_quote !== 'string' || typeof step.utterance !== 'string'
            || step.source_quote.includes(step.utterance)) continue;
        const quoteStart = input.indexOf(step.source_quote, speechCursor);
        if (quoteStart < 0) continue;
        const utteranceStart = input.indexOf(step.utterance, quoteStart + step.source_quote.length);
        if (utteranceStart < 0) continue;
        const utteranceEnd = utteranceStart + step.utterance.length;
        const nextStart = steps.slice(index + 1).map(next => input.indexOf(next?.source_quote || '', utteranceEnd))
            .filter(position => position >= utteranceEnd).sort((left, right) => left - right)[0] ?? input.length;
        if (utteranceEnd <= nextStart)
            step.source_quote = input.slice(quoteStart, utteranceEnd);
    }
    // Context is informational and carries no action. A model can split an
    // action cue (for example, its addressee) into a context step while putting
    // the quoted utterance in a later action step. Once speech normalization
    // expands that action to the full user span, discard overlapping context
    // spans so validation sees one ordered owner for those source words.
    const actionSpans = steps.filter(step => object(step) && step.kind !== 'context')
        .map(step => {
            const start = input.indexOf(step.source_quote);
            return start < 0 ? null : [start, start + step.source_quote.length];
        }).filter(Boolean);
    for (let index = steps.length - 1; index >= 0; index--) {
        if (steps[index]?.kind !== 'context') continue;
        const start = input.indexOf(steps[index].source_quote);
        if (start < 0) continue;
        const end = start + steps[index].source_quote.length;
        if (actionSpans.some(([actionStart, actionEnd]) =>
            start < actionEnd && actionStart < end)) steps.splice(index, 1);
    }
    // When an interpreter correctly resolves several route legs but cites the
    // entire sentence for each, partition that shared span at the ordered
    // canonical destination mentions. No route is inferred here; only the
    // supplied, validated destinations are used to anchor the source slices.
    for (let index = 0; index < steps.length - 1; index++) {
        const first = steps[index];
        const second = steps[index + 1];
        if (first?.kind !== 'travel' || second?.kind !== 'travel'
            || first.source_quote !== second.source_quote) continue;
        const shared = first.source_quote;
        const start = input.indexOf(shared);
        if (start < 0) continue;
        const findDestination = step => {
            const destination = (context.references || []).filter(object)
                .find(reference => reference.id === step.destination_id);
            const aliases = [destination?.name, step.destination_id].filter(value =>
                typeof value === 'string' && value.trim()).sort((a, b) => b.length - a.length);
            for (const alias of aliases) {
                const at = shared.toLocaleLowerCase().indexOf(alias.normalize('NFKC').toLocaleLowerCase());
                if (at >= 0) return { start: at, end: at + alias.length };
            }
            return null;
        };
        const firstDestination = findDestination(first);
        const secondDestination = findDestination(second);
        if (!firstDestination || !secondDestination
            || firstDestination.end > secondDestination.start) continue;
        first.source_quote = shared.slice(0, firstDestination.end);
        second.source_quote = shared.slice(firstDestination.end);
    }
    let sourceCursor = 0;
    for (let index = 0; index < steps.length; index++) {
        const step = steps[index];
        if (step?.kind !== 'travel' || !step.destination_id) continue;
        const start = input.indexOf(step.source_quote, sourceCursor);
        if (start < 0) continue;
        const end = start + step.source_quote.length;
        let nextStart = input.length;
        for (let nextIndex = index + 1; nextIndex < steps.length; nextIndex++) {
            const nextStartCandidate = input.indexOf(steps[nextIndex]?.source_quote || '', end);
            if (nextStartCandidate >= end) { nextStart = nextStartCandidate; break; }
        }
        const gap = input.slice(end, nextStart);
        const destination = (context.references || []).filter(object)
            .find(reference => reference.id === step.destination_id);
        const aliases = [step.destination_id, destination?.name].filter(value =>
            typeof value === 'string' && value.trim())
            .map(value => value.normalize('NFKC').toLocaleLowerCase());
        const normalizedGap = gap.normalize('NFKC').toLocaleLowerCase();
        if (gap && aliases.some(alias => normalizedGap.includes(alias)))
            step.source_quote += gap;
        sourceCursor = end + gap.length;
    }
    const newIndexes = new Map(steps.map((step, index) => [originalIndexes.get(step), index]));
    for (const step of steps) if (object(step) && Array.isArray(step.depends_on))
        step.depends_on = step.depends_on.map(dependency => object(dependency)
            ? { ...dependency, step_index: newIndexes.get(dependency.step_index) ?? -1 } : dependency);
    return { ...proposal, steps };
}
function schema() {
    const contract = { type: 'object', additionalProperties: false,
    required: ['protocol', 'steps'], properties: {
        protocol: { type: 'string', const: 'resolved_intent_v1' },
        steps: { type: 'array', minItems: 0, maxItems: 32, items: {
            type: 'object', additionalProperties: false,
            required: ['source_quote', 'kind'], properties: {
                source_quote: { type: 'string', minLength: 1, maxLength: 5000 },
                kind: { type: 'string', enum: kinds },
                actor_id: { type: 'string', maxLength: 120 },
                target_ids: { type: 'array', maxItems: 8,
                    items: { type: 'string', maxLength: 120 } },
                destination_id: { type: 'string', maxLength: 120 },
                exit_index: { type: 'integer', minimum: 0, maximum: 499 },
                operation: { type: 'string', enum: operations },
                target_id: { type: 'string', maxLength: 120 },
                item_id: { type: 'string', maxLength: 160 },
                recipient_id: { type: 'string', maxLength: 120 },
                quantity: { type: 'integer', minimum: 1, maximum: 100 },
                minutes: { anyOf: [{ type: 'integer', minimum: 1, maximum: 10080 }, { type: 'null' }],
                    description: 'Only an explicitly requested duration. Omit for waiting for a person or event without a duration.' },
                to_state: { type: 'string', maxLength: 80 },
                outfit: { type: 'string', maxLength: 160 },
                activity: { type: 'string', maxLength: 180 },
                depends_on: { type: 'array', minItems: 0, maxItems: 8,
                    description: 'Omit unless the player explicitly makes this action conditional on an EARLIER step succeeding. Never refer to this step itself; the first step cannot have dependencies.', items: {
                    type: 'object', additionalProperties: false,
                    required: ['step_index', 'outcome'], properties: {
                        step_index: { type: 'integer', minimum: 0, maximum: 31 },
                        outcome: { type: 'string', const: 'succeeded' }
                    }
                } },
                utterance: { type: 'string', maxLength: 5000 }
            }
        } }
    } };
    const properties = contract.properties.steps.items.properties;
    const requiredByKind = { travel: ['destination_id'], interaction: ['operation', 'target_id'],
        transfer: ['operation', 'item_id'], speech: ['utterance'], question: ['utterance'],
        appearance: ['outfit'], activity: ['activity'] };
    // The provider schema must enforce the same kind-specific requirements as
    // the engine. A flat optional-field bag invited structurally incomplete
    // transfers even when constrained generation reported HTTP 200 / stop.
    contract.properties.steps.items = { anyOf: kinds.map(kind => ({
        type: 'object', additionalProperties: false,
        required: ['source_quote', 'kind', ...(requiredByKind[kind] || [])],
        properties: Object.fromEntries(['source_quote', 'kind', ...fieldsByKind[kind],
            ...(kind === 'context' ? [] : ['depends_on'])].map(key => [key,
            key === 'kind' ? { type: 'string', const: kind }
                : key === 'operation' ? { type: 'string', enum: kind === 'transfer'
                    ? ['take', 'drop', 'give', 'consume'] : ['open', 'close', 'lock', 'unlock', 'use', 'interact'] }
                    : properties[key]]))
    })) };
    contract.properties.steps.items.anyOf = contract.properties.steps.items.anyOf.flatMap(branch => {
        if (branch.properties.kind.const !== 'transfer') return [branch];
        return ['take', 'drop', 'give', 'consume'].map(operation => {
            const properties = { ...branch.properties, operation: { type: 'string', const: operation } };
            if (operation !== 'give') delete properties.recipient_id;
            return { ...branch, properties, required: [...branch.required,
                ...(operation === 'give' ? ['recipient_id'] : [])] };
        });
    });
    return contract;
}
function validate(intent, context = {}) {
    const errors = [];
    const fail = (reason, index = null) => errors.push({ reason,
        ...(index === null ? {} : { step_index: index }) });
    if (!object(intent) || intent.protocol !== 'resolved_intent_v1' || !Array.isArray(intent.steps)
        || intent.steps.length > 32) return { ok: false, errors: [{ reason: 'invalid_resolved_intent' }] };
    const input = String(context.input || '');
    let cursor = 0;
    const referenceEntries = (context.references || []).filter(object);
    const references = new Set(referenceEntries.map(entry => entry?.id).filter(id));
    const seenItems = new Set();
    const items = referenceEntries.filter(entry => entry.type === 'item'
        || entry.kind === 'item' || entry.item === true).filter(entry => {
        const key = id(entry.id) ? `id:${entry.id}`
            : `name:${String(entry.name || '').normalize('NFKC').toLocaleLowerCase()}`;
        if (seenItems.has(key)) return false;
        seenItems.add(key);
        return true;
    });
    const itemIds = new Set(items.map(entry => entry.id).filter(id));
    const itemNames = new Map();
    for (const item of items) for (const key of new Set([item.name, item.id]
        .filter(name => typeof name === 'string' && name.trim())
        .map(name => name.normalize('NFKC').toLocaleLowerCase())))
        itemNames.set(key, (itemNames.get(key) || 0) + 1);
    references.add('player');
    for (const [index, step] of intent.steps.entries()) {
        const allowed = new Set(['source_quote', 'kind', 'actor_id', 'target_ids', 'destination_id',
            'operation', 'target_id', 'item_id', 'recipient_id', 'quantity', 'minutes',
            'to_state', 'outfit', 'activity', 'utterance', 'exit_index', 'depends_on']);
        if (!object(step) || Object.keys(step).some(key => !allowed.has(key))
            || !kinds.includes(step.kind) || typeof step.source_quote !== 'string'
            || !step.source_quote.trim() || step.source_quote.length > 5000) {
            fail('invalid_intent_step', index); continue;
        }
        const at = input.indexOf(step.source_quote, cursor);
        if (at < 0) fail('source_quote_out_of_order_or_missing', index);
        else cursor = at + step.source_quote.length;
        if (step.actor_id !== undefined && (!id(step.actor_id) || !references.has(step.actor_id)))
            fail('unknown_intent_actor', index);
        if (step.target_ids !== undefined && (!Array.isArray(step.target_ids)
            || step.target_ids.length > 8 || step.target_ids.some(target => !id(target)
                || !references.has(target)))) fail('unknown_intent_target', index);
        if (step.destination_id !== undefined && (!id(step.destination_id)
            || !references.has(step.destination_id))) fail('unknown_intent_destination', index);
        if (step.exit_index !== undefined && (!Number.isInteger(step.exit_index)
            || step.exit_index < 0 || step.exit_index > 499)) fail('invalid_intent_exit', index);
        if (step.target_id !== undefined && (!id(step.target_id) || !references.has(step.target_id)))
            fail('unknown_intent_target', index);
        if (step.item_id !== undefined) {
            const value = typeof step.item_id === 'string' ? step.item_id.trim() : '';
            const key = value.normalize('NFKC').toLocaleLowerCase();
            if (!value || value.length > 160 || !itemIds.has(value)
                && itemNames.get(key) !== 1)
                fail(itemNames.get(key) > 1 ? 'ambiguous_intent_item' : 'unknown_intent_item', index);
        }
        if (step.recipient_id !== undefined && (!id(step.recipient_id)
            || !references.has(step.recipient_id))) fail('unknown_intent_recipient', index);
        if (step.operation !== undefined && !operations.includes(step.operation))
            fail('unknown_intent_operation', index);
        if (step.kind === 'travel' && !step.destination_id)
            fail('travel_destination_required', index);
        if (step.kind === 'transfer' && (!['take', 'drop', 'give', 'consume'].includes(step.operation)
            || !step.item_id || step.operation === 'give' && !step.recipient_id))
            fail('invalid_transfer_intent', index);
        if (step.kind === 'interaction' && (!['open', 'close', 'lock', 'unlock', 'use', 'interact']
            .includes(step.operation) || !step.target_id))
            fail('invalid_interaction_intent', index);
        if ((step.kind === 'speech' || step.kind === 'question')
            && typeof step.utterance !== 'string') fail('missing_intent_utterance', index);
        // An unspecified wait uses the existing turn clock. It does not grant
        // arbitrary extra time or assert that the awaited event occurred.
        if (step.kind === 'appearance' && (typeof step.outfit !== 'string'
            || !step.outfit.trim() || step.outfit.length > 160
            || !step.source_quote.includes(step.outfit))) fail('invalid_appearance_intent', index);
        if (step.kind === 'activity' && (typeof step.activity !== 'string'
            || !step.activity.trim() || step.activity.length > 180
            || !step.source_quote.includes(step.activity))) fail('invalid_activity_intent', index);
        if (step.depends_on !== undefined && (!Array.isArray(step.depends_on)
            || step.depends_on.length > 8 || step.depends_on.some(dependency =>
                !object(dependency) || Object.keys(dependency).some(key =>
                    !['step_index', 'outcome'].includes(key))
                || !Number.isInteger(dependency.step_index) || dependency.step_index < 0
                || dependency.step_index >= index || intent.steps[dependency.step_index]?.kind === 'context'
                || dependency.outcome !== 'succeeded')))
            fail('invalid_intent_dependency', index);
        if (step.quantity !== undefined && (!Number.isInteger(step.quantity)
            || step.quantity < 1 || step.quantity > 100)) fail('invalid_intent_quantity', index);
        if (step.minutes !== undefined && (!Number.isInteger(step.minutes)
            || step.minutes < 1 || step.minutes > 10080)) fail('invalid_intent_duration', index);
        if (step.utterance !== undefined && (typeof step.utterance !== 'string'
            || !step.utterance.trim() || step.utterance.length > 5000
            || !step.source_quote.includes(step.utterance)))
            fail('utterance_not_in_source_quote', index);
    }
    return { ok: errors.length === 0, errors,
        intent: errors.length ? null : { protocol: intent.protocol, steps: intent.steps.map(step => ({
            source_quote: step.source_quote, kind: step.kind,
            ...(step.actor_id ? { actor_id: step.actor_id } : {}),
            ...(step.target_ids ? { target_ids: [...step.target_ids] } : {}),
            ...(step.destination_id ? { destination_id: step.destination_id } : {}),
            ...(Number.isInteger(step.exit_index) ? { exit_index: step.exit_index } : {}),
            ...(step.operation ? { operation: step.operation } : {}),
            ...(step.target_id ? { target_id: step.target_id } : {}),
            ...(step.item_id ? { item_id: step.item_id } : {}),
            ...(step.recipient_id ? { recipient_id: step.recipient_id } : {}),
            ...(step.quantity ? { quantity: step.quantity } : {}),
            ...(step.minutes ? { minutes: step.minutes } : {}),
            ...(step.to_state ? { to_state: step.to_state } : {}),
            ...(step.outfit ? { outfit: step.outfit } : {}),
            ...(step.activity ? { activity: step.activity } : {}),
            ...(step.depends_on?.length ? { depends_on: step.depends_on.map(dependency => ({
                step_index: dependency.step_index, outcome: dependency.outcome })) } : {}),
            ...(step.utterance ? { utterance: step.utterance } : {})
        })) } };
}
function fromLinkedActions(actions, input) {
    if (!Array.isArray(actions)) return { ok: false, errors: [{ reason: 'invalid_linked_actions' }] };
    const converted = actions.map(action => ({ source_quote: action.request, kind:
        ({ physical: 'interaction', travel: 'travel', speech: 'speech', question: 'question',
            observation: 'observation', wait: 'wait', gesture: 'gesture', other: 'other' })[action.kind] || 'other',
        ...(action.kind === 'speech' ? { utterance: String(action.request || '') } : {}),
        ...(action.action_effects?.actor_move?.[0]?.actor_id
            ? { actor_id: action.action_effects.actor_move[0].actor_id } : {}),
        ...((action.action_effects?.actor_move || []).at(-1)?.to_location_id
            ? { destination_id: action.action_effects.actor_move.at(-1).to_location_id } : {}) }));
    return validate({ protocol: 'resolved_intent_v1', steps: converted }, { input,
        references: actions.flatMap(action => [action.action_effects?.actor_move?.[0]?.actor_id,
            ...((action.action_effects?.actor_move || []).map(move => move.to_location_id))]
            .filter(Boolean).map(id => ({ id }))) });
}
const api = { schema, validate, normalizeProposal, sourceSpan, fromLinkedActions, kinds, operations };
root.HordeResolvedIntent = api;
if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
