'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');
(async () => {
 const browser = await chromium.launch(launchOptions);
 try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
   const url = new URL(route.request().url());
   if (url.hostname !== 'living-audit.test') return route.abort();
   const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
   if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({status:404,body:''});
   return route.fulfill({contentType: {'.js':'text/javascript','.html':'text/html','.css':'text/css'}[path.extname(file)] || 'application/octet-stream', body:fs.readFileSync(file)});
  });
  await page.goto('https://living-audit.test/');
  await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
  await page.evaluate(() => { clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer); document.getElementById('modal-overlay').classList.add('hidden'); document.getElementById('create-new-world-btn').click(); });
  await page.locator('.world-studio-tab[data-tab="w-basics"]').click();
  await page.locator('#w-studio-name').fill('Audit isolated world');
  const id = await page.evaluate(async () => { await saveWorld(); return state.editingWorld.id; });
  for (const tab of await page.locator('.world-studio-tab').all()) {
   await tab.click();
   const target = await tab.getAttribute('data-tab');
   assert(await page.locator('#tab-' + target).isVisible(), target);
  }
  await page.screenshot({path:path.join(__dirname,'living-worlds-audit-20261112/editor-desktop.png')});
  await page.reload();
  await page.waitForFunction(id => state.worlds.some(w => w.id === id), id);
  await page.evaluate(id => { clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer); openWorldStudio(id); }, id);
  const result = await page.evaluate(async id => {
   const before = JSON.stringify(state.worlds.find(w => w.id === id));
   const original = saveState;
   document.getElementById('w-studio-name').value = 'Unsaved edit';
   saveState = async () => { throw Error('audit storage failure'); };
   let failed = false;
   try { await saveWorld(); } catch(error) { failed = error.message === 'audit storage failure'; }
   finally { saveState = original; }
   return {failed, unchanged: before === JSON.stringify(state.worlds.find(w => w.id === id)), draft:state.editingWorld.name};
  }, id);
  assert(result.failed);
  assert.equal(result.unchanged, true, 'failed editor save must not publish an unsaved world to the live library');
  assert.equal(result.draft, 'Unsaved edit', 'the edit remains available for retry');
  const newFailure = await page.evaluate(async () => {
   createNewWorld(); const id = state.editingWorld.id; const original = saveState;
   saveState = async () => { throw Error('audit new world failure'); };
   try { await saveWorld(); } catch {} finally { saveState = original; }
   return {absent:!state.worlds.some(w=>w.id===id), draft:state.editingWorld.id===id};
  });
  assert(newFailure.absent && newFailure.draft);
  assert.deepEqual(errors, []);
  console.log('PASS: create, save, reload, edit and failed-save isolation');
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
