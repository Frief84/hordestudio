const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:43129/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const result = await page.evaluate(() => {
    const world = state.worlds.find(w => (w.entities || []).some(e => e.type === 'npc'));
    if (!world) throw new Error('No built-in NPC world available for UI test');
    state.editingWorld = world;
    const npc = world.entities.find(e => e.type === 'npc');
    const views = {};
    for (const provider of ['none','kokoro','ming']) {
      state.globalSettings.ttsProvider = provider;
      openWorldRecordInspector('entity',npc.id,'persona','people');
      views[provider] = {
        kokoro: !!document.querySelector('.ent-voice-settings') && !document.querySelector('.ent-voice-settings').hidden,
        ming: !!document.querySelector('.ent-ming-settings') && !document.querySelector('.ent-ming-settings').hidden
      };
      closeWorldRecordInspector();
    }
    return views;
  });
  console.log(JSON.stringify(result));
  await browser.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
