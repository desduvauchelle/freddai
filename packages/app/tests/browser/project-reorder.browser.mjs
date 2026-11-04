// Run against the native Vite server with an isolated browser profile.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
const browser = await chromium.launch({headless:true, executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
 const page = await browser.newPage({viewport:{width:1120,height:900}});
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(() => {
   const sessions=[];
   const db={accounts:[],projects:['a','b','c'].map(id=>({id,name:id,path:'/offline/'+id,color:'#aaa',policy:'inherit',account:null,last:null})),sessions,preferences:{prefer_last:false,fallback:null,last:null}};
   localStorage.setItem('freddai.read',JSON.stringify({t6:94,t7:93}));
   window.isTauri=true;
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,invoke:async(cmd)=>{
     if(cmd==='platform')return 'macos'; if(cmd==='snapshot')return db;
     if(cmd.startsWith('plugin:event|'))return 1;
     if(cmd==='provider_installations')return [];
     throw new Error(`Offline test blocks ${cmd}`);
   }};
   window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
 });
 await page.goto(process.env.SIDEBAR_URL || 'http://127.0.0.1:1433/');
 await page.locator('.project-group-heading').first().waitFor({state:'attached'});
 await page.getByRole('button',{name:'Back to threads',exact:true}).click();
 await page.keyboard.press('Escape');

 const order=()=>page.locator('section[data-project-id]').evaluateAll(els=>els.map(e=>e.dataset.projectId));
 assert.deepEqual(await order(),['a','b','c']);
 const handle=await page.getByRole('button',{name:'Reorder a',exact:true}).boundingBox();
 const target=await page.locator('section[data-project-id="c"]').boundingBox();
 await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);
 await page.mouse.down();
 await page.mouse.move(target.x+target.width/2,target.y+target.height-2,{steps:15});
 await page.mouse.up();
 assert.deepEqual(await order(),['b','c','a']);
 await page.reload();
 await page.getByRole('button',{name:'Back to threads',exact:true}).click();
 await page.keyboard.press('Escape');
 await page.locator('section[data-project-id="a"]').waitFor();
 assert.deepEqual(await order(),['b','c','a']);
 await page.getByRole('button',{name:'Reorder a',exact:true}).focus();
 await page.keyboard.press('Alt+ArrowUp');
 assert.deepEqual(await order(),['b','a','c']);
 assert.deepEqual(errors,[]);
 console.log('PASS: pointer reorder, persisted reload, keyboard reorder; no accounts or provider turns.');
} finally {await browser.close();}
