// Offline fixture: HomeView with stateful sessions; a stand-in conversation fills the panel. Sidebar column shows real row markup for comparison.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { HomeView } from '../../src/desktop/HomeView';
import { resolveHomeLaunch } from '../../src/desktop/home-launch';
import { Dot } from '../../src/desktop/ThreadStatus';
import { threadListStatus, type Account, type Project, type Session } from '../../src/desktop/types';
import '@freddai/ui/styles.css';
import '../../src/desktop/desktop.css';
import '../../src/workspace.css';
import '../../src/appearance/appearance.css';
import '../../src/desktop/themes.css';
import '../../src/desktop/home.css';

localStorage.setItem('freddai.office.recent-only.v1', 'false');
document.documentElement.dataset.freddaiAppearance = 'light'; document.documentElement.dataset.freddaiTheme = 'freddai';
const NOW = Date.now();
const account: Account = { id: 'a', name: 'Main', provider: 'claude', color: '#d99573' };
const codex: Account = { id: 'c', name: 'Main', provider: 'codex', color: '#59b99a' };
const colors = ['#5b7fd1', '#d15b7f', '#4cae7e'];
const projects: Project[] = ['Freddai', 'Landing page', 'Billing API'].map((name, i) => ({ id: `p${i}`, name, path: `/p/${i}`, color: colors[i], policy: 'inherit', account: null, last: null }) as Project);
const titles = ['Fix the build', 'Polish the dashboard tiles', 'Investigate flaky voice test', 'Write release notes', 'Refactor sidebar rows'];
const statuses = ['running', 'done', 'waiting', 'done', 'failed'];
const initial: Session[] = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, title: titles[i % 5] + (i > 4 ? ` ${i}` : ''), project: `p${i % 3}`, account: i % 2 ? 'c' : 'a', status: statuses[i % 5], updated: NOW - (i + 1) * 600_000, provider_id: null, messages: [], pending: null, error: null }) as unknown as Session);
const db = { accounts: [account, codex], projects, sessions: [], preferences: { fallback: 'a' } } as never;

function Convo({ s }: { s: Session }) {
  return <div className="chat-surface" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
    <div className="chat-transcript" style={{ flex: 1, overflow: 'auto', padding: 16 }}>
      <p><b>You</b><br />{s.title}, please.</p><p><b>Agent</b><br />On it. I looked at the files and made the change; tests pass.</p>
    </div>
    <form className="chat-composer" onSubmit={e => e.preventDefault()}><textarea aria-label="Reply" placeholder="Reply…" /></form>
  </div>;
}

function Fixture() {
  const [sessions, setSessions] = useState(initial);
  const [log, setLog] = useState<string[]>([]);
  (window as unknown as { log: string[] }).log = log;
  return <main className="native-workspace" style={{ display: 'grid', gridTemplateColumns: '300px 1fr', height: '100dvh', background: 'var(--background)' }}>
    <aside className="thread-browser" style={{ borderRight: '1px solid var(--border)', overflow: 'auto', padding: '8px 0' }} aria-label="Sidebar">
      {sessions.slice(0, 6).map(t => <div key={t.id} role="button" tabIndex={0} className="task-row compact-session">
        <span className="session-agent" style={{ color: t.account === 'c' ? codex.color : account.color }}>●</span>
        <strong className="session-title">{t.title}</strong><Dot status={threadListStatus(t, {})} /></div>)}
    </aside>
    <div className="home-pane" style={{ overflow: 'auto' }}>
      <HomeView sessions={sessions} projects={projects} accounts={[account, codex]} now={NOW} canCreate native={false}
        onOpenThread={id => setLog(l => [...l, `open:${id}`])} onAddProject={() => {}} onNewThread={p => setLog(l => [...l, `navigate-new:${p}`])}
        resolveLaunch={id => resolveHomeLaunch(db, id, 'bypass')}
        onCreateThread={async (project, prompt) => { const id = `n${Date.now()}`; setTimeout(() => setSessions(s => [{ id, title: prompt, project, account: 'a', status: 'running', updated: Date.now(), provider_id: null, messages: [], pending: null, error: null } as unknown as Session, ...s]), 300); return prompt; }}
        onRespond={async () => {}} renderThread={id => { const s = sessions.find(t => t.id === id); return s ? <Convo s={s} /> : null; }} />
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
