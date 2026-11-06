import assert from 'node:assert/strict';
const {chromium, webkit} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
for (const engine of [chromium, webkit]) {
 const browser = await engine.launch({headless:true,...(engine===chromium?{channel:'chrome'}:{})});
 try {
 const page=await browser.newPage();
 await page.goto('http://127.0.0.1:1420/@fs'+new URL('./fixtures/schedule-overflow.html',import.meta.url).pathname);
 await page.getByText('Schedule configuration',{exact:true}).waitFor();
 for(const width of [1440,960,640]) {
 await page.setViewportSize({width,height:760});
 await page.waitForTimeout(150);
 await page.evaluate(()=>{
 const panel=document.querySelector(innerWidth<=800?'.schedule-workspace':'.schedule-configuration');
 panel.scrollTop=panel.scrollHeight;
 window.scrollTo(0,document.body.scrollHeight);
 });
 await page.waitForTimeout(150);
 const state=await page.evaluate(()=>{
 const panel=document.querySelector(innerWidth<=800?'.schedule-workspace':'.schedule-configuration');
 return {documentHeight:document.documentElement.scrollHeight,scrollY,header:document.querySelector('header').getBoundingClientRect().top,footer:document.querySelector('footer').getBoundingClientRect().bottom,panelHeight:panel.clientHeight,panelContent:panel.scrollHeight,panelScroll:panel.scrollTop};
 });
 console.log(engine.name(),width,state);
 assert.ok(state.documentHeight<=760 && state.scrollY===0 && state.header===0 && state.footer<=760,'App chrome must stay inside viewport');
 assert.ok(state.panelContent>state.panelHeight && state.panelScroll>0,'Long task must scroll inside its panel');
 }
 } finally {await browser.close();}
}
