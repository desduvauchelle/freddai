// Offline Office fixture: synthetic projects and threads, no accounts or provider calls.
// ?variant=full|mini, ?width=<card px> for mini. `window.__office.advance()` moves the story one step so characters walk.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Office } from '../../src/office/index';
import type { Project, Session } from '../../src/desktop/types';

const params = new URLSearchParams(location.search);
const variant = params.get('variant') === 'mini' ? 'mini' : 'full';
const width = Number(params.get('width') || 720);
const NOW = new Date(2026, 10, 4, 15, 0).getTime();
const colors = ['#5b7fd1', '#d15b7f', '#4cae7e', '#e2b34a', '#9b6bd1', '#4fb8c9', '#d1895b', '#7fd15b', '#5bd1c4', '#c45bd1'];
const allNames = ['Freddai', 'Landing page', 'Billing API', 'Mobile companion', 'Docs', 'Infra', 'Analytics', 'Website', 'Support', 'Research'];
const names = Array.from({ length: Math.min(40, Math.max(0, Number(params.get('projects') ?? 6))) }, (_, i) => allNames[i] ?? `Project ${i + 1}`);
const projects: Project[] = names.map((name, i) => ({ id: `p${i}`, name, path: `/p/${i}`, color: colors[i % colors.length], policy: 'inherit', account: null, last: null }));
const msgs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', text: '' }));
const pending = { id: 1, request: { subtype: 'can_use_tool', tool_name: 'Bash', input: {} } } as never;

type Spec = [id: string, project: number, status: string, user: number, wait?: boolean];
const base: Spec[] = [
  ['t1', 0, 'running', 12], ['t2', 0, 'running', 8], ['t3', 0, 'waiting', 5, true],
  ['t4', 1, 'running', 14], ['t5', 1, 'failed', 3],
  ['t6', 2, 'done', 9], ['t7', 2, 'review', 4],
  ['t8', 3, 'starting', 1],
  ['t9', 4, 'running', 7], ['t10', 4, 'running', 6], ['t11', 4, 'waiting', 2, true],
  ['t12', 5, 'running', 11],
];
// Each step is a set of overrides applied on top of the previous one.
const steps: Record<string, Partial<Record<string, Spec | null>>>[] = [
  {},
  { t3: ['t3', 0, 'running', 6], t4: ['t4', 1, 'waiting', 15, true], t1: ['t1', 0, 'done', 13], t8: ['t8', 3, 'running', 2], t13: ['t13', 5, 'starting', 1] },
  { t13: ['t13', 5, 'running', 2], t5: ['t5', 1, 'running', 4], t10: ['t10', 4, 'review', 7], t14: ['t14', 2, 'starting', 1] },
] as never;

function specsAt(step: number): Spec[] {
  const map = new Map(base.map(s => [s[0], s] as const));
  for (let i = 1; i <= step; i++) for (const [id, v] of Object.entries(steps[i])) { if (v) map.set(id, v as Spec); else map.delete(id); }
  return [...map.values()];
}
const toSessions = (step: number): Session[] => specsAt(step).map(([id, p, status, user, wait], i) => ({
  id, title: `Thread ${id} on ${names[p]}`, project: `p${p}`, account: 'a', status, updated: NOW - (i + 1) * 60_000,
  provider_id: null, messages: msgs(user * 2), pending: wait ? pending : null, error: null,
}));

function Fixture() {
  const [step, setStep] = useState(0);
  (window as unknown as { __office: unknown }).__office = { advance: () => setStep(s => Math.min(s + 1, steps.length - 1)), step };
  const sessions = toSessions(step);
  return <div style={{ padding: variant === 'mini' ? 16 : 0 }}>
    <div style={{ width: variant === 'mini' ? width : undefined, position: 'relative' }}>
      <Office variant={variant} sessions={sessions} projects={projects} schedules={Array.from({ length: Number(params.get('schedules') || 0) }, (_, i) => ({ id: `s${i}`, name: `Scheduled task ${i + 1}`, project: 'p0', next_due: NOW + (i + 1) * 3600_000, enabled: true }))} now={NOW} onOpenThread={id => { (window as unknown as { __opened: string }).__opened = id; }} onClose={() => {}} />
    </div>
    <button id="advance" style={{ position: 'fixed', right: 8, top: 8, zIndex: 100 }} onClick={() => setStep(s => Math.min(s + 1, steps.length - 1))}>Advance ({step})</button>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
