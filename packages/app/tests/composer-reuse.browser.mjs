import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const width of [1440, 900]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1421'}/@fs${fileURLToPath(new URL('./fixtures/composer-reuse.html', import.meta.url))}`);
    await page.getByRole('combobox', { name: 'Project filter' }).click();
    await page.getByRole('option', { name: 'Offline project', exact: true }).click();
    await page.getByRole('listbox').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'New thread in Offline project', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'New thread', exact: true });
    await sheet.getByRole('textbox', { name: 'Task prompt' }).fill('Reusable conversation');
    for (const name of ['Attach files', 'Separate worktree', 'Assistant and difficulty', 'Start voice call']) assert.equal(await sheet.getByRole('button', { name, exact: true }).count(), 1);
    await sheet.screenshot({ path: `/tmp/freddai-composer-reuse-${width}.png` });
    const box = await sheet.boundingBox();
    assert.ok(box.width <= width && box.x >= 0);
    await sheet.getByRole('button', { name: 'Start thread', exact: true }).click();
    const thread = page.getByRole('dialog', { name: 'Conversation', exact: true });
    await thread.getByRole('textbox', { name: 'Message agent' }).waitFor();
    assert.equal(await thread.locator('.thread-transcript').count(), 1);
    await thread.getByRole('button', { name: 'Close', exact: true }).click();
    await thread.waitFor({ state: 'detached' });
    await page.getByRole('region', { name: 'Home', exact: true }).waitFor();
    // Check ordinary new-thread entry uses precisely the same controls and input.
    await page.getByRole('button', { name: 'New task in Offline project', exact: true }).click();
    await page.getByRole('textbox', { name: 'Task prompt' }).waitFor();
    assert.equal(await page.locator('.chat-composer').count(), 1);
    assert.equal(await page.evaluate(() => window.__fixtureCalls.filter(x => x === 'launch').length), 1);
    await page.close();
  }
  console.log('PASS: dashboard and ordinary entry share the full composer; launch opens canonical transcript/reply; sheet closes back to Home at both desktop widths');
} finally { await browser.close(); }
