import {fileURLToPath} from 'node:url';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome'});
try {
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const base = process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420';
 const fixture = fileURLToPath(new URL('./fixtures/thread-overflow.html', import.meta.url));
 const url = `${base}/@fs${fixture}`;
 await page.goto(url);
 await page.locator('.companion-row').first().waitFor();
 for(const width of [320,390,430]){
  await page.setViewportSize({width,height:844});
  const rows=await page.locator('.companion-row').evaluateAll(els=>els.map(el=>{
   const title=el.querySelector('strong'),date=el.querySelector('time');
   return {rowRight:el.getBoundingClientRect().right,titleWidth:title.clientWidth,titleScroll:title.scrollWidth,ellipsis:getComputedStyle(title).textOverflow,dateRight:date?.getBoundingClientRect().right,viewport:innerWidth};
  }));
  console.log(width,JSON.stringify(rows));
  if (process.env.FREDDAI_LAYOUT_SCREENSHOTS) await page.screenshot({path:`${process.env.FREDDAI_LAYOUT_SCREENSHOTS}/thread-overflow-${width}.png`});
  const viewport=await page.locator('.companion-body [data-slot=scroll-area-viewport]').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));
  assert.ok(viewport.scroll<=viewport.width+1,'thread metadata must not overflow the scroll viewport');
  for(const row of rows){assert.ok(row.rowRight<=width+1,'thread row must fit phone width');assert.ok(row.dateRight<=width,'date must remain visible');assert.ok(row.titleScroll>row.titleWidth,'long title must be constrained for truncation');assert.equal(row.ellipsis,'ellipsis')}
 }
 // Projects are now grouped headings in the thread list (no separate Projects screen).
 const project = await page.locator('.companion-project-heading h2').first().evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,right:el.getBoundingClientRect().right}));
 assert.ok(project.scroll>project.width && project.right<=430,'long project names truncate too');
 await page.goto(url+'?surface=desktop');
 for(const width of [240,320,500]) {
  await page.setViewportSize({width,height:844});
  const rows=await page.locator('.compact-session').evaluateAll(els=>els.map(el=>({right:el.getBoundingClientRect().right,title:el.querySelector('.session-title').clientWidth,scroll:el.querySelector('.session-title').scrollWidth,date:el.querySelector('time').getBoundingClientRect().right,icon:el.querySelector('.session-cli').getBoundingClientRect().right})));
  for(const row of rows) {assert.ok(row.right<=width+1);assert.ok(row.scroll>row.title);assert.ok(row.date<=width && row.icon<=width,'desktop metadata remains visible')}
 }
 console.log('PASS phone titles/metadata/projects truncate at 320/390/430px; desktop titles truncate and retain icons/dates at 240/320/500px.');
}finally {await browser.close()}
