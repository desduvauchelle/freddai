import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
 for (const width of [320,390,768,1024,1440]) {
  const page = await browser.newPage({ viewport: { width, height: 1180 } });
  await page.goto(`http://127.0.0.1:1420/@fs${fileURLToPath(new URL('./fixtures/commander-settings.html',import.meta.url))}`);
  await page.getByLabel('Voice to text').selectOption('openrouter');
  await page.getByLabel('Text to voice').selectOption('vercel');
  await page.getByRole('button',{name:'Save voice connections'}).click();
  await page.getByRole('status').getByText('Saved').waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`);
  await page.screenshot({ path: `/tmp/freddai-commander-settings-${width}.png`, fullPage:true });
  await page.close(); console.log(`Commander settings ${width}px passed`);
 }
} finally { await browser.close(); }
