import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage();
  const fixture = fileURLToPath(new URL('./fixtures/message-table.html', import.meta.url));
  for (const mobile of [false, true]) {
    await page.setViewportSize({ width: mobile ? 390 : 1100, height: 900 });
    await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fixture}${mobile ? '?mobile' : ''}`);
    await page.locator('.native-message ul').first().waitFor();
    for (const [tag, expected] of [['ul', 'disc'], ['ol', 'decimal']]) {
      const lists = await page.locator(`.native-message ${tag}`).evaluateAll(elements => elements.map(el => ({
        marker: getComputedStyle(el).listStyleType,
        display: getComputedStyle(el.querySelector('li')).display,
        padding: parseFloat(getComputedStyle(el).paddingLeft),
      })));
      assert.ok(lists.length > 0, `${tag} exists`);
      for (const list of lists) {
        assert.equal(list.marker, expected, `${mobile ? 'mobile' : 'desktop'} ${tag} marker`);
        assert.equal(list.display, 'list-item');
        assert.ok(list.padding >= 20, 'markers have space inside the message');
      }
    }
    console.log('PASS', mobile ? 'mobile' : 'desktop', 'bullets, nested bullets, numbered lists');
  }
} finally { await browser.close(); }
