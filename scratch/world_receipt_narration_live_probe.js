/* Opt-in local model probe. Reads committed fixture copies; never writes World state. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const narration = require('../worlds/receipt-narration');

const endpoint = process.env.HORDE_NARRATION_OLLAMA || 'http://127.0.0.1:11434';
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname),
    'Only a local Ollama endpoint is permitted');
const model = process.env.HORDE_NARRATION_MODEL || 'qwen2.5:14b-instruct-q4_K_M';

async function main() {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'horde-receipt-narration-'));
    const file = path.join(folder, 'fixtures.json');
    try {
        const audit = spawnSync(process.execPath,
            [path.join(__dirname, 'world_server_binding_browser_audit.js')], {
                encoding: 'utf8', env: { ...process.env, HORDE_NARRATION_CAPTURE: file },
                maxBuffer: 4 * 1024 * 1024, timeout: 120000
            });
        assert.equal(audit.status, 0, audit.stderr || audit.stdout);
        const fixtures = JSON.parse(fs.readFileSync(file, 'utf8')).cases;
        for (const fixture of fixtures) {
            const original = JSON.stringify({ world: fixture.world, session: fixture.session });
            const projected = narration.project(fixture.world, fixture.session);
            assert(projected.ok, JSON.stringify(projected));
            assert.equal(JSON.stringify({ world: fixture.world, session: fixture.session }), original);
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 120000);
            let data;
            const started = performance.now();
            try {
                const response = await fetch(new URL('/api/chat', endpoint), {
                    method: 'POST', signal: controller.signal,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model, stream: false,
                        options: { temperature: 0, seed: 42, num_ctx: 8192, num_predict: 450 },
                        messages: narration.messages(projected) })
                });
                if (!response.ok) throw new Error(`local_model_http_${response.status}`);
                data = await response.json();
            } finally { clearTimeout(timeout); }
            const text = String(data.message?.content || '').trim();
            assert.equal(JSON.stringify({ world: fixture.world, session: fixture.session }), original);
            console.log('NARRATION_AB', JSON.stringify({
                fixture: fixture.name, model, combinedCalls: fixture.combinedCalls,
                extraNarrationCalls: 1, combinedTokens: null,
                extraInputTokens: data.prompt_eval_count ?? null,
                extraOutputTokens: data.eval_count ?? null,
                extraElapsedMs: Math.round(performance.now() - started),
                confirmedActions: projected.input.confirmed.length,
                unconfirmedActions: projected.input.unconfirmed.map(item => item.outcome),
                dialogueExactPreserved: projected.input.dialogue.map(item =>
                    text.includes(item.statement)),
                baseline: fixture.baseline, alternative: text
            }));
        }
    } finally {
        if (fs.existsSync(file)) fs.unlinkSync(file);
        fs.rmdirSync(folder);
    }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
