// Verify the actual local-model request and scene commit without calling a provider.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');

(async () => {
    const world = JSON.parse(fs.readFileSync(path.join(root,
        'Policy Panic at Bramble and Pike.horde_world'), 'utf8'));
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext();
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname !== 'local-scene-audit.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file))
                return route.fulfill({ status: 404, body: '' });
            return route.fulfill({ body: fs.readFileSync(file),
                contentType: file.endsWith('.js') ? 'text/javascript'
                    : file.endsWith('.html') ? 'text/html' : 'text/css' });
        });
        const page = await context.newPage();
        await page.goto('https://local-scene-audit.test');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
        const result = await page.evaluate(async world => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            world.model = 'fixture/model';
            world.contextSize = 65536;
            world.kernel = { enabled: true, sceneDrafts: true, memoryMode: 'ledger' };
            state.worlds = [world];
            state.worldInstances = { [world.id]: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            state.globalSettings.apiProvider = 'local';
            state.globalSettings.localBaseUrl = 'http://localhost:11434/v1';
            const sess = prepareCurrentWorldSession();
            sess.setupComplete = true;
            sess.playerLocation = 'loc_reception';
            sess.revealedSecrets = [
                ...world.locations.flatMap(location => location.secrets || []),
                ...world.entities.flatMap(entity => entity.secrets || [])
            ].map(secret => secret.label);
            sess.history.push({ id: 'start', role: 'dm', text: 'Gloria waits at reception.',
                location: 'loc_reception' });
            switchView('worldPlay');
            renderWorldPlayState();
            const action = 'Hello.';
            const draft = { protocol: 'scene_draft_v2',
                narrative: [{ id: 'p1', text: 'Gloria smiles in acknowledgement.' }],
                actions: [{ request: action, kind: 'speech', status: 'resolved', response_id: 'p1' }],
                events: [], effects: {}, speech: [], commitments: [] };
            const requests = [];
            window.fetch = async (url, options) => {
                if (!String(url).includes('/chat/completions'))
                    return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
                const body = JSON.parse(options.body);
                requests.push(body);
                const message = { content: JSON.stringify(draft) };
                return new Response(`data: ${JSON.stringify({ choices: [{ delta: message,
                    finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
                { headers: { 'Content-Type': 'text/event-stream' } });
            };
            document.getElementById('world-user-input').value = action;
            await executeWorldTurn();
            return { request: requests[0], calls: requests.length,
                source: sess.lastTurnStateSource, rejected: sess.lastTurnAudit?.rejected || [],
                text: sess.history.at(-1)?.text };
        }, world);
        assert.equal(result.calls, 1, JSON.stringify(result));
        assert.equal(result.request.response_format?.type, 'json_schema');
        assert.equal(result.request.tools, undefined);
        const schema = result.request.response_format.json_schema.schema;
        assert.equal(schema.additionalProperties, false);
        assert.equal(schema.properties.effects.additionalProperties, false);
        assert.equal(schema.properties.events.items.additionalProperties, false);
        assert(!schema.properties.events.items.properties.type.enum.includes('posture'));
        assert.deepEqual(result.rejected, []);
        assert.match(result.text, /Gloria smiles/);
        const secretTurn = await page.evaluate(async () => {
            const sess = getCurrentWorldSession();
            sess.revealedSecrets = [];
            const action = 'Hello again.';
            const draft = { protocol: 'scene_draft_v2',
                narrative: [{ id: 'p1', text: 'Gloria nods at the second greeting.' }],
                actions: [{ request: action, kind: 'speech', status: 'resolved', response_id: 'p1' }],
                events: [], effects: {}, speech: [], commitments: [] };
            let request;
            window.fetch = async (url, options) => {
                if (!String(url).includes('/chat/completions'))
                    return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
                request = JSON.parse(options.body);
                const delta = { tool_calls: [{ id: 'draft', index: 0, type: 'function',
                    function: { name: 'commit_world_turn', arguments: JSON.stringify(draft) } }] };
                return new Response(`data: ${JSON.stringify({ choices: [{ delta,
                    finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`,
                { headers: { 'Content-Type': 'text/event-stream' } });
            };
            document.getElementById('world-user-input').value = action;
            await executeWorldTurn();
            return { request, rejected: sess.lastTurnAudit?.rejected || [] };
        });
        assert.equal(secretTurn.request.response_format, undefined,
            'locked secrets keep the lookup tool available');
        assert(secretTurn.request.tools.some(tool => tool.function.name === 'investigate_secret'));
        assert.deepEqual(secretTurn.rejected, []);
        const repairedSecretTurn = await page.evaluate(async () => {
            const sess = getCurrentWorldSession();
            const action = 'Hello, Gloria.';
            const narrative = [{ id: 'p1', text: 'Gloria leans toward the desk.' }];
            const base = { protocol: 'scene_draft_v2', narrative,
                actions: [{ request: action, kind: 'speech', status: 'resolved', response_id: 'p1' }],
                effects: {}, speech: [], commitments: [] };
            const bad = { ...base, events: [{ type: 'posture', actor_id: 'npc_gloria',
                status: 'completed', passage_id: 'p1' }] };
            const fixed = { ...base, events: [{ type: 'activity', actor_id: 'npc_gloria',
                status: 'completed', activity: 'leaning toward the desk', passage_id: 'p1' }] };
            const requests = [];
            window.fetch = async (url, options) => {
                if (!String(url).includes('/chat/completions'))
                    return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
                const body = JSON.parse(options.body);
                requests.push(body);
                if (!body.stream) return new Response(JSON.stringify({ choices: [
                    { message: { content: JSON.stringify(fixed) } }
                ] }), { headers: { 'Content-Type': 'application/json' } });
                const delta = { tool_calls: [{ id: 'draft', index: 0, type: 'function',
                    function: { name: 'commit_world_turn', arguments: JSON.stringify(bad) } }] };
                return new Response(`data: ${JSON.stringify({ choices: [{ delta,
                    finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`,
                { headers: { 'Content-Type': 'text/event-stream' } });
            };
            document.getElementById('world-user-input').value = action;
            await executeWorldTurn();
            return { requests, rejected: sess.lastTurnAudit?.rejected || [],
                source: sess.lastTurnStateSource };
        });
        assert.equal(repairedSecretTurn.requests.length, 2, JSON.stringify(repairedSecretTurn));
        assert.equal(repairedSecretTurn.requests[1].response_format?.type, 'json_schema',
            'a local repair after a gated-secret tool turn must use constrained output');
        assert.equal(repairedSecretTurn.requests[1].tools, undefined);
        assert.deepEqual(repairedSecretTurn.rejected, []);
        const partialTurn = await page.evaluate(async () => {
            const sess = getCurrentWorldSession();
            const action = 'I greet Gloria and knock on the desk.';
            const draft = { protocol: 'scene_draft_v2',
                narrative: [{ id: 'p1', text: 'Gloria returns your greeting.' }],
                actions: [{ request: 'I greet Gloria', kind: 'speech', status: 'resolved', response_id: 'p1' }],
                events: [], effects: {}, speech: [], commitments: [] };
            window.fetch = async (url, options) => {
                if (!String(url).includes('/chat/completions'))
                    return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
                const body = JSON.parse(options.body);
                const delta = body.tools
                    ? { tool_calls: [{ id: 'draft', index: 0, type: 'function',
                        function: { name: 'commit_world_turn', arguments: JSON.stringify(draft) } }] }
                    : { content: JSON.stringify(draft) };
                return new Response(`data: ${JSON.stringify({ choices: [{ delta,
                    finish_reason: body.tools ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
                { headers: { 'Content-Type': 'text/event-stream' } });
            };
            document.getElementById('world-user-input').value = action;
            await executeWorldTurn();
            return { text: sess.history.at(-1)?.text, audit: sess.lastTurnAudit };
        });
        assert.deepEqual(partialTurn.audit?.rejected || [], []);
        assert.match(partialTurn.audit?.unaddressed_player_request || '', /knock on the desk/);
        assert.match(partialTurn.text, /Action note:.*knock on the desk/);
        console.log('PASS local scene uses a closed JSON schema and commits a valid draft');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
