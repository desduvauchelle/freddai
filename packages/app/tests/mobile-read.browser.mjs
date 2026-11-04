import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome'});
// Read state is owned by the Mac host: the snapshot's `read_at` per thread. The fixture models the host's markRead/mergeRead.
// The refresh control lives in the connection details, which the status icon toggles.
const refresh=async page=>{const button=page.getByRole('button',{name:'Refresh connection',exact:true});if(!await button.count())await page.getByRole('button',{name:/Connected to your Mac|Connecting to your Mac|Mac disconnected/}).click();await button.click()};
const readAt=page=>page.evaluate(()=>window.hostReadAt('a-0'));
try {
 const page=await browser.newPage({viewport:{width:390,height:844}});
 // WKWebView can be visible without reporting document focus until an input is focused.
 await page.addInitScript(()=>{
  document.hasFocus=()=>false;
  let visibility='visible';
  Object.defineProperty(document,'visibilityState',{get:()=>visibility});
  window.setSyntheticVisibility=value=>{visibility=value;document.dispatchEvent(new Event('visibilitychange'));};
 });
 const fixture=fileURLToPath(new URL('./fixtures/project-groups.html',import.meta.url));
 const url=`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fixture}`;
 await page.goto(url);
 await page.getByRole('button',{name:/A task 00/}).click();
 await page.evaluate(()=>{window.setSyntheticVisibility('hidden');window.completeSyntheticThread();});
 await refresh(page);
 await page.waitForTimeout(150);
 assert.equal(await readAt(page),undefined,'background conversations remain unread on the host');
 await page.evaluate(()=>window.setSyntheticVisibility('visible'));
 await page.waitForFunction(()=>window.hostReadAt('a-0')!==undefined,{},{timeout:2000});
 const calls=await page.evaluate(()=>window.hostCalls.markRead.filter(c=>c.thread==='a-0'));
 assert.ok(calls.length>=1,'foregrounding sends markRead to the host');
 assert.equal(await page.evaluate(()=>localStorage.getItem('freddai.companion.read')),null,'no device-local read map is written');
 await page.getByRole('button',{name:'Back to threads',exact:true}).click();
 assert.equal(await page.getByText('A task 00',{exact:true}).count(),0,'read thread leaves active list');
 await page.getByRole('combobox',{name:'Status filter',exact:true}).selectOption('done');
 await page.getByText('A task 00',{exact:true}).waitFor();
 assert.equal(await page.locator('[data-status=unread]').count(),0);
 // The host's read_at survives the next snapshot: the row is still read after a refresh.
 await refresh(page);
 await page.waitForTimeout(150);
 assert.equal(await page.locator('[data-status=unread]').count(),0,'read_at from the host snapshot keeps the thread read');
 // Migration: a legacy device-local map is sent to the host once, then removed.
 await page.evaluate(()=>localStorage.setItem('freddai.companion.read',JSON.stringify({'a-0':123,'b-1':456})));
 await page.reload();
 await page.getByRole('region',{name:'Alpha threads',exact:true}).waitFor();
 await page.waitForFunction(()=>localStorage.getItem('freddai.companion.read')===null,{},{timeout:2000});
 assert.deepEqual(await page.evaluate(()=>window.hostCalls.mergeRead),[{'a-0':123,'b-1':456}],'legacy cursors are merged into the host exactly once');
 assert.equal(await readAt(page),123,'host adopted the migrated cursor');
 // A completion received on the list remains unread until the conversation is opened.
 await page.reload();
 await page.getByRole('region',{name:'Alpha threads',exact:true}).waitFor();
 await page.evaluate(()=>window.completeSyntheticThread());
 await refresh(page);
 await page.getByText('Unread reply',{exact:true}).waitFor();
 assert.equal(await readAt(page),undefined);
 await page.getByRole('button',{name:/A task 00/}).click();
 await page.waitForFunction(()=>window.hostReadAt('a-0')!==undefined,{},{timeout:2000});
 await page.getByRole('button',{name:'Back to threads',exact:true}).click();
 assert.equal(await page.getByText('A task 00',{exact:true}).count(),0);
 console.log('PASS visible mobile conversation is read via the host read_at without document focus; legacy local cursors migrate once; leaves active rows and appears in Finished.');
}finally{await browser.close()}
