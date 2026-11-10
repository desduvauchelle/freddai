import type { Message } from '../desktop/types';
import type { Model } from '../desktop/agent-selection';
import type { CompanionClient, CompanionSnapshot, CompanionThread, CommanderClient } from './companion';
import type { Proposal, Todo, NoteSummary } from '../desktop/commander/api';
import { createMockGoogleHost, mockAccounts, mockTriggers } from '../desktop/google-mocks';

/**
 * Offline fake Mac for simulator screenshots and UI work. Never imported by device builds:
 * apps/native/src/mobile.tsx loads it only when VITE_COMPANION_FIXTURE === '1'.
 * No network, no accounts, no pairing; start/reply append fake messages locally.
 */
const now = Date.now();
const min = 60_000, hour = 3_600_000, day = 24 * hour;
let seq = 0;
const msg = (role: string, text: string): Message => ({ id: `fx-${++seq}`, role, text });

const assistants = [{ id: 'claude-personal', name: 'Personal', provider: 'claude' }, { id: 'codex-work', name: 'Work', provider: 'codex' }];
const projects: CompanionSnapshot['projects'] = [
  { id: 'commander', name: 'Commander-in-Chief', color: '#d98a3d', canStart: true, provider: 'claude', defaultAssistant: 'claude-personal', assistants, kind: 'commander', objective: 'Chief of staff: routes work to projects, tracks to-dos and checks results.' },
  { id: 'freddai', name: 'Freddai', color: '#7c6cf0', canStart: true, provider: 'claude', defaultAssistant: 'claude-personal', assistants },
  { id: 'lucy-web', name: 'Lucy Web', color: '#2fa37a', canStart: true, provider: 'codex', defaultAssistant: 'codex-work', assistants },
  { id: 'dormouse-rive', name: 'Dormouse Rive', color: '#e0803c', canStart: true, provider: 'claude', defaultAssistant: 'claude-personal', assistants },
];

const markdown = `I traced the unread badge to the companion snapshot. Here is what I found.

## Root cause

\`readCursor\` is stored per device, but the Mac only reports \`updated\` for threads it has *rendered*. A thread that finished while the window was closed never got a cursor, so it stays unread forever.

### Fix

1. Seed the cursor from \`updated\` when a thread first appears in a snapshot.
2. Persist the cursor after \`respond()\` succeeds, not before.
3. Keep the badge logic pure so it can be unit tested.

\`\`\`ts
export function threadListStatus(
  thread: Pick<Session, 'id' | 'status' | 'updated'>,
  read: Record<string, number>,
): string {
  const seen = read[thread.id] ?? -1;
  return thread.status === 'done' && seen < thread.updated ? 'unread' : thread.status;
}
\`\`\`

And the host side:

\`\`\`rust
fn mark_read(state: &mut ReadState, thread: &str, updated: i64) {
    let entry = state.cursors.entry(thread.to_owned()).or_insert(0);
    *entry = (*entry).max(updated);
}
\`\`\`

| Case | Before | After |
| --- | --- | --- |
| Finished while closed | unread forever | unread once |
| Opened on phone | unread | read |
| Opened on Mac | unread on phone | read everywhere |

> Note: this changes behavior for threads older than a week, which were previously never badged.

- Tests: \`pnpm --filter @freddai/app test\` passes (214 tests)
- Typecheck is clean
- Remaining: confirm on a real device`;

const longTranscript: Message[] = [
  msg('user', 'The unread badge on my phone never clears for threads that finished while my Mac was asleep. Can you find out why?'),
  msg('assistant', 'I will start by finding where the badge is computed and how the read cursor is stored.'),
  msg('tool', 'Grep  threadListStatus  in packages/app/src'),
  msg('tool', 'Read  packages/app/src/desktop/types.ts  (lines 100-140)'),
  msg('tool', 'Read  packages/app/src/mobile/MobileApp.tsx  (lines 30-120)'),
  msg('assistant', 'The status rule is simple and correct. The issue must be what feeds `read`. Checking the host snapshot code.'),
  msg('tool', 'Bash  cargo test -p freddai-host read_state -- --nocapture'),
  msg('tool', 'Edit  crates/host/src/read_state.rs'),
  msg('user', 'Great, go ahead and fix it. Keep the change small.'),
  msg('assistant', markdown),
];

const t = (id: string, project: string, title: string, status: string, ago: number, extra: Partial<CompanionThread> = {}): CompanionThread => ({
  id, project, title, status, updated: now - ago, last_user_message_at: now - ago - 2 * min,
  messages: [msg('user', title), msg('assistant', status === 'running' ? 'Working on it. Reading the relevant files first.' : 'Done. Summary of the change is above.')],
  canReply: true, queued: 0, error: null, provider: projects.find(p => p.id === project)?.provider, ...extra,
});

const threads: CompanionThread[] = [
  t('cmd1', 'commander', 'Commander chat', 'done', 6 * min, { messages: [msg('user', 'What is blocked today?'), msg('assistant', 'Two things need you: the Lucy Web pricing change and the iOS install. Everything else is moving.')] }),
  t('t1', 'freddai', 'Sync read state between Mac and iPhone', 'done', 4 * min, { messages: longTranscript }),
  t('t2', 'freddai', 'Native drawer for thread list', 'running', 20_000, { messages: [msg('user', 'Build a native iOS drawer for the thread list.'), msg('tool', 'Read  MobileApp.tsx'), msg('tool', 'Edit  native-shell.ts'), msg('assistant', 'Wiring the drawer rows to the existing thread model now.')] }),
  t('t3', 'freddai', 'Run the iOS install script on device', 'waiting', 3 * min, {
    pending: { request_id: 'req-1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'pnpm ios:install', description: 'Build, sign and install the companion on the paired iPhone' } } },
    messages: [msg('user', 'Install the latest build on my iPhone.'), msg('assistant', 'I need to run the install script. This builds and installs on your paired device.')],
  }),
  t('t4', 'lucy-web', 'Fix flaky checkout test on Safari', 'failed', 35 * min, { error: 'Agent exited with code 1: test runner timed out after 120s', messages: [msg('user', 'The checkout e2e test fails on Safari about one run in five.'), msg('tool', 'Bash  pnpm test:e2e --project=webkit'), msg('assistant', 'The run stopped before I could finish.')] }),
  t('t5', 'lucy-web', 'Add dark mode to the pricing page', 'done', 2 * hour),
  t('t6', 'lucy-web', 'Audit unused dependencies', 'done', 5 * hour),
  t('t7', 'lucy-web', 'Draft release notes for 2.4', 'done', 26 * hour),
  t('t8', 'dormouse-rive', 'Tune sleeping animation timing', 'running', 90_000),
  t('t9', 'dormouse-rive', 'Export mascot states as Rive file', 'done', 2 * day),
  t('t10', 'dormouse-rive', 'Add confetti on first completed thread', 'done', 3 * day),
  t('t11', 'freddai', 'Queue follow-ups while agent is running', 'running', 8 * min, { queued: 2, queue: [{ id: 'q1', prompt: 'Also update the spec', attachments: 0 }, { id: 'q2', prompt: 'Then run typecheck', attachments: 0 }] }),
  t('t12', 'freddai', 'Refactor settings panel into tabs', 'done', 4 * day),
];

const models: Model[] = [
  { model: 'claude-opus-4-7', displayName: 'Opus', isDefault: true, supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'].map(reasoningEffort => ({ reasoningEffort })) },
  { model: 'claude-sonnet-5-5', displayName: 'Sonnet', supportedReasoningEfforts: ['low', 'medium', 'high'].map(reasoningEffort => ({ reasoningEffort })) },
  { model: 'claude-haiku-4-5', displayName: 'Haiku', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] },
];

/** Screenshot aid only (`VITE_COMPANION_FIXTURE_MANY=1`): older finished threads that exercise the 25-row Recent view. */
const manyThreads = (): CompanionThread[] => Array.from({ length: 30 }, (_, i) => t(`many${i}`, i % 3 === 0 ? 'lucy-web' : 'freddai', `Archive task ${String(i + 1).padStart(2, '0')}`, 'done', (3 + i) * hour));

const codexModels: Model[] = [
  { model: 'gpt-5.5', displayName: 'GPT-5.5', isDefault: true, supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'].map(reasoningEffort => ({ reasoningEffort })) },
  { model: 'gpt-5.5-mini', displayName: 'GPT-5.5 Mini', supportedReasoningEfforts: ['low', 'medium'].map(reasoningEffort => ({ reasoningEffort })) },
];

const iso = (ago: number) => new Date(now - ago).toISOString();
const baseTodo = (id: string, title: string, project: string | null, owner: Todo['owner'], status: Todo['status'], extra: Partial<Todo> = {}): Todo => ({
  id, title, description: null, project, owner, thread: null, status, due: null, check_back_at: null, verification: [],
  completion_basis: null, completion_note: null, created_at: iso(day), updated_at: iso(hour), history: [], ...extra,
});
function createCommanderFixture(getThreads: () => CompanionThread[]): CommanderClient {
  const proposals: Proposal[] = [{
    id: 'fx-prop-1', tool: 'freddai_start_task', summary: 'Start a task in Lucy Web: add a pricing FAQ', project: 'lucy-web',
    arguments: { project: 'lucy-web', prompt: 'Add a pricing FAQ section below the plans table.' }, status: 'pending', result: null, error: null,
    thread: null, created_at: iso(5 * min), decided_at: null,
  }];
  const todos: Todo[] = [
    baseTodo('fx-todo-1', 'Review the dark mode pricing page', 'lucy-web', 'me', 'needs_review', {
      thread: 't5', verification: [{ requirement: 'Dark mode applies to all plan cards', status: 'met', evidence: 'Screenshot in the thread' }, { requirement: 'Contrast checked', status: 'unclear', evidence: null }] }),
    baseTodo('fx-todo-2', 'Tune sleeping animation timing', 'dormouse-rive', 'thread', 'in_progress', { thread: 't8' }),
    baseTodo('fx-todo-3', 'Plan the 2.4 release notes', 'freddai', 'commander', 'open', { due: iso(-day) }),
  ];
  const notes: (NoteSummary & { body: string })[] = [{ name: 'weekly-focus', title: 'Weekly focus', updated_at: iso(2 * hour), preview: 'Ship companion Commander.', body: '# Weekly focus\n\nShip companion Commander.' }];
  return {
    state: async () => ({
      project: { id: 'commander', name: 'Commander-in-Chief', objective: projects[0].objective ?? null, account: null, model: 'latest' },
      thread_id: getThreads().find(x => x.project === 'commander')?.id ?? null,
      status: { needs_you: proposals.filter(p => p.status === 'pending').length + todos.filter(x => x.status === 'needs_review').length, running: 1, done_today: 2 },
    }),
    proposals: async () => proposals.map(p => ({ ...p })),
    respond: async ({ id, approve, prompt }) => {
      const p = proposals.find(x => x.id === id); if (!p) throw new Error('Proposal not found');
      Object.assign(p, approve ? { status: 'approved', result: `Started a task${prompt ? ' (edited)' : ''}.`, thread: 't8' } : { status: 'declined' }, { decided_at: new Date().toISOString() });
      return { ...p };
    },
    todos: async () => todos.map(x => ({ ...x })),
    saveTodo: async patch => {
      const existing = todos.find(x => x.id === patch.id);
      if (existing) { Object.assign(existing, patch, { updated_at: new Date().toISOString() }); return { ...existing }; }
      const created = baseTodo(`fx-todo-${todos.length + 1}`, patch.title ?? 'Untitled', patch.project ?? null, patch.owner ?? 'me', patch.status ?? 'open', patch);
      todos.push(created); return { ...created };
    },
    notes: async () => notes.map(({ body: _body, ...n }) => n),
    readNote: async name => ({ name, body: notes.find(n => n.name === name)?.body ?? '' }),
    writeNote: async (name, body) => { const n = notes.find(x => x.name === name); if (n) n.body = body; return { name, title: name, updated_at: new Date().toISOString(), preview: body.slice(0, 80) }; },
  };
}

export function createFixtureClient(options: { many?: boolean; stallReplies?: boolean } = {}): CompanionClient {
  const state: CompanionSnapshot = { canReorderProjects: true, threadList: { projectOrder: projects.map(p => p.id) }, projects, threads: [...threads, ...(options.many ? manyThreads() : [])].map(x => ({ ...x, messages: [...x.messages] })) };
  const touch = (id: string, fn: (th: CompanionThread) => void) => {
    const th = state.threads.find(x => x.id === id); if (!th) return;
    fn(th); th.updated = Date.now(); th.last_user_message_at = th.updated;
  };
  const commander = createCommanderFixture(() => state.threads);
  const google = createMockGoogleHost({ accounts: mockAccounts, triggers: mockTriggers.map(t => ({ ...t, project: 'freddai', account: 'claude-personal' })) });
  return {
    commander,
    googleCommand: google.command,
    moveProject: async (project, target, after) => {
      const order = (state.threadList?.projectOrder || state.projects.map(p => p.id)).filter(id => id !== project);
      order.splice(order.indexOf(target) + (after ? 1 : 0), 0, project);
      state.threadList = { ...state.threadList, projectOrder: order };
      return order;
    },
    summaries: {
      get: async date => ({ date, running: false, error: null, threads: 3,
        summary: { date, markdown: 'Completed the dashboard layout and reviewed project activity. All summaries stay in the same scrolling page as your projects.', generated_at: now, provider: 'fixture', account: '', model: '', threads: 3 } }),
      generate: async () => { throw new Error('Summary generation is disabled in the offline layout fixture.'); },
    },
    snapshot: async () => ({ canReorderProjects: true, threadList: state.threadList, projects: state.projects, threads: state.threads.map(x => ({ ...x, messages: [...x.messages] })) }),
    models: async target => {
      const a = assistants.find(x => x.id === target.assistant);
      const provider = a?.provider ?? (target.thread ? state.threads.find(x => x.id === target.thread)?.provider : projects.find(p => p.id === target.project)?.provider);
      return provider === 'codex' ? codexModels : models;
    },
    // Pretend the Mac accepted the upload; the file never leaves the simulator.
    attachPath: async file => ({ id: `fx-att-${++seq}`, name: file.name, bytes: 0, mime: file.mime, sha256: '' }),
    voice: async () => ({ enabled: true, ready: true }),
    transcribe: async () => ({ text: 'This is a dictated fixture sentence.', durationMs: 2000, model: 'fixture' }),
    start: async ({ project, prompt, assistant, options }) => {
      const id = `fx-new-${++seq}`;
      state.threads.unshift({ id, project, title: prompt.slice(0, 60), status: 'running', updated: Date.now(), last_user_message_at: Date.now(), messages: [msg('user', prompt), msg('assistant', 'On it. (Fixture mode: no agent is running.)')], canReply: true, queued: 0, error: null, provider: assistants.find(a => a.id === assistant)?.provider ?? projects.find(p => p.id === project)?.provider, options: options && { model: options.model, effort: options.effort, permission_mode: options.permission_mode } });
      return id;
    },
    reply: async ({ thread, prompt }) => options.stallReplies ? new Promise<never>(() => {}) /* screenshot aid: keeps the message in the on-device queue strip */ : touch(thread, th => { th.messages.push(msg('user', prompt), msg('assistant', 'Got it. (Fixture mode: no agent is running.)')); }),
    respond: async ({ thread, allow }) => touch(thread, th => { th.pending = null; th.status = 'running'; th.messages.push(msg('assistant', allow ? 'Allowed. Continuing.' : 'Declined. Skipping that step.')); }),
    action: async ({ thread, action }) => { if (action === 'stop') touch(thread, th => { th.status = 'done'; }); else state.threads = state.threads.filter(x => x.id !== thread); },
    queue: async () => {},
  };
}
