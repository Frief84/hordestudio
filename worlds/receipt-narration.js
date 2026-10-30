/* Optional, read-only projection for receipt-based narration experiments. */
(function(root) {
'use strict';
const lore = typeof module !== 'undefined' && module.exports
    ? require('../assets/worlds/world-lore') : root.HordeWorldLore;
const clone = value => JSON.parse(JSON.stringify(value));
const freeze = value => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
};
const bad = reason => ({ ok: false, reason });

function project(world, session) {
    const entry = session?.worldTurnReceipts?.at(-1);
    const receipt = entry?.receipt;
    if (!receipt || !Array.isArray(receipt.action_results)
        || !Array.isArray(receipt.confirmed_effects)) return bad('linked_receipt_required');
    if (entry.audit?.world_state_version !== session.worldStateVersion)
        return bad('stale_or_uncommitted_receipt');
    const receiptId = receipt.turn_id || receipt.action_results[0]?.action_id;
    const message = [...(session.history || [])].reverse().find(item => item.role === 'dm'
        && item.sceneMemory?.receiptId === receiptId);
    if (!receiptId || !message) return bad('matching_scene_memory_required');
    const results = new Map(receipt.action_results.map(item => [item.action_id, item.outcome]));
    if (results.size !== receipt.action_results.length
        || (entry.audit.actions || []).some(item => results.get(item.action_id) !== item.outcome))
        return bad('action_results_mismatch');
    const events = receipt.events || [];
    if (!Array.isArray(events) || receipt.confirmed_effects.some(effect =>
        results.get(effect.action_id) !== 'succeeded'
        || !['changed', 'no_change'].includes(effect.result)
        || !Array.isArray(effect.event_indices)
        || effect.event_indices.some(index => !Number.isInteger(index) || index < 0
            || events[index]?.action_id !== effect.action_id))) return bad('effect_trace_mismatch');
    if (events.some(event => event.status === 'completed'
        && results.get(event.action_id) !== 'succeeded')) return bad('event_result_mismatch');
    const passages = Array.isArray(receipt.passages) ? receipt.passages : [];
    const speech = Array.isArray(receipt.speech_attributions) ? receipt.speech_attributions : [];
    if (speech.some(item => (item.speaker !== 'player'
        && !(world.entities || []).some(entity => entity.id === item.speaker))
        || (passages.length && !passages.some(passage =>
            passage.id === item.passage_id && passage.action_id === item.action_id
            && passage.text.includes(item.statement)))))
        return bad('speech_reference_mismatch');
    const speakerByPassage = new Map((receipt.passage_speakers || [])
        .map(item => [item.passage_id, item.speaker_id]));
    if (passages.some(passage => {
        const speakers = [...new Set(speech.filter(item => item.passage_id === passage.id
            && item.statement === passage.text)
            .map(item => item.speaker))];
        return speakerByPassage.has(passage.id)
            && speakerByPassage.get(passage.id) !== (speakers.length === 1 ? speakers[0] : null);
    })) return bad('speaker_evidence_mismatch');
    const memory = message.sceneMemory;
    const confirmedMemory = { ...memory, records: (memory.records || []).filter(record =>
        !record.actionId || results.get(record.actionId) === 'succeeded') };
    const playerIntent = [...(session.history || [])].slice(0,
        session.history.indexOf(message)).reverse().find(item => item.role === 'user')?.text || '';
    const intentExcerpts = new Map((entry.audit.binding?.actionSpans || [])
        .filter(span => Number.isInteger(span.start) && Number.isInteger(span.end)
            && span.start >= 0 && span.end > span.start && span.end <= playerIntent.length)
        .map(span => [span.action_id, playerIntent.slice(span.start, span.end)]));
    const involved = new Set(events.flatMap(event => [event.actor_id,
        ...(event.witnessed_by || [])]).concat(speech.flatMap(item =>
        [item.speaker, ...(item.listeners || [])])));
    const people = (world.entities || []).filter(entity => entity.type === 'npc'
        && (involved.has(entity.id) || (session.entityStates?.[entity.id]?.location
            || entity.startLocation) === session.playerLocation)).map(entity => ({
        id: entity.id, name: entity.name, persona: entity.persona || '',
        description: entity.description || '',
        location: session.entityStates?.[entity.id]?.location || entity.startLocation || null,
        knowledge: (lore?.knowledge(world, entity.id) || []).map(fact => ({
            id: fact.id, text: fact.text, knowledge: fact.knowledge })),
        memories: (session.entityStates?.[entity.id]?.observations || []).map(item => ({
            text: item.text || '', sourceType: item.sourceType || item.source || 'unknown',
            eventId: item.eventId || '', turn: item.turn ?? null,
            visibility: item.visibility || 'private'
        })).filter(item => item.text)
    }));
    const confirmed = receipt.action_results.filter(item => item.outcome === 'succeeded')
        .map(item => ({ action_id: item.action_id,
            intentExcerpt: intentExcerpts.get(item.action_id) || null,
            events: events.filter(event => event.action_id === item.action_id
                && event.status === 'completed'),
            effects: receipt.confirmed_effects.filter(effect => effect.action_id === item.action_id) }));
    const unconfirmed = receipt.action_results.filter(item => item.outcome !== 'succeeded')
        .map(item => ({ ...item, intentExcerpt: intentExcerpts.get(item.action_id) || null }));
    const projection = {
        receiptId, location: receipt.scene?.player_location_id || session.playerLocation,
        confirmed, unconfirmed,
        dialogue: speech.filter(item => results.get(item.action_id) === 'succeeded')
            .map(item => ({ action_id: item.action_id,
            passage_id: item.passage_id, speaker: item.speaker,
            listeners: item.listeners, statement: item.statement })),
        narrativeDetails: passages.map(item => ({ passage_id: item.id,
            action_id: item.action_id, speaker: speakerByPassage.get(item.id) ?? null,
            text: item.text, outcome: results.get(item.action_id) || 'unknown',
            authority: 'style_only' })),
        sceneMemory: confirmedMemory, npcPerspectives: people, playerIntent
    };
    return { ok: true, input: freeze(clone(projection)) };
}

function messages(projection) {
    if (!projection?.ok || !Object.isFrozen(projection.input))
        throw new Error('committed_narration_projection_required');
    const input = projection.input;
    return [{ role: 'system', content: `Describe only this committed World turn. confirmed events and effects are the sole evidence for this turn's world changes; no_change did not change state. failed, blocked, skipped and unresolved actions must not acquire a result. playerIntent states a request, not its outcome. Never add a player action, even a gesture, without a confirmed event. narrativeDetails are style examples, never evidence. npcPerspectives contain background identity and earlier personal knowledge, not actions or properties newly established this turn; do not import their details into an unconfirmed action. Do not infer appearance or species from a name when persona and description are absent. Copy each confirmed dialogue.statement verbatim, preserving its speaker; speaker:null is unknown. Each NPC may speak only from that NPC's own knowledge. Do not invent actions, effects, locations, item properties, commitments or new NPC knowledge. If evidence cannot support a coherent account, describe uncertainty without asserting a result. Output narration only.` },
    { role: 'user', content: JSON.stringify(input) }];
}
const api = { project, messages };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.HordeWorldReceiptNarration = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
