// Run against the native Vite server with an isolated browser profile.
// PLAYWRIGHT_MODULE may point to an existing Playwright installation.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
import assert from 'node:assert/strict';
const browser = await chromium.launch({headless:true,
 executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
 const page = await browser.newPage({viewport:{width:1440,height:900}});
 await page.addInitScript(() => {
   const db={accounts:[],projects:[{id:'p',name:'freddai',path:'/offline',color:'#aaa',policy:'inherit',account:null,last:null}],sessions:[{id:'t',project:'p',account:'',title:'The hover state for show all the threads in the left navigation should fill the entire row',status:'running',updated:100,provider_id:null,messages:[],pending:null,error:null}],preferences:{}};
   window.isTauri=true;
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,invoke:async(cmd)=>{if(cmd==='platform')return 'macos';if(cmd==='snapshot')return db;if(cmd==='snapshot_since')return {...db,full:true,revision:1,hostId:'fixture'};if(cmd.startsWith('plugin:event|'))return 1;if(cmd==='provider_installations')return [];throw new Error(`Offline test blocks ${cmd}`)}};
   window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
 });
 await page.goto('http://127.0.0.1:1420/');
 await page.getByRole('button',{name:'Back to threads',exact:true}).click();
 await page.keyboard.press('Escape');
 await page.locator('.task-row').first().click();
 await page.locator('.pane-thread-title').waitFor();
 const measure=()=>page.locator('.pane-thread-title').evaluate(el=>({width:el.clientWidth,gap:el.nextElementSibling.getBoundingClientRect().left-el.getBoundingClientRect().right}));
 console.log(await measure());
 assert.ok((await measure()).gap<12,'title should use space up to trailing actions');
 assert.equal(await page.locator('.pane-account').innerText(),'Connection removed');
 for (const width of [900,1120,1600]) {
   await page.setViewportSize({width,height:900});
   assert.ok((await measure()).gap<12,`title fills available header space at ${width}px`);
 }
 console.log('PASS header uses available width at 900/1120/1440/1600px; removed connection labeled');
} finally {await browser.close();}
