const { chromium } = require('playwright');

function wav() {
  const samples = 8000;
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(data.length - 8, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(8000, 24);
  data.writeUInt32LE(16000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(samples * 2, 40);
  return data;
}

(async () => {
  const browser = await chromium.launch({headless:true,
    executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args:['--autoplay-policy=no-user-gesture-required']});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/v1/models', route => route.fulfill({status:200,
    headers:{'access-control-allow-origin':'*'},contentType:'application/json',
    body:JSON.stringify({data:[{id:'test-local-model'}]})}));
  await page.route('**/v1/audio/speech', async route => {
    const body = route.request().postDataJSON();
    if (body.model !== 'test-local-model' || body.voice !== 'test-local-voice')
      throw new Error('Unexpected speech request: ' + JSON.stringify(body));
    await route.fulfill({status:200,headers:{'access-control-allow-origin':'*'},
      contentType:'audio/wav',body:wav()});
  });
  await page.goto('http://127.0.0.1:43129/',{waitUntil:'domcontentloaded'});
  await page.locator('#tts-provider').waitFor();
  await page.locator('#tts-provider').selectOption('local');
  await page.waitForTimeout(500);
  if (await page.locator('#local-provider-tts-settings').evaluate(el => el.hidden))
    throw new Error('Local settings are hidden');
  if (!await page.locator('#kokoro-provider-settings').evaluate(el => el.hidden) ||
      !await page.locator('#ming-provider-settings').evaluate(el => el.hidden))
    throw new Error('Another provider is visible');
  if (await page.locator('#local-tts-settings-title').count())
    throw new Error('Duplicate local TTS card remains');
  await page.locator('#test-local-tts-btn').click();
  await page.locator('#local-tts-result').filter({hasText:'1 models visible'}).waitFor();
  const target = await page.evaluate(() => {
    const world = state.worlds.find(w => (w.entities || []).some(e => e.type === 'npc'));
    const npc = world.entities.find(e => e.type === 'npc');
    openWorldStudio(world.id);
    openWorldRecordInspector('entity',npc.id,'persona','people');
    return {worldId:world.id,npcId:npc.id};
  });
  await page.locator('.ent-local-name').fill('Local editor test');
  await page.locator('.ent-local-model').fill('test-local-model');
  await page.locator('.ent-local-voice').fill('test-local-voice');
  await page.locator('.ent-local-preview').click();
  await page.locator('.ent-local-status').filter({hasText:'Preview ready'}).waitFor();
  await page.locator('.ent-local-save').click();
  await page.locator('.ent-local-status').filter({hasText:'saved and assigned'}).waitFor();
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1200);
  const profile = await page.evaluate(({worldId,npcId}) =>
    state.worlds.find(w => w.id === worldId)?.entities.find(e => e.id === npcId)?.tts_profiles?.local,
    target);
  if (profile?.model !== 'test-local-model' || profile?.voice !== 'test-local-voice')
    throw new Error('Local NPC voice was not retained after reload');
  await page.locator('#tts-provider').selectOption('kokoro');
  if (errors.length) throw new Error(errors.join('; '));
  console.log('Local provider settings, connection, NPC preview and save/reload passed');
  await browser.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
