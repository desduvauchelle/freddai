import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const width of [320, 430, 768, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fileURLToPath(new URL('./fixtures/dashboard-call.html', import.meta.url))}`);
    await page.getByRole('button', { name: 'Call Commander' }).click();
    const island = page.getByRole('complementary', { name: 'Commander call' });
    await island.waitFor();
    for (const expanded of [false, true]) {
      if (expanded) await page.getByRole('button', { name: /Commander · talk/ }).click();
      assert.ok(await island.evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= innerWidth), `${width}: island fits`);
      const end = await page.getByRole('button', { name: 'End call' }).boundingBox();
      assert.ok(end && end.x >= 0 && end.x + end.width <= width, `${width}: hangup visible`);
      await page.screenshot({ path: `/tmp/freddai-dashboard-call-${width}-${expanded ? 'expanded' : 'compact'}.png` });
    }
    await page.getByRole('button', { name: 'Mute microphone' }).click();
    await page.getByRole('button', { name: 'Unmute microphone' }).waitFor();
    await page.getByRole('button', { name: 'End call' }).click();
    await island.waitFor({ state: 'hidden' });
    await page.close();
  }
  console.log('PASS: dashboard call controls fit phone, tablet and desktop; expand, mute and hangup work offline.');
} finally { await browser.close(); }
