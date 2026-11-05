import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = process.env.FREDDAI_LAYOUT_SCREENSHOTS || '/tmp/office-redesign';
mkdirSync(out, { recursive: true });
const base = process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420';
const fixture = fileURLToPath(new URL('./fixtures/office.html', import.meta.url));
const url = query => `${base}/@fs${fixture}${query}`;
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
// Room and zone floors are the fixed floor plan; they must not move when threads change state.
const rooms = page => page.evaluate(() => [...document.querySelectorAll('.office-svg .office-floor')].map(r => { const b = r.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)].join(','); }).join('|'));
const chars = page => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.office-svg [role=button]')].map(el => { const b = el.getBoundingClientRect(); return [el.getAttribute('aria-label'), [Math.round(b.x), Math.round(b.y)]]; })));
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

  await page.goto(url('?variant=full'));
  await page.locator('svg.office-svg').waitFor();
  const before = await rooms(page), start = await chars(page);
  assert.equal(await page.locator('[aria-label$=" room"]').count(), 6, 'one room per project');
  await page.screenshot({ path: `${out}/full-1440x900.png` });

  await page.click('#advance');
  await page.waitForTimeout(1800);
  const mid = await chars(page);
  assert.ok(Object.keys(mid).some(k => JSON.stringify(mid[k]) !== JSON.stringify(start[k])), 'someone is walking');
  await page.screenshot({ path: `${out}/full-1440x900-mid-walk.png` });
  await page.waitForTimeout(500);
  assert.equal(await rooms(page), before, 'rooms must not move while characters walk');
  await page.waitForTimeout(14000);
  assert.equal(await rooms(page), before, 'rooms must not move after states change');
  await page.screenshot({ path: `${out}/full-1440x900-after-step1.png` });
  await page.click('#advance');
  await page.waitForTimeout(16000);
  assert.equal(await rooms(page), before, 'rooms must not move after the second step');
  await page.screenshot({ path: `${out}/full-1440x900-after-step2.png` });

  await page.setViewportSize({ width: 1000, height: 700 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/full-1000x700.png` });

  for (const width of [720, 560, 900]) {
    await page.setViewportSize({ width: width + 40, height: 700 });
    await page.goto(url(`?variant=mini&width=${width}`));
    await page.locator('svg.office-svg').waitFor();
    await page.waitForTimeout(500);
    const box = await page.locator('.office-mini').boundingBox();
    assert.ok(box.height <= 0.45 * 700 + 60, `mini card height capped (${box.height})`);
    await page.screenshot({ path: `${out}/mini-${width}.png` });
  }

  // Sizing with 8 projects: the map must use the space it is given. Measures the drawn map (the svg's content box), not just the element.
  const mapBox = (pg, scope) => pg.evaluate(sc => {
    const svg = document.querySelector(`${sc} svg.office-svg`), vb = svg.viewBox.baseVal, r = svg.getBoundingClientRect();
    const k = Math.min(r.width / vb.width, r.height / vb.height);
    return { w: vb.width * k, h: vb.height * k, scale: k, boxW: r.width, boxH: r.height, stageH: document.querySelector(`${sc} .office-stage`).getBoundingClientRect().height };
  }, scope);
  for (const card of [1210, 720, 560, 1600]) {
    await page.setViewportSize({ width: card + 40, height: 1162 });
    await page.goto(url(`?variant=mini&width=${card}&projects=8`));
    await page.locator('svg.office-svg').waitFor();
    await page.waitForTimeout(400);
    const m = await mapBox(page, '.office-mini');
    console.log('mini', card, JSON.stringify(m));
    assert.ok(m.w >= (card - 16) * 0.97, `mini ${card}: map spans the card (${m.w} of ${card - 16})`);
    assert.ok(m.stageH <= 0.45 * 1162, `mini ${card}: stage under 45vh (${m.stageH})`);
    await page.screenshot({ path: `${out}/sizing-mini-${card}.png` });
  }
  for (const [vw, vh] of [[1686, 1162], [1440, 900]]) {
    await page.setViewportSize({ width: vw, height: vh });
    await page.goto(url('?variant=mini&width=1210&projects=8'));
    await page.locator('svg.office-svg').waitFor();
    await page.click('[aria-label="Expand office"]');
    await page.waitForTimeout(500);
    const ov = await page.locator('.office-overlay').boundingBox(), bar = await page.locator('.office-overlay .office-bar').boundingBox(), m = await mapBox(page, '.office-overlay');
    console.log('full', vw, vh, JSON.stringify({ ov, bar, ...m }));
    assert.equal(Math.round(ov.height), vh, 'overlay covers the window');
    assert.ok(m.stageH >= vh - bar.height - 2, `full ${vw}x${vh}: stage fills window minus bar (${m.stageH})`);
    assert.ok(m.h >= (vh - bar.height) * 0.75 || m.w >= vw * 0.75, `full ${vw}x${vh}: map fills most of height or width (${Math.round(m.w)}x${Math.round(m.h)})`);
    assert.ok(m.scale > 1, `full ${vw}x${vh}: scale may exceed 1 (${m.scale})`);
    await page.screenshot({ path: `${out}/sizing-full-${vw}x${vh}.png` });
  }

  // A tray folder opens its thread.
  await page.setViewportSize({ width: 760, height: 700 });
  await page.goto(url('?variant=mini&width=720'));
  await page.locator('svg.office-svg').waitFor();
  await page.getByRole('button', { name: /Thread t6/ }).click();
  assert.equal(await page.evaluate(() => window.__opened), 't6');

  // Reduced motion: characters teleport.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const rm = await ctx.newPage();
  await rm.goto(url('?variant=full'));
  await rm.locator('svg.office-svg').waitFor();
  const rmStart = await chars(rm);
  await rm.click('#advance');
  await rm.waitForTimeout(300);
  const rmEnd = await chars(rm);
  await rm.waitForTimeout(300);
  assert.deepEqual(await chars(rm), rmEnd, 'reduced motion: settled immediately');
  assert.notDeepEqual(rmEnd, rmStart);

  assert.deepEqual(errors, [], 'no console or page errors');
  console.log('PASS office: fixed rooms, walking, mini cap, folder click, reduced motion. Screenshots in', out);
} finally { await browser.close(); }
