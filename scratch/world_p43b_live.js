/** P4.3b real-model turns in disposable browser profiles, with one hard ledger. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');
const out = path.join(__dirname, 'world-model-p43b-2026-10-27');
const source = JSON.parse(fs.readFileSync(path.join(out, 'The_Submission_Vault_source.horde_world'), 'utf8'));
const ledgerPath = path.join(out, 'request-ledger.json');
const maxRequests = 60;
const scenarios = {
  A1: 'I take Linda to the Round Room and open it with the Cell Key.',
  A2: 'I ask Linda to come with me. If she agrees, I unlock the Round Room door with the Cell key, open it and walk inside with her.',
  B_unlock: 'I unlock the Round Room door with the Cell key, but stay in the Antechamber.',
  B_unlock_after: 'I unlock the Round Room door with the Cell key, but stay in the Antechamber.',
  B_clear_open: 'I unlock the door to the Round Room with the Cell key.',
  B_no_key: 'I unlock the Round Room door without a key.',
  B_no_key_actual: 'I unlock the Round Room door.',
  B_wrong_key: 'I unlock the Round Room door with a brass key.',
  B_wrong_key_after: 'I unlock the Round Room door with a brass key.',
  B_enter_locked: 'I walk through the locked Round Room door without opening it.',
  C_linda_go: 'I ask Linda to go to the Round Room on her own. She may refuse.',
  C_linda_item: 'I ask Linda to hold the Cell key for me.',
  D_speech: 'I ask Linda whether she will come to the Round Room with me.',
  D_silent: 'I ask Linda a question and wait quietly for her answer.',
  E_remote_knowledge: 'I ask Linda what Alexis knows about our conversation here in the Antechamber.',
  F_inventory: 'I check whether I have the Cell key in my inventory.',
  G_check_success: 'I examine the locked mechanism in the Antechamber.',
  G_check_failure: 'I examine the locked mechanism in the Antechamber.',
  G_check_no_resource: 'I examine the locked mechanism in the Antechamber.',
  H_session: 'I ask Linda how she feels about going to the Round Room.',
  H_dialogue: 'I greet Linda.'
};
const scenario = process.argv[2] || 'A1';
const model = process.argv[3] || 'qwen2.5:14b-instruct-q4_K_M';
if (!scenarios[scenario]) throw Error(`Unknown scenario: ${scenario}`);
if (!['gemma4:31b-it-q4_K_M', 'qwen2.5:14b-instruct-q4_K_M'].includes(model))
  throw Error(`Model outside approved scope: ${model}`);
const slug = model.startsWith('gemma4') ? 'gemma4' : 'qwen2.5';
const resultPath = path.join(out, `${slug}-${scenario}.json`);
if (fs.existsSync(resultPath)) throw Error(`Result already exists: ${resultPath}`);
const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath)) : { limit: maxRequests, calls: [] };
if (ledger.calls.length >= maxRequests) throw Error('Approved model request budget exhausted');
const saveLedger = () => fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
saveLedger();
function snapshot(world, session) {
  return { worldId: world.id, sessionId: session.id, playerLocation: session.playerLocation,
    inventory: structuredClone(session.inventory), playerStats: structuredClone(session.playerStats),
    unlockedExits: structuredClone(session.unlockedExits || {}),
    entityStates: structuredClone(session.entityStates), locationStates: structuredClone(session.locationStates),
    historyLength: session.history.length, turnEventsLength: session.turnEvents.length,
    receiptsLength: session.worldTurnReceipts.length, turnCount: session.turnCount };
}
function serve(context, calls, getTurnIndex) {
  return context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/worlds/bind-turn') {
      const headers = { 'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      const result = spawnSync(process.execPath, [path.join(root, 'worlds/turn-binding-worker.js')],
        { input: request.postData(), encoding: 'utf8' });
      return route.fulfill({ status: 200, contentType: 'application/json', headers, body: result.stdout });
    }
    if (url.pathname === '/v1/chat/completions') {
      const turnIndex = getTurnIndex();
      if (ledger.calls.length >= maxRequests
          || calls.filter(call => call.turnIndex === turnIndex).length >= 3)
        return route.fulfill({ status: 429, contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' }, body: '{"error":"P4.3b request cap reached"}' });
      const body = JSON.parse(request.postData());
      body.max_tokens = Math.min(Number(body.max_tokens || 8192), 8192);
      const entry = { id: ledger.calls.length + 1, scenario, turnIndex, model, startedAt: new Date().toISOString(),
        request: body, status: 'started' };
      ledger.calls.push(entry);
      calls.push(entry);
      saveLedger(); // Count before connecting, including timeout and process abort.
      console.log(`MODEL_REQUEST ${entry.id} ${scenario} ${model}`);
      try {
        const response = await fetch('http://127.0.0.1:11434/v1/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          signal: AbortSignal.timeout(150000) });
        const responseText = await response.text();
        entry.status = response.status;
        entry.response = responseText;
        entry.durationMs = Date.now() - Date.parse(entry.startedAt);
        saveLedger();
        return route.fulfill({ status: response.status,
          contentType: response.headers.get('content-type') || 'application/json',
          headers: { 'access-control-allow-origin': '*' }, body: responseText });
      } catch (error) {
        entry.status = 'error'; entry.error = String(error);
        entry.durationMs = Date.now() - Date.parse(entry.startedAt);
        saveLedger();
        return route.fulfill({ status: 502, contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: String(error) }) });
      }
    }
    if (url.hostname !== 'p43b-live.test') return route.abort();
    const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
      return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: { '.html': 'text/html', '.js': 'text/javascript',
      '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
}
(async () => {
  const started = Date.now();
  const browser = await chromium.launch(launchOptions);
  try {
    const context = await browser.newContext();
    const calls = [];
    let turnIndex = 0;
    await serve(context, calls, () => turnIndex);
    const page = await context.newPage();
    await page.exposeFunction('p43bSetTurnIndex', index => { turnIndex = index; });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto('https://p43b-live.test/');
    await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
    const result = await page.evaluate(async ({ source, scenario, input, model }) => {
      clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer);
      await Promise.all([saveStateInFlight, worldSaveInFlight].filter(Boolean));
      const world = validateWorldData(source);
      world.id = `p43b_${scenario}_${Date.now()}`;
      normalizeAuthoredWorld(world);
      if (scenario.startsWith('G_check_')) {
        world.hudConfig.stats.push({ id: 'focus', name: 'Focus', value: 9, min: 0, max: 20 },
          { id: 'energy', name: 'Energy', value: 5, min: 0, max: 20 });
        world.locations.find(item => item.id === 'loc_antechamber').description +=
          ' A neutral locked mechanism is mounted beside the table.';
        world.gameRules.universalChecks = { enabled: true, rules: [{ id: 'p43b_mechanism',
          name: 'Examine locked mechanism', match: { kind: 'physical', requestIncludes: 'mechanism' },
          values: [{ subject: 'actor', source: 'stat', key: 'focus' }], difficulty: 7,
          results: [
            { id: 'pass', kind: 'success', minMargin: 0, effects: [],
              costs: [{ resourceId: 'energy', amount: 2 }] },
            { id: 'fail', kind: 'failure', minMargin: -100, effects: [],
              costs: [{ resourceId: 'energy', amount: 1 }] }
          ] }] };
      }
      world.model = model;
      state.worlds = [world];
      state.worldInstances = { [world.id]: { sessions: [{ id: `p43b_${scenario}`, name: 'Isolated Master' }],
        activeSessionId: `p43b_${scenario}` } };
      state.activeWorldId = world.id;
      state.apiKey = 'offline'; state.globalSettings.apiProvider = 'local';
      state.globalSettings.localBaseUrl = 'http://127.0.0.1:11434/v1';
      const sess = state.worldInstances[world.id].sessions[0];
      resetWorldTimeline(world, sess);
      prepareCurrentWorldSession();
      applyStartingLifeToSession(world, sess, world.startingLives.find(life => life.name === 'Master').id);
      if (scenario === 'B_no_key_actual') sess.inventory = sess.inventory.filter(item =>
        String(item?.name || item).toLowerCase() !== 'cell key');
      if (scenario === 'G_check_failure') sess.playerStats.focus = 3;
      if (scenario === 'G_check_no_resource') sess.playerStats.energy = 0;
      sess.setupComplete = true;
      await saveWorldsState();
      switchView('worldPlay'); renderWorldPlayState();
      const before = { playerLocation: sess.playerLocation, inventory: structuredClone(sess.inventory),
        playerStats: structuredClone(sess.playerStats), unlockedExits: structuredClone(sess.unlockedExits || {}),
        entityStates: structuredClone(sess.entityStates), locationStates: structuredClone(sess.locationStates),
        historyLength: sess.history.length, turnEventsLength: sess.turnEvents.length,
        receiptsLength: sess.worldTurnReceipts.length, turnCount: sess.turnCount };
      const inputs = scenario === 'H_session' ? [
        'I ask Linda how she feels about going to the Round Room.',
        'I check whether I have the Cell key in my inventory.',
        'I unlock the Round Room door with the Cell key.',
        'I ask Linda to come with me.',
        'I walk through the Round Room door.'
      ] : scenario === 'H_dialogue' ? [
        'I greet Linda.', 'I ask Linda what she wants.', 'I thank Linda.'
      ] : [input];
      const steps = [];
      const turnStarted = performance.now();
      for (let index = 0; index < inputs.length; index++) {
        await window.p43bSetTurnIndex(index + 1);
        document.getElementById('world-user-input').value = inputs[index];
        const stepStarted = performance.now();
        await executeWorldTurn();
        const current = getCurrentWorldSession();
        const error = document.getElementById('world-turn-error-text')?.textContent || '';
        steps.push({ input: inputs[index], durationMs: Math.round(performance.now() - stepStarted),
          error, location: current.playerLocation,
          inventory: structuredClone(current.inventory),
          unlockedExits: structuredClone(current.unlockedExits || {}),
          receipt: structuredClone(current.worldTurnReceipts?.at(-1) || null),
          narrative: current.history.at(-1)?.text || '',
          historyLength: current.history.length });
        if (error || scenario === 'H_session' && index === 2
            && current.unlockedExits?.['door:loc_antechamber::loc_round_room'] !== true) break;
      }
      const active = getCurrentWorldSession();
      const saved = (await HordeDB.get(`worldInstance:${world.id}`))?.sessions?.find(item => item.id === active.id);
      if (scenario.startsWith('H_') && saved) {
        state.worldInstances[world.id].sessions = [structuredClone(saved)];
        state.worldInstances[world.id].activeSessionId = saved.id;
        prepareCurrentWorldSession();
      }
      return { before, durationMs: Math.round(performance.now() - turnStarted),
        error: document.getElementById('world-turn-error-text')?.textContent || '',
        audit: active.lastTurnAudit, receipt: active.worldTurnReceipts?.at(-1),
        callAudit: [...active.history].reverse().find(item => item.role === 'dm')?.callAudit,
        narrative: active.history.at(-1)?.text,
        steps, history: active.history.slice(-3), turnEvents: active.turnEvents.slice(-30),
        live: { playerLocation: active.playerLocation, inventory: active.inventory,
          playerStats: active.playerStats, unlockedExits: active.unlockedExits || {},
          entityStates: active.entityStates, locationStates: active.locationStates,
          historyLength: active.history.length, turnEventsLength: active.turnEvents.length,
          receiptsLength: active.worldTurnReceipts.length, turnCount: active.turnCount },
        saved: saved && { playerLocation: saved.playerLocation, inventory: saved.inventory,
          playerStats: saved.playerStats, unlockedExits: saved.unlockedExits || {},
          entityStates: saved.entityStates, locationStates: saved.locationStates,
          historyLength: saved.history.length, turnEventsLength: saved.turnEvents.length,
          receiptsLength: saved.worldTurnReceipts.length, turnCount: saved.turnCount },
        reloaded: scenario.startsWith('H_') ? { playerLocation: getCurrentWorldSession().playerLocation,
          inventory: getCurrentWorldSession().inventory,
          unlockedExits: getCurrentWorldSession().unlockedExits || {},
          historyLength: getCurrentWorldSession().history.length } : null };
    }, { source, scenario, input: scenarios[scenario], model });
    const record = { scenario, input: scenarios[scenario], model, totalDurationMs: Date.now() - started,
      ...result, requestIds: calls.map(call => call.id), pageErrors };
    fs.writeFileSync(resultPath, JSON.stringify(record, null, 2));
    console.log(JSON.stringify({ scenario, model, calls: calls.length, requestIds: record.requestIds,
      durationMs: result.durationMs, error: result.error, accepted: result.audit?.accepted,
      rejected: result.audit?.rejected?.map(item => item.reason),
      before: { place: result.before.playerLocation, inventory: result.before.inventory },
      live: { place: result.live.playerLocation, inventory: result.live.inventory,
        unlockedExits: result.live.unlockedExits, receipts: result.live.receiptsLength },
      savedMatches: JSON.stringify(result.live) === JSON.stringify(result.saved), pageErrors }, null, 2));
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
