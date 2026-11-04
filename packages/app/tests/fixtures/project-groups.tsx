import { createRoot } from 'react-dom/client';
import { MobileApp } from '../../src/mobile/MobileApp';
import '@freddai/ui/styles.css';
const now=Date.now();
const thread=(project:string,n:number)=>({id:`${project}-${n}`,project,title:`${project.toUpperCase()} task ${String(n).padStart(2,'0')}`,status:n<5?'running':'interrupted',updated:n===26?now+999999:now-n*86400000,last_user_message_at:now-n*86400000-(project==='b'?1000:0),messages:[],canReply:false,queued:0,error:null});
const threads=[...Array.from({length:27},(_,n)=>thread('a',n)),...Array.from({length:7},(_,n)=>thread('b',n))];
// Models the Mac host: read cursors live in the snapshot's `read_at`, set by markRead/mergeRead and only moving forward.
const hostCalls={markRead:[] as {thread:string;at:number}[],mergeRead:[] as Record<string,number>[]};
const raise=(id:string,at:number)=>{const t=threads.find(x=>x.id===id) as any;if(t&&at>(t.read_at??-Infinity))t.read_at=at};
Object.assign(window,{completeSyntheticThread:()=>{threads[0].status='done';threads[0].updated+=1000},hostCalls,hostReadAt:(id:string)=>(threads.find(x=>x.id===id) as any)?.read_at});
createRoot(document.getElementById('root')!).render(<MobileApp client={{
 async snapshot(){return {projects:[{id:'b',name:'Beta',color:'#777',canStart:false},{id:'a',name:'Alpha',color:'#777',canStart:false},{id:'empty',name:'Empty project',color:'#777',canStart:false}],threads:structuredClone(threads)}},
 async action({thread: id, action}){const index=threads.findIndex(t=>t.id===id);if(index<0)throw new Error('Missing synthetic thread');if(action==='stop')threads[index].status='interrupted';else threads.splice(index,1);},
 async markRead({thread:id,at}){hostCalls.markRead.push({thread:id,at});raise(id,at)},
 async mergeRead(cursors){hostCalls.mergeRead.push(cursors);for(const [id,at] of Object.entries(cursors))raise(id,at)},
 async start(){throw new Error('Disabled in fixture')},async reply(){throw new Error('Disabled in fixture')},async respond(){throw new Error('Disabled in fixture')},
}}/>);
