import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixture = fileURLToPath(new URL('./fixtures/office.html', import.meta.url));
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage();
  for (const variant of ['mini', 'full']) for (const width of [390, 1440]) for (const count of [0, 1, 2, 9, 10, 20]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fixture}?variant=${variant}&width=${width - 32}&projects=${count}`);
    await page.locator('.office-svg').waitFor();
    await page.waitForTimeout(150);
    const rooms = await page.locator('rect.office-floor').evaluateAll(els => els.filter(el => /-f\d+\)/.test(el.getAttribute('fill'))).map(el => ({ x: +el.getAttribute('x'), y: +el.getAttribute('y'), w: +el.getAttribute('width') })));
    assert.equal(rooms.length, count);
    assert.equal(await page.getByRole('img', { name: /Ready for a task/ }).count(), count);
    const reservesFit = await page.getByRole('group', { name: 'Lobby', exact: true }).evaluate(el => {
      const floor = el.parentElement.querySelector('rect.office-floor').getBBox();
      return [...el.querySelectorAll('[role="img"]')].every(mouse => {
        const r = mouse.getBBox();
        return r.x >= floor.x && r.x + r.width <= floor.x + floor.width && r.y >= floor.y && r.y + r.height <= floor.y + floor.height;
      });
    });
    assert.ok(reservesFit, 'every project reserve stays inside the compact lobby');
    const rows = [...new Set(rooms.map(r => r.y))].map(y => rooms.filter(r => r.y === y));
    if (rows.length) {
      const populations = rows.map(r => r.length);
      assert.ok(Math.max(...populations) - Math.min(...populations) <= 1);
      for (const row of rows) {
        assert.equal(row[0].x, rows[0][0].x);
        assert.equal(row.at(-1).x + row.at(-1).w, rows[0].at(-1).x + rows[0].at(-1).w);
      }
    }
    assert.ok(await page.locator('.office-map').evaluate(el => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1));
    if (variant === 'mini' && width === 1440 && [1, 2, 10, 20].includes(count)) await page.screenshot({ path: `/tmp/freddai-balanced-${count}.png` });
    console.log('PASS', variant, width, count, rows.map(r => r.length));
  }
} finally { await browser.close(); }
