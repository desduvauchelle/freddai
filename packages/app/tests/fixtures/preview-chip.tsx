import { createRoot } from 'react-dom/client';
import { MobileApp } from '../../src/mobile/MobileApp';
import type { CompanionSnapshot } from '../../src/mobile/companion';
import '@freddai/ui/styles.css';
const data: CompanionSnapshot = {projects:[{id:'p',name:'Synthetic project',color:'#777',canStart:true,provider:'claude'}],threads:[{id:'t',project:'p',title:'Preview chip',status:'done',updated:Date.now(),messages:[{id:'m1',role:'user',text:'Show me the app'},{id:'m2',role:'assistant',text:'The dev server is running at http://localhost:3000/ and the docs at http://localhost:5173/some/very/long/path/that/goes/on?query=value&other=thing'}],canReply:true,queued:0,error:null,provider:'claude',options:{model:'sonnet',effort:'high',permission_mode:'ask'}}]};
createRoot(document.getElementById('root')!).render(<MobileApp client={{
 async snapshot(){return structuredClone(data);},
 async models(){return [];},
 async attach(file){return {id:crypto.randomUUID(),name:file.name,bytes:file.size,mime:file.type,sha256:'synthetic'};},
 async queue(){}, async action(){},
 start:async()=>'t', reply:async()=>undefined, respond:async()=>undefined,
}}/>);
