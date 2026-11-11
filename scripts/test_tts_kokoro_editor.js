const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:43129/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const target = await page.evaluate(() => {
    const world = state.worlds.find(w => (w.entities || []).some(e => e.type === 'npc'));
    const npc = world?.entities.find(e => e.type === 'npc');
    if (!npc) throw new Error('No NPC found');
    openWorldStudio(world.id);
    openWorldRecordInspector('entity',npc.id,'persona','people');
    return {worldId:world.id,npcId:npc.id};
  });
  await page.locator('.ent-kokoro-mix-a').selectOption('af_heart');
  await page.locator('.ent-kokoro-mix-b').selectOption('af_sarah');
  await page.locator('.ent-kokoro-mix-weight').fill('60');
  await page.locator('.ent-kokoro-mix-preview').click();
  await page.locator('.ent-kokoro-mix-status').filter({hasText:'Mixture previewed'}).waitFor({timeout:60000});
  await page.locator('.ent-kokoro-mix-assign').click();
  await page.locator('.ent-kokoro-name').fill('Saved mixture test');
  await page.locator('.ent-kokoro-save').click();
  await page.waitForTimeout(1000);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const result = await page.evaluate(({worldId,npcId}) => {
    const world = state.worlds.find(w => w.id === worldId);
    const npc = world?.entities.find(e => e.id === npcId);
    return {formula:npc?.voice_profile?.formula,
      saved:world?.voice_settings?.kokoro_profiles?.some(p => p.name === 'Saved mixture test')};
  }, target);
  console.log(JSON.stringify(result));
  if (result.formula !== 'af_heart:60,af_sarah:40' || !result.saved)
    throw new Error('Kokoro mixture was not retained after reload');
  await browser.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
