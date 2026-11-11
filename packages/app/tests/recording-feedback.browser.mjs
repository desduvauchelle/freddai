import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const width of [320, 390, 744, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fileURLToPath(new URL('./fixtures/recording-feedback.html', import.meta.url))}`);
    const feedback = page.getByRole('group', { name: 'Voice recording' });
    await feedback.waitFor();
    await page.waitForTimeout(50);
    const bounds = await feedback.boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= width, `${width}: feedback fits viewport`);
    const cancel = page.getByRole('button', { name: 'Cancel recording' });
    const send = page.getByRole('button', { name: 'Send recording' });
    const homeX = await cancel.boundingBox(), homeSend = await send.boundingBox();
    // Synthetic pointer moves exercise layout without recording or dispatching a live task.
    await page.locator('#root > div').dispatchEvent('pointermove', { clientX: 150, clientY: 390 });
    await page.waitForTimeout(30);
    let x = await cancel.boundingBox();
    assert(Math.abs(x.y + x.height / 2 - homeX.y - homeX.height / 2) < 0.1, 'cancel keeps its Y centre');
    await page.locator('#root > div').dispatchEvent('pointermove', { clientX: 190, clientY: 360 });
    await page.waitForTimeout(30);
    const arrow = await send.boundingBox();
    assert(Math.abs(arrow.x + arrow.width / 2 - homeSend.x - homeSend.width / 2) < 0.1, 'send keeps its X centre');
    await page.locator('#root > div').dispatchEvent('pointermove', { clientX: 200, clientY: 400 });
    await page.waitForTimeout(30);
    x = await cancel.boundingBox();
    assert(Math.abs(x.x - homeX.x) < 0.1 && Math.abs(x.y - homeX.y) < 0.1, 'cancel returns home');
    await page.screenshot({ path: `/tmp/freddai-recording-${width}.png` });
    await page.close();
  }
  console.log('PASS: recording rails, reset, and viewport fit at 320/390/744/1024/1440 widths.');
} finally { await browser.close(); }
