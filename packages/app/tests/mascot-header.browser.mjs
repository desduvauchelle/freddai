import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const pw=await import(process.env.PLAYWRIGHT_MODULE || 'playwright'); const chromium=pw.chromium || pw.default.chromium;
const base=process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420';
const fixture=fileURLToPath(new URL('./fixtures/mascot-header.html',import.meta.url));
const out=fileURLToPath(new URL('../../../output/verification/',import.meta.url));
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome'});
try {
 for (const mood of [0,2,4,6,8]) {
  const ctx=await browser.newContext({viewport:{width:600,height:140},deviceScaleFactor:2});
  const page=await ctx.newPage();
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${base}/@fs${fixture}?mood=${mood}`);
  await page.locator('.mascot-header canvas').first().waitFor({timeout:15000});
  await page.waitForTimeout(mood===6?3500:2500);
  assert.ok(await page.locator('.mascot-header canvas').count()>0,`mood ${mood}: canvas present`);
  assert.equal(await page.locator('.mascot-header').getAttribute('data-mascot-state'),String(mood));
  await page.locator('[data-testid=header]').screenshot({path:`${out}mascot3-header-mood${mood}.png`});
  assert.deepEqual(errors,[],`mood ${mood}: page errors`);
  await ctx.close();
 }
 console.log('PASS: screenshots written to output/verification/mascot3-header-mood{0,2,4,6,8}.png');
} finally {await browser.close()}
