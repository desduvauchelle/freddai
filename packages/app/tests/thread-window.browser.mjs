import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless:true, channel:'chrome'});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => {errors.push(e.message); console.error(e.message);});
  const fixture = fileURLToPath(new URL('./fixtures/thread-window.html', import.meta.url));
  await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fixture}?thread=focus`);
  await page.getByRole('heading', {name:'Focused conversation'}).waitFor({timeout:10000}).catch(async e=>{ console.error(await page.locator('body').innerText()); throw e; });
  for (const width of [640, 960, 1440]) {
    await page.setViewportSize({width, height:760});
    assert.equal(await page.locator('.app-titlebar, .thread-browser, .native-accounts, .settings-page').count(), 0);
    assert.equal(await page.getByRole('main', {name:'Thread window'}).count(), 1);
    assert.equal(await page.getByRole('region', {name:'Conversation messages'}).count(), 1);
    assert.equal(await page.getByRole('textbox', {name:'Message agent'}).count(), 1);
    assert.equal(await page.getByRole('button', {name:'Split view', exact:true}).count(), 0);
    for (const shortcut of ['Control+n','Control+,','Control+1','Control+\\','Escape']) await page.keyboard.press(shortcut);
    assert.equal(await page.getByRole('heading', {name:'Focused conversation'}).count(), 1);
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.ok(await page.locator('main').evaluate(el=>el.getBoundingClientRect().height > 650));
  }
  await page.getByRole('button', {name:'Thread actions', exact:true}).click();
  assert.equal(await page.getByRole('menuitem', {name:'Open in New Window', exact:true}).count(), 0);
  await page.getByRole('menuitem', {name:'Close window', exact:true}).click();
  assert.ok(await page.evaluate(()=>window.threadWindowCommands.includes('plugin:window|close')));
  assert.deepEqual(errors, []);
  console.log('PASS: thread-only window, transcript/composer, no workspace chrome or shortcuts, native close at 640/960/1440px');
} finally { await browser.close(); }
