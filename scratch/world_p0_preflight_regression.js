'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const resolved = require('../worlds/resolved-intent');
const scene = require('../worlds/scene-draft');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

assert(source.includes('const interpretWorldAction = async input =>'),
    'free-form actions must enter through the generic ResolvedIntent model contract');
assert(source.includes('buildWorldResolvedIntentDraft(canonicalWorld'),
    'validated intents must compile through the existing linked World executor');
assert(source.includes('buildWorldResolvedIntentFailureDraft(input, canonicalWorld,'),
    'an invalid/unavailable interpretation must become a safe engine clarification');
assert(source.includes('const failClosed = reason =>')
    && source.includes("if (!response.ok) return failClosed(`model_http_${response.status}`)")
    && source.includes("return failClosed(error?.code || error?.message || 'intent_model_error')"),
    'model and transport failures must not fall into the large V3 receipt/retry path');
assert(/status: 'needs_clarification',[\s\S]*?action_effects: \{\}/.test(source),
    'safe intent fallback must have no world effects');
assert(source.includes('resolvedIntentDraft || buildWorldDeterministicMoveDraft')
    && source.includes('!resolvedIntentSafeFallback) confirmedNarrative = await narrateResolvedIntent'),
    'the clarification path must skip the main model receipt and narration calls');
assert(!source.includes('resolveWorldTurnIntentP0('),
    'natural-language turns must not depend on a phrase-specific movement resolver');
assert(!source.includes('resolveWorldMoveSpeechIntentP0('),
    'compound interpretation must not depend on a phrase-specific move/speech resolver');
assert(!source.includes('worldCompoundMoveSpeechHint('),
    'the prompt must not add sentence-specific movement hints');

const refs = ['player', 'kitchen', 'hall', 'garden', 'brass_key', 'door_hall', 'mara']
    .map(id => ({ id, ...(id === 'brass_key' ? { type: 'item' } : {}) }));
const examples = [
    ['I pick up the brass key, go through the hall door, then tell Mara “Ready.”', [
        { source_quote: 'I pick up the brass key', kind: 'transfer', operation: 'take', item_id: 'brass_key' },
        { source_quote: 'go through the hall door', kind: 'travel', destination_id: 'hall' },
        { source_quote: 'then tell Mara “Ready.”', kind: 'speech', utterance: 'Ready.' }
    ]],
    ['Geh in den Garten, warte 10 Minuten und winke Mara zu.', [
        { source_quote: 'Geh in den Garten', kind: 'travel', destination_id: 'garden' },
        { source_quote: 'warte 10 Minuten', kind: 'wait', minutes: 10 },
        { source_quote: 'und winke Mara zu', kind: 'gesture' }
    ]],
    ['I am already in the hall; ask Mara about the storm.', [
        { source_quote: 'I am already in the hall', kind: 'travel', destination_id: 'hall' },
        { source_quote: 'ask Mara about the storm', kind: 'question', utterance: 'ask Mara about the storm' }
    ]]
];
for (const [input, steps] of examples) {
    const result = resolved.validate({ protocol: 'resolved_intent_v1', steps }, { input, references: refs });
    assert(result.ok, JSON.stringify(result.errors));
    assert(scene.playerRequestCoverage(input,
        result.intent.steps.map(step => ({ request: step.source_quote }))).ok);
}
console.log('P0 generic intent contract, formulation variants, and no-phrase-special-case guards passed');
