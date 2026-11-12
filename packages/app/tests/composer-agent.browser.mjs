import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless:true,channel:'chrome'});
try {
 const page = await browser.newPage(); const errors=[]; page.on('pageerror', e=>errors.push(e.message));
 const fixture=fileURLToPath(new URL('./fixtures/composer-agent.html',import.meta.url));
 await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fixture}`);
 for (const width of [390,744,1024,1440]) {
  await page.setViewportSize({width,height:850});
  await page.getByRole('button',{name:'Assistant and difficulty'}).click();
  const dialog=page.getByRole('dialog'); await dialog.waitFor();
  assert.deepEqual(await dialog.locator('h3').allTextContents(),['Claude Code','Codex']);
  assert.equal(await dialog.getByRole('combobox').count(),0);
  const box=await dialog.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 850);
  await page.screenshot({path:`/tmp/freddai-assistant-${width}.png`});
  await dialog.getByRole('button',{name:'Codex · Preview connection',exact:true}).click();
  if (width >= 720) {
   // Wide: one dialog, three columns (Assistant / Model / Thinking); stays open until Done.
   await dialog.getByRole('heading',{name:'Choose assistant, model and thinking'}).waitFor();
   await page.screenshot({path:`/tmp/freddai-difficulty-${width}.png`});
   await dialog.getByRole('group',{name:'Model'}).getByRole('button',{name:'Fast',exact:true}).click();
   await dialog.getByRole('button',{name:'Done',exact:true}).click();
  } else {
   await dialog.getByRole('heading',{name:'Choose difficulty'}).waitFor();
   await page.screenshot({path:`/tmp/freddai-difficulty-${width}.png`});
   await dialog.getByRole('button',{name:'Fast',exact:true}).click();
  }
  await dialog.waitFor({state:'hidden'});
  assert.match(await page.getByRole('button',{name:'Assistant and difficulty'}).textContent(),/Codex.*Fast/);
  assert.equal(await page.getByRole('textbox',{name:'Draft'}).inputValue(),'Keep this draft');
 }
 await page.getByRole('button',{name:'Assistant and difficulty'}).click();
 await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Assistant and difficulty');
 assert.deepEqual(errors,[]);
 console.log('PASS assistant → difficulty → close at 390, 744, 1024, 1440px; draft preserved, focus restored, no runtime errors.');
} finally { await browser.close(); }
