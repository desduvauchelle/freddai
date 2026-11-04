import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome'});
const refreshConnection=async page=>{const button=page.getByRole('button',{name:'Refresh connection',exact:true});if(!await button.count())await page.getByRole('button',{name:/Connected to your Mac|Connecting to your Mac|Mac disconnected/}).click();await button.click()};
try {
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 const base=process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420';
 const fixture=fileURLToPath(new URL('./fixtures/tool-activity.html',import.meta.url));
 await page.goto(`${base}/@fs${fixture}`);
 await page.getByRole('button',{name:/Tool disclosure regression/}).click();
 assert.equal(await page.locator('details.tool-activity').count(),2,'adjacent tool messages must form collapsed groups');
 assert.equal(await page.getByText('SYNTHETIC_TOOL_OUTPUT_ONE',{exact:true}).isVisible(),false,'tool payload must be hidden by default');
 await page.locator('details.tool-activity > summary').first().click();
 assert.equal(await page.getByText('SYNTHETIC_TOOL_OUTPUT_ONE',{exact:true}).isVisible(),false,'each call remains collapsed inside an open group');
 await page.locator('details.tool-activity-call > summary').first().click();
 assert.equal(await page.getByText('SYNTHETIC_TOOL_OUTPUT_ONE',{exact:true}).isVisible(),true);
 assert.equal(await page.getByText('SYNTHETIC_TOOL_OUTPUT_TWO',{exact:true}).isVisible(),false);
 await page.evaluate(()=>window.appendSyntheticTool());
 await refreshConnection(page);
 await page.getByText('Tool activity · 2 calls',{exact:true}).last().waitFor();
 assert.equal(await page.locator('details.tool-activity[open]').count(),1,'polling must preserve the open group');
 assert.equal(await page.getByText('SYNTHETIC_TOOL_OUTPUT_ONE',{exact:true}).isVisible(),true);
 assert.equal(await page.getByText('SYNTHETIC_APPENDED_OUTPUT',{exact:true}).isVisible(),false);
 await page.locator('details.tool-activity > summary').first().click();
 assert.equal(await page.getByText('SYNTHETIC_TOOL_OUTPUT_ONE',{exact:true}).isVisible(),false);
 await page.getByRole('button',{name:'Back to threads',exact:true}).click();
 await page.getByRole('button',{name:/Tool disclosure regression/}).click();
 assert.equal(await page.locator('details.tool-activity[open]').count(),0,'reopening a conversation starts collapsed');
 assert.equal(await page.getByText('An ordinary assistant reply',{exact:true}).isVisible(),true);
 if(process.env.FREDDAI_LAYOUT_SCREENSHOTS) {
  await page.screenshot({path:`${process.env.FREDDAI_LAYOUT_SCREENSHOTS}/tool-activity-collapsed.png`});
  await page.locator('details.tool-activity > summary').first().click();
  await page.locator('details.tool-activity-call > summary').first().click();
  await page.screenshot({path:`${process.env.FREDDAI_LAYOUT_SCREENSHOTS}/tool-activity-expanded.png`});
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: adjacent grouping, initially hidden payloads, nested disclosure, polling stability, appended calls, reopening collapsed, ordinary replies visible.');
} finally {await browser.close()}
