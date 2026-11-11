import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = process.env.FREDDAI_BROWSER_ENGINE === 'webkit' ? await webkit.launch({ headless: true }) : await chromium.launch({ headless: true, channel: 'chrome' });
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
    await page.getByRole('button', { name: 'Simulate spoken request' }).click();
    const card = page.getByRole('region', { name: 'Command review' });
    await card.waitFor();
    assert.match(await card.getByRole('textbox', { name: 'Instruction' }).inputValue(), /say hello/);
    await card.getByRole('textbox', { name: 'Instruction' }).fill('Hello from the review card');
    assert.ok(await card.evaluate(el => el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= innerWidth), `${width}: review card fits`);
    assert.ok(await island.evaluate(el => el.scrollWidth <= el.clientWidth), `${width}: card causes no horizontal overflow`);
    await page.screenshot({ path: `/tmp/freddai-dashboard-review-${width}.png` });
    await page.evaluate(() => document.documentElement.style.setProperty('--companion-viewport-height', '300px'));
    assert.ok(await island.evaluate(el => el.getBoundingClientRect().height <= 280), `${width}: review scrolls within keyboard-reduced viewport`);
    await page.evaluate(() => document.documentElement.style.removeProperty('--companion-viewport-height'));
    await page.getByRole('button', { name: 'Cancel command' }).click();
    await card.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Mute microphone' }).click();
    await page.getByRole('button', { name: 'Unmute microphone' }).waitFor();
    await page.getByRole('button', { name: 'End call' }).click();
    await island.waitFor({ state: 'hidden' });
    await page.close();
  }
  console.log('PASS: dashboard call controls fit phone, tablet and desktop; spoken request opens an editable card; cancel, expand, mute and hangup work offline.');
} finally { await browser.close(); }
