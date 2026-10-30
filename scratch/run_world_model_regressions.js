'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const names = [
  'world_general_turn_matrix_audit.js',
  'world_server_binding_audit.js',
  'world_p43e_speaker_receipt_audit.js',
  'world_p43e_vault_turn_audit.js',
  'world_p43d_action_reliability_audit.js',
  'world_linked_execution_audit.js',
  'world_linked_hardening_audit.js',
  'world_action_path_parity_audit.js',
  'world_turn_transaction_audit.js',
  'world_working_state_audit.js',
  'world_p41_universal_checks_audit.js',
  'world_p42_resource_cost_audit.js',
  'world_model_client_audit.js',
  'world_npc_goal_actions_audit.js',
  'world_npc_goal_decision_audit.js',
  'world_npc_goal_priority_audit.js',
  'world_npc_goal_progress_audit.js',
  'world_perception_audit.js',
  'world_knowledge_share_audit.js',
  'world_server_binding_browser_audit.js',
  'world_p42_resource_cost_browser_audit.js',
  'world_p41_linked_turn_browser_audit.js',
  'world_npc_goal_tick_browser_audit.js',
  'world_perception_browser_audit.js',
  'world_knowledge_share_persistence_browser_audit.js',
  'worlds2_atomic_turn_persistence_browser_audit.js',
  'worlds2_startup_recovery_browser_audit.js',
  'worlds2_hosted_turn_deadline_browser_audit.js'
];
async function run(name) {
  const child = spawn(process.execPath, [path.join(__dirname, name)], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env,
      HORDE_BROWSER_EXECUTABLE: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' }
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
    output = (output + chunk).slice(-5000);
  });
  let timeout = false;
  const timer = setTimeout(() => { timeout = true; child.kill(); },
    Number(process.env.HORDE_REGRESSION_TIMEOUT_MS || 120000));
  const code = await new Promise(resolve => child.on('exit', resolve));
  clearTimeout(timer);
  const result = { name, code, timeout, tail: output.trim().split(/\r?\n/).slice(-8).join('\n') };
  console.log(`${name}: ${timeout ? 'TIMEOUT' : code === 0 ? 'PASS' : 'FAIL'}`);
  return result;
}
(async () => {
  const results = [];
  for (const name of names) results.push(await run(name));
  fs.writeFileSync(process.env.HORDE_REGRESSION_OUTPUT
    ? path.resolve(process.env.HORDE_REGRESSION_OUTPUT)
    : path.join(__dirname, 'world-model-regressions-2026-10-26.json'),
    JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
