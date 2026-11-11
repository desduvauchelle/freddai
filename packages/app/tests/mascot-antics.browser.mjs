import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = process.env.ANTICS_OUT || '/tmp/antics-check';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
const diff = (a, b) => !a.equals(b);
try {
  const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
  const problems = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(`console.${m.type()}: ${m.text()}`); });
  page.on('response', r => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`); });
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fileURLToPath(new URL('./fixtures/mascot-antics.html', import.meta.url))}`);
  const root = page.locator('[data-mascot-mode]').first();
  await root.waitFor({ state: 'attached' });
  await page.waitForFunction(() => document.querySelector('[data-mascot-mode]')?.getAttribute('data-mascot-mode') !== 'loading', null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const mode = await root.getAttribute('data-mascot-mode');
  console.log('mode =', mode);
  assert.equal(mode, 'animated', `mascot mode must be animated, got ${mode}; problems: ${problems.join(' | ')}`);
  const canvas = page.locator('canvas').first();
  const idle = await canvas.screenshot({ path: `${out}/idle.png` });
  const results = [];
  for (let mood = 9; mood <= 14; mood++) {
    await page.evaluate(m => window.playAntic(m), mood);
    await page.waitForTimeout(300);
    assert.equal(await root.getAttribute('data-mascot-state'), String(mood), `mood ${mood}: state`);
    const antic = await root.getAttribute('data-mascot-antic');
    assert.ok(antic, `mood ${mood}: data-mascot-antic not set`);
    const a = await canvas.screenshot({ path: `${out}/mood-${mood}-a.png` });
    await page.waitForTimeout(700);
    const b = await canvas.screenshot({ path: `${out}/mood-${mood}-b.png` });
    const moving = diff(a, b), vsIdle = diff(a, idle) && diff(b, idle);
    results.push(`${mood}(${antic}): motion=${moving} vsIdle=${vsIdle}`);
    assert.ok(moving, `mood ${mood}: no motion between frames`);
    assert.ok(vsIdle, `mood ${mood}: identical to idle`);
    await page.waitForTimeout(500);
  }
  const bad = problems.filter(p => /rive|wasm|\.riv|load/i.test(p) && !/^console\.error: Failed to load resource/.test(p));
  console.log('console/page problems:', problems.length ? problems : 'none');
  assert.equal(bad.length, 0, `rive/wasm/load errors: ${bad.join(' | ')}`);
  console.log('PASS: mode=animated; ' + results.join('; '));
} finally { await browser.close(); }
