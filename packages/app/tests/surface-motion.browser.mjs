import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
try {
  for (const width of [1440, 768, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fileURLToPath(new URL('./fixtures/surface-motion.html', import.meta.url))}`);
    for (const button of ['Open project', 'Plus']) {
      await page.getByRole('button', { name: button, exact: true }).click();
      const panel = page.getByRole('dialog');
      const motion = await panel.evaluate(el => {
        const animation = el.getAnimations()[0];
        animation.pause(); animation.currentTime = 100;
        return { name: getComputedStyle(el).animationName, duration: animation.effect.getTiming().duration, x: new DOMMatrix(getComputedStyle(el).transform).m41, width: el.getBoundingClientRect().width };
      });
      assert.equal(motion.name, 'surface-sheet-in'); assert.equal(motion.duration, 380);
      assert.ok(motion.x > 0 && motion.x < motion.width, 'panel occupies an intermediate position');
      await panel.evaluate(el => el.getAnimations()[0].finish());
      if (button === 'Plus') await page.getByRole('textbox', { name: 'Draft' }).fill('Preserved while stepping back');
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      assert.equal(await panel.getAttribute('data-state'), 'closed', 'exit retains the panel');
      await panel.waitFor({ state: 'detached' });
    }
    await page.getByRole('button', { name: 'Open dialog', exact: true }).click();
    assert.equal(await page.getByRole('dialog').evaluate(el => getComputedStyle(el).animationName), 'surface-dialog-in');
    await page.getByRole('dialog').evaluate(el => el.getAnimations().forEach(animation => animation.finish()));
    const bounds = await page.getByRole('dialog').boundingBox();
    assert.ok(Math.abs(bounds.x + bounds.width / 2 - width / 2) < 1, 'dialog stays centered');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Open project', exact: true }).click();
    assert.equal(await page.getByRole('dialog').evaluate(el => getComputedStyle(el).animationName), 'none');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: project/plus entry, intermediate frames, retained exit, reopening and reduced motion at desktop, tablet and phone widths');
} finally { await browser.close(); }
