import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
 for(const width of [390,768]) {
  const page=await browser.newPage({viewport:{width,height:844},colorScheme:'dark'});
  await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fileURLToPath(new URL('./fixtures/companion-queue.html',import.meta.url))}`);
  await page.getByRole('button',{name:/Check companion layout/}).click();
  const queue=page.getByRole('region',{name:'Message queue'});
  await queue.waitFor();
  assert.equal(await page.locator('.companion-compose-area .companion-queue').count(),0);
  assert.equal(await page.locator('.companion-body .companion-queue').count(),1);
  const box=await queue.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width&&box.height<90,'collapsed queue stays compact');
  const avatar=await page.locator('.companion-activity').boundingBox();
  const composer=await page.locator('.companion-compose-area').boundingBox();
  assert.ok(avatar.y+avatar.height<=box.y,'queue appears below the avatar');
  assert.ok(box.y+box.height<=composer.y,'collapsed queue appears above the composer');
  assert.equal(await queue.getByRole('list').count(),0);
  await page.screenshot({path:`/tmp/companion-queue-${width}-collapsed.png`});
  await queue.getByRole('button',{name:/Up next/}).click();
  assert.equal(await queue.getByRole('listitem').count(),3);
  const expandedBox=await queue.boundingBox();
  const last=await queue.getByRole('listitem').last().boundingBox();
  assert.ok(last.y+last.height<=expandedBox.y+expandedBox.height,'expanded queue must not clip later messages');
  await page.screenshot({path:`/tmp/companion-queue-${width}-expanded.png`});
  await queue.getByRole('button',{name:'Pause queued messages'}).click();
  await queue.getByRole('button',{name:'Resume queued messages'}).waitFor();
  await queue.getByRole('button',{name:'Remove queued message 2'}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.companion-queue-list li').length===2);
  await queue.getByRole('button',{name:'Clear queue'}).click();
  await queue.waitFor({state:'hidden'});
  await page.close();
 }
 console.log('PASS phone/tablet queue: compact transcript placement, expansion, pause, remove, clear. Offline fixture only.');
}finally{await browser.close()}
