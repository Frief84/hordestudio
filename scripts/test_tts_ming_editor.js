const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  page.on('pageerror', error => console.error('page error', error.message));
  await page.goto('http://127.0.0.1:43129/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.locator('#tts-provider').selectOption('ming');
  await page.waitForTimeout(300);
  console.log('selected Ming');
  const target = await page.evaluate(() => {
    const world = state.worlds.find(w => (w.entities || []).some(e => e.type === 'npc'));
    const npc = world?.entities.find(e => e.type === 'npc');
    if (!npc) throw new Error('No NPC found');
    openWorldStudio(world.id);
    openWorldRecordInspector('entity',npc.id,'persona','people');
    return {worldId:world.id,npcId:npc.id};
  });
  console.log('opened NPC editor');
  await page.locator('.ent-ming-name').fill('Editor test voice');
  await page.locator('.ent-ming-description').fill('A calm, clear female voice.');
  await page.locator('.ent-ming-test').fill('Hello from Horde Studio.');
  console.log('filled profile');
  await page.locator('.ent-ming-preview').click();
  console.log('clicked preview', await page.locator('.ent-ming-status').textContent());
  await page.locator('.ent-ming-status').filter({hasText:'Preview ready'}).waitFor({timeout:240000});
  await page.locator('.ent-ming-save').click();
  await page.locator('.ent-ming-status').filter({hasText:'saved and assigned'}).waitFor({timeout:30000});
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const result = await page.evaluate(({worldId,npcId}) => {
    const npc = state.worlds.find(w => w.id === worldId)?.entities.find(e => e.id === npcId);
    return {name:npc?.tts_profiles?.ming?.name,mode:npc?.tts_profiles?.ming?.mode};
  }, target);
  console.log(JSON.stringify(result));
  if (result.name !== 'Editor test voice' || result.mode !== 'design')
    throw new Error('Ming editor profile was not saved and reloaded');
  await page.locator('#tts-provider').selectOption('kokoro');
  await browser.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
