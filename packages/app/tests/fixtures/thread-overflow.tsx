// Isolated layout fixture: no accounts, credentials, native bridge or providers.
import { createRoot } from 'react-dom/client';
import { MobileApp } from '../../src/mobile/MobileApp';
import '@freddai/ui/styles.css';
import { ScrollArea } from '@freddai/ui/components/scroll-area';
import type { Session } from '../../src/desktop/types';
import { ThreadList } from '../../src/desktop/ThreadList';
import { ThreadTitle } from '../../src/desktop/ThreadTitle';
import { Code2 } from 'lucide-react';
import '../../src/workspace.css';
import '../../src/desktop/desktop.css';
const title = 'Investigate a very long thread title that must remain on one line without hiding the status or date '.repeat(4);
const unbroken = 'unbroken-thread-title-'.repeat(50);
const data = {
 projects: [{id:'synthetic',name:'ExtremelyLongProjectNameWithoutAnySpaces'.repeat(8),color:'#777',canStart:false}],
 threads: [title,unbroken].map((title,index)=>({id:String(index),project:'synthetic',title,status:'running',updated:1,messages:[],canReply:false,queued:0,error:null})),
};
const desktop = new URLSearchParams(location.search).get('surface') === 'desktop';
const desktopThreads: Session[] = data.threads.map(thread => ({ ...thread, account: "synthetic", provider_id: null, pending: null }));
const desktopRows = <div className="dev-app native-workspace"><ScrollArea className="thread-list-scroll min-h-0 flex-1" viewportProps={{className:'thread-list'}}><section>{<ThreadList threads={desktopThreads} renderRow={t => <div role="button" tabIndex={0} className="task-row compact-session" key={t.id}><span className="state-dot state-In-progress"/><strong className="session-title"><ThreadTitle title={t.title} onRename={async()=>{}}/></strong><span className="session-cli"><Code2 size={13}/></span><time className="task-time">now</time></div>} />}</section></ScrollArea></div>;
createRoot(document.getElementById('root')!).render(desktop ? desktopRows : <MobileApp client={{
 async snapshot(){return data},
 async start(){throw new Error('Disabled in layout fixture')},
 async reply(){throw new Error('Disabled in layout fixture')},
 async respond(){throw new Error('Disabled in layout fixture')},
}}/>);
