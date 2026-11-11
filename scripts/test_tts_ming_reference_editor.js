const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:43129/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.locator('#tts-provider').selectOption('ming');
  await page.waitForTimeout(300);
  const target = await page.evaluate(() => {
    const world = state.worlds.find(w => (w.entities || []).some(e => e.type === 'npc'));
    const npc = world?.entities.find(e => e.type === 'npc');
    if (!npc) throw new Error('No NPC found');
    openWorldStudio(world.id);
    openWorldRecordInspector('entity',npc.id,'persona','people');
    return {worldId:world.id,npcId:npc.id};
  });
  await page.locator('.ent-ming-name').fill('Reference editor test');
  await page.locator('.ent-ming-mode').selectOption('reference');
  await page.locator('.ent-ming-file').setInputFiles(path.resolve('scratch/tts-kokoro-smoke.wav'));
  await page.locator('.ent-ming-transcript').fill('Hello from Horde Studio.');
  await page.locator('.ent-ming-test').fill('Hello from Horde Studio.');
  await page.locator('.ent-ming-preview').click();
  await page.locator('.ent-ming-status').filter({hasText:'Preview ready'}).waitFor({timeout:240000});
  await page.locator('.ent-ming-save').click();
  await page.locator('.ent-ming-status').filter({hasText:'saved and assigned'}).waitFor({timeout:30000});
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const result = await page.evaluate(({worldId,npcId}) => {
    const npc = state.worlds.find(w => w.id === worldId)?.entities.find(e => e.id === npcId);
    return {mode:npc?.tts_profiles?.ming?.mode,referenceId:npc?.tts_profiles?.ming?.referenceId};
  }, target);
  console.log(JSON.stringify(result));
  if (result.mode !== 'reference' || !result.referenceId)
    throw new Error('Ming reference voice was not retained');
  await page.locator('#tts-provider').selectOption('kokoro');
  await browser.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
