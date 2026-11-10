import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const width of [320, 430, 768, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: 'dark' });
    await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fileURLToPath(new URL('./fixtures/completion-cards.html', import.meta.url))}`);
    const card = page.getByRole('region', { name: 'Thread completion' });
    await card.waitFor();
    assert.equal(await card.getByRole('button', { name: 'Summarize' }).count(), 2);
    const fits = await card.evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= innerWidth);
    assert.ok(fits, `card fits ${width}`);
    await card.getByRole('button', { name: /Open thread: LiveCase/ }).click();
    await page.waitForFunction(() => document.querySelector('output').textContent === 'aaaaaaaa-1111');
    await card.getByRole('button', { name: 'Summarize' }).first().click();
    const draft = await page.getByRole('textbox', { name: 'Message' }).inputValue();
    assert.ok(draft.startsWith('My existing draft\n\n'));
    assert.ok(draft.includes('(aaaaaaaa-1111)'));
    await page.screenshot({ path: `/tmp/freddai-completion-cards-${width}.png` });
    await card.getByRole('button', { name: 'Dismiss' }).click();
    await card.waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('textbox', { name: 'Message' }).inputValue(), draft);
    await page.close();
  }
  console.log('PASS: completion cards fit phone, tablet and desktop; links, draft preservation and dismiss work without provider turns.');
} finally { await browser.close(); }
