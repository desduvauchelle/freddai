import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const width of [390, 1024]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const fixture = fileURLToPath(new URL('./fixtures/project-groups.html', import.meta.url));
    await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fixture}`);
    const alpha = page.getByRole('region', { name: 'Alpha threads', exact: true });
    const beta = page.getByRole('region', { name: 'Beta threads', exact: true });
    const toggle = alpha.getByRole('button', { name: 'Alpha', exact: true });
    await toggle.waitFor();
    const count = await alpha.locator('.companion-row').count();
    assert.ok(count > 0);
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await alpha.locator('.companion-row').count(), 0);
    assert.ok(await beta.locator('.companion-row').count() > 0);
    assert.equal(await alpha.getByRole('button', { name: 'New task in Alpha' }).count(), 1);
    await page.waitForTimeout(2200);
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await toggle.focus();
    await page.keyboard.press('Enter');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await alpha.locator('.companion-row').count(), count);
    await page.close();
  }
  console.log('PASS project collapse/expand, independent groups, refresh retention, separate new-thread control and keyboard access at phone/tablet widths');
} finally { await browser.close(); }
