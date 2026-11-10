import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
try {
  for (const touch of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: touch });
    await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fileURLToPath(new URL('./fixtures/mascot-controls.html', import.meta.url))}`);
    await page.locator('.dormouse-motion').first().waitFor({state:'attached'});
    assert.equal(await page.locator('.dormouse-motion').count(), 10);
    for (const button of await page.locator('.dormouse-motion').all()) {
      const box = await button.boundingBox();
      assert.equal(box.width, box.height, `touch=${touch}: mascot control must stay circular`);
      if (await button.evaluate(el => !!el.closest('.companion'))) assert.ok(box.width >= 44, 'phone touch target must remain at least 44px');
    }
    const button = page.locator('.companion .dormouse-motion').first();
    await button.click({force:true});
    await page.waitForFunction(() => localStorage.getItem('freddai.mascotPaused') === 'true');
    assert.equal(await button.getAttribute('aria-label'), 'Play mascot animations');
    await page.close();
  }
  console.log('PASS: circular mascot controls across 5 sizes, desktop/phone, mouse/touch; pause still works');
} finally { await browser.close(); }
