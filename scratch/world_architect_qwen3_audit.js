/** Local Qwen3 structured-output regression without starting a model. */
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildContext } = require('./app_source.js');

const requests = [];
let nextReply = () => ({ choices: [{ finish_reason: 'stop', message: {
    content: '{"operations":[{"type":"add_item","record":{"id":"item_chair","name":"Chair"}}]}'
} }] });
const context = {
    isLocalProvider: () => true,
    sanitizeMessagesForProvider: messages => messages,
    apiBase: () => 'http://localhost:11434/v1',
    authHeaders: () => ({}),
    attributionHeaders: () => ({}),
    HordeWorldModelClient: { json: async ({ body }) => {
        requests.push(body);
        return { response: { ok: true }, data: nextReply() };
    } }
};
buildContext(vm, ['worldArchitectJSON'], context);

(async () => {
    const messages = [{ role: 'user', content: 'Create one item.' }];
    const result = await context.worldArchitectJSON({}, 'qwen3:30b', messages, 3200, 'operations');
    assert.equal(result.operations[0].record.id, 'item_chair');
    assert.equal(requests[0].reasoning_effort, 'none');
    assert.equal(requests[0].max_tokens, 3200);

    requests.length = 0;
    nextReply = () => ({ choices: [{ finish_reason: 'length', message: { content: '{"operations":[' } }] });
    await assert.rejects(
        context.worldArchitectJSON({}, 'qwen3:30b', messages, 200, 'operations'),
        /400-token output limit.*strict repair retry also failed/i
    );
    assert.equal(requests.length, 2);
    assert(requests.every(body => body.reasoning_effort === 'none'));
    assert.equal(requests[1].max_tokens, 400);

    console.log('World Architect Qwen3 structured-output checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
