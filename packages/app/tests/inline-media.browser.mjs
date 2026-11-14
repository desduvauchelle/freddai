import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out=process.env.FREDDAI_LAYOUT_SCREENSHOTS || '/tmp/freddai-inline-video';
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome'});
try {
 const base=process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420';
 const fixture=fileURLToPath(new URL('./fixtures/inline-media.html',import.meta.url));
 for (const [name,width,height] of [['phone',390,844],['desktop',1100,700]]) {
  const page=await browser.newPage({viewport:{width,height}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${base}/@fs${fixture}`);
  await page.getByRole('button',{name:/Inline media/}).first().click();
  const thumbs=page.locator('.generated-thumb-button');
  await thumbs.nth(1).waitFor();
  assert.equal(await thumbs.count(),2,'bare local path and hosted URL must both render thumbnails');
  assert.ok((await page.evaluate(()=>window.readCalls)).includes('/Users/denis/Desktop/hero.png'),'reader gets the exact bare path');
  await page.waitForFunction(()=>[...document.querySelectorAll('.generated-thumb-button img')].every(i=>i.complete&&i.naturalWidth>0));
  await page.screenshot({path:`${out}/${name}-thumbs.png`});
  for (const [i,label] of [[0,'local'],[1,'remote']]) {
   await thumbs.nth(i).click();
   const box=page.locator('.generated-lightbox-stage img');
   await box.waitFor(); await page.waitForTimeout(400);
   const bb=await box.boundingBox();
   assert.ok(bb.width<=width+0.5&&bb.height<=height*0.85+1,`lightbox image fits viewport (${JSON.stringify(bb)})`);
   if (i===1) assert.equal(await page.getByRole('button',{name:'Open link'}).isVisible(),true);
   await page.screenshot({path:`${out}/${name}-lightbox-${label}.png`});
   await page.keyboard.press('Escape');
   await page.locator('.generated-lightbox').waitFor({state:'detached'});
  }
  const card=page.getByRole('button',{name:/Play video: sample.mp4/});
  await card.waitFor(); await page.waitForFunction(()=>/Play · /.test(document.querySelector('.generated-media-card')?.textContent||''));
  assert.deepEqual(await page.evaluate(()=>window.videoReads),[[0,65536]],'only the 64 KiB probe before Play');
  await page.locator('.generated-media').first().scrollIntoViewIfNeeded();
  await page.screenshot({path:`${out}/${name}-video-card.png`});
  await card.click();
  const video=page.locator('.generated-media video');
  await video.waitFor();
  await page.waitForFunction(()=>(document.querySelector('.generated-media video')?.readyState??0)>=1);
  assert.match(await video.getAttribute('src'),/^blob:/);
  const vb=await video.boundingBox();
  assert.ok(vb.width<=width&&vb.height<=height*0.6+1,`inline video fits (${JSON.stringify(vb)})`);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'no horizontal overflow');
  await video.scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
  await page.screenshot({path:`${out}/${name}-video-inline.png`});
  await page.getByRole('button',{name:/Expand video/}).click();
  const lv=page.locator('.generated-lightbox video'); await lv.waitFor();
  await page.waitForFunction(()=>(document.querySelector('.generated-lightbox video')?.readyState??0)>=1);
  const lb=await lv.boundingBox();
  assert.ok(lb.width<=width+0.5&&lb.height<=height*0.85+1,`lightbox video fits (${JSON.stringify(lb)})`);
  await page.screenshot({path:`${out}/${name}-video-lightbox.png`});
  assert.deepEqual(errors,[]);
  await page.close();
 }
 console.log('PASS: bare local path + hosted URL render thumbnails and fit-to-screen lightboxes at 390x844 and 1100x700. Screenshots in',out);
} finally {await browser.close()}
