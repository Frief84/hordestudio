'use strict';
// Rebind captured real Gemma proposals without launching Chrome or changing saves.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const binding = require('../worlds/turn-binding');
for (const file of ['world-chair-a-engine-2026-11-01.json',
    'world-chair-b-engine-2026-11-01.json',
    'world-chair-c-engine-2026-11-01-r5.json']) {
    const [capture] = require(path.join(__dirname, file));
    assert(capture.saved && capture.receipt, file);
    assert.equal(capture.saved.historyLength, capture.live.historyLength, file);
    for (const recorded of capture.bindingResponses) {
        if (recorded.status !== 0) continue;
        const { draft, context, canonical } = JSON.parse(recorded.request);
        const turnId = 'turn_' + crypto.createHash('sha256').update(JSON.stringify([
            context.worldId, context.sessionId, context.version, context.nonce, context.input
        ])).digest('hex').slice(0, 24);
        const replay = binding.bind(draft, { ...context, turnId }, canonical);
        const original = JSON.parse(recorded.response);
        assert.deepEqual(replay, original, file + ': binding replay changed');
    }
    if (capture.id === 'CHAIR_C') {
        assert.equal(capture.saved.entityStates.chair.interactableState, 'upright');
        assert(capture.receipt.receipt.events.some(event => event.type === 'environment'
            && event.action === 'upright'));
        assert(capture.receipt.receipt.events.some(event => event.type === 'activity'
            && event.activity === 'sitting'));
        assert(capture.receipt.receipt.speech_attributions.length >= 2);
    }
    console.log('PASS saved Gemma replay ' + capture.id + ' (' + capture.calls.length
        + ' model calls in original capture)');
}
