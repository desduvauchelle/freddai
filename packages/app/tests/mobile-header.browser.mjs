import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const fixture=fileURLToPath(new URL('./fixtures/project-groups.html',import.meta.url));
 await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fixture}`);
 await page.getByRole('button',{name:/A task 00/}).click();
 // The centered mascot avatar was replaced by a left-aligned title block with a small connection icon.
 const header=page.locator('.companion-thread-header');await header.waitFor();
 assert.equal(await page.locator('.companion-avatar').count(),0,'the header avatar is gone');
 const hbox=await header.boundingBox();assert.ok(hbox.x>=0&&hbox.x+hbox.width<=390.5,'header fits the phone width');
 const title=await page.getByRole('heading',{name:'A task 00',exact:true}).boundingBox();assert.ok(title.x>=0&&title.x+title.width<=390.5,'title stays on screen');
 const conn=await page.getByRole('button',{name:/Connected to your Mac|Connecting to your Mac|Mac disconnected/}).boundingBox();assert.ok(conn.x+conn.width<=390.5&&conn.width<=48,'connection control is a small icon');
 await page.getByRole('button',{name:'Thread actions',exact:true}).click();
 assert.equal(await page.getByRole('menuitem',{name:'Archive',exact:true}).getAttribute('data-disabled'),'');
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Stop current turn and pause queue',exact:true}).click();
 await page.getByRole('button',{name:'Stop current turn and pause queue',exact:true}).waitFor({state:'hidden'});
 await page.getByRole('button',{name:'Thread actions',exact:true}).click();
 await page.getByRole('menuitem',{name:'Delete…',exact:true}).click();
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('heading',{name:'A task 00',exact:true}).waitFor();
 await page.getByRole('button',{name:'Thread actions',exact:true}).click();
 await page.getByRole('menuitem',{name:'Archive',exact:true}).click();
 await page.getByRole('heading',{name:'Threads',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:/A task 00/}).count(),0);
 await page.getByRole('button',{name:/A task 01/}).click();
 await page.getByRole('button',{name:'Thread actions',exact:true}).click();
 await page.getByRole('menuitem',{name:'Delete…',exact:true}).click();
 await page.getByRole('button',{name:'Move to Deleted',exact:true}).click();
 await page.getByRole('heading',{name:'Threads',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:/A task 01/}).count(),0);
 console.log('PASS compact thread header with connection icon, stop, archive gating, delete cancel/confirm, and list navigation using synthetic threads.');
}finally{await browser.close()}
