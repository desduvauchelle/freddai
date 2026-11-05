import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  const fixture = fileURLToPath(new URL('./fixtures/connection-loading.html', import.meta.url));
  await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fixture}`);
  await page.getByRole('status').filter({ hasText: 'Connecting to your Mac…' }).waitFor();
  await page.locator('[data-mascot-mode="animated"] canvas').waitFor();
  const cloud = page.locator('.companion-connecting-cloud');
  const before = await cloud.evaluate(el => getComputedStyle(el).transform);
  await page.waitForTimeout(600);
  assert.notEqual(await cloud.evaluate(el => getComputedStyle(el).transform), before);
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    const box = await page.locator('.companion-connecting').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width, 'scene fits viewport');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await mkdir('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/connection-loading.png' });
  await page.getByRole('button', { name: 'Pause mascot animations' }).click();
  assert.equal(await cloud.evaluate(el => getComputedStyle(el).animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await cloud.evaluate(el => getComputedStyle(el).animationName), 'none');
  console.log('PASS connection scene: animation, phone/tablet fit, pause, reduced motion.');
} finally { await browser.close(); }
