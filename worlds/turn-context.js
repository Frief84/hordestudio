/* Pure context selection. No providers, persistence, or state mutation. */
(function(root) {
'use strict';
function history(options) {
    const messages = [];
    if (options.maxTurns !== undefined) return recentHistory(options);
    let remaining = options.budget, latestStateKept = false, count = 0;
    for (let i = options.start; i >= 0 && count < 160; i--) {
        const m = options.history[i];
        // Failed UI notices and their abandoned requests are not story canon.
        // Keep the current action, but do not teach the narrator to roleplay
        // previous repair errors or answer an abandoned request again.
        if (m.stateSource === 'frozen_no_receipt') continue;
        if (i !== options.start && m.role === 'user'
            && options.history[i + 1]?.stateSource === 'frozen_no_receipt') continue;
        let content = options.text(m);
        if (!content) continue;
        const current = i === options.start && m.role === 'user';
        if (m.role === 'dm' && options.prepare) {
            const hasState = /<internal_states\b/i.test(content);
            content = options.prepare(content, !latestStateKept);
            if (hasState) latestStateKept = true;
        }
        if (!content) continue;
        if (!current && m.location && m.location !== options.location) {
            const name = options.locations.find(location => location.id === m.location)?.name;
            content = `[DISTANT EVENT (HIDDEN FROM PRESENT NPCs)]: ${name ? `[Loc: ${name}] ` : ''}${content}`;
        }
        const tokens = Math.ceil((content.length + 48) / 3.2);
        if (remaining - tokens <= 0) {
            if (current) throw new Error('The current player action exceeds this World’s context budget. Shorten the action or increase World Context Size. No model request was sent.');
            break;
        }
        const role = m.role === 'dm' ? 'assistant' : 'user';
        if (messages[0]?.role === role) messages[0].content = content + '\n\n' + messages[0].content;
        else messages.unshift({ role, content });
        remaining -= tokens;
        count++;
    }
    for (const injection of options.injections || []) {
        messages.splice(Math.max(0, messages.length - (injection.depth || 0)), 0,
            { role: injection.role || 'system', content: injection.content });
    }
    return messages;
}

// Select whole turns: a budget boundary must not leave an answer without its
// question. The current request is independent and is never silently dropped.
function recentHistory(options) {
    const groups = [];
    let pending = [];
    for (let i = 0; i <= options.start; i++) {
        const m = options.history[i];
        if (!m || m.stateSource === 'frozen_no_receipt') continue;
        // A reroll ends its context at the original request, before the
        // rejected reply. That request is active again, not abandoned.
        if (i !== options.start && m.role === 'user'
            && options.history[i + 1]?.stateSource === 'frozen_no_receipt') continue;
        if (m.role === 'user') pending.push({ m, i });
        else if (m.role === 'dm') {
            groups.push([...pending, { m, i }]);
            pending = [];
        }
    }
    const current = options.history[options.start]?.role === 'user' ? pending : [];
    let remaining = options.budget, latestStateKept = false;
    const selected = [], ids = [];
    const candidates = [current, ...(options.maxTurns > 0 ? groups.slice(-options.maxTurns).reverse() : [])];
    for (let gi = 0; gi < candidates.length; gi++) {
        const group = candidates[gi];
        let keptState = latestStateKept;
        const prepared = group.map(({ m, i }) => {
            let content = options.text(m);
            if (m.role === 'dm' && options.prepare && content) {
                const hasState = /<internal_states\b/i.test(content);
                content = options.prepare(content, !keptState);
                if (hasState) keptState = true;
            }
            if (content && i !== options.start && m.location && m.location !== options.location) {
                const name = options.locations.find(loc => loc.id === m.location)?.name;
                content = `[DISTANT EVENT (HIDDEN FROM PRESENT NPCs)]: ${name ? `[Loc: ${name}] ` : ''}${content}`;
            }
            return { role: m.role === 'dm' ? 'assistant' : 'user', content, id: m.id };
        }).filter(m => m.content);
        const cost = prepared.reduce((n, m) => n + Math.ceil((m.content.length + 48) / 3.2), 0);
        if (cost > remaining) {
            if (gi === 0 && current.length) throw new Error('The current player action exceeds this World’s context budget. Shorten the action or increase World Context Size. No model request was sent.');
            break;
        }
        remaining -= cost;
        latestStateKept = keptState;
        selected.unshift(...prepared);
        ids.push(...prepared.map(m => m.id).filter(Boolean));
    }
    const result = selected.map(({ role, content }) => ({ role, content }));
    for (const injection of options.injections || []) result.splice(Math.max(0, result.length - (injection.depth || 0)), 0,
        { role: injection.role || 'system', content: injection.content });
    options.onSelected?.(ids);
    return result;
}

// Extractive scene memory: reuse accepted statements, never ask a second model
// to reinterpret state. Records live on the originating take, not in a second
// mutable archive, so rerolls/deletion cannot leave orphaned canon behind.
function sceneMemory(draft, receiptId, location, turn) {
    if (Array.isArray(draft?.action_results) && Array.isArray(draft?.confirmed_effects)) {
        const outcomes = new Map(draft.action_results.map(item => [item.action_id, item.outcome]));
        const records = [];
        const events = Array.isArray(draft.events) ? draft.events : [];
        events.forEach((event, eventIndex) => {
            if (event?.status !== 'completed' || outcomes.get(event.action_id) !== 'succeeded') return;
            const text = String(event.type === 'observation'
                ? event.observation || event.evidence || '' : event.evidence || '').trim();
            if (!text) return;
            const witnesses = event.type === 'observation' ? [event.actor_id]
                : Array.isArray(event.witnessed_by) ? event.witnessed_by : [];
            records.push({ kind: event.source_type === 'told' ? 'testimony' : 'event',
                actor: event.actor_id, text: text.slice(0, 700), actionId: event.action_id,
                eventIndex, witnesses, effects: draft.confirmed_effects.filter(effect =>
                    effect.result === 'changed' && effect.event_indices.includes(eventIndex))
                    .map(effect => effect.type) });
        });
        for (const speech of draft.speech_attributions || []) if (speech?.speaker
            && outcomes.get(speech.action_id) !== 'skipped')
            records.push({ kind: 'testimony', actor: speech.speaker,
                listeners: speech.listeners, text: String(speech.statement).slice(0, 700),
                actionId: speech.action_id, passageId: speech.passage_id });
        for (const effect of draft.confirmed_effects) if (outcomes.get(effect?.action_id) === 'succeeded')
            records.push({ kind: 'effect', actor: effect.payload?.actor_id
                || effect.payload?.subject_id || '', actionId: effect.action_id,
                eventIndices: effect.event_indices, witnesses: effect.event_indices.flatMap(index =>
                    Array.isArray(events[index]?.witnessed_by) ? events[index].witnessed_by : []),
                result: effect.result,
                text: JSON.stringify({ type: effect.type, payload: effect.payload,
                    result: effect.result }).slice(0, 700) });
        const unique = [...new Map(records.map(record =>
            [`${record.kind}:${record.actionId || ''}:${record.actor || ''}:${record.text}`, record])).values()];
        return { receiptId, location, turn, records: unique };
    }
    const records = [];
    for (const event of draft.receipt.events || []) {
        if (event.status !== 'completed' || !event.evidence) continue;
        records.push({ kind: event.source_type === 'told' ? 'testimony' : 'event',
            actor: event.actor_id, text: String(event.evidence).slice(0, 700) });
    }
    for (const speech of draft.speech || []) records.push({ kind: 'testimony', actor: speech.speaker,
        listeners: speech.listeners, text: String(speech.statement).slice(0, 700) });
    if (draft.receipt.state_updates.ledger_update) records.push({ kind: 'chronicle',
        text: String(draft.receipt.state_updates.ledger_update).slice(0, 700) });
    const unique = [...new Map(records.map(r => [`${r.kind}:${r.actor || ''}:${r.text}`, r])).values()].slice(0, 12);
    return { receiptId, location, turn, records: unique };
}

// Prompt-only projection of the existing lore packet. Keep the full packet for
// authoring/debugging; references here point to the exact narrator facts and
// never alter their audience or the canonical World definition.
function loreForPrompt(packet, currentDescription, authoredDescription) {
    if (!packet || typeof packet !== 'object')
        return { packet, currentDescription: String(currentDescription || '') };
    const projected = { ...packet };
    delete projected.selection; // Retrieval diagnostics are not story context.
    delete projected.npcPlaces; // The same IDs are in each NPC PERSPECTIVE.
    const facts = new Map((packet.narrator || []).filter(fact => fact?.id)
        .map(fact => [fact.id, JSON.stringify(fact)]));
    projected.npcKnowledge = Object.fromEntries(Object.entries(packet.npcKnowledge || {})
        .map(([actor, entries]) => [actor, (Array.isArray(entries) ? entries : []).map(fact =>
            fact?.id && facts.get(fact.id) === JSON.stringify(fact) ? fact.id : fact)]));
    const authored = String(authoredDescription || '');
    const full = String(currentDescription || '');
    const place = (packet.places || []).find(item => item?.id === packet.locationId);
    const description = authored && place?.description === authored && full.startsWith(authored)
        ? full.slice(authored.length).trim() || '(see WORLD LORE current place description)'
        : full;
    return { packet: projected, currentDescription: description };
}

// Exact repeats only. A fuzzy match could erase distinct testimony, a changed
// deadline, or a later correction; those remain in their original sources.
function historySources(ledger = '', archive = '', matrix = '') {
    const key = line => String(line || '').trim().replace(/\r/g, '');
    const seen = new Set(String(ledger || '').split('\n').map(key).filter(Boolean));
    const archiveLines = String(archive || '').split('\n').filter(line => {
        const value = key(line);
        if (!value || seen.has(value)) return false;
        seen.add(value);
        return true;
    });
    const archiveText = archiveLines.join('\n');
    const matrixBlocks = String(matrix || '').split(/(?=\n\n\[MEMORY MATRIX:)/);
    const matrixText = matrixBlocks.map(block => {
        const lines = block.split('\n').filter(line => {
            const match = line.match(/^\[WORLD HISTORY\]:\s*(.*)$/u);
            return !match || !seen.has(key(match[1]));
        });
        const hasRecord = lines.some(line => /^\[(?:WORLD HISTORY|LOCAL MEMORY|RECALLED HISTORY)\]:/u.test(line));
        return hasRecord || !block.includes('[MEMORY MATRIX:') ? lines.join('\n') : '';
    }).filter(Boolean).join('');
    return { archive: archiveText, matrix: matrixText };
}

function sourceLinkedRecall(recall) {
    return recall ? `\n\n[SOURCE-LINKED SCENE MEMORY — past scenes, NOT current state]\n${recall}\nTestimony means somebody said it, not that it is true. Narrative excerpts quote an older scene and may contain dialogue, intentions or uncertainty; they are not new verified state. Current engine state overrides old events. Do not grant recalled knowledge to an unwitnessing NPC.` : '';
}
// Lightweight retrieval only: these keys select source text, never rewrite it
// or infer facts. Prefix matching tolerates common English/German inflections.
const recallStopWords = new Set(('the and that this with from have has had was were what which when where who why how '
    + 'she her him his they their them you your our about again then there here said did does would could should '
    + 'der die das den dem des ein eine einen einer einem und mit von für auf aus bei ist sind war waren hat hatte haben '
    + 'was wer wie wann welche welcher welches sie ihr ihm ihn ihre seiner sein noch damals dort hier über auch sich nicht').split(' '));
function recallTerms(value) {
    return [...new Set((String(value || '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) || [])
        .filter(word => !recallStopWords.has(word))
        .map(word => word.length > 5 ? word.slice(0, 5) : word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word))];
}

function recall(history, query, location, limit = 4500, excludedIds = [], options = {}) {
    const excluded = new Set(excludedIds);
    const terms = recallTerms(options.primaryQuery ?? query).slice(0, 40);
    const contextTerms = recallTerms(`${query} ${options.recentContext || ''}`).slice(0, 100);
    const actors = new Set(options.actorIds || []);
    const candidates = [];
    const matches = (words, keys) => keys.reduce((n, key) => n + (words.has(key) ? 1 : 0), 0);
    for (const [index, message] of history.entries()) {
        const memory = message.sceneMemory || {};
        if (!message.id || excluded.has(message.id)
            || message.stateSource === 'frozen_no_receipt') continue;
        const ranked = (memory.records || []).filter(record => typeof record.text === 'string').map((record, order) => {
            const words = new Set(recallTerms(record.text));
            const score = matches(words, terms) * 10 + Math.min(2, matches(words, contextTerms))
                + (actors.has(record.actor) ? 3 : 0) + (memory.location === location ? 1 : 0);
            return { record, order, score };
        }).filter(item => item.score > 0);
        // Old saves and prose-only details may have no structured memory.
        // Search the selected take's original narration, keeping whole short
        // sentences, provenance and witnesses. This is not a new state fact.
        if (message.role === 'dm' && typeof options.text === 'function') {
            const prose = String(options.text(message) || '')
                .replace(/<(world_turn_receipt|internal_states|details)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
            const passages = prose.match(/[^.!?\n]+(?:[.!?]+|$)/gu) || [];
            const excerpts = passages.map((passage, pi) => ({ passage: passage.trim(), pi,
                score: matches(new Set(recallTerms(passage)), terms) * 10 }))
                .filter(item => item.score > 0 && item.passage.length <= 1000)
                .sort((a, b) => b.score - a.score || a.pi - b.pi);
            const best = excerpts[0];
            if (best && !ranked.some(item => item.record.text.includes(best.passage))) {
                const previous = best.pi > 0 ? passages[best.pi - 1].trim() : '';
                const text = previous && previous.length + best.passage.length < 1000
                    ? `${previous} ${best.passage}` : best.passage;
                ranked.push({ order: Number.MAX_SAFE_INTEGER, score: best.score - 0.5,
                    record: { kind: 'narrative_excerpt', text,
                        witnesses: Array.isArray(message.witnesses) ? message.witnesses : [] } });
            }
        }
        ranked.sort((a, b) => b.score - a.score || a.order - b.order);
        if (ranked.length) candidates.push({ score: ranked[0].score, index, ranked,
            source: { sourceMessageId: message.id, receiptId: memory.receiptId, turn: memory.turn,
                location: memory.location || message.location } });
    }
    let used = 0;
    const selected = [];
    for (const item of candidates.sort((a, b) => b.score - a.score || b.index - a.index)) {
        if (selected.length >= 8) break;
        const records = [];
        for (const candidate of item.ranked.slice(0, 3)) {
            const text = JSON.stringify({ ...item.source, records: [...records, candidate.record] });
            if (used + text.length + (selected.length ? 1 : 0) <= limit) records.push(candidate.record);
        }
        if (!records.length) continue;
        const text = JSON.stringify({ ...item.source, records });
        used += text.length + (selected.length ? 1 : 0);
        selected.push({ index: item.index, text });
    }
    return selected.sort((a,b) => a.index - b.index).map(item => item.text).join('\n');
}
root.HordeWorldTurnContext = { history, sceneMemory, recall, loreForPrompt,
    historySources, sourceLinkedRecall };
if (typeof module !== 'undefined') module.exports = root.HordeWorldTurnContext;
})(globalThis);
