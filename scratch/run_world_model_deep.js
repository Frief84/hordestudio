'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const screenDirectory = path.join(__dirname, 'world-model-screening-2026-10-26');
const directory = path.join(__dirname, 'world-model-deep-2026-10-26');
fs.mkdirSync(directory, { recursive: true });
function spent() {
  return [screenDirectory, directory].flatMap(folder => fs.readdirSync(folder)
    .filter(name => name.endsWith('.json'))
    .map(name => JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'))[0]?.calls?.length || 0))
    .reduce((a, b) => a + b, 0);
}
async function run(model, slug, testCase) {
  const label = `${slug}-${testCase}`;
  const target = path.join(directory, `${label}.json`);
  if (fs.existsSync(target)) return;
  // One Ministral T03 request was started, then interrupted during the pause.
  const remaining = 30 - spent() - 1;
  if (remaining <= 0) return;
  const allowed = Math.min(3, remaining);
  const log = fs.createWriteStream(path.join(directory, `${label}.log`));
  console.log(`DEEP ${label} budget=${remaining} limit=${allowed}`);
  const child = spawn(process.execPath, [path.join(__dirname, 'world_linked_ollama_live_audit.js')], {
    cwd: root,
    env: { ...process.env,
      HORDE_BROWSER_EXECUTABLE: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      HORDE_LIVE_MAX_REQUESTS: String(allowed),
      HORDE_LIVE_MODEL: model,
      HORDE_LIVE_CASE: testCase,
      HORDE_LIVE_OUTPUT: target }
  });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
    process.stdout.write(chunk); log.write(chunk);
  });
  const timer = setTimeout(() => child.kill(), 330000);
  const finished = setInterval(() => {
    if (fs.existsSync(target)) child.kill();
  }, 1000);
  const code = await new Promise(resolve => child.on('exit', resolve));
  clearTimeout(timer); clearInterval(finished); log.end();
  if (!fs.existsSync(target)) fs.writeFileSync(target,
    JSON.stringify([{ id: testCase, model, error: 'Harness watchdog after 330 s', calls: [] }], null, 2));
  console.log(`DEEP DONE ${label} exit=${code} spent=${spent()}`);
}
(async () => {
  for (const [model, slug, cases] of [
    ['ministral-3:14b', 'ministral-3', ['T03', 'P42', 'P41']],
    ['qwen2.5:14b-instruct-q4_K_M', 'qwen2.5', ['T03', 'P41', 'P42', 'A3', 'A2']]
  ]) for (const testCase of cases) await run(model, slug, testCase);
})().catch(error => { console.error(error); process.exitCode = 1; });
