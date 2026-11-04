import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const width of [1100, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const fixture = fileURLToPath(new URL('./fixtures/optimistic-permission.html', import.meta.url));
    await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fixture}`);
    await page.getByRole('button', { name: 'Two', exact: true }).click();
    await page.getByRole('button', { name: 'Send answers', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Answers submitted · Sending…' }).waitFor({ timeout: 700 });
    assert.equal(await page.evaluate(() => window.calls), 1);
    assert.equal(await page.getByRole('button', { name: 'Send answers' }).count(), 0);
    await page.evaluate(() => window.fail());
    await page.getByRole('alert').filter({ hasText: 'Synthetic permission failure' }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Which option?' }).inputValue(), 'Two');
    await page.getByRole('button', { name: 'Send answers', exact: true }).click();
    await page.evaluate(() => window.accept());
    await page.getByRole('status').filter({ hasText: 'Waiting for agent…' }).waitFor();
    await page.getByRole('button', { name: 'Next request' }).click();
    await page.getByRole('button', { name: 'Send answers', exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Which option?' }).inputValue(), '');
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: desktop/phone shared decisions update immediately, prevent resubmit, preserve answers on failure, reset for next request');
} finally { await browser.close(); }
