// Run against the native Vite server with an isolated browser profile.
// PLAYWRIGHT_MODULE may point to an existing Playwright installation.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
import assert from 'node:assert/strict';
const browser = await chromium.launch({headless:true,
 executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
 for (const grouped of [true, false]) {
 for (const historyOnly of [false, true]) {
 const page = await browser.newPage({viewport:{width:1120,height:900}});
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({grouped,historyOnly}) => {
   const sessions=Array.from({length:8},(_,i)=>({id:`t${i}`,project:'p',account:'',title:`Thread ${i}`,status:i<6 && !historyOnly?'running':'done',updated:100-i,provider_id:null,messages:[],pending:null,error:null}));
   const db={accounts:[],projects:[{id:'p',name:'Project',path:'/offline',color:'#aaa',policy:'inherit',account:null,last:null}],sessions,preferences:{prefer_last:false,fallback:null,last:null}};
   localStorage.setItem('freddai.grouped', JSON.stringify(grouped));
   localStorage.setItem('freddai.read',JSON.stringify(Object.fromEntries(sessions.filter(t=>t.status==='done').map(t=>[t.id,t.updated]))));
   window.isTauri=true;
   window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,invoke:async(cmd)=>{
     if(cmd==='platform')return 'macos'; if(cmd==='snapshot')return db;
     if(cmd.startsWith('plugin:event|'))return 1;
     if(cmd==='provider_installations')return [];
     throw new Error(`Offline test blocks ${cmd}`);
   }};
   window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
 }, {grouped,historyOnly});
 await page.goto(process.env.SIDEBAR_URL || 'http://127.0.0.1:1433/');
 await page.getByRole('button',{name:'Back to threads',exact:true}).waitFor();
 await page.getByRole('button',{name:'Back to threads',exact:true}).click();
 await page.keyboard.press('Escape');
 const buttons=page.getByRole('button',{name:/^Show older threads/});
 assert.equal(await buttons.count(),1,'one history action per project');
 assert.equal(await page.locator('.task-row').count(),historyOnly?0:6);
 const projectFilter = await page.getByRole('combobox',{name:'Project filter',exact:true}).innerText();
 const statusFilter = await page.getByRole('combobox',{name:'Status filter',exact:true}).innerText();
 await buttons.click();
 assert.equal(await page.getByRole('combobox',{name:'Project filter',exact:true}).innerText(),projectFilter);
 assert.equal(await page.getByRole('combobox',{name:'Status filter',exact:true}).innerText(),statusFilter);
 assert.equal(await page.locator('.task-row').count(),8,'one click reveals the read-completed rows');
 assert.equal(await page.getByText('Thread 6',{exact:true}).count(),1);
 assert.equal(await page.getByText('Thread 7',{exact:true}).count(),1);
 assert.equal(await page.getByRole('button',{name:/finished/i}).count(),0,'no separate finished action');
 const historyButton=page.getByRole('button',{name:/^Hide older threads/});
 assert.equal(await historyButton.getAttribute('aria-expanded'),'true');
 const style=await historyButton.evaluate(el=>({size:getComputedStyle(el).fontSize,weight:getComputedStyle(el).fontWeight}));
 assert.deepEqual(style,{size:'11px',weight:'400'});
 await historyButton.click();
 assert.equal(await page.locator('.task-row').count(),historyOnly?0:6,'collapse restores the default list');
 await page.getByRole('button',{name:/^Show older threads/}).click();
 assert.equal(await page.locator('.task-row').count(),8,'history can be reopened');
 assert.equal(await page.getByRole('button',{name:/^Hide older threads/}).count(),1);
 assert.deepEqual(errors,[]);
 console.log(`PASS: grouped=${grouped}, historyOnly=${historyOnly}; unified action, all history, discreet style, collapse and reopen.`);
 await page.close();
 }
 }
} finally {await browser.close();}
