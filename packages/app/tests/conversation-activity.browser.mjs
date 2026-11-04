import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const fixture = fileURLToPath(new URL('./fixtures/conversation-activity.html', import.meta.url));
const base = process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420';
try {
  const page = await browser.newPage({ viewport: { width: 600, height: 300 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const [status, text, mood] of [['starting', 'Starting…', 2], ['running', 'Working…', 2], ['waiting', 'Waiting for your input…', 4], ['failed', 'Needs attention', 8], ['interrupted', 'Interrupted', 7]]) {
    await page.goto(`${base}/@fs${fixture}?status=${status}`);
    const row = page.locator('.conversation-activity');
    await row.locator('canvas').waitFor();
    assert.equal(await row.getByRole('status').textContent(), text);
    assert.equal(await row.locator('[data-mascot-state]').getAttribute('data-mascot-state'), String(mood));
    const boxes = await row.evaluate(el => {
      const a = el.children[0].getBoundingClientRect(), b = el.children[1].getBoundingClientRect();
      return { right: a.right, left: b.left, delta: Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) };
    });
    assert.ok(boxes.left > boxes.right && boxes.delta < 2, 'character and label align horizontally');
    if (status === 'running') {
      await page.waitForTimeout(1000);
      await page.screenshot({ path: fileURLToPath(new URL('../../../output/verification/conversation-activity.png', import.meta.url)) });
      await row.getByRole('button', { name: 'Pause mascot animations' }).click({ force: true });
      assert.equal(await row.locator('[data-mascot-mode]').getAttribute('data-mascot-mode'), 'static');
      await row.getByRole('button', { name: 'Play mascot animations' }).click({ force: true });
      await row.locator('canvas').waitFor();
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${base}/@fs${fixture}?status=running`);
  await page.locator('[data-mascot-mode="static"]').waitFor();
  assert.equal(await page.locator('canvas').count(), 0);
  for (const status of ['idle', 'done']) {
    await page.goto(`${base}/@fs${fixture}?status=${status}`);
    await page.locator('.chat-assistant').waitFor();
    assert.equal(await page.locator('.conversation-activity').count(), 0);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: animated activity states, horizontal layout, pause/resume, reduced motion, idle/completion cleanup');
} finally { await browser.close(); }
