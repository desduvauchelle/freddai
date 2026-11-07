import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { disconnectedClient, type CompanionClient, type CompanionSnapshot } from './companion';

// A fake native mobile shell: every bridge call is recorded and every event handler captured, so the test can "tap" native UI.
const shell = vi.hoisted(() => {
  const handlers: Record<string, (...args: never[]) => void> = {};
  const on = (name: string) => vi.fn(async (handler: (...args: never[]) => void) => { handlers[name] = handler; return () => {}; });
  return {
    handlers,
    setMode: vi.fn(async () => {}), setComposerText: vi.fn(async () => {}), discardFiles: vi.fn(async () => {}), pickOption: vi.fn(async () => null as string | null),
    setDashboard: vi.fn(async (_model: unknown) => {}),
    setVoice: vi.fn(async () => {}), appendComposerText: vi.fn(async () => {}),
    on,
  };
});
vi.mock('./native-shell', () => ({
  hasNativeDashboardContent: () => true, isNativeShell: () => true, probeNativeShell: async () => true, useNativeShell: () => true,
  setMode: shell.setMode, setComposerText: shell.setComposerText, discardFiles: shell.discardFiles, pickOption: shell.pickOption,
  setVoice: shell.setVoice, appendComposerText: shell.appendComposerText, onVoiceRecorded: shell.on('voiceRecorded'), onVoiceError: shell.on('voiceError'),
  setDashboard: shell.setDashboard, onDashboardAction: shell.on('dashboardAction'),
  setConnection: vi.fn(async () => {}), setThreads: vi.fn(async () => {}), setThreadMeta: vi.fn(async () => {}),
  onNavBack: shell.on('navBack'), onComposerSend: shell.on('composerSend'), onConnectionTap: shell.on('connectionTap'), onThreadAction: shell.on('threadAction'), onSelectThread: shell.on('selectThread'),
  onSearch: shell.on('search'), onSetFilter: shell.on('setFilter'), onNewThread: shell.on('newThread'), onMoveProject: shell.on('moveProject'), onShowOlder: shell.on('showOlder'), onSetView: shell.on('setView'), onRecentPage: shell.on('recentPage'), onDashboard: shell.on('dashboard'),
}));
import { MobileApp } from './MobileApp';
import { setThreads as sentThreads } from './native-shell';

const assistants = [{ id: 'a', name: 'Personal', provider: 'claude' }, { id: 'b', name: 'Work', provider: 'codex' }];
const data: CompanionSnapshot = {
  projects: [
    { id: 'p1', name: 'First', color: '#777', canStart: true, defaultAssistant: 'a', assistants },
    { id: 'p2', name: 'Second', color: '#777', canStart: true, defaultAssistant: 'a', assistants },
  ],
  threads: [{ id: 't1', project: 'p1', title: 'Old thread', status: 'done', updated: 5, messages: [], canReply: true, queued: 0, error: null }],
};
const file = { path: '/tmp/freddai-attachments/x/photo.jpg', name: 'photo.jpg', mime: 'image/jpeg', bytes: 1000 };
const clientWith = (extra: Partial<CompanionClient> = {}): CompanionClient => ({
  ...disconnectedClient, snapshot: async () => structuredClone(data), models: async () => [],
  attachPath: vi.fn(async f => ({ id: `att-${f.name}`, name: f.name, bytes: 1000, mime: f.mime, sha256: '' })),
  start: vi.fn(async () => 'new-thread'), ...extra,
});
const modeCalls = () => shell.setMode.mock.calls as unknown as [string, Record<string, unknown>][];
const send = (text: string, files: unknown[] = []) => act(async () => { (shell.handlers.composerSend as (t: string, f: unknown[]) => void)(text, files); });

beforeAll(() => {
  // Reduced motion keeps the mascot static in jsdom.
  window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })) as never;
});
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
afterEach(cleanup);

it('launches on the New thread home with the drawer closed, even when threads exist', async () => {
  localStorage.setItem('freddai.companion.lastThread', 't1');
  render(<MobileApp client={clientWith()} />);
  expect(await screen.findByText('What should we work on today?')).toBeTruthy();
  await waitFor(() => expect(modeCalls().some(([mode]) => mode === 'new')).toBe(true));
  expect(modeCalls().every(([mode, options]) => mode !== 'conversation' && !options?.openDrawer)).toBe(true);
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(await screen.findByRole('button', { name: 'Project: First' })).toBeTruthy();
  expect(await screen.findByRole('button', { name: 'Coding agent: Claude · Personal' })).toBeTruthy();
});

it('starts a thread with the chosen project, agent and model, then opens the conversation', async () => {
  const client = clientWith();
  render(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  shell.pickOption.mockResolvedValueOnce('p2');
  await act(async () => { screen.getByRole('button', { name: 'Project: First' }).click(); });
  await screen.findByRole('button', { name: 'Project: Second' });
  shell.pickOption.mockResolvedValueOnce('b');
  await act(async () => { screen.getByRole('button', { name: /^Coding agent/ }).click(); });
  await screen.findByRole('button', { name: 'Coding agent: Codex · Work' });
  shell.pickOption.mockResolvedValueOnce('gpt-x').mockResolvedValueOnce('high');
  await act(async () => { (shell.handlers.threadAction as (p: {action: string}) => void)({action:'model'}); });
  expect(shell.pickOption).toHaveBeenCalledWith(expect.objectContaining({title: 'Reasoning effort'}));
  shell.pickOption.mockResolvedValueOnce('bypass');
  await act(async () => { (shell.handlers.threadAction as (p: {action: string}) => void)({action:'permissions'}); });
  await send('Build the thing');
  await waitFor(() => expect(client.start).toHaveBeenCalledWith(expect.objectContaining({
    project: 'p2', assistant: 'b', prompt: 'Build the thing', options: expect.objectContaining({ model: 'gpt-x', effort: 'high', permission_mode: 'bypass', attachments: [] }),
  })));
  await waitFor(() => expect(modeCalls().at(-1)?.[0]).toBe('conversation'));
  expect(localStorage.getItem('freddai.companion.lastProject')).toBe('p2');
});

it('reopens on the last used project', async () => {
  localStorage.setItem('freddai.companion.lastProject', 'p2');
  render(<MobileApp client={clientWith()} />);
  expect(await screen.findByRole('button', { name: 'Project: Second' })).toBeTruthy();
});

it('uploads native attachments by path, sends their ids, and discards the tmp files after success', async () => {
  const client = clientWith();
  render(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await send('See photo', [file]);
  await waitFor(() => expect(client.start).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ attachments: ['att-photo.jpg'] }) })));
  expect(client.attachPath).toHaveBeenCalledWith(file);
  await waitFor(() => expect(shell.discardFiles).toHaveBeenCalledWith([file.path]));
});

it('shows an upload spinner until the attachment finishes, then a sending spinner until acknowledgment', async () => {
  let finishUpload!: (value: { id: string; name: string; bytes: number; mime: string; sha256: string }) => void;
  let finishSend!: (id: string) => void;
  const client = clientWith({
    attachPath: vi.fn(() => new Promise<Awaited<ReturnType<NonNullable<CompanionClient['attachPath']>>>>(resolve => { finishUpload = resolve; })),
    start: vi.fn(() => new Promise<string>(resolve => { finishSend = resolve; })),
  });
  render(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await send('See upload', [file]);
  const status = await screen.findByText('Uploading 1 of 1: photo.jpg…');
  expect(status.querySelector('svg')).toBeTruthy();
  await act(async () => finishUpload({ ...file, id: 'att-photo.jpg', sha256: '' }));
  expect(await screen.findByText('Sending…')).toBeTruthy();
  expect(screen.queryByText('Uploading 1 of 1: photo.jpg…')).toBeNull();
  await act(async () => finishSend('thread-upload'));
  await waitFor(() => expect(screen.queryByText('Sending…')).toBeNull());
});

it('retains rejected text and chips in the outbox without overwriting the next draft', async () => {
  const client = clientWith({ start: vi.fn(async () => { throw new Error('Mac said no'); }) });
  render(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await send('Try again', [file]);
  expect(await screen.findByText('Mac said no')).toBeTruthy();
  expect(shell.setComposerText).not.toHaveBeenCalledWith('Try again', [file]);
  expect(JSON.parse(localStorage.getItem('freddai.companion.outbox.v1') || '[]')[0]).toMatchObject({ prompt: 'Try again', nativeFiles: [file], blocked: true });
  expect(shell.discardFiles).not.toHaveBeenCalled();
});

it('refuses more than 20 files without uploading and restores the composer', async () => {
  const client = clientWith();
  render(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  const many = Array.from({ length: 21 }, (_, i) => ({ ...file, path: `/tmp/freddai-attachments/${i}/f.jpg` }));
  await send('Too many', many);
  expect(client.attachPath).not.toHaveBeenCalled();
  expect(client.start).not.toHaveBeenCalled();
  expect(shell.setComposerText).toHaveBeenCalledWith('Too many', many);
});

it('returns from a conversation to the native home on Android Back without starting work', async () => {
  const client = clientWith();
  render(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await act(async () => { (shell.handlers.selectThread as (p: { id: string }) => void)({ id: 't1' }); });
  await waitFor(() => expect(modeCalls().at(-1)?.[0]).toBe('conversation'));
  await act(async () => { shell.handlers.navBack(); });
  await screen.findByText('What should we work on today?');
  expect(modeCalls().at(-1)?.[0]).toBe('new');
  expect(client.start).not.toHaveBeenCalled();
});

it('shows the mic only when the Mac reports dictation ready, and auto-sends the transcript (typed text combined natively, same Send path)', async () => {
  const client = clientWith({ voice: vi.fn(async () => ({ enabled: true, ready: true })), transcribe: vi.fn(async () => ({ text: 'hello there', durationMs: 900, model: 'base' })) });
  render(<MobileApp client={client} />);
  await waitFor(() => expect(shell.setVoice).toHaveBeenCalledWith(true));
  await act(async () => { (shell.handlers.voiceRecorded as (p: string, ms: number) => void)('/tmp/freddai-attachments/x/dictation.m4a', 900); });
  await waitFor(() => expect(shell.appendComposerText).toHaveBeenCalledWith('hello there', true));
  expect(client.transcribe).toHaveBeenCalledWith({ path: '/tmp/freddai-attachments/x/dictation.m4a' });
  expect(shell.setVoice).toHaveBeenCalledWith(true, 'transcribing');
  expect(shell.setVoice).toHaveBeenLastCalledWith(true, 'idle');
});

it('hides the mic when dictation is not ready and surfaces transcription and microphone errors', async () => {
  const client = clientWith({ voice: vi.fn(async () => ({ enabled: true, ready: false })), transcribe: vi.fn(async () => { throw new Error('Voice dictation is turned off on the Mac'); }) });
  render(<MobileApp client={client} />);
  await waitFor(() => expect(shell.setVoice).toHaveBeenCalledWith(false));
  expect(shell.setVoice).not.toHaveBeenCalledWith(true);
  await act(async () => { (shell.handlers.voiceRecorded as (p: string, ms: number) => void)('/tmp/freddai-attachments/x/dictation.m4a', 900); });
  expect((await screen.findByRole('alert')).textContent).toContain('Voice dictation is turned off on the Mac');
  expect(shell.appendComposerText).not.toHaveBeenCalled();
  // A concurrent availability refresh may hide the mic again without changing its idle state.
  expect(shell.setVoice).toHaveBeenCalledWith(false, 'idle');
  await act(async () => { (shell.handlers.voiceError as (m: string) => void)('Microphone access is off — enable it in Settings › Freddai'); });
  expect((await screen.findByRole('alert')).textContent).toContain('Microphone access is off');
});

it('surfaces a failed dictation status check loudly and keeps the mic hidden', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const client = clientWith({ voice: vi.fn(async () => { throw new Error('Unknown composer operation'); }) });
  render(<MobileApp client={client} />);
  expect((await screen.findByRole('alert')).textContent).toContain('Dictation unavailable: Unknown composer operation');
  expect(warn).toHaveBeenCalledWith('[voice]', expect.any(String), 'Unknown composer operation');
  expect(shell.setVoice).not.toHaveBeenCalledWith(true);
  warn.mockRestore();
});

it('shows an accepted new message without a Mac handoff or queue label while the snapshot catches up', async () => {
  render(<MobileApp client={clientWith()} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await send('Start this work');
  // The header pill shows the thread title too; the message itself must be in the transcript.
  await waitFor(() => expect(screen.getAllByText('Start this work').some(el => !el.closest('.companion-fh'))).toBe(true));
  expect(screen.queryByText('Queued on your Mac')).toBeNull();
  expect(screen.queryByText('Continue this thread on your Mac.')).toBeNull();
  expect(screen.getByText('Starting…')).toBeTruthy();
});

it('keeps real queued replies visible and shows the streamed response after the host echoes the message', async () => {
  let snapshot = structuredClone(data);
  snapshot.threads[0].status = 'running';
  const client = clientWith({ snapshot: async () => structuredClone(snapshot), reply: vi.fn(async () => {}) });
  render(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await act(async () => { (shell.handlers.selectThread as (p: { id: string }) => void)({ id: 't1' }); });
  await send('Next instruction');
  expect(screen.queryByText('Queued on your Mac')).toBeNull();
  snapshot.threads[0].queue = [{ id: `phone:${(client.reply as ReturnType<typeof vi.fn>).mock.calls[0][0].requestId}`, prompt: 'Next instruction', attachments: 0 }];
  snapshot.threads[0].queued = 1;
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  await screen.findByRole('region', { name: 'Message queue' });
  expect(screen.queryByRole('article', { name: 'Your message' })).toBeNull();
  snapshot.threads[0].messages = [
    { id: 'user', role: 'user', text: 'Next instruction' },
    { id: 'assistant', role: 'assistant', text: 'Working on it' },
  ];
  snapshot.threads[0].queue = []; snapshot.threads[0].queued = 0;
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  await screen.findByText('Working on it');
  expect(screen.getAllByText('Next instruction')).toHaveLength(1);
  expect(screen.queryByRole('region', { name: 'Message queue' })).toBeNull();
});

it('does not send a running thread back to the Mac before replies become available', async () => {
  const snapshot = structuredClone(data);
  snapshot.threads[0].status = 'running'; snapshot.threads[0].canReply = false;
  render(<MobileApp client={clientWith({ snapshot: async () => snapshot })} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await act(async () => { (shell.handlers.selectThread as (p: { id: string }) => void)({ id: 't1' }); });
  await screen.findByText('Working…');
  expect(screen.queryByText('Continue this thread on your Mac.')).toBeNull();
  expect(screen.queryByText('This thread cannot take replies. Start a new thread to continue.')).toBeNull();
});

it('does not send an empty transcript and says so visibly', async () => {
  const client = clientWith({ voice: vi.fn(async () => ({ enabled: true, ready: true })), transcribe: vi.fn(async () => ({ text: '   ', durationMs: 300, model: 'base' })) });
  render(<MobileApp client={client} />);
  await waitFor(() => expect(shell.setVoice).toHaveBeenCalledWith(true));
  await act(async () => { (shell.handlers.voiceRecorded as (p: string, ms: number) => void)('/tmp/freddai-attachments/x/dictation.m4a', 300); });
  expect((await screen.findByRole('alert')).textContent).toContain("Didn't catch anything");
  expect(shell.appendComposerText).not.toHaveBeenCalled();
  expect(shell.setVoice).toHaveBeenLastCalledWith(true, 'idle');
});

it('warns and shows the error when transcription fails, without sending', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const client = clientWith({ voice: vi.fn(async () => ({ enabled: true, ready: true })), transcribe: vi.fn(async () => { throw new Error('model missing'); }) });
  render(<MobileApp client={client} />);
  await waitFor(() => expect(shell.setVoice).toHaveBeenCalledWith(true));
  await act(async () => { (shell.handlers.voiceRecorded as (p: string, ms: number) => void)('/tmp/freddai-attachments/x/dictation.m4a', 900); });
  expect((await screen.findByRole('alert')).textContent).toContain('Dictation failed: model missing');
  expect(warn).toHaveBeenCalledWith('[voice]', 'transcribe failed', 'model missing');
  expect(shell.appendComposerText).not.toHaveBeenCalled();
  warn.mockRestore();
});


it('starts an idle reply immediately and never duplicates it in the dispatch queue', async () => {
  const snapshot = structuredClone(data);
  const client = clientWith({ snapshot: async () => structuredClone(snapshot), reply: vi.fn(async () => {}) });
  render(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await act(async () => { (shell.handlers.selectThread as (p: { id: string }) => void)({ id: 't1' }); });
  await send('Idle follow-up');
  expect(screen.getByText('Starting…')).toBeTruthy();
  expect(screen.queryByText('Completed')).toBeNull();
  snapshot.threads[0].queue = [{ id: `phone:${(client.reply as ReturnType<typeof vi.fn>).mock.calls[0][0].requestId}`, prompt: 'Idle follow-up', attachments: 0 }];
  snapshot.threads[0].queued = 1;
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  await screen.findByText('Starting…');
  expect(screen.getAllByText('Idle follow-up')).toHaveLength(1);
  expect(screen.queryByRole('region', { name: 'Message queue' })).toBeNull();
  snapshot.threads[0].status = 'running';
  snapshot.threads[0].queue = []; snapshot.threads[0].queued = 0;
  snapshot.threads[0].messages = [{ id: 'echo', role: 'user', text: 'Idle follow-up' }];
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  await screen.findByText('Working…');
  expect(screen.getAllByText('Idle follow-up')).toHaveLength(1);
});


it('retains a rejected idle reply for explicit retry and returns the avatar to its real state', async () => {
  render(<MobileApp client={clientWith({ reply: vi.fn(async () => { throw new Error('Reply rejected'); }) })} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await act(async () => { (shell.handlers.selectThread as (p: { id: string }) => void)({ id: 't1' }); });
  await send('Keep my reply');
  expect(await screen.findByText('Reply rejected')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  expect(screen.getByText('Completed')).toBeTruthy();
  expect(shell.setComposerText).not.toHaveBeenCalledWith('Keep my reply', []);
});

it('shows a connection scene before projects are available, then replaces it with ready controls', async () => {
  let finish!: (value: CompanionSnapshot) => void;
  const pending = new Promise<CompanionSnapshot>(resolve => { finish = resolve; });
  render(<MobileApp client={clientWith({ snapshot: () => pending })} />);
  expect(await screen.findByText('Connecting to your Mac…')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Project:/ })).toBeNull();
  expect(screen.queryByText('What should we work on today?')).toBeNull();
  await act(async () => finish(structuredClone(data)));
  expect(await screen.findByRole('button', { name: 'Project: First' })).toBeTruthy();
  expect(screen.queryByText('Connecting to your Mac…')).toBeNull();
});

it.each([false, true])('records actual viewing only after the transcript loads with ignoreUnread=%s', async ignoreUnread => {
  let finish!: (value: CompanionSnapshot) => void;
  const pending = new Promise<CompanionSnapshot>(resolve => { finish = resolve; });
  const summary = structuredClone(data);
  summary.threadList = { ignoreUnread };
  summary.threads[0].messagesLoaded = false;
  const snapshot = vi.fn(async (_signal: AbortSignal, thread?: string) => thread ? pending : summary);
  const markRead = vi.fn(async () => {});
  render(<MobileApp client={clientWith({ snapshot, markRead })} />);
  await screen.findByRole('button', { name: 'Project: First' });
  expect(snapshot.mock.calls[0][1]).toBeUndefined();
  await act(async () => { (shell.handlers.selectThread as (p: { id: string }) => void)({ id: 't1' }); });
  expect(snapshot.mock.calls.at(-1)?.[1]).toBe('t1');
  expect(await screen.findByText('Loading conversation…')).toBeTruthy();
  expect(markRead).not.toHaveBeenCalled();
  const full = structuredClone(data);
  full.threadList = { ignoreUnread };
  full.threads[0].messagesLoaded = true;
  full.threads[0].messages = [{ id: 'm', role: 'assistant', text: 'Full conversation history is here' }];
  await act(async () => finish(full));
  expect(await screen.findByText('Full conversation history is here')).toBeTruthy();
  await waitFor(() => expect(markRead).toHaveBeenCalledWith({ thread: 't1', at: 5 }));
  expect(screen.queryByText('Loading conversation…')).toBeNull();
});


const dashboardAction = (event: { action: string; project?: string; assistant?: string; path?: string }) => act(async () => {
  (shell.handlers.dashboardAction as (p: typeof event) => void)(event);
});
it('opens native Dashboard cards without duplicating web controls and opens project threads', async () => {
  render(<MobileApp client={clientWith()} />);
  await screen.findByText('What should we work on today?');
  await act(async () => { shell.handlers.dashboard(); });
  expect(screen.queryByRole('article', { name: 'Project Second' })).toBeNull();
  expect(shell.setDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ projects: expect.arrayContaining([expect.objectContaining({ id: 'p2', name: 'Second', canStart: true })]) }));
  await dashboardAction({ action: 'open', project: 'p1' });
  expect(modeCalls().at(-1)).toEqual(['dashboard', { title: 'Dashboard', openDrawer: true }]);
  await act(async () => { (shell.handlers.selectThread as (p: {id: string}) => void)({ id: 't1' }); });
  await waitFor(() => expect(modeCalls().at(-1)?.[0]).toBe('conversation'));
});

it('carries native dashboard project agent, model and effort through the composer launch', async () => {
  const client = clientWith();
  render(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await act(async () => { shell.handlers.dashboard(); });
  shell.pickOption.mockResolvedValueOnce('b');
  await dashboardAction({ action: 'agent' });
  shell.pickOption.mockResolvedValueOnce('offline-model').mockResolvedValueOnce('high');
  await dashboardAction({ action: 'model', project: 'p2', assistant: 'b' });
  await dashboardAction({ action: 'new', project: 'p2', assistant: 'b' });
  await screen.findByRole('button', { name: 'Coding agent: Codex · Work' });
  await send('Offline dashboard launch');
  expect(client.start).toHaveBeenCalledWith(expect.objectContaining({ project: 'p2', assistant: 'b', options: expect.objectContaining({ model: 'offline-model', effort: 'high' }) }));
});

it('transcribes a native card recording into the captured project draft without sending', async () => {
  const client = clientWith({ transcribe: vi.fn(async () => ({ text: 'Dictated task', durationMs: 1200, model: 'fixture' })) });
  render(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await act(async () => { shell.handlers.dashboard(); });
  await dashboardAction({ action: 'voice', project: 'p2', assistant: 'b', path: '/tmp/freddai-attachments/task.m4a' });
  await screen.findByRole('button', { name: 'Project: Second' });
  expect(client.transcribe).toHaveBeenCalledWith({ path: '/tmp/freddai-attachments/task.m4a' });
  expect(shell.appendComposerText).toHaveBeenCalledWith('Dictated task', false);
  expect(client.start).not.toHaveBeenCalled();
  expect(shell.setComposerText).not.toHaveBeenCalled();
});

it('recovers native dashboard controls after transcription failure without launching a task', async () => {
  const client = clientWith({ transcribe: vi.fn(async () => { throw new Error('Mac disconnected'); }) });
  render(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await act(async () => { shell.handlers.dashboard(); });
  await dashboardAction({ action: 'voice', project: 'p2', assistant: 'b', path: '/tmp/freddai-attachments/task.m4a' });
  await waitFor(() => expect(shell.setDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'Dashboard: Mac disconnected' })));
  expect(shell.setDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ busy: false }));
  expect(client.start).not.toHaveBeenCalled();
});

it('retains a late dashboard transcript for its project instead of overwriting another composer', async () => {
  let finish!: (value: { text: string; durationMs: number; model: string }) => void;
  const client = clientWith({ transcribe: vi.fn(() => new Promise<{ text: string; durationMs: number; model: string }>(resolve => { finish = resolve; })) });
  render(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await act(async () => { shell.handlers.dashboard(); });
  await dashboardAction({ action: 'voice', project: 'p2', assistant: 'b', path: '/tmp/freddai-attachments/task.m4a' });
  await act(async () => { shell.handlers.navBack(); });
  await act(async () => { finish({ text: 'Late task', durationMs: 900, model: 'fixture' }); });
  expect(shell.setComposerText).not.toHaveBeenCalled();
  expect(shell.appendComposerText).not.toHaveBeenCalled();
  expect(await screen.findByRole('button', { name: 'Project: First' })).toBeTruthy();
  await act(async () => { shell.handlers.dashboard(); });
  await dashboardAction({ action: 'new', project: 'p2', assistant: 'b' });
  expect(shell.appendComposerText).toHaveBeenCalledWith('Late task', false);
  expect(client.start).not.toHaveBeenCalled();
});
it('gives the Office the full native content area when expanded and restores cards on close', async () => {
  render(<MobileApp client={clientWith()} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await act(async () => { shell.handlers.dashboard(); });
  fireEvent.click(screen.getByRole('button', { name: 'Expand office' }));
  await waitFor(() => expect(shell.setDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ expanded: true })));
  fireEvent.click(screen.getByRole('button', { name: 'Close office' }));
  await waitFor(() => expect(shell.setDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ expanded: false })));
});


it('keeps global Schedules out of an ordinary native conversation', async () => {
  render(<MobileApp client={clientWith({ scheduleCommand: vi.fn(async () => undefined) })} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await act(async () => { (shell.handlers.selectThread as (p: { id: string }) => void)({ id: 't1' }); });
  await waitFor(() => expect(modeCalls().at(-1)?.[0]).toBe('conversation'));
  expect(screen.queryByRole('button', { name: 'Schedules' })).toBeNull();
  await act(async () => { shell.handlers.dashboard(); });
  await waitFor(() => expect(shell.setDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ schedules: true })));
  expect(screen.queryByRole('button', { name: 'Schedules' })).toBeNull();
  await act(async () => { (shell.handlers.selectThread as (p: { id: string }) => void)({ id: 't1' }); });
  expect(screen.queryByRole('button', { name: 'Schedules' })).toBeNull();
});


it.each(['thread', 'home', 'away-and-back'])('keeps newer %s navigation when an earlier dictated new-thread send is acknowledged late', async destination => {
  let acknowledge!: (id: string) => void;
  const client = clientWith({ start: vi.fn(() => new Promise<string>(resolve => { acknowledge = resolve; })) });
  render(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await send('Transcribed new task');
  expect(client.start).toHaveBeenCalledTimes(1);
  await act(async () => { (shell.handlers.selectThread as (p: { id: string }) => void)({ id: 't1' }); });
  expect(modeCalls().at(-1)?.[1].title).toBe('Old thread');
  if (destination !== 'thread') await act(async () => { shell.handlers.navBack(); });
  const expected = modeCalls().at(-1);
  await act(async () => acknowledge('new-thread'));
  expect(modeCalls().at(-1)).toEqual(expected);
  // The completed send is still tracked; only its stale navigation is suppressed.
  if (destination === 'away-and-back') {
    await act(async () => { (shell.handlers.selectThread as (p: { id: string }) => void)({ id: 'new-thread' }); });
    await waitFor(() => expect(screen.getAllByText('Transcribed new task').some(el => !el.closest('.companion-fh'))).toBe(true));
  }
});

it('drives the native drawer Projects/Recent mode, the bottom section and paging through the threads payload', async () => {
  localStorage.clear();
  const many: CompanionSnapshot = { ...data, threads: Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, project: i % 2 ? 'p1' : 'p2', title: `Thread ${i}`, status: 'done', updated: 100 + i, messages: [], canReply: true, queued: 0, error: null })) };
  render(<MobileApp client={clientWith({ snapshot: async () => structuredClone(many) })} />);
  const last = () => (sentThreads as unknown as { mock: { calls: [any][] } }).mock.calls.at(-1)![0];
  const fire = (name: string, payload: unknown) => act(async () => { (shell.handlers[name] as (p: unknown) => void)(payload); });
  await waitFor(() => expect(last().groups.length).toBe(2));
  expect(last().view).toBe('projects');
  expect(last().recentSection.threads.map((t: { id: string }) => t.id)).toEqual(['n39', 'n38', 'n37', 'n36', 'n35']);
  await fire('recentPage', { action: 'more', section: 'bottom' });
  await waitFor(() => expect(last().recentSection.threads).toHaveLength(15));
  expect(last().recent.threads).toHaveLength(25);
  await fire('recentPage', { action: 'less', section: 'bottom' });
  await waitFor(() => expect(last().recentSection.threads).toHaveLength(5));
  await fire('setView', { view: 'recent' });
  await waitFor(() => expect(last().view).toBe('recent'));
  expect(localStorage.getItem('freddai.companion.threadNavView')).toBe('recent');
  expect(last().recent.threads).toHaveLength(25);
  expect(last().recent.threads[0]).toMatchObject({ id: 'n39', projectLabel: 'First' });
  await fire('recentPage', { action: 'more' });
  await waitFor(() => expect(last().recent.threads).toHaveLength(40));
  await fire('search', { query: 'Thread' });
  await waitFor(() => expect(last().recent.threads).toHaveLength(25));
  await fire('recentPage', { action: 'more' });
  await fire('recentPage', { action: 'less' });
  await waitFor(() => expect(last().recent.expanded).toBe(false));
});
