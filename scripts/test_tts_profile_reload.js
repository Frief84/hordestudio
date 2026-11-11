const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:43129/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const expected = await page.evaluate(async () => {
    const world = state.worlds.find(w => (w.entities || []).some(e => e.type === 'npc'));
    if (!world) throw new Error('No NPC world available');
    const npc = world.entities.find(e => e.type === 'npc');
    npc.voice_profile = {engine:'kokoro',formula:'af_heart:50,af_sarah:50',speed:1};
    npc.tts_profiles = {ming:{engine:'ming',name:'Test voice',model:'0.5b',mode:'design',
      description:'A warm voice'}};
    await saveState();
    return {worldId:world.id,npcId:npc.id};
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const result = await page.evaluate(({worldId,npcId}) => {
    const npc = state.worlds.find(w => w.id === worldId)?.entities.find(e => e.id === npcId);
    return {kokoro:npc?.voice_profile?.formula,ming:npc?.tts_profiles?.ming?.description};
  }, expected);
  console.log(JSON.stringify(result));
  if (result.kokoro !== 'af_heart:50,af_sarah:50' || result.ming !== 'A warm voice')
    throw new Error('TTS profiles were not retained after reload');
  await browser.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
