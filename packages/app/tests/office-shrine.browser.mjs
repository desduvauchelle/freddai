import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixture = fileURLToPath(new URL('./fixtures/office.html', import.meta.url));
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage();
  for (const width of [390, 1440]) for (const variant of ['mini', 'full']) for (const schedules of [0, 1, 4, 12]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fixture}?variant=${variant}&width=${width - 32}&projects=9&schedules=${schedules}`);
    const shrine = page.getByRole('group', { name: 'Clock shrine', exact: true });
    await shrine.waitFor();
    await page.waitForTimeout(150);
    assert.equal(await shrine.getByRole('img').count(), Math.min(4, schedules));
    assert.ok(await page.locator('.office-map').evaluate(el => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1));
    const positions = await page.locator('g[aria-label="Clock shrine"], g[aria-label="Coffee lounge"], g[aria-label="Your desk"]').evaluateAll(els => Object.fromEntries(els.map(el => { const r = el.getBBox(); return [el.getAttribute('aria-label'), { x: r.x, right: r.x + r.width }]; })));
    assert.ok(positions['Coffee lounge'].right <= positions['Clock shrine'].x);
    assert.ok(positions['Clock shrine'].right <= positions['Your desk'].x);
    if (width === 1440 && variant === 'mini' && schedules === 4) {
      await page.screenshot({ path: '/tmp/freddai-shrine.png' });
      await shrine.screenshot({ path: '/tmp/freddai-shrine-detail.png' });
    }
    console.log('PASS', width, variant, schedules);
  }
} finally { await browser.close(); }
