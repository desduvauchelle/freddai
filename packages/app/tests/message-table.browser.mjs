import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless:true,channel:'chrome'});
try {
  const page = await browser.newPage();
  const fixture = fileURLToPath(new URL('./fixtures/message-table.html',import.meta.url));
  for (const [width,mobile] of [[1440,false],[900,false],[500,false],[390,true],[320,true],[1024,true]]) {
    await page.setViewportSize({width,height:900});
    await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fixture}${mobile?'?mobile':''}`);
    await page.locator('table').waitFor();
    const sizes = await page.evaluate(() => {
      const table = document.querySelector('table');
      const viewport = table.closest('[data-slot=scroll-area-viewport]');
      const prose = document.querySelector('.native-message > p');
      const transcript = document.querySelector('.chat-transcript');
      viewport.scrollLeft = 10000;
      return {prose:prose.getBoundingClientRect().width,table:table.getBoundingClientRect().width,viewport:viewport.clientWidth,scrolled:viewport.scrollLeft,body:document.body.scrollWidth,transcript:transcript.scrollWidth,transcriptWidth:transcript.clientWidth,cells:[...table.querySelectorAll('th,td')].map(el=>el.getBoundingClientRect().width)};
    });
    console.log({width,mobile,...sizes});
    assert.ok(sizes.body<=width,'page must not overflow horizontally');
    assert.ok(sizes.transcript<=sizes.transcriptWidth+1,'table must not widen transcript');
    assert.ok(sizes.cells.every(w=>w>=150),'cells must retain readable widths');
    if (!mobile) assert.ok(sizes.prose<=800,'desktop prose stays capped');
    if (width===1440) assert.ok(sizes.viewport>sizes.prose+200,'table breaks out of prose column');
    if (width<=500) assert.ok(sizes.scrolled>0,'narrow table can scroll horizontally');
    await page.screenshot({path:`/tmp/freddai-table-${width}-${mobile}.png`});
  }
  console.log('PASS table breakout, prose cap, cell widths, and isolated horizontal scrolling.');
} finally { await browser.close(); }
