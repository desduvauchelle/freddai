import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 const fixture=fileURLToPath(new URL('./fixtures/project-groups.html',import.meta.url));
 await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fixture}`);
 await page.getByRole('button',{name:/A task 00/}).click();
 const back=page.getByRole('button',{name:'Back to threads'});
 async function swipe(points,target='.thread-transcript') {
  await page.locator(target).first().evaluate((el,points)=>{
   for(const [index,[x,y]] of points.entries()) {
    const touch=new Touch({identifier:1,target:el,clientX:x,clientY:y});
    el.dispatchEvent(new TouchEvent(index===0?'touchstart':index===points.length-1?'touchend':'touchmove',{bubbles:true,touches:index===points.length-1?[]:[touch],changedTouches:[touch]}));
   }
  },points);
 }
 await swipe([[10,300],[15,350],[120,360]]);assert.equal(await back.count(),1,'vertical scroll must not navigate');
 await swipe([[200,300],[300,300]]);assert.equal(await back.count(),1,'swipe must start at left edge');
 await swipe([[30,300],[0,300]]);assert.equal(await back.count(),1,'left swipe must not navigate');
 await swipe([[10,300],[60,300]]);assert.equal(await back.count(),1,'short swipe must not navigate');
 const draft=page.getByRole('textbox',{name:'Reply'});
 await draft.fill('Preserve this draft');
 await swipe([[10,700],[130,700]],'.companion-composer textarea');assert.equal(await back.count(),1,'composer touch must not navigate');
 await swipe([[10,300],[70,304],[130,308]]);
 await page.getByRole('heading',{name:'Threads',exact:true}).waitFor();
 await page.getByRole('button',{name:/A task 00/}).click();
 assert.equal(await draft.inputValue(),'Preserve this draft');
 console.log('PASS edge swipe back, vertical/left/short/interior/composer guards, and draft retention.');
}finally{await browser.close()}
