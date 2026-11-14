import {fileURLToPath} from 'node:url';
import {mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out=process.env.FREDDAI_PREVIEW_CHIP_SCREENSHOTS || '/tmp/freddai-preview-chip';
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
const fixture=fileURLToPath(new URL('./fixtures/preview-chip.html',import.meta.url));
try {
 for (const [name,width,height,mobile] of [['phone',390,844,true],['desktop',1100,700,false]]) {
  const page=await browser.newPage({viewport:{width,height},isMobile:mobile,hasTouch:mobile});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fixture}`);
  await page.getByRole('button',{name:/Preview chip/}).first().click();
  const chip=page.locator('button.preview-chip').first();
  await chip.waitFor({timeout:5000});
  const m=await page.locator('button.preview-chip').evaluateAll(bs=>bs.map(b=>({text:b.textContent,h:b.getBoundingClientRect().height,w:b.getBoundingClientRect().width,sw:b.scrollWidth,cw:b.clientWidth})));
  await page.screenshot({path:`${out}/${name}.png`});
  console.log(name,JSON.stringify(m));
  for (const c of m) {assert.ok(c.h<60,`${name} chip height ${c.h}`);assert.ok(c.sw<=c.cw+1,`${name} chip text overflows`);}
  assert.ok(m[0].text.startsWith('Preview '));
  assert.deepEqual(errors,[]);
  await page.close();
 }
} finally { await browser.close(); }
