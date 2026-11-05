import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const url=process.env.WEB_TEST_URL || 'http://127.0.0.1:3000';
try {
 for(const theme of ['light','dark']) for(const width of [375,768,1440]) {
  const page=await browser.newPage({viewport:{width,height:1000},colorScheme:theme});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.locator('h1').waitFor();await page.locator('main img').evaluateAll(imgs=>imgs.forEach(i=>i.loading='eager'));await page.waitForTimeout(1000);
  assert.equal(await page.locator('h1').count(),1);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no page overflow');
  assert.ok(await page.locator('main img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0)),'images load');
  await page.locator('details').first().locator('summary').click();assert.ok(await page.locator('details').first().getAttribute('open')!==null);
  await page.getByRole('link',{name:'Get Freddai',exact:false}).first().click();assert.equal(new URL(page.url()).hash,'#download');
  await page.screenshot({path:`/tmp/freddai-landing-${theme}-${width}.png`,fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS',theme,width);await page.close();
 }
}finally{await browser.close()}
