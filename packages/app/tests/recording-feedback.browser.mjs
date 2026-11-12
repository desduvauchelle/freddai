import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch({headless:true, ...(engine === chromium ? {channel:'chrome'} : {})});
  try {
    const page = await browser.newPage();
    await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fileURLToPath(new URL('./fixtures/recording-feedback.html', import.meta.url))}`);
    for (const width of [320,390,768,1024,1440]) {
      await page.setViewportSize({width,height:800});
      for (const corner of ['top-left','top-right','bottom-left','bottom-right']) {
        await page.getByLabel('Corner').selectOption(corner);
        for (const name of ['Send recording','Cancel recording']) {
          const button = page.getByRole('button',{name});
          const rect = await button.boundingBox();
          assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width && rect.y + rect.height <= 800, `${engine.name()} ${width} ${corner} ${name}`);
          await button.click({trial:true});
        }
      }
    }
    await page.screenshot({path:`/tmp/freddai-dictation-${engine.name()}.png`});
    console.log(`${engine.name()}: all 20 corner/viewport layouts visible and clickable`);
  } finally { await browser.close(); }
}
