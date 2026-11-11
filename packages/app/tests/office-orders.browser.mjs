import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  await mkdir('/tmp/freddai-office-orders', { recursive: true });
  for (const [width, native] of [[390, true], [813, true], [1440, false]]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    await page.addInitScript(() => {
      class Recorder {
        static isTypeSupported() { return true; }
        state = 'inactive'; mimeType = 'audio/mp4';
        start() { this.state = 'recording'; }
        stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob(['fixture']) }); this.onstop(); }
      }
      window.MediaRecorder = Recorder;
      Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
    });
    const fixture = fileURLToPath(new URL('./fixtures/office-orders.html', import.meta.url));
    await page.goto(`http://127.0.0.1:1420/@fs${fixture}${native ? '?native=1' : ''}`);
    await page.getByRole('button', { name: 'Give an order to Beta' }).click();
    const mic = page.locator('.office-order button').first();
    await mic.waitFor({ state: 'visible' });
    const r = await mic.boundingBox();
    const stage = await page.locator('.office-overlay .office-stage').boundingBox();
    assert.ok(r.height >= 44 && r.y + r.height <= stage.y + stage.height + 1, 'mic must fit inside stage');
    await mic.dispatchEvent('pointerdown', { button: 0, pointerId: 1 });
    await page.getByRole('button', { name: 'Stop recording in Beta' }).waitFor();
    assert.equal(await page.locator('.office-listener').count(), 3);
    await page.screenshot({ path: `/tmp/freddai-office-orders/${width}-listening.png` });
    await mic.dispatchEvent('pointercancel', { pointerId: 1 });
    await page.getByRole('button', { name: 'Dictate task in Beta' }).waitFor();
    assert.equal(await page.evaluate(() => window.officeOrderCalls.length), 0);
    await mic.dispatchEvent('pointerdown', { button: 0, pointerId: 1 });
    await page.getByRole('button', { name: 'Stop recording in Beta' }).waitFor();
    await mic.dispatchEvent('pointerup', { pointerId: 1 });
    await page.getByText('Task started').waitFor();
    assert.equal(await page.evaluate(() => window.officeOrderCalls[0].project), 'beta');
    const dialog = page.getByRole('dialog', { name: 'Office' });
    await dialog.getByRole('button', { name: 'Give an order to Alpha' }).click();
    await dialog.getByRole('button', { name: 'Dictate task in Alpha' }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.close();
  }
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const fixture = fileURLToPath(new URL('./fixtures/office-orders.html', import.meta.url));
    await page.goto(`http://127.0.0.1:1420/@fs${fixture}?native=1&boss=1`);
    await page.getByRole('button', { name: 'Give an order to Alpha' }).waitFor();
    assert.equal(await page.locator('.office-boss-suite').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Give an order to Ada' }).count(), 0);
    await page.getByRole('button', { name: 'Expand office' }).click();
    await page.getByRole('dialog', { name: 'Office' }).waitFor();
    assert.equal(await page.locator('.office-boss-suite').count(), 0);
    await page.screenshot({ path: `/tmp/freddai-office-orders/${width}-without-boss-office.png` });
    await page.close();
  }
  const audioPage = await browser.newPage();
  await audioPage.goto('http://127.0.0.1:1420');
  const audioResult = await audioPage.evaluate(async modulePath => {
    const { macCompatibleRecording } = await import(modulePath);
    const context = new AudioContext(), destination = context.createMediaStreamDestination(), tone = context.createOscillator();
    tone.connect(destination); tone.start(); await context.resume();
    const recorder = new MediaRecorder(destination.stream, { mimeType: 'audio/webm;codecs=opus' }), chunks = [];
    const completed = new Promise(resolve => { recorder.ondataavailable = e => chunks.push(e.data); recorder.onstop = resolve; });
    recorder.start(); await new Promise(resolve => setTimeout(resolve, 400)); recorder.stop(); await completed;
    tone.stop(); destination.stream.getTracks().forEach(track => track.stop()); await context.close();
    const wav = await macCompatibleRecording(new Blob(chunks, { type: recorder.mimeType }));
    const buffer = await wav.arrayBuffer(), view = new DataView(buffer);
    return { type: wav.type, size: wav.size, rate: view.getUint32(24, true), channels: view.getUint16(22, true) };
  }, `/@fs${fileURLToPath(new URL('../src/mobile/recording-audio.ts', import.meta.url))}`);
  assert.equal(audioResult.type, 'audio/wav'); assert.equal(audioResult.rate, 16000); assert.equal(audioResult.channels, 1); assert.ok(audioResult.size > 1000);
  await audioPage.close();
  console.log('Office orders: phone, tablet and desktop layout, native-card visibility, listening, cancel, release routing and expanded controls passed. No microphone or provider used.');
} finally { await browser.close(); }
