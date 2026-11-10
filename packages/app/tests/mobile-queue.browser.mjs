import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
 for(const width of [320,390,768]) {
  const page=await browser.newPage({viewport:{width,height:844},colorScheme:'dark',reducedMotion:'reduce'});
  await page.goto(`${process.env.FREDDAI_PREVIEW_URL || 'http://127.0.0.1:1420'}/@fs${fileURLToPath(new URL('./fixtures/companion-queue.html',import.meta.url))}`);
  await page.getByRole('button',{name:/Check companion layout/}).first().click();
  const queue=page.getByRole('region',{name:'Message queue'});
  await queue.waitFor();
  assert.equal(await queue.getByRole('listitem').count(),3);
  assert.equal(await queue.getByRole('button').count(),9);
  const rows = await queue.getByRole('listitem').evaluateAll(items => items.map(row => {
    const preview = row.querySelector('.message-queue-preview').getBoundingClientRect();
    const actions = [...row.querySelectorAll('.message-queue-actions button')].map(button => button.getBoundingClientRect());
    return { fits: row.scrollWidth <= row.clientWidth, previewWidth: preview.width,
      aligned: actions.every(button => Math.abs(button.y + button.height / 2 - preview.y - preview.height / 2) < 1),
      touchTargets: actions.every(button => button.width >= 44 && button.height >= 44) };
  }));
  assert.ok(rows.every(row => row.fits && row.previewWidth > 60 && row.aligned && row.touchTargets), `preview and all actions share one compact row with phone touch targets: ${width} ${JSON.stringify(rows)}`);
  const composer = page.locator('.companion-composer');
  const gap = (await composer.boundingBox()).y - ((await queue.boundingBox()).y + (await queue.boundingBox()).height);
  assert.ok(gap >= 0 && gap <= 16, `queue stays against composer: ${width}, gap ${gap}`);
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
