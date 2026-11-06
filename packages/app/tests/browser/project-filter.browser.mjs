// Run against the native Vite server with an isolated browser profile.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
const browser = await chromium.launch({headless:true, executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
 for (const height of [400, 900]) {
 const page = await browser.newPage({viewport:{width:1120,height}});
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(() => {
   const sessions=[];
   const db={accounts:[],projects:Array.from({length:12},(_,i)=>'Project '+i).map(id=>({id,name:id,path:'/offline/'+id,color:'#aaa',policy:'inherit',account:null,last:null})),sessions,preferences:{prefer_last:false,fallback:null,last:null}};
   localStorage.setItem('freddai.read',JSON.stringify({t6:94,t7:93}));
   window.isTauri=true;
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,invoke:async(cmd)=>{
     if(cmd==='platform')return 'macos'; if(cmd==='snapshot')return db; if(cmd==='snapshot_since')return {...db,full:true,revision:1,hostId:'offline-reorder'};
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


 const trigger=page.locator('[aria-label="Project filter"]');
 await trigger.click();
 await page.getByRole('option',{name:'Project 11',exact:true}).click();
 await trigger.click();
 const menu=page.getByRole('listbox');
 const t=await trigger.boundingBox(), m=await menu.boundingBox();
 console.log({trigger:t,menu:m});
 assert.ok(m.y>=t.y+t.height, 'project menu must open below its trigger, clear of window controls');
 await page.keyboard.press('Escape');
 assert.equal(await trigger.innerText(),'Project 11');
 assert.ok(m.y+m.height<=height, 'long project list stays inside the window');
 await page.getByRole('combobox',{name:'Status filter',exact:true}).click();
 const status=await page.locator('[aria-label="Status filter"]').boundingBox();
 const statusMenu=await page.getByRole('listbox').boundingBox();
 assert.ok(statusMenu.y>=status.y+status.height, 'status menu opens below its trigger');
 assert.ok(statusMenu.y+statusMenu.height<=height, 'status menu stays inside the window');
 await page.keyboard.press('Escape');
 assert.deepEqual(errors,[]);
 console.log('PASS: project dropdown stays below its trigger with a late selection');
 await page.close();
 }
} finally {await browser.close();}
