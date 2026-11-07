import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
 for(const width of [390,768]) {
  const page=await browser.newPage({viewport:{width,height:844},colorScheme:'dark'});
  await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fileURLToPath(new URL('./fixtures/companion-queue.html',import.meta.url))}`);
  await page.getByRole('button',{name:/Check companion layout/}).first().click();
  const queue=page.getByRole('region',{name:'Message queue'});
  await queue.waitFor();
  assert.equal(await queue.getByRole('listitem').count(),3);
  assert.equal(await queue.getByRole('button').count(),9);
  const box=await queue.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width,'queue fits viewport');
  assert.equal(await page.getByRole('button',{name:/Pause queued|Clear queue|More actions/}).count(),0);
  await queue.getByRole('button',{name:'Edit queued message',exact:true}).first().click();
  await queue.getByRole('textbox').fill('Updated mobile instruction');
  await queue.getByRole('button',{name:'Save queued message'}).click();
  await queue.getByText('Updated mobile instruction',{exact:true}).waitFor();
  await queue.getByRole('button',{name:/Delete queued message: Then verify/}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.message-queue li').length===2);
  await queue.getByRole('button',{name:'Steer instead'}).first().click();
  await page.waitForFunction(()=>document.querySelectorAll('.message-queue li').length===1);
  await page.screenshot({path:`/tmp/companion-queue-${width}.png`});
  await queue.getByRole('button',{name:/Delete queued message:/}).click();
  await queue.waitFor({state:'hidden'});
  await page.close();
 }
 console.log('PASS phone/tablet queue: desktop queue parity, edit, delete, steer. Offline fixture only.');
}finally{await browser.close()}
