import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
const out = process.env.SHOTS || '/tmp/project-sheet-shots';
try {
  for (const [w, h] of [[1440, 900], [1100, 700]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const base = process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420';
    await page.goto(`${base}/@fs${fileURLToPath(new URL('./fixtures/project-sheet.html', import.meta.url))}`);
    const shot = n => page.screenshot({ path: `${out}/${w}-${n}.png` });
    await page.getByRole('article', { name: 'Project Freddai' }).waitFor();
    await shot('1-dashboard');
    await page.getByRole('button', { name: 'Show threads in Freddai' }).click();
    await page.getByRole('list', { name: 'Threads in Freddai' }).waitFor(); await page.waitForTimeout(900);
    await shot('2-sheet');
    await page.getByRole('list', { name: 'Threads in Freddai' }).getByRole('button').first().click();
    await page.getByRole('textbox', { name: 'Reply' }).waitFor(); await page.waitForTimeout(200);
    await shot('3-thread');
    await page.keyboard.press('Escape');
    await page.getByRole('list', { name: 'Threads in Freddai' }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('article', { name: 'Project Freddai' }).count(), 1);
    await shot('5-after-escape');
    await page.getByRole('button', { name: 'New thread in Landing page' }).click();
    await page.getByLabel('Prompt for Landing page').fill('Add a pricing section');
    await page.waitForTimeout(300); await shot('4-new-thread');
    await page.getByRole('button', { name: 'Start thread' }).click();
    await page.getByRole('textbox', { name: 'Reply' }).waitFor(); await page.waitForTimeout(200);
    await shot('4b-new-thread-started');
    assert.deepEqual(await page.evaluate(() => window.log), [], 'nothing navigated away from the dashboard');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('ok');
} finally { await browser.close(); }
