// Offline Office v7 (Campus) fixture: mounts OfficeSwitch (v7) with synthetic sessions. ?variant=mini|full
import { createRoot } from 'react-dom/client';
import { Office7 } from '../../src/office7';
import type { Project, Session } from '../../src/desktop/types';

localStorage.setItem('freddai.office.version.v1', 'v7');
localStorage.setItem('freddai.office.recent-only.v1', 'false');
const variant = new URLSearchParams(location.search).get('variant') === 'full' ? 'full' : 'mini';
const NOW = Date.now();
const colors = ['#5b7fd1', '#d15b7f', '#4cae7e', '#e2b34a', '#9b6bd1', '#4fb8c9'];
const baseNames = ['Freddai', 'Landing page', 'Billing API'];
const extraNames = ['recursive-engine', 'recursive-sales', 'livecase-blog', 'LC - Agent', 'ai-juicing-landing', 'tucky', 'youtuber-video-recorder', 'tamias-duo', 'rs-landing', 'ai-tutor', 'gamer-one', 'tamail', 'pipelens', 'app-factory', 'livecase-apps', 'livecaseplus-server', 'infra', 'docs', 'mobile', 'web', 'cli', 'ops'];
// ?projects=N (3..25) adds extra projects beyond the three that own sessions, to test the guild district layout.
const wanted = Math.min(25, Math.max(3, Number(new URLSearchParams(location.search).get('projects') ?? 3)));
const names = [...baseNames, ...extraNames].slice(0, wanted);
const projects: Project[] = names.map((name, i) => ({ id: `p${i}`, name, path: `/p/${i}`, color: colors[i % colors.length], policy: 'inherit', account: null, last: null }));
const msgs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', text: '' }));
const pending = { id: 1, request: { subtype: 'can_use_tool', tool_name: 'Bash', input: {} } } as never;
const specs: [string, number, string, number, boolean?, number?][] = [
  ['t1', 0, 'running', 12], ['t2', 0, 'running', 8], ['t3', 1, 'waiting', 5, true], ['t4', 1, 'review', 4],
  ['t5', 2, 'done', 9], ['t6', 2, 'failed', 3], ['t7', 1, 'starting', 1], ['t8', 1, 'running', 6],
];
const sessions: Session[] = specs.map(([id, p, status, user, wait, age], i) => ({
  id, title: `Thread ${id} on ${names[p]}`, project: `p${p}`, account: 'a', status, updated: NOW - (age ?? (i + 1) * 10_000),
  provider_id: null, messages: msgs(user * 2), pending: wait ? pending : null, error: status === 'failed' ? 'boom' : null,
} as unknown as Session));
createRoot(document.getElementById('root')!).render(
  <div style={{ padding: 16, width: variant === 'mini' ? 900 : undefined, position: 'relative' }}>
    <Office7 variant={variant} sessions={sessions} projects={projects} schedules={[]} now={NOW} onOpenThread={() => {}} onClose={() => {}} />
  </div>);
