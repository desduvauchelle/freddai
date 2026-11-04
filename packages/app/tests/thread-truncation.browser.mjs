import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
try {
  const page = await browser.newPage();
  const base = process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420';
  const fixture = fileURLToPath(new URL('./fixtures/thread-overflow.html', import.meta.url));
  await page.goto(`${base}/@fs${fixture}?surface=desktop`);
  await page.locator('.thread-presence .session-title').first().waitFor();
  for (const width of [240, 320, 360, 500, 700]) {
    await page.setViewportSize({ width, height: 500 });
    const rows = await page.locator('.compact-session').evaluateAll(elements => elements.map(row => {
      const title = row.querySelector('.session-title');
      const style = getComputedStyle(title);
      return { right: row.getBoundingClientRect().right, width: title.clientWidth, scroll: title.scrollWidth,
        ellipsis: style.textOverflow, nowrap: style.whiteSpace, overflow: style.overflowX,
        metadataRight: row.querySelector('time').getBoundingClientRect().right };
    }));
    for (const row of rows) {
      assert.ok(row.right <= width + 1, `row must fit ${width}px, got ${row.right}px`);
      assert.ok(row.metadataRight <= width, 'trailing metadata must remain visible');
      assert.ok(row.scroll > row.width, 'long title must overflow its constrained box');
      assert.equal(row.ellipsis, 'ellipsis');
      assert.equal(row.nowrap, 'nowrap');
      assert.equal(row.overflow, 'hidden');
    }
    if (process.env.FREDDAI_LAYOUT_SCREENSHOTS) await page.screenshot({ path: `${process.env.FREDDAI_LAYOUT_SCREENSHOTS}/thread-truncation-${width}.png` });
    console.log(`PASS title ellipsis and visible metadata at ${width}px with real ThreadList wrappers`);
  }
} finally { await browser.close(); }
