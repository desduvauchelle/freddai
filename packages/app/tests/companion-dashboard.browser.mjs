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
  async function choose(label, option) {
    await page.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  }
  await choose('Coding agent', 'Codex · Second');
  const defaults = page.getByRole('group', { name: 'Dashboard task defaults' });
  await choose('Model', 'Custom model…');
  await defaults.getByRole('textbox', { name: 'Custom model ID' }).fill('offline-model');
  await choose('Difficulty', 'High');
  assert.equal(await first.getByRole('combobox').count(), 0, 'no model controls on project cards');
  await first.getByRole('button', { name: 'New thread in Project One' }).click();
  assert.equal(await page.getByRole('combobox', { name: 'Coding assistant' }).inputValue(), 'second');
  await page.getByRole('button', { name: 'Back to threads' }).click();
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  assert.equal(await defaults.getByRole('textbox', { name: 'Custom model ID' }).inputValue(), 'offline-model');
  assert.match(await defaults.getByRole('combobox', { name: 'Difficulty' }).textContent(), /High/);
  await mkdir('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/dashboard-ipad-sidebar.png', fullPage: true });
  for (const [width, height, sidebar, count] of [[390,844,false,2], [744,1060,false,2], [1024,720,false,3], [1400,900,false,3]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(value => { document.documentElement.dataset.companionSidebar = String(value); }, sidebar);
    assert.equal(await columns(), count, `${width}×${height} columns`);
    const heading = await page.getByRole('heading', { name: 'Your projects', exact: true }).boundingBox();
    const controls = await defaults.boundingBox();
    if (width >= 620) {
      assert.ok(controls.x >= heading.x + heading.width, `${width}: defaults to right of heading`);
      assert.ok(Math.abs((controls.y + controls.height / 2) - (heading.y + heading.height / 2)) < 20, `${width}: compact heading row`);
    } else assert.ok(controls.y >= heading.y + heading.height, `${width}: defaults under heading`);
    assert.ok(controls.x >= 0 && controls.x + controls.width <= width, `${width}: defaults fit viewport`);
    assert.equal(await page.locator('.companion-project-card select').count(), 0);
    for (const name of ['Model', 'Difficulty']) {
      const control = defaults.getByRole('combobox', { name, exact: true });
      assert.ok(await control.isVisible(), `${width}: ${name} visible`);
      const box = await control.boundingBox();
      assert.ok((width >= 620 || box.y >= heading.y + heading.height) && box.x >= 0 && box.x + box.width <= width, `${width}: ${name} under heading and within viewport`);
    }

    assert.ok(await first.getByRole('button', { name: 'New thread in Project One' }).isVisible(), 'new thread is directly on the card');
    assert.ok(await first.getByRole('button', { name: 'Dictate task in Project One' }).isVisible(), 'microphone is directly on the card');
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
