const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:43129/', { waitUntil: 'domcontentloaded' });
  await page.locator('#tts-provider').waitFor();
  await page.waitForTimeout(1500);
  console.log('initial', await page.locator('#tts-provider').inputValue());
  await page.locator('#tts-provider').selectOption('none');
  await page.waitForTimeout(500);
  console.log('none', await page.locator('#kokoro-provider-settings').evaluate(el => el.hidden),
    await page.locator('#ming-provider-settings').evaluate(el => el.hidden));
  await page.locator('#tts-provider').selectOption('ming');
  await page.waitForTimeout(500);
  console.log('ming', await page.locator('#kokoro-provider-settings').evaluate(el => el.hidden),
    await page.locator('#ming-provider-settings').evaluate(el => el.hidden));
  await page.locator('#tts-provider').selectOption('kokoro');
  await page.waitForTimeout(500);
  console.log('kokoro', await page.locator('#kokoro-provider-settings').evaluate(el => el.hidden),
    await page.locator('#ming-provider-settings').evaluate(el => el.hidden));
  console.log('page errors', errors.slice(0, 5));
  await browser.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
