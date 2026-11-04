// Actual companion renderer with an isolated transcript; no native/provider calls.
import { createRoot } from 'react-dom/client';
import { MobileApp } from '../../src/mobile/MobileApp';
import '@freddai/ui/styles.css';
const messages = [
 {id:'u1',role:'user',text:'Inspect the synthetic fixture'},
 {id:'t1',role:'tool',text:'SYNTHETIC_TOOL_OUTPUT_ONE'},
 {id:'t2',role:'tool',text:'SYNTHETIC_TOOL_OUTPUT_TWO'},
 {id:'a1',role:'assistant',text:'An ordinary assistant reply'},
 {id:'t3',role:'tool',text:'SYNTHETIC_TOOL_OUTPUT_THREE'},
];
Object.assign(window,{appendSyntheticTool:()=>messages.push({id:'t4',role:'tool',text:'SYNTHETIC_APPENDED_OUTPUT'})});
createRoot(document.getElementById('root')!).render(<MobileApp client={{
 async snapshot(){return {projects:[{id:'p1',name:'Synthetic project',color:'#777',canStart:false}],threads:[{id:'s1',project:'p1',title:'Tool disclosure regression',status:'running',updated:messages.length,messages:[...messages],canReply:false,queued:0,error:null}]}},
 async start(){throw new Error('Disabled in fixture')},async reply(){throw new Error('Disabled in fixture')},async respond(){throw new Error('Disabled in fixture')},
}}/>);
