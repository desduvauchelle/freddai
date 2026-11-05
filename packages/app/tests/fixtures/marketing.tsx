// Offline marketing capture. No accounts, credentials, native host or dispatch.
import { createRoot } from 'react-dom/client';
import { HomeView } from '../../src/desktop/HomeView';
import { MobileApp } from '../../src/mobile/MobileApp';
import type { Project, Session } from '../../src/desktop/types';
import '@freddai/ui/styles.css';
import '../../src/workspace.css';
import '../../src/desktop/desktop.css';
import '../../src/desktop/themes.css';
import { mockIPC } from '@tauri-apps/api/mocks';
mockIPC((cmd, args) => {
  if (cmd !== 'day_summary') throw new Error('No native actions in marketing capture');
  return {date: args?.date, running: false, error: null, threads: 6, summary: {date: args?.date, markdown: 'Across three projects: shipped onboarding, fixed tablet navigation, and added search pagination.\n\nStill in progress: pricing page polish and offline support.', generated_at: Date.now(), provider: 'Preview', account: '', model: 'Illustrative recap', threads: 6}};
});
const now = Date.now();
const projects: Project[] = [
  { id: 'web', name: 'Website', color: '#9b91d2', path: '/demo/website', policy: 'inherit', account: null, last: null },
  { id: 'app', name: 'Mobile app', color: '#86b8a3', path: '/demo/mobile', policy: 'inherit', account: null, last: null },
  { id: 'api', name: 'API', color: '#d6ad74', path: '/demo/api', policy: 'inherit', account: null, last: null },
];
const sessions: Session[] = ['Polish the pricing page', 'Add offline support', 'Speed up search', 'Fix navigation on tablets', 'Ship the new onboarding', 'Add pagination'].map((title, i) => ({id: String(i), title, project: projects[i % 3].id, account: '', status: i < 2 ? 'running' : 'done', updated: now - i * 60000, last_user_message_at: now - i * 60000, provider_id: null, messages: [], pending: null, error: null}));
const disabled = async (): Promise<never> => { throw new Error('Disabled in offline marketing capture'); };
const mobile = new URLSearchParams(location.search).has('mobile');
document.documentElement.classList.add('dark');
createRoot(document.getElementById('root')!).render(mobile ? <MobileApp client={{
  async snapshot() { return { projects: projects.map(p => ({...p, canStart: false})), threads: sessions.map(s => ({...s, canReply: false, queued: 0})) }; },
  start: disabled, reply: disabled, respond: disabled, action: disabled,
}} /> : <div className="dev-app native-workspace dark" style={{height: '100vh', overflow:'hidden'}}><div style={{padding:'18px 30px', borderBottom:'1px solid #ffffff18', display:'flex', justifyContent:'space-between'}}><strong>freddai</strong><span>Home · Your projects at a glance</span></div><HomeView sessions={sessions} projects={projects} accounts={[]} now={now} canCreate={false} resolveLaunch={() => ({ok:false, reason:'Offline preview'})} onOpenThread={() => {}} onAddProject={() => {}} onCreateThread={disabled} onRespond={disabled} /></div>);
