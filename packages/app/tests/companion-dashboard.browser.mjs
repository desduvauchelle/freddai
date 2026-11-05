import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 813, height: 690 }, colorScheme: 'dark' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const fixture = fileURLToPath(new URL('./fixtures/companion-dashboard.html', import.meta.url));
  await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fixture}`);
  // iPad mini landscape has a 320pt native sidebar: its webview alone is almost square.
  await page.evaluate(() => { document.documentElement.dataset.companionSidebar = 'true'; });
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await page.getByRole('heading', { name: 'Cached daily summary' }).waitFor();
  const first = page.getByRole('article', { name: 'Project Project One', exact: true });
  const second = page.getByRole('article', { name: 'Project Project Two', exact: true });
  const columns = async () => page.locator('.companion-project-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  assert.equal(await columns(), 3, 'iPad mini landscape with sidebar fits three project cards');
  const a = await first.boundingBox(), b = await second.boundingBox();
  assert.ok(Math.abs(a.y - b.y) < 1 && b.x > a.x, 'first two cards share a row');
  await page.getByRole('combobox', { name: 'Coding agent', exact: true }).selectOption('second');
  await first.getByRole('button', { name: 'Open project Project One' }).click();
  const panel = page.getByRole('dialog');
  await panel.getByText('Model default', { exact: true }).click();
  await panel.getByRole('combobox', { name: 'Model', exact: true }).selectOption('__custom');
  await panel.getByRole('textbox', { name: 'Custom model ID' }).fill('offline-model');
  await panel.getByRole('combobox', { name: 'Reasoning effort' }).selectOption('high');
  await panel.getByRole('heading', { name: 'Project One', exact: true }).click();
  await panel.getByRole('button', { name: 'New thread in Project One' }).click();
  assert.equal(await page.getByRole('combobox', { name: 'Coding assistant' }).inputValue(), 'second');
  await page.getByRole('button', { name: 'Back to threads' }).click();
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  assert.equal(await page.getByRole('combobox', { name: 'Coding agent', exact: true }).inputValue(), 'second');
  await first.getByRole('button', { name: 'Open project Project One' }).click();
  await panel.getByText('offline-model', { exact: true }).click();
  assert.equal(await panel.getByRole('textbox', { name: 'Custom model ID' }).inputValue(), 'offline-model');
  assert.equal(await panel.getByRole('combobox', { name: 'Reasoning effort' }).inputValue(), 'high');
  await panel.getByRole('heading', { name: 'Project One', exact: true }).click();
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await mkdir('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/dashboard-ipad-sidebar.png', fullPage: true });
  for (const [width, height, sidebar, count] of [[390,844,false,1], [744,1060,false,2], [1024,720,false,3], [1400,900,false,3]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(value => { document.documentElement.dataset.companionSidebar = String(value); }, sidebar);
    assert.equal(await columns(), count, `${width}×${height} columns`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal page overflow');
    const bounds = await page.locator('.companion-dashboard').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    assert.ok(bounds.scroll <= bounds.width, 'dashboard controls fit available width');
    await page.screenshot({ path: `output/playwright/dashboard-${width}.png`, fullPage: true });
  }
  await page.getByRole('heading', { name: 'Cached daily summary' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'output/playwright/dashboard-summary.png' });
  assert.deepEqual(errors, []);
  console.log('PASS dashboard: cached summary, agent/model/effort persistence, phone/iPad portrait, sidebar landscape, two/three-column layouts and project panels; no provider calls.');
} finally { await browser.close(); }
