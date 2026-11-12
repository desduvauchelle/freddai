import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const fixture = fileURLToPath(new URL('./fixtures/companion-workspaces.html', import.meta.url));
  await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fixture}`);
  await page.getByRole('combobox', { name: 'Workspace filter' }).selectOption('w');
  assert.equal(await page.getByRole('button', { name: /Task b/ }).count(), 0);
  await page.reload();
  assert.equal(await page.getByRole('combobox', { name: 'Workspace filter' }).inputValue(), 'w');
  await page.getByRole('button', { name: /Task a/ }).first().click();
  await page.getByRole('button', { name: 'Thread actions' }).click();
  await page.getByRole('menuitem', { name: 'Pin thread', exact: true }).click();
  await page.getByRole('button', { name: 'Thread actions' }).click();
  await page.getByRole('menuitem', { name: 'Unpin thread', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Back to threads' }).click();
  await page.getByRole('button', { name: 'Manage workspaces' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  const work = dialog.getByRole('region', { name: 'Work workspace' });
  await work.getByRole('button', { name: 'Add projects' }).click();
  const picker = page.getByRole('dialog', { name: 'Add projects to Work' });
  await picker.getByRole('button', { name: 'Beta', exact: true }).click();
  await picker.getByRole('button', { name: 'Beta, added', exact: true }).waitFor();
  await picker.getByRole('button', { name: 'Done', exact: true }).click();
  await work.getByRole('button', { name: 'Remove Beta from Work' }).waitFor();
  for (const width of [320, 390, 744, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    await page.screenshot({ path: `/tmp/freddai-companion-settings-${width}.png` });
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, `workspace editor fits ${width}px`);
  }
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: /Task b/ }).first().waitFor();
  await page.getByRole('combobox', { name: 'Project filter' }).selectOption('a');
  await page.getByRole('textbox', { name: 'Search threads' }).fill('nothing');
  await page.getByRole('combobox', { name: 'Workspace filter' }).selectOption('');
  await page.getByRole('button', { name: /Task b/ }).first().waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS companion workspace persistence, shared pin action, membership updates, All reset, and phone/tablet editor layout. No accounts or provider calls.');
} finally { await browser.close(); }
