/** Optional paid Worlds acceptance test. Read the key from stdin; never store it. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const childProcess = require('node:child_process');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');
const model = 'google/gemma-4-31b-it';
const scenario = process.argv.includes('--lever') ? 'lever' : 'lamp';

async function readKey() {
    if (process.stdin.isTTY) {
        try { childProcess.execFileSync('stty', ['-echo'], { stdio: 'inherit' }); } catch {}
    }
    const input = readline.createInterface({ input: process.stdin, terminal: false });
    const key = await new Promise(resolve => input.once('line', resolve));
    input.close();
    if (process.stdin.isTTY) {
        try { childProcess.execFileSync('stty', ['echo'], { stdio: 'inherit' }); } catch {}
    }
    if (!/^sk-or-v1-[a-z0-9]+$/i.test(key)) throw new Error('Expected an OpenRouter key on stdin.');
    return key;
}

(async () => {
    const key = await readKey();
    const browser = await chromium.launch(launchOptions);
    let calls = 0;
    let conservativeSpendUsd = 0;
    const statuses = [];
    const providerBodies = [];
    try {
        const context = await browser.newContext();
        await context.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.hostname === 'openrouter.ai' && url.pathname === '/api/v1/chat/completions') {
                const body = route.request().postData() || '';
                const request = JSON.parse(body);
                if (request.model !== model) throw new Error('Unexpected model in live test.');
                if (++calls > 10 || body.length > 500_000 || Number(request.max_tokens) > 2000) {
                    throw new Error(`Live-test call/token ceiling reached before another provider request: call=${calls}, bytes=${body.length}, max_tokens=${Number(request.max_tokens) || 0}.`);
                }
                // Very conservative preflight: count one token per character,
                // charge 4x the published input/output prices, and reserve a
                // full max_tokens completion for every call.
                conservativeSpendUsd += 4 * ((body.length * 0.09 + Number(request.max_tokens || 1024) * 0.34) / 1_000_000);
                if (conservativeSpendUsd > (scenario === 'lever' ? 0.5 : 1.0))
                    throw new Error('Live-test budget ceiling reached.');
                const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
                    body
                });
                statuses.push(upstream.status);
                const responseBody = Buffer.from(await upstream.arrayBuffer());
                providerBodies.push(responseBody.toString('utf8').slice(0, 6000));
                return route.fulfill({ status: upstream.status,
                    contentType: upstream.headers.get('content-type') || 'application/json',
                    body: responseBody });
            }
            if (url.hostname !== 'worlds2-live.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
                return route.fulfill({ status: 404, body: '' });
            }
            const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
            return route.fulfill({ contentType: mime, body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        const errors = [];
        const warnings = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => {
            if (['warning', 'error'].includes(message.type()))
                warnings.push(message.text().slice(0, 500));
        });
        await page.goto('https://worlds2-live.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer, { timeout: 30000 });
        const result = await page.evaluate(async ({ liveModel, liveScenario }) => {
            clearInterval(companionAgencyTimer);
            clearInterval(companionAlwaysOnTimer);
            state.globalSettings.apiProvider = 'openrouter';
            state.apiKey = 'live-test-key-in-node-only';
            const lever = liveScenario === 'lever';
            const world = { id: 'live_world_fixture', name: 'Live World Fixture', model: liveModel,
                dmPrompt: lever
                    ? 'A corroded pressure lever controls a steam valve. It is under tension; pulling it may release the valve or scald the operator. Resolve the player action rather than reintroducing the room.'
                    : 'Narrate a grounded scene in two sentences. Use the world-state tool or tagged receipt when needed.',
                intro: '', startLocationId: 'room', maxTokens: 768,
                locations: [{ id: 'room', name: 'Room', description: lever
                    ? 'A cellar with a corroded pressure lever and dangerous steam valve.'
                    : 'A quiet room with a lamp.', exits: [] }],
                entities: [], hudConfig: { showClock: false, showQuests: false, showLedger: true,
                    stats: lever ? [{ id: 'wits', name: 'Wits', value: 4, min: 0, max: 10,
                        roll: { enabled: true, mode: 'direct' } }] : [] },
                gameRules: { profileId: 'adventure', modules: { stats: lever, checks: lever,
                    health: false, conditions: false, inventory: false, equipment: false,
                    commerce: false, quests: false, relationships: false, schedules: false,
                    livingWorld: false }, dice: { resolution: 'automatic', sides: 20,
                    defaultDifficulty: 11, visibility: 'visible' } },
                kernel: { enabled: true, memoryMode: 'ledger', resolveFirst: true } };
            state.worlds = [world];
            state.worldInstances = { live_world_fixture: { sessions: [], activeSessionId: null } };
            state.activeWorldId = world.id;
            const sess = prepareCurrentWorldSession();
            sess.setupComplete = true;
            sess.history.push({ id: 'opening', role: 'dm', text: lever
                ? 'The corroded pressure lever shudders beside the steam valve. It might vent safely, or scald your hand if forced.'
                : 'You enter the room.', location: 'room' });
            switchView('worldPlay');
            renderWorldPlayState();
            document.getElementById('world-user-input').value = lever
                ? 'I grasp the pressure lever and pull it slowly, bracing against the steam. I want to vent the valve without getting burned.'
                : 'I inspect the lamp without touching it.';
            await executeWorldTurn();
            const dm = [...sess.history].reverse().find(message => message.role === 'dm');
            const actionResolution = sess.worldTurnReceipts?.at(-1)?.receipt?.action_resolution || null;
            const savedSession = (await HordeDB.get('worldInstance:live_world_fixture'))
                ?.sessions?.find(item => item.id === sess.id);
            return { lastRole: sess.history.at(-1)?.role, textLength: dm?.text?.length || 0,
                text: String(dm?.text || '').slice(0, 1600), actionResolution,
                stateSource: dm?.stateSource || '', callKinds: dm?.callAudit?.calls?.map(call => call.kind) || [],
                failedAttempts: sess.worldCallDiagnostics?.length || 0,
                persisted: !!savedSession?.history?.at(-1),
                persistedCheckOutcome: savedSession?.checkHistory?.at(-1)?.narrativeOutcome || '',
                receiptCount: sess.worldTurnReceipts?.length || 0,
                checkCount: sess.checkHistory?.length || 0,
                checkResult: sess.checkHistory?.at(-1) || null,
                pendingChecks: sess.pendingChecks?.length || 0,
                presentationFallback: sess.lastTurnAudit?.presentationFallback || '',
                auditRejected: (sess.lastTurnAudit?.rejected || []).map(item => item.reason) };
        }, { liveModel: model, liveScenario: scenario });
        console.log(JSON.stringify({ diagnostic: true, model, scenario, calls, statuses,
            conservativeSpendUsd, errors, warnings, result,
            ...(process.argv.includes('--verbose') ? {
                providerBodies: providerBodies.map(body => body.slice(0, 2500))
            } : {}) }, null, 2));
        assert.equal(errors.length, 0, errors.join('; '));
        assert.equal(result.lastRole, 'dm', 'live World turn should finish with a DM reply');
        assert(result.textLength > 15, 'live World turn should have meaningful prose');
        assert(result.actionResolution?.outcome, 'live receipt must answer the submitted action');
        if (!result.checkCount) assert(result.text.includes(result.actionResolution.outcome),
            'visible prose must include the accepted action outcome');
        if (result.checkResult?.narrativeOutcome)
            assert(result.text.includes(result.checkResult.narrativeOutcome),
                'visible prose must include the engine-selected check consequence');
        assert.notEqual(result.stateSource, 'frozen_no_receipt', 'live action must resolve or report a repair failure');
        if (scenario === 'lever') assert(result.checkCount + result.pendingChecks > 0,
            'the established dangerous lever action must trigger an authoritative check');
        assert(result.persisted, 'live World turn should persist');
        if (result.checkResult?.narrativeOutcome)
            assert.equal(result.persistedCheckOutcome, result.checkResult.narrativeOutcome,
                'selected check consequence must survive persistence');
        assert(result.callKinds.includes('main'), 'live main call should be in turn diagnostics');
        console.log(JSON.stringify({ pass: true, model, scenario, calls, statuses, conservativeSpendUsd,
            result }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => { console.error('Live Worlds acceptance failed:', error.message); process.exitCode = 1; });
