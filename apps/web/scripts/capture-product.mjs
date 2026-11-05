import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixture = fileURLToPath(new URL('../../../../packages/app/tests/fixtures/marketing.html', import.meta.url));
const output = fileURLToPath(new URL('../public/screenshots/', import.meta.url));
const mobileSelector = query => query ? '.companion' : '.home-tiles';
const browser=await chromium.launch({channel:'chrome',headless:true});
for (const [name,width,height,query] of [['desktop',1200,760,''],['companion',768,860,'?mobile']]) {
 const page=await browser.newPage({viewport:{width,height},colorScheme:'dark'});
 await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fixture}${query}`);
 await page.locator(mobileSelector(query)).waitFor();
 await page.waitForTimeout(1500);
 await page.screenshot({path:`${output}${name}.png`});
 await page.close();
}
await browser.close();
