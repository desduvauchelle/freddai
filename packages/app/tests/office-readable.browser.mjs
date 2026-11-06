import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixture = fileURLToPath(new URL('./fixtures/office.html', import.meta.url));
import assert from 'node:assert/strict';
const b=await chromium.launch({headless:true,channel:'chrome'});
try {
const page=await b.newPage();
for(const variant of ['mini','full']) for(const width of [390,1440]) {
await page.setViewportSize({width,height:844});
await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fixture}?variant=${variant}&width=${width-32}&projects=9`);
await page.locator('.office-svg').waitFor();
const fit = () => page.locator('.office-map').evaluate(el=>el.scrollWidth<=el.clientWidth+1 && el.scrollHeight<=el.clientHeight+1);
assert.ok(await fit(), 'office must auto-fit on first open');
const metrics=await page.locator('.office-svg').evaluate(el=>({scale:el.getScreenCTM().a,width:el.parentElement.clientWidth,scroll:el.parentElement.scrollWidth}));
await page.getByRole('button',{name:'Zoom in',exact:true}).click();
assert.equal(await page.getByRole('dialog').count(),variant==='full'?1:0);
const zoomScale=await page.locator('.office-svg').evaluate(el=>el.getScreenCTM().a);
assert.ok(zoomScale > metrics.scale, 'zoom is an explicit opt-in');
await page.getByRole('button',{name:'Fit all',exact:true}).click();
assert.ok(await fit(), 'Fit all restores the overview');
await page.setViewportSize({width:width===390?844:1000,height:600});
await page.waitForTimeout(100);
assert.ok(await fit(), 'overview auto-fits after resize');
console.log('PASS',variant,width,metrics);
}
} finally {await b.close();}
