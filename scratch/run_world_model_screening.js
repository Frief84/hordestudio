'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const directory = path.join(__dirname, 'world-model-screening-2026-10-26');
fs.mkdirSync(directory, { recursive: true });
const models = [
  ['gemma4:31b-it-q4_K_M', 'gemma4'],
  ['gpt-oss:20b', 'gpt-oss'],
  ['ministral-3:14b', 'ministral-3'],
  ['jaahas/qwen3.5-uncensored:27b', 'qwen3.5'],
  ['mistral-small3.2:24b', 'mistral-small3.2'],
  ['qwen2.5:14b-instruct-q4_K_M', 'qwen2.5'],
  ['qwen3:30b', 'qwen3']
];
async function run(model, slug, testCase) {
  const label = `${slug}-${testCase}`;
  const target = path.join(directory, `${label}.json`);
  if (fs.existsSync(target)) return;
  const log = fs.createWriteStream(path.join(directory, `${label}.log`));
  console.log(`SCREENING ${label}`);
  const child = spawn(process.execPath, [path.join(__dirname, 'world_linked_ollama_live_audit.js')], {
    cwd: root,
    env: { ...process.env,
      HORDE_BROWSER_EXECUTABLE: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      HORDE_LIVE_MAX_REQUESTS: '1',
      HORDE_LIVE_REQUEST_TIMEOUT_MS: '150000',
      HORDE_LIVE_MAX_OUTPUT_TOKENS: '2048',
      HORDE_LIVE_MODEL: model,
      HORDE_LIVE_CASE: testCase,
      HORDE_LIVE_OUTPUT: target }
  });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
    process.stdout.write(chunk);
    log.write(chunk);
  });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, 175000);
  const finished = setInterval(() => {
    if (fs.existsSync(target)) child.kill();
  }, 1000);
  const code = await new Promise(resolve => child.on('exit', resolve));
  clearTimeout(timer);
  clearInterval(finished);
  log.end();
  if (timedOut && !fs.existsSync(target)) fs.writeFileSync(target,
    JSON.stringify([{ id: testCase, model, error: 'Harness process timeout after 175 s', calls: [] }], null, 2));
  console.log(`SCREENING DONE ${label} exit=${code} watchdog=${timedOut}`);
}
(async () => {
  for (const [model, slug] of models) {
    await run(model, slug, 'T03');
    const firstPath = path.join(directory, `${slug}-T03.json`);
    const first = JSON.parse(fs.readFileSync(firstPath, 'utf8'))[0];
    const firstTimedOut = String(first.error || '').includes('TimeoutError')
      || String(first.error || '').includes('Harness process timeout');
    if (firstTimedOut) {
      console.log(`SCREENING SKIP ${slug}-P42: T03 exceeded the screening time limit`);
      continue;
    }
    await run(model, slug, 'P42');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
