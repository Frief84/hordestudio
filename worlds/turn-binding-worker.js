'use strict';
const { createHash } = require('node:crypto');
const { bind } = require('./turn-binding');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
    input += chunk;
    if (input.length > 2 * 1024 * 1024) throw new Error('oversized_turn_binding');
});
process.stdin.on('end', () => {
    try {
        const { draft, context, canonical } = JSON.parse(input);
        if (!context || ['worldId', 'sessionId', 'nonce', 'input'].some(key => typeof context[key] !== 'string')
            || !Number.isInteger(context.version) || context.version < 0 || !Number.isFinite(context.now))
            throw new Error('invalid_turn_binding_context');
        const turnId = 'turn_' + createHash('sha256').update(JSON.stringify([
            context.worldId, context.sessionId, context.version, context.nonce, context.input
        ])).digest('hex').slice(0, 24);
        process.stdout.write(JSON.stringify(bind(draft, { ...context, turnId }, canonical)));
    } catch (error) {
        process.stdout.write(JSON.stringify({ ok: false, errors: [{ reason: 'invalid_turn_binding', detail: error.message }] }));
        process.exitCode = 1;
    }
});
