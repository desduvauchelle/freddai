import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const width of [320, 390, 768, 1024]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
    const fixture = fileURLToPath(new URL('./fixtures/mobile-send.html', import.meta.url));
    await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fixture}`);
    await page.getByRole('button', { name: /Send latency/ }).first().click();
    await page.getByRole('textbox', { name: 'Reply', exact: true }).fill('Busy follow-up');
    await page.getByRole('button', { name: 'Queue message', exact: true }).click();
    const queue = page.getByRole('region', { name: 'Message queue' });
    await queue.getByText('Busy follow-up', { exact: true }).waitFor({ timeout: 700 });
    assert.equal(await page.locator('article[data-role=user]').count(), 0, 'busy send never flashes in transcript');
    assert.equal(await page.getByRole('textbox', { name: 'Reply', exact: true }).inputValue(), '');
    const bounds = await queue.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, `queue fits ${width}px`);
    await page.evaluate(() => window.acknowledgeSend());
    await page.waitForTimeout(150);
    assert.equal(await queue.getByText('Busy follow-up', { exact: true }).count(), 1, 'queue survives stale acknowledgment snapshot');
    await page.evaluate(() => window.publishSend());
    await page.waitForFunction(() => !document.querySelector('.message-queue'), undefined, { timeout: 2500 });
    assert.equal(await page.locator('article[data-role=user]').filter({ hasText: 'Busy follow-up' }).count(), 1);
    await page.evaluate(() => window.setIdle());
    await page.waitForTimeout(1300);
    await page.getByRole('textbox', { name: 'Reply', exact: true }).fill('Idle follow-up');
    await page.getByRole('button', { name: 'Send reply', exact: true }).click();
    await page.locator('article[data-role=user]').filter({ hasText: 'Idle follow-up' }).waitFor({ timeout: 700 });
    assert.equal(await queue.count(), 0, 'idle send retains direct transcript preview');
    await page.close();
  }
  console.log('PASS immediate busy-send queue and idle transcript behavior at 320/390/768/1024px; synthetic dispatch only.');
} finally { await browser.close(); }
