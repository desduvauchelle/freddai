import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = process.env.FREDDAI_BROWSER_ENGINE === 'webkit' ? await webkit.launch({ headless: true }) : await chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const width of [320, 430, 768, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fileURLToPath(new URL('./fixtures/dashboard-call.html', import.meta.url))}`);
    await page.getByRole('button', { name: 'Call Commander' }).click();
    const pill = page.getByRole('complementary', { name: 'Commander call' });
    await pill.waitFor();
    const inside = el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; };
    assert.ok(await pill.evaluate(inside), `${width}: pill fits inside the viewport`);
    assert.ok(await pill.evaluate(el => el.getBoundingClientRect().height <= 36 && el.getBoundingClientRect().width <= 220), `${width}: pill stays compact`);
    assert.equal(await page.getByText('Details').count(), 0, `${width}: no Details expander`);
    await page.getByRole('button', { name: 'End call' }).waitFor();
    await page.screenshot({ path: `/tmp/freddai-dashboard-call-${width}-pill.png` });
    // The page must stay scrollable and clickable during the call: no backdrop, no scroll lock.
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflow), 'visible', `${width}: body not scroll-locked`);
    const hit = await page.evaluate(() => { const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return el?.id || el?.tagName; });
    assert.ok(['content', 'BODY', 'HTML', 'DIV', 'P'].includes(hit), `${width}: nothing covers the page centre (${hit})`);
    await page.mouse.move(width / 2, 400);
    await page.mouse.wheel(0, 300);
    await page.waitForFunction(() => scrollY > 0);
    await page.evaluate(() => scrollTo(0, 0));
    await page.getByRole('button', { name: 'Simulate spoken request' }).click();
    const card = page.getByRole('region', { name: 'Command review' });
    await card.waitFor();
    await page.waitForTimeout(350); // slide-in animation
    assert.match(await card.getByRole('textbox', { name: 'Instruction' }).inputValue(), /say hello/);
    await card.getByRole('textbox', { name: 'Instruction' }).fill('Hello from the review card');
    assert.ok(await card.evaluate(inside), `${width}: review card fits the viewport`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: sheet causes no horizontal overflow`);
    assert.equal(await page.locator('[data-slot="sheet-overlay"], [data-radix-dialog-overlay]').count(), 0, `${width}: no modal overlay`);
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflow), 'visible', `${width}: sheet does not lock scroll`);
    // The page behind the sheet still scrolls and the pill stays reachable.
    await page.mouse.move(10, 100);
    await page.mouse.wheel(0, 300);
    await page.waitForFunction(() => scrollY > 0);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `/tmp/freddai-dashboard-review-${width}.png` });
    await page.evaluate(() => document.documentElement.style.setProperty('--companion-viewport-height', '300px'));
    assert.ok(await page.locator('.dashboard-review-sheet').evaluate(el => el.getBoundingClientRect().height <= 300), `${width}: review scrolls within keyboard-reduced viewport`);
    await page.evaluate(() => document.documentElement.style.removeProperty('--companion-viewport-height'));
    await page.keyboard.press('Escape');
    await card.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Mute' }).click();
    await page.getByRole('button', { name: 'Unmute' }).waitFor();
    await page.waitForTimeout(1100);
    assert.notEqual((await page.getByLabel('Call duration').textContent()).trim(), '0:00', `${width}: timer advances`);
    await page.getByRole('button', { name: 'End call' }).click();
    await pill.waitFor({ state: 'hidden' });
    await page.close();
  }
  console.log('PASS: compact call pill fits phone, tablet and desktop; the page scrolls during the call; the review sheet is non-modal and closes on Escape; mute, timer and hangup work offline.');
} finally { await browser.close(); }
