const assert = require('node:assert/strict');

global.window = { state: { globalSettings: { ttsProvider: 'ming', mingModel: '0.5b' } } };
let sent;
global.fetch = async (path, options) => {
    sent = { path, body: JSON.parse(options.body) };
    return { ok: true, blob: async () => new Blob(['RIFF']) };
};
require('../virtual_humans/frontend/ming-world-bridge.js');

(async () => {
    const profile = { engine: 'ming', mode: 'design', model: '0.5b' };
    await window.HordeMing.synthesize('World speech', profile, { worldId: 'world-one' });
    assert.equal(sent.path, '/api/tts/ming/synthesize');
    assert.equal(sent.body.worldId, 'world-one');
    await window.HordeMing.synthesize('General preview', profile);
    assert.equal(Object.hasOwn(sent.body, 'worldId'), false);
    console.log('Ming world audio request scope: passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
