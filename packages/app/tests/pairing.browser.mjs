import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome', timeout: 15000 });
const base = `${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fileURLToPath(new URL('./fixtures/pairing.html', import.meta.url))}`;
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(base);
  const connect = page.getByRole('button', { name: 'Connect', exact: true });
  await page.getByLabel('Pairing code').fill('123'); assert.ok(await connect.isDisabled());
  await page.getByLabel('Pairing code').fill('000000'); await connect.click();
  await page.getByRole('alert').filter({ hasText: 'Incorrect or expired code' }).waitFor();
  await page.getByLabel('Pairing code').fill('123456'); await connect.click();
  await page.getByText('Waiting for approval on your Mac…').waitFor();
  assert.equal(await page.getByText('Paired companion screen').count(), 0);
  assert.ok(await page.getByLabel('Pairing code').isDisabled());
  await page.screenshot({ path: 'output/verification/companion-pairing-iphone.png' });
  await page.evaluate(() => window.approveSyntheticPairing());
  await page.getByText('Paired companion screen').waitFor();
  await page.setViewportSize({ width: 900, height: 800 }); await page.goto(base + '?desktop');
  await page.getByRole('button', { name: 'Pair device', exact: true }).click();
  await page.getByText('123456', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Approve device', exact: true }).click();
  await page.getByRole('button', { name: 'Revoke access for Test iPhone', exact: true }).waitFor();
  assert.equal(await page.getByText('123456', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Revoke access for Test iPhone', exact: true }).click();
  await page.waitForFunction(() => !document.body.textContent.includes('Revoke access'));
  console.log('Pairing UI passed: code validation, approval gate, successful transition, Mac approval and revocation (synthetic boundary).');
} finally { await browser.close(); }
