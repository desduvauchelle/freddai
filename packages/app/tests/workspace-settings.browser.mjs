import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const width of [320, 390, 820, 1024]) {
    const page = await browser.newPage({ viewport: { width, height: 1180 }, hasTouch: true });
    const fixture = fileURLToPath(new URL('./fixtures/workspace-settings.html', import.meta.url));
    await page.goto(`http://127.0.0.1:1420/@fs${fixture}`);
    const personal = page.getByRole('region', { name: 'Personal workspace' });
    const work = page.getByRole('region', { name: 'Work workspace' });
    await personal.waitFor();
    if (width >= 820) {
      await page.evaluate(async stylesheet => {
        await import(stylesheet);
        document.querySelector('main').classList.remove('companion-workspaces');
      }, `/@fs${fileURLToPath(new URL('../src/desktop/desktop.css', import.meta.url))}`);
      const label = personal.getByRole('button', { name: 'Move Alpha from Personal', exact: true }).locator('span');
      const size = await label.boundingBox();
      assert.ok(size.width > 25 && size.height < 30, 'desktop project name stays readable');
    }
    assert.equal(await page.getByRole('combobox').count(), 0);
    assert.equal(await page.getByRole('button', { name: /Move workspace .* (up|down)/ }).count(), 0);
    assert.equal(await page.getByLabel('Color for Personal', { exact: true }).count(), 0);
    await personal.getByRole('button', { name: 'Choose color for personal' }).click();
    const picker = await personal.locator('.color-field-picker').boundingBox();
    assert.ok(picker.x >= 0 && picker.x + picker.width <= width, 'color picker stays on screen');
    await page.getByLabel('Color for Personal', { exact: true }).fill('#abcdef');
    await page.getByRole('button', { name: 'Apply color' }).click();
    assert.equal(await personal.evaluate(el => el.style.borderLeftColor), 'rgb(171, 205, 239)');
    await personal.getByRole('button', { name: 'Delete workspace Personal' }).click();
    await personal.getByRole('button', { name: 'Cancel', exact: true }).click();
    if (width >= 820) {
      const bounds = await personal.locator('.workspace-header').evaluate(el => Array.from(el.children).map(child => child.getBoundingClientRect().y));
      assert.ok(Math.max(...bounds) - Math.min(...bounds) < 15, 'workspace controls share one row');
    }
    await personal.getByRole('button', { name: 'Add projects' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add projects to Personal' });
    await sheet.getByRole('textbox', { name: 'Search projects' }).fill('Beta');
    await sheet.getByRole('button', { name: 'Beta', exact: true }).click();
    await sheet.getByRole('button', { name: 'Beta, added', exact: true }).waitFor();
    await page.screenshot({ path: `/tmp/freddai-project-picker-${width}.png` });
    await sheet.getByRole('button', { name: 'Done', exact: true }).click();
    await personal.getByRole('button', { name: 'Move Beta from Personal', exact: true }).waitFor();
    // Real touchscreen input exercises pointer capture and the touch-action rules.
    const source = page.getByRole('button', { name: 'Reorder workspace Personal' });
    await work.scrollIntoViewIfNeeded();
    await source.scrollIntoViewIfNeeded();
    const from = await source.boundingBox();
    const target = await work.boundingBox();
    const session = await page.context().newCDPSession(page);
    const x = from.x + from.width / 2, y = from.y + from.height / 2;
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: target.x + 30, y: target.y + target.height / 2 + 5 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => document.querySelector('[data-workspace-id]:not([data-workspace-id=""])')?.getAttribute('data-workspace-id') === 'b');
    const member = page.getByRole('button', { name: 'Move Beta from Personal', exact: true });
    await member.scrollIntoViewIfNeeded();
    const memberBounds = await member.boundingBox();
    const workBounds = await work.boundingBox();
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: memberBounds.x + 20, y: memberBounds.y + 20 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: workBounds.x + 30, y: workBounds.y + workBounds.height / 2 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await work.getByRole('button', { name: 'Move Beta from Work', exact: true }).waitFor();
    const moved = await work.getByRole('button', { name: 'Move Beta from Work', exact: true }).boundingBox();
    const unassigned = page.getByRole('region', { name: 'No workspace', exact: true });
    const unassignedBounds = await unassigned.boundingBox();
    await page.mouse.move(moved.x + 10, moved.y + 10);
    await page.mouse.down();
    await page.mouse.move(unassignedBounds.x + 20, unassignedBounds.y + 20, { steps: 5 });
    await page.mouse.up();
    await unassigned.getByText('Beta', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `/tmp/freddai-workspace-settings-${width}.png`, fullPage: true });
    await page.close();
    console.log(`PASS ${width}px: assignment, move, unassign, touch reorder and project drag, no overflow`);
  }
} finally { await browser.close(); }
