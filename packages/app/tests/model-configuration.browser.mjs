import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
  const page=await browser.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  const fixture=fileURLToPath(new URL('./fixtures/model-configuration.html',import.meta.url));
  await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fixture}`);
  for(const width of [390,744,1024]) {
    await page.setViewportSize({width,height:900});
    await page.getByRole('columnheader',{name:'Smart',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`no page overflow at ${width}`);
    await page.screenshot({path:`/tmp/freddai-model-configuration-${width}.png`,fullPage:true});
  }
  await page.getByLabel('Codex Smart model',{exact:true}).fill('sol');
  await page.getByRole('button',{name:'Save model configuration'}).click();
  await page.getByRole('status').filter({hasText:'saved for all devices'}).waitFor();
  assert.equal(JSON.parse(await page.getByLabel('Shared mapping').textContent()).codex.smart.family,'sol');
  await page.getByRole('combobox',{name:'Difficulty',exact:true}).click();
  assert.deepEqual(await page.getByRole('option').allTextContents(),['Smart','Normal','Fast','Custom']);
  await page.getByRole('option',{name:'Smart',exact:true}).click();
  assert.equal(JSON.parse(await page.getByLabel('Session selection').textContent()).model,'freddai-level:smart');
  await page.getByRole('combobox',{name:'Difficulty',exact:true}).click();
  await page.getByRole('option',{name:'Custom',exact:true}).click();
  await page.getByLabel('Custom model ID').fill('gpt-specific');
  await page.getByLabel('Reasoning effort',{exact:true}).selectOption('high');
  assert.deepEqual(JSON.parse(await page.getByLabel('Session selection').textContent()),{model:'gpt-specific',effort:'high'});
  assert.deepEqual(errors,[]);
  console.log('PASS shared mapping editor, four difficulty choices, Custom model/effort, and phone/tablet/desktop layout. No accounts or provider turns.');
} finally {await browser.close();}
