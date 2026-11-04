import { createRoot } from 'react-dom/client';
import { MobileApp } from '../../src/mobile/MobileApp';
import type { CompanionSnapshot } from '../../src/mobile/companion';
import '@freddai/ui/styles.css';
const data: CompanionSnapshot = {projects:[{id:'p',name:'Synthetic project',color:'#777',canStart:true,provider:'claude'}],threads:[{id:'t',project:'p',title:'Send latency',status:'running',updated:Date.now(),messages:[],canReply:true,queued:0,error:null,provider:'claude',options:{model:'sonnet',effort:'high',permission_mode:'ask'}}]};
let resolveSend: (value?: any) => void;
let rejectSend: (error: Error) => void;
let sent = '';
let resolveDecision: () => void;
let rejectDecision: (error: Error) => void;
Object.assign(window, {
 acknowledgeSend:()=>resolveSend('new-thread'),
 rejectSend:()=>rejectSend(new Error('Synthetic send failure')),
 publishSend:()=>{data.threads[0].messages.push({id:crypto.randomUUID(),role:'user',text:sent});data.threads[0].updated++;},
 snapshotCalls:0,
 composerCalls:[],
 setQueue:()=>{data.threads[0].queue=[{id:'q1',prompt:'Pending direction',attachments:1}];data.threads[0].queued=1;},
 setIdle:()=>{data.threads[0].status='done';},
 showDecision:()=>{data.threads[0].pending={id:'decision-1',method:'item/commandExecution/requestApproval',params:{command:'echo synthetic'}};},
 acknowledgeDecision:()=>resolveDecision(),
 rejectDecision:()=>rejectDecision(new Error('Synthetic decision failure')),
 clearDecision:()=>{data.threads[0].pending=null;},
});
const dispatch = (prompt:string)=>{sent=prompt;return new Promise<any>((resolve,reject)=>{resolveSend=resolve;rejectSend=reject;});};
createRoot(document.getElementById('root')!).render(<MobileApp client={{
 async snapshot(){(window as any).snapshotCalls++;return structuredClone(data);},
 async models(){return [];},
 async attach(file){return {id:crypto.randomUUID(),name:file.name,bytes:file.size,mime:file.type,sha256:'synthetic'};},
 async queue(input){(window as any).composerCalls.push(input);if(input.action==='pause')data.threads[0].queuePaused=true;if(input.action==='resume')data.threads[0].queuePaused=false;if(['clear','delete'].includes(input.action)){data.threads[0].queue=[];data.threads[0].queued=0;}},
 async action(input){(window as any).composerCalls.push(input);if(input.action==='stop'){data.threads[0].status='interrupted';data.threads[0].queuePaused=true;}},
 start:input=>{(window as any).composerCalls.push(input);return dispatch(input.prompt);}, reply:input=>{(window as any).composerCalls.push(input);return dispatch(input.prompt);}, respond:()=>new Promise<void>((resolve,reject)=>{resolveDecision=resolve;rejectDecision=reject;}),
}}/>);
