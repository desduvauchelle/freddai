import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
 const page = await browser.newPage({viewport:{width:1200,height:800},colorScheme:'dark'});
 await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fileURLToPath(new URL('./fixtures/companion-dashboard.html', import.meta.url))}?desktop`);
 await page.getByRole('heading',{name:'Cached daily summary'}).waitFor();
 const sidebar = page.getByRole('complementary',{name:'Thread navigator'});
 assert.ok(await sidebar.isVisible());
 const card = page.getByRole('article',{name:'Project Project One',exact:true});
 const sb=await sidebar.boundingBox(), cb=await card.boundingBox();
 assert.ok(cb.x >= sb.x+sb.width);
 assert.equal(await card.evaluate(el=>getComputedStyle(el).padding), '8px 10px');
 await page.screenshot({path:'output/playwright/satellite-dashboard.png'});
 await page.getByRole('button',{name:'Toggle thread navigator'}).first().click();
 assert.equal(await sidebar.count(),0);
 await page.getByRole('button',{name:'Toggle thread navigator'}).first().click();
 await card.getByRole('button',{name:'New thread in Project One'}).click();
 assert.ok(await sidebar.isVisible());
 await page.screenshot({path:'output/playwright/satellite-composer.png'});
 await page.setViewportSize({width:640,height:700});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 console.log('PASS desktop satellite: persistent sidebar, shared card padding, hide/reopen, composer and narrow window.');
} finally {await browser.close();}
