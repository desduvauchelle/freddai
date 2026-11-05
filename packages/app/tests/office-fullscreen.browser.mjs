import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.OFFICE_WEBKIT ? webkit : chromium;
const browser = await engine.launch({ headless: true, ...(process.env.OFFICE_WEBKIT ? {} : { channel: 'chrome' }) });
try {
  const page = await browser.newPage();
  const fixture = fileURLToPath(new URL('./fixtures/companion-dashboard.html', import.meta.url));
  for (const [width, height] of [[744, 1060], [390, 844], [320, 568], [1024, 720], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fixture}`);
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    // A clipped/translated dashboard must not become the fullscreen containing block.
    await page.getByRole('button', { name: 'Expand office' }).click();
    await page.locator('.companion-dashboard').evaluate(el => { el.style.transform = 'translateZ(0)'; el.style.height = '1400px'; el.style.overflow = 'hidden'; });
    const close = page.getByRole('button', { name: 'Close office' });
    const b = await close.boundingBox();
    console.log(width, height, b);
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= width && b.y + b.height <= height, 'close button fits viewport');
    assert.ok(b.width >= 44 && b.height >= 44, 'close target supports touch');
    await page.setViewportSize({ width: height, height: width });
    const rotated = await close.boundingBox();
    assert.ok(rotated.x >= 0 && rotated.y >= 0 && rotated.x + rotated.width <= height && rotated.y + rotated.height <= width, 'close stays visible after rotation');
    await close.click({ timeout: 1500 });
    await page.getByRole('dialog', { name: 'Office', exact: true }).waitFor({ state: 'detached' });
  }
  console.log('PASS fullscreen: visible, touch-sized, clickable close across phone/tablet/desktop sizes');
} finally { await browser.close(); }
