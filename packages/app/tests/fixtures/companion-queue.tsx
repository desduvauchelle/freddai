import { createRoot } from 'react-dom/client';
import { MobileApp } from '../../src/mobile/MobileApp';
import { disconnectedClient, type CompanionSnapshot } from '../../src/mobile/companion';
import '@freddai/ui/styles.css';
const data: CompanionSnapshot = { projects: [{id:'p',name:'Freddai',color:'#777',canStart:false}], threads: [{
 id:'queue-demo',project:'p',title:'Check companion layout',status:'running',updated:Date.now(),provider:'codex',canReply:true,queued:3,error:null,
 messages:[{id:'u',role:'user',text:'Make the companion layout more compact.'},{id:'a',role:'assistant',text:'I’m checking the phone and tablet layouts. Your next messages will run in order after this turn.'}],
 queue:[{id:'1',prompt:'Check the composer with the keyboard open on a small phone.',attachments:0},{id:'2',prompt:'Then verify landscape on iPad and make sure the draft survives rotation.',attachments:2},{id:'3',prompt:'Summarize what changed and the checks that passed.',attachments:0}],
}] };
createRoot(document.getElementById('root')!).render(<MobileApp client={{...disconnectedClient,
 async snapshot(){return structuredClone(data)},
 async queue({action,message}){const t=data.threads[0];if(action==='pause'||action==='resume')t.queuePaused=action==='pause';if(action==='clear')t.queue=[];if(action==='delete'||action==='steer')t.queue=t.queue?.filter(m=>m.id!==message);t.queued=t.queue?.length||0;t.updated++;},
}}/>);
