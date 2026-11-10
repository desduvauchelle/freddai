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
const callIo = vi.hoisted(() => ({
  handler: (_event: { type: string; text?: string }) => {},
  start: vi.fn(async () => {}), stop: vi.fn(async () => {}), setListening: vi.fn(async () => {}), speak: vi.fn(async () => {}), stopSpeaking: vi.fn(async () => {}),
}));
vi.mock('./companion-call', () => ({ companionCallIo: () => ({ ...callIo, listen: async (handler: typeof callIo.handler) => { callIo.handler = handler; return () => {}; } }) }));
vi.mock('./native-shell', () => ({
  hasNativeVoiceCall: () => false, hasNativeDashboardContent: () => true, isNativeShell: () => true, probeNativeShell: async () => true, useNativeShell: () => true,
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

// Composer tests enter New thread through the same explicit native action as users.
async function renderNew(ui: Parameters<typeof render>[0]) {
  const result = render(ui);
  await act(async () => { shell.handlers.newThread(); });
  return result;
}

beforeAll(() => {
  // Reduced motion keeps the mascot static in jsdom.
  window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })) as never;
});
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
afterEach(cleanup);

it('launches on Dashboard with the drawer closed, even when threads and a remembered project exist', async () => {
  localStorage.setItem('freddai.companion.lastThread', 't1');
  localStorage.setItem('freddai.companion.lastProject', 'p2');
  render(<MobileApp client={clientWith()} />);
  await waitFor(() => expect(modeCalls().at(-1)).toEqual(['dashboard', { title: 'Dashboard' }]));
  expect(modeCalls().every(([mode, options]) => mode !== 'new' && mode !== 'conversation' && !options?.openDrawer)).toBe(true);
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByText('What should we work on today?')).toBeNull();
  await act(async () => { shell.handlers.newThread(); });
  expect(await screen.findByRole('button', { name: /^Project:/ })).toBeTruthy();
  expect(modeCalls().at(-1)?.[0]).toBe('new');
});

it('starts a thread with the chosen project, agent and model, then opens the conversation', async () => {
  const client = clientWith();
  await renderNew(<MobileApp client={client} />);
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
  await renderNew(<MobileApp client={clientWith()} />);
  expect(await screen.findByRole('button', { name: 'Project: Second' })).toBeTruthy();
});

it('uploads native attachments by path, sends their ids, and discards the tmp files after success', async () => {
  const client = clientWith();
  await renderNew(<MobileApp client={client} />);
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
  await renderNew(<MobileApp client={client} />);
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
  await renderNew(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await send('Try again', [file]);
  expect(await screen.findByText('Mac said no')).toBeTruthy();
  expect(shell.setComposerText).not.toHaveBeenCalledWith('Try again', [file]);
  expect(JSON.parse(localStorage.getItem('freddai.companion.outbox.v1') || '[]')[0]).toMatchObject({ prompt: 'Try again', nativeFiles: [file], blocked: true });
  expect(shell.discardFiles).not.toHaveBeenCalled();
});

it('refuses more than 20 files without uploading and restores the composer', async () => {
  const client = clientWith();
  await renderNew(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  const many = Array.from({ length: 21 }, (_, i) => ({ ...file, path: `/tmp/freddai-attachments/${i}/f.jpg` }));
  await send('Too many', many);
  expect(client.attachPath).not.toHaveBeenCalled();
  expect(client.start).not.toHaveBeenCalled();
  expect(shell.setComposerText).toHaveBeenCalledWith('Too many', many);
});

it('returns from a conversation to the native home on Android Back without starting work', async () => {
  const client = clientWith();
  await renderNew(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await act(async () => { (shell.handlers.selectThread as (p: { id: string }) => void)({ id: 't1' }); });
  await waitFor(() => expect(modeCalls().at(-1)?.[0]).toBe('conversation'));
  await act(async () => { shell.handlers.navBack(); });
  await waitFor(() => expect(modeCalls().at(-1)?.[0]).toBe('dashboard'));
  expect(client.start).not.toHaveBeenCalled();
});

it('shows the mic only when the Mac reports dictation ready, and auto-sends the transcript (typed text combined natively, same Send path)', async () => {
  const client = clientWith({ voice: vi.fn(async () => ({ enabled: true, ready: true })), transcribe: vi.fn(async () => ({ text: 'hello there', durationMs: 900, model: 'base' })) });
  await renderNew(<MobileApp client={client} />);
  await waitFor(() => expect(shell.setVoice).toHaveBeenCalledWith(true));
  await act(async () => { (shell.handlers.voiceRecorded as (p: string, ms: number) => void)('/tmp/freddai-attachments/x/dictation.m4a', 900); });
  await waitFor(() => expect(shell.appendComposerText).toHaveBeenCalledWith('hello there', true));
  expect(client.transcribe).toHaveBeenCalledWith({ path: '/tmp/freddai-attachments/x/dictation.m4a' });
  expect(shell.setVoice).toHaveBeenCalledWith(true, 'transcribing');
  expect(shell.setVoice).toHaveBeenLastCalledWith(true, 'idle');
});

it('hides the mic when dictation is not ready and surfaces transcription and microphone errors', async () => {
  const client = clientWith({ voice: vi.fn(async () => ({ enabled: true, ready: false })), transcribe: vi.fn(async () => { throw new Error('Voice dictation is turned off on the Mac'); }) });
  await renderNew(<MobileApp client={client} />);
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
  await renderNew(<MobileApp client={client} />);
  expect((await screen.findByRole('alert')).textContent).toContain('Dictation unavailable: Unknown composer operation');
  expect(warn).toHaveBeenCalledWith('[voice]', expect.any(String), 'Unknown composer operation');
  expect(shell.setVoice).not.toHaveBeenCalledWith(true);
  warn.mockRestore();
});

it('shows an accepted new message without a Mac handoff or queue label while the snapshot catches up', async () => {
  await renderNew(<MobileApp client={clientWith()} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await send('Start this work');
  // The header pill shows the thread title too; the message itself must be in the transcript.
  await waitFor(() => expect(screen.getAllByText('Start this work').some(el => !el.closest('.companion-fh'))).toBe(true));
  expect(screen.queryByText('Queued on your Mac')).toBeNull();
  expect(screen.queryByText('Continue this thread on your Mac.')).toBeNull();
  expect(screen.getByText('Starting…')).toBeTruthy();
});

it.each(['starting', 'running', 'waiting'])('puts a %s-thread send straight in the queue before the host acknowledges it', async status => {
  const snapshot = structuredClone(data);
  snapshot.threads[0].status = status;
  let accept!: () => void;
  const reply = vi.fn((_input: Parameters<CompanionClient['reply']>[0]) => new Promise<void>(resolve => { accept = resolve; }));
  await renderNew(<MobileApp client={clientWith({ snapshot: async () => structuredClone(snapshot), reply, queue: vi.fn(async () => {}) })} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await act(async () => { (shell.handlers.selectThread as (p: { id: string }) => void)({ id: 't1' }); });
  await send('Queue this immediately');
  const queue = screen.getByRole('region', { name: 'Message queue' });
  expect(within(queue).getByText('Queue this immediately')).toBeTruthy();
  expect(within(queue).getAllByRole('button').every(button => (button as HTMLButtonElement).disabled)).toBe(true);
  expect(screen.queryByRole('article', { name: 'Your message' })).toBeNull();
  await act(async () => { accept(); });
  expect(within(screen.getByRole('region', { name: 'Message queue' })).getByText('Queue this immediately')).toBeTruthy();
  expect(screen.queryByRole('article', { name: 'Your message' })).toBeNull();
  snapshot.threads[0].queue = [{ id: `phone:${reply.mock.calls[0][0].requestId}`, prompt: 'Queue this immediately', attachments: 0 }];
  snapshot.threads[0].queued = 1;
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  await waitFor(() => expect(within(screen.getByRole('region', { name: 'Message queue' })).getAllByRole('button').every(button => !(button as HTMLButtonElement).disabled)).toBe(true));
  expect(screen.getAllByText('Queue this immediately')).toHaveLength(1);
});

it('keeps real queued replies visible and shows the streamed response after the host echoes the message', async () => {
  let snapshot = structuredClone(data);
  snapshot.threads[0].status = 'running';
  const client = clientWith({ snapshot: async () => structuredClone(snapshot), reply: vi.fn(async () => {}) });
  await renderNew(<MobileApp client={client} />);
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
  await renderNew(<MobileApp client={clientWith({ snapshot: async () => snapshot })} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await act(async () => { (shell.handlers.selectThread as (p: { id: string }) => void)({ id: 't1' }); });
  await screen.findByText('Working…');
  expect(screen.queryByText('Continue this thread on your Mac.')).toBeNull();
  expect(screen.queryByText('This thread cannot take replies. Start a new thread to continue.')).toBeNull();
});

it('does not send an empty transcript and says so visibly', async () => {
  const client = clientWith({ voice: vi.fn(async () => ({ enabled: true, ready: true })), transcribe: vi.fn(async () => ({ text: '   ', durationMs: 300, model: 'base' })) });
  await renderNew(<MobileApp client={client} />);
  await waitFor(() => expect(shell.setVoice).toHaveBeenCalledWith(true));
  await act(async () => { (shell.handlers.voiceRecorded as (p: string, ms: number) => void)('/tmp/freddai-attachments/x/dictation.m4a', 300); });
  expect((await screen.findByRole('alert')).textContent).toContain("Didn't catch anything");
  expect(shell.appendComposerText).not.toHaveBeenCalled();
  expect(shell.setVoice).toHaveBeenLastCalledWith(true, 'idle');
});

it('warns and shows the error when transcription fails, without sending', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const client = clientWith({ voice: vi.fn(async () => ({ enabled: true, ready: true })), transcribe: vi.fn(async () => { throw new Error('model missing'); }) });
  await renderNew(<MobileApp client={client} />);
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
  await renderNew(<MobileApp client={client} />);
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
  await renderNew(<MobileApp client={clientWith({ reply: vi.fn(async () => { throw new Error('Reply rejected'); }) })} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await act(async () => { (shell.handlers.selectThread as (p: { id: string }) => void)({ id: 't1' }); });
  await send('Keep my reply');
  expect(await screen.findByText('Reply rejected')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Retry now' })).toBeTruthy();
  expect(screen.getByText('Completed')).toBeTruthy();
  expect(shell.setComposerText).not.toHaveBeenCalledWith('Keep my reply', []);
});

it('retries a queued message on network change and Retry now with the same request id, showing the failure reason', async () => {
  const start = vi.fn()
    .mockRejectedValueOnce(new Error('Relay unavailable. Check your internet connection.'))
    .mockRejectedValueOnce(new Error('Relay unavailable. Check your internet connection.'))
    .mockResolvedValue('new-thread');
  await renderNew(<MobileApp client={clientWith({ start })} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await send('Hello from 5G');
  expect((await screen.findAllByText(/last attempt failed: Relay unavailable.*retrying in/)).length).toBeGreaterThan(0);
  expect(start).toHaveBeenCalledTimes(1);
  // Network path change: retry immediately instead of waiting out the backoff.
  await act(async () => { window.dispatchEvent(new Event('online')); });
  await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
  // Manual Retry now.
  fireEvent.click(await screen.findByRole('button', { name: 'Retry now' }));
  await waitFor(() => expect(start).toHaveBeenCalledTimes(3));
  const ids = start.mock.calls.map(call => call[0].requestId);
  expect(new Set(ids).size).toBe(1);
});

it('shows a connection scene before projects are available, then replaces it with ready controls', async () => {
  let finish!: (value: CompanionSnapshot) => void;
  const pending = new Promise<CompanionSnapshot>(resolve => { finish = resolve; });
  await renderNew(<MobileApp client={clientWith({ snapshot: () => pending })} />);
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
  await renderNew(<MobileApp client={clientWith({ snapshot, markRead })} />);
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


const dashboardAction = (event: { action: string; project?: string; assistant?: string; path?: string; send?: boolean; thread?: string }) => act(async () => {
  (shell.handlers.dashboardAction as (p: typeof event) => void)(event);
});
it('opens native Dashboard cards without duplicating web controls and opens project threads', async () => {
  await renderNew(<MobileApp client={clientWith()} />);
  await screen.findByText('What should we work on today?');
  await act(async () => { shell.handlers.dashboard(); });
  expect(screen.queryByRole('article', { name: 'Project Second' })).toBeNull();
  expect(shell.setDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ projects: expect.arrayContaining([expect.objectContaining({ id: 'p2', name: 'Second', canStart: true })]) }));
  await dashboardAction({ action: 'open', project: 'p1' });
  expect(modeCalls().at(-1)).toEqual(['dashboard', { title: 'Dashboard', openDrawer: true }]);
  await dashboardAction({ action: 'thread', project: 'p1', thread: 't1' });
  await waitFor(() => expect(modeCalls().at(-1)?.[0]).toBe('conversation'));
});

it('carries native dashboard project agent, model and effort through the composer launch', async () => {
  const client = clientWith();
  await renderNew(<MobileApp client={client} />);
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

it('applies the shared dashboard model and difficulty to tasks in different projects', async () => {
  const client = clientWith();
  await renderNew(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await act(async () => { shell.handlers.dashboard(); });
  shell.pickOption.mockResolvedValueOnce('b');
  await dashboardAction({ action: 'agent' });
  shell.pickOption.mockResolvedValueOnce('shared-model');
  await dashboardAction({ action: 'dashboard-model' });
  shell.pickOption.mockResolvedValueOnce('high');
  await dashboardAction({ action: 'dashboard-effort' });
  await dashboardAction({ action: 'new', project: 'p1', assistant: 'b' });
  await send('First shared task');
  expect(client.start).toHaveBeenLastCalledWith(expect.objectContaining({ project: 'p1', assistant: 'b', options: expect.objectContaining({ model: 'shared-model', effort: 'high' }) }));
  await act(async () => { shell.handlers.dashboard(); });
  await dashboardAction({ action: 'new', project: 'p2', assistant: 'b' });
  await send('Second shared task');
  expect(client.start).toHaveBeenLastCalledWith(expect.objectContaining({ project: 'p2', assistant: 'b', options: expect.objectContaining({ model: 'shared-model', effort: 'high' }) }));
});

it('transcribes a native card recording into the captured project draft without sending', async () => {
  const client = clientWith({ transcribe: vi.fn(async () => ({ text: 'Dictated task', durationMs: 1200, model: 'fixture' })) });
  await renderNew(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await act(async () => { shell.handlers.dashboard(); });
  await dashboardAction({ action: 'voice', project: 'p2', assistant: 'b', path: '/tmp/freddai-attachments/task.m4a' });
  await screen.findByRole('button', { name: 'Project: Second' });
  expect(client.transcribe).toHaveBeenCalledWith({ path: '/tmp/freddai-attachments/task.m4a' });
  expect(shell.appendComposerText).toHaveBeenCalledWith('Dictated task', false);
  expect(client.start).not.toHaveBeenCalled();
  expect(shell.setComposerText).not.toHaveBeenCalled();
});

it('send-mode dashboard dictation starts a task in the project and stays on the dashboard', async () => {
  let finishTranscript!: (value: { text: string; durationMs: number; model: string }) => void;
  const transcript = new Promise<{ text: string; durationMs: number; model: string }>(resolve => { finishTranscript = resolve; });
  const client = clientWith({ transcribe: vi.fn(() => transcript) });
  await renderNew(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await act(async () => { shell.handlers.dashboard(); });
  shell.setMode.mockClear();
  await dashboardAction({ action: 'voice', project: 'p2', assistant: 'b', path: '/tmp/freddai-attachments/a.m4a', send: true });
  await waitFor(() => expect(shell.setDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ message: '', projects: expect.arrayContaining([
    expect.objectContaining({ id: 'p1', sending: false }), expect.objectContaining({ id: 'p2', sending: true }),
  ]) })));
  await act(async () => { finishTranscript({ text: 'Ship it', durationMs: 900, model: 'fixture' }); });
  await waitFor(() => expect(client.start).toHaveBeenCalledWith(expect.objectContaining({ project: 'p2', assistant: 'b', prompt: 'Ship it' })));
  await waitFor(() => expect(shell.setDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ message: '', projects: expect.arrayContaining([expect.objectContaining({ id: 'p2', sending: false })]) })));
  expect(shell.appendComposerText).not.toHaveBeenCalled();
  expect(modeCalls().some(([mode]) => mode === 'conversation' || mode === 'new')).toBe(false);
});

it('send-mode dashboard dictation reports an empty transcript loudly and sends nothing', async () => {
  const client = clientWith({ transcribe: vi.fn(async () => ({ text: '  ', durationMs: 300, model: 'fixture' })) });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await renderNew(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await act(async () => { shell.handlers.dashboard(); });
  await dashboardAction({ action: 'voice', project: 'p2', assistant: 'b', path: '/tmp/freddai-attachments/a.m4a', send: true });
  await waitFor(() => expect(shell.setDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ message: expect.stringContaining("Couldn't send to Second: Didn't catch anything") })));
  expect(warn).toHaveBeenCalledWith('[voice]', 'dashboard send failed', expect.objectContaining({ project: 'Second' }));
  expect(client.start).not.toHaveBeenCalled();
  warn.mockRestore();
});

it('send-mode dashboard dictations run concurrently and both deliver', async () => {
  const finish: ((v: { text: string; durationMs: number; model: string }) => void)[] = [];
  const client = clientWith({ transcribe: vi.fn(() => new Promise<{ text: string; durationMs: number; model: string }>(resolve => { finish.push(resolve); })) });
  await renderNew(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await act(async () => { shell.handlers.dashboard(); });
  await dashboardAction({ action: 'voice', project: 'p1', path: '/tmp/freddai-attachments/1.m4a', send: true });
  await dashboardAction({ action: 'voice', project: 'p2', assistant: 'b', path: '/tmp/freddai-attachments/2.m4a', send: true });
  expect(client.transcribe).toHaveBeenCalledTimes(2);
  await act(async () => { finish[1]({ text: 'Second task', durationMs: 1, model: 'f' }); finish[0]({ text: 'First task', durationMs: 1, model: 'f' }); });
  await waitFor(() => expect(client.start).toHaveBeenCalledTimes(2));
  const prompts = (client.start as ReturnType<typeof vi.fn>).mock.calls.map(c => `${c[0].project}:${c[0].prompt}`).sort();
  expect(prompts).toEqual(['p1:First task', 'p2:Second task']);
});

it('send-mode Commander dictation replies to the Commander thread without opening it', async () => {
  const snap = structuredClone(data);
  snap.projects.push({ id: 'cmd', name: 'Commander', color: '#777', canStart: true, kind: 'commander' });
  const reply = vi.fn(async () => {});
  const commander = { state: vi.fn(async () => ({ thread_id: 'ct', status: {} })) } as never;
  const client = clientWith({ snapshot: async () => structuredClone(snap), reply, commander, transcribe: vi.fn(async () => ({ text: 'Plan the week', durationMs: 1, model: 'f' })) });
  await renderNew(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await act(async () => { shell.handlers.dashboard(); });
  shell.setMode.mockClear();
  await dashboardAction({ action: 'voice', project: 'cmd', path: '/tmp/freddai-attachments/c.m4a', send: true });
  await waitFor(() => expect(reply).toHaveBeenCalledWith(expect.objectContaining({ thread: 'ct', prompt: 'Plan the week' })));
  expect(client.start).not.toHaveBeenCalled();
  expect(modeCalls().some(([mode]) => mode === 'conversation' || mode === 'new')).toBe(false);
});

it('recovers native dashboard controls after transcription failure without launching a task', async () => {
  const client = clientWith({ transcribe: vi.fn(async () => { throw new Error('Mac disconnected'); }) });
  await renderNew(<MobileApp client={client} />);
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
  await renderNew(<MobileApp client={client} />);
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
  await renderNew(<MobileApp client={clientWith()} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await act(async () => { shell.handlers.dashboard(); });
  fireEvent.click(screen.getByRole('button', { name: 'Expand office' }));
  await waitFor(() => expect(shell.setDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ expanded: true })));
  await waitFor(() => expect(modeCalls().at(-1)?.[0]).toBe('other'));
  fireEvent.click(screen.getByRole('button', { name: 'Close office' }));
  await waitFor(() => expect(shell.setDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ expanded: false })));
  await waitFor(() => expect(modeCalls().at(-1)?.[0]).toBe('dashboard'));
});


it('keeps global Schedules out of an ordinary native conversation', async () => {
  await renderNew(<MobileApp client={clientWith({ scheduleCommand: vi.fn(async () => undefined) })} />);
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
  await renderNew(<MobileApp client={client} />);
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
  await renderNew(<MobileApp client={clientWith({ snapshot: async () => structuredClone(many) })} />);
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


it('does not flash a device backlog while an online message is being submitted', async () => {
  let finish!: (id: string) => void;
  const client = clientWith({ start: vi.fn(() => new Promise<string>(resolve => { finish = resolve; })) });
  await renderNew(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await send('Send immediately');
  await waitFor(() => expect(client.start).toHaveBeenCalled());
  expect(screen.queryByText(/queued on this device/)).toBeNull();
  expect(screen.getByText('Sending…')).toBeTruthy();
  expect(JSON.parse(localStorage.getItem('freddai.companion.outbox.v1') || '[]')).toHaveLength(1);
  await act(async () => { finish('new-thread'); });
  await waitFor(() => expect(JSON.parse(localStorage.getItem('freddai.companion.outbox.v1') || '[]')).toEqual([]));
  expect(screen.getAllByText('Send immediately').length).toBeGreaterThan(0);
});


it('loads without reviving accepted legacy messages or sending them again', async () => {
  localStorage.setItem('freddai.companion.outbox.v1', JSON.stringify([{
    id: 'accepted', thread: 't1', project: 'p1', prompt: 'Already delivered',
    ordinal: 1, startsTurn: true, acknowledged: true, attachments: [],
  }]));
  const client = clientWith({ reply: vi.fn(async () => {}) });
  await renderNew(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await act(async () => { (shell.handlers.selectThread as (p: { id: string }) => void)({ id: 't1' }); });
  await screen.findByText('Completed');
  expect(screen.queryByText('Already delivered')).toBeNull();
  expect(screen.queryByText('Starting…')).toBeNull();
  expect(screen.queryByText(/queued on this device/)).toBeNull();
  expect(client.reply).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem('freddai.companion.outbox.v1') || '[]')).toEqual([]);
});


it('processes submitted recordings in FIFO order while another transcription is pending', async () => {
  let finish!: (value: { text: string; durationMs: number; model: string }) => void;
  const transcribe = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce({ text: 'second', durationMs: 1000, model: 'fixture' });
  await renderNew(<MobileApp client={clientWith({ transcribe })} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await act(async () => { shell.handlers.voiceRecorded('/tmp/first.m4a' as never); shell.handlers.voiceRecorded('/tmp/second.m4a' as never); });
  expect(transcribe).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ text: 'first', durationMs: 1000, model: 'fixture' }); });
  await waitFor(() => expect(transcribe).toHaveBeenCalledTimes(2));
  expect((shell.appendComposerText.mock.calls as unknown as [string, boolean][]).map(call => call[0])).toEqual(['first', 'second']);
});


it('queues recordings into their captured chat without touching a newer composer', async () => {
  let finish!: (value: { text: string; durationMs: number; model: string }) => void;
  const transcribe = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce({ text: 'second', durationMs: 1000, model: 'fixture' });
  const client = clientWith({ transcribe, reply: vi.fn(async () => {}) });
  await renderNew(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await act(async () => { (shell.handlers.selectThread as (p: { id: string }) => void)({ id: 't1' }); });
  await waitFor(() => expect(modeCalls().at(-1)?.[0]).toBe('conversation'));
  const record = shell.handlers.voiceRecorded as unknown as (path: string, duration: number, draft: { text: string; files: unknown[] }) => void;
  await act(async () => { record('/tmp/first.m4a', 1000, { text: 'Typed', files: [] }); record('/tmp/second.m4a', 1000, { text: '', files: [] }); });
  expect(transcribe).toHaveBeenCalledTimes(1);
  await act(async () => { shell.handlers.navBack(); });
  await act(async () => { finish({ text: 'first', durationMs: 1000, model: 'fixture' }); });
  await waitFor(() => expect(client.reply).toHaveBeenCalledTimes(2));
  expect((client.reply as ReturnType<typeof vi.fn>).mock.calls.map(call => call[0])).toEqual([
    expect.objectContaining({ thread: 't1', prompt: 'Typed first' }), expect.objectContaining({ thread: 't1', prompt: 'second' }),
  ]);
  expect(shell.appendComposerText).not.toHaveBeenCalled();
  expect(modeCalls().at(-1)?.[0]).toBe('dashboard');
});

it('keeps consecutive new-chat recordings in one thread while the first send is pending', async () => {
  let acknowledge!: (id: string) => void;
  const client = clientWith({ transcribe: vi.fn().mockResolvedValueOnce({ text: 'first', durationMs: 1000, model: 'fixture' })
    .mockResolvedValueOnce({ text: 'second', durationMs: 1000, model: 'fixture' }),
    start: vi.fn(() => new Promise<string>(resolve => { acknowledge = resolve; })), reply: vi.fn(async () => {}) });
  await renderNew(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  const record = shell.handlers.voiceRecorded as unknown as (path: string, duration: number, draft: { text: string; files: unknown[] }) => void;
  await act(async () => { record('/tmp/first.m4a', 1000, { text: '', files: [] }); record('/tmp/second.m4a', 1000, { text: '', files: [] }); });
  await waitFor(() => expect(client.start).toHaveBeenCalledTimes(1));
  expect(client.reply).not.toHaveBeenCalled();
  await act(async () => { acknowledge('dictation-chat'); });
  await waitFor(() => expect(client.reply).toHaveBeenCalledWith(expect.objectContaining({ thread: 'dictation-chat', prompt: 'second' })));
  expect(client.start).toHaveBeenCalledTimes(1);
});

it('continues the transcription FIFO after a failed recording', async () => {
  const client = clientWith({ transcribe: vi.fn().mockRejectedValueOnce(new Error('bad audio'))
    .mockResolvedValueOnce({ text: 'second', durationMs: 1000, model: 'fixture' }) });
  await renderNew(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  const record = shell.handlers.voiceRecorded as unknown as (path: string, duration: number, draft: { text: string; files: unknown[] }) => void;
  await act(async () => { record('/tmp/first.m4a', 1000, { text: '', files: [] }); record('/tmp/second.m4a', 1000, { text: '', files: [] }); });
  await waitFor(() => expect(client.start).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'second' })));
  expect(client.start).toHaveBeenCalledTimes(1);
});

it('queues a transcript for a running chat even before normal reply controls become available', async () => {
  const snapshot = structuredClone(data);
  snapshot.threads[0].status = 'running'; snapshot.threads[0].canReply = false;
  const client = clientWith({ snapshot: async () => structuredClone(snapshot), reply: vi.fn(async () => {}),
    transcribe: vi.fn(async () => ({ text: 'another instruction', durationMs: 1000, model: 'fixture' })) });
  await renderNew(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await act(async () => { (shell.handlers.selectThread as (p: { id: string }) => void)({ id: 't1' }); });
  await screen.findByText('Working…');
  const record = shell.handlers.voiceRecorded as unknown as (path: string, duration: number, draft: { text: string; files: unknown[] }) => void;
  await act(async () => { record('/tmp/next.m4a', 1000, { text: '', files: [] }); });
  await waitFor(() => expect(client.reply).toHaveBeenCalledWith(expect.objectContaining({ thread: 't1', prompt: 'another instruction' })));
  expect(shell.appendComposerText).not.toHaveBeenCalled();
});


it('recovers a missing attachment by explicitly sending the queued text without attachments', async () => {
  const client = clientWith({ attachPath: vi.fn(async () => { throw new Error('Attachment is no longer available. Remove it and attach it again.'); }) });
  await renderNew(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await send('Keep this text', [file]);
  const recover = await screen.findByRole('button', { name: 'Send without attachments' });
  expect(client.start).not.toHaveBeenCalled();
  fireEvent.click(recover);
  await waitFor(() => expect(client.start).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Keep this text', options: expect.objectContaining({ attachments: [] }) })));
  expect(client.attachPath).toHaveBeenCalledTimes(1);
});

it('can delete a blocked missing-attachment message and unblock the next message', async () => {
  const client = clientWith({ attachPath: vi.fn(async () => { throw new Error('Attachment is no longer available. Remove it and attach it again.'); }) });
  await renderNew(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await send('Broken photo', [file]);
  const cancel = await screen.findByRole('button', { name: 'Cancel queued message' });
  await waitFor(() => expect(cancel.hasAttribute('disabled')).toBe(false));
  fireEvent.click(cancel);
  await waitFor(() => expect(screen.queryByText('Broken photo')).toBeNull());
  expect(JSON.parse(localStorage.getItem('freddai.companion.outbox.v1') || '[]')).toEqual([]);
  await send('Next message');
  await waitFor(() => expect(client.start).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Next message' })));
});


it('starts a companion call, delivers speech through the outbox, and preserves the typed draft', async () => {
  localStorage.setItem('freddai.companion.drafts', JSON.stringify({ t1: 'Keep my draft' }));
  const client = clientWith({ reply: vi.fn(async () => {}), transcribe: vi.fn(), action: vi.fn(async () => {}) });
  render(<MobileApp client={client} />);
  await waitFor(() => expect(shell.handlers.selectThread).toBeTruthy());
  await act(async () => { (shell.handlers.selectThread as (p: { id: string }) => void)({ id: 't1' }); });
  expect(screen.queryByRole('button', { name: 'Start call' })).toBeNull();
  await act(async () => { (shell.handlers.threadAction as (p: { action: string }) => void)({ action: 'call' }); });
  expect(callIo.start).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'End call' })).toBeTruthy();
  await act(async () => { callIo.handler({ type: 'segment', text: 'Spoken message' }); });
  await waitFor(() => expect(client.reply).toHaveBeenCalledWith(expect.objectContaining({ thread: 't1', prompt: 'Spoken message' })), { timeout: 2500 });
  expect(JSON.parse(localStorage.getItem('freddai.companion.drafts')!).t1).toBe('Keep my draft');
  expect(shell.setVoice).toHaveBeenCalledWith(false, 'idle');
  await act(async () => { screen.getByRole('button', { name: 'End call' }).click(); });
  expect(callIo.stop).toHaveBeenCalled();
});


it('dismisses a thread back to Dashboard and can reopen the same thread without starting work', async () => {
  const client = clientWith();
  render(<MobileApp client={client} />);
  await waitFor(() => expect(modeCalls().at(-1)?.[0]).toBe('dashboard'));
  await act(async () => { (shell.handlers.selectThread as (p: { id: string }) => void)({ id: 't1' }); });
  await waitFor(() => expect(modeCalls().at(-1)?.[0]).toBe('conversation'));
  await act(async () => { shell.handlers.navBack(); });
  await waitFor(() => expect(modeCalls().at(-1)?.[0]).toBe('dashboard'));
  await act(async () => { (shell.handlers.selectThread as (p: { id: string }) => void)({ id: 't1' }); });
  await waitFor(() => expect(modeCalls().at(-1)?.[0]).toBe('conversation'));
  expect(client.start).not.toHaveBeenCalled();
});


it('opens organization settings from native navigation with project sorting immediately visible', async () => {
  render(<MobileApp client={clientWith({ snapshot: async () => ({ ...structuredClone(data), canReorderProjects: true }), moveProject: vi.fn(async () => ['p2', 'p1']) })} />);
  await waitFor(() => expect(shell.handlers.threadAction).toBeTypeOf('function'));
  await act(async () => { (shell.handlers.threadAction as (p: { action: string }) => void)({ action: 'organization' }); });
  expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Move First down' })).toBeTruthy();
  expect(modeCalls().at(-1)?.[0]).toBe('other');
});

it('starts a call on a new thread and creates the thread from speech without consuming its draft', async () => {
  localStorage.setItem('freddai.companion.drafts', JSON.stringify({ new: 'Keep my new draft' }));
  const client = clientWith({ transcribe: vi.fn() });
  await renderNew(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await act(async () => { (shell.handlers.threadAction as (p: { action: string }) => void)({ action: 'call' }); });
  expect(callIo.start).toHaveBeenCalledTimes(1);
  expect(client.start).not.toHaveBeenCalled();
  await act(async () => { callIo.handler({ type: 'segment', text: 'Start from speech' }); });
  await waitFor(() => expect(client.start).toHaveBeenCalledWith(expect.objectContaining({ project: 'p1', prompt: 'Start from speech' })), { timeout: 2500 });
  expect(screen.getByRole('button', { name: 'End call' })).toBeTruthy();
  expect(callIo.stop).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem('freddai.companion.drafts')!).new).toBe('Keep my new draft');
});


it('queues further speech behind the first call message while thread creation is pending', async () => {
  let finish!: (id: string) => void;
  const client = clientWith({ transcribe: vi.fn(), start: vi.fn(() => new Promise<string>(resolve => { finish = resolve; })), reply: vi.fn(async () => {}) });
  await renderNew(<MobileApp client={client} />);
  await screen.findByRole('button', { name: 'Project: First' });
  await act(async () => { (shell.handlers.threadAction as (p: { action: string }) => void)({ action: 'call' }); });
  await act(async () => { callIo.handler({ type: 'segment', text: 'First spoken message' }); });
  await waitFor(() => expect(client.start).toHaveBeenCalledTimes(1), { timeout: 2500 });
  await act(async () => { callIo.handler({ type: 'segment', text: 'Second spoken message' }); });
  await waitFor(() => expect(JSON.parse(localStorage.getItem('freddai.companion.outbox.v1')!).length).toBe(2), { timeout: 2500 });
  expect(client.start).toHaveBeenCalledTimes(1);
  await act(async () => { finish('created-call-thread'); });
  await waitFor(() => expect(client.reply).toHaveBeenCalledWith(expect.objectContaining({ thread: 'created-call-thread', prompt: 'Second spoken message' })));
  expect(screen.getByRole('button', { name: 'End call' })).toBeTruthy();
  await act(async () => { callIo.handler({ type: 'segment', text: 'Third spoken message' }); });
  await waitFor(() => expect(client.reply).toHaveBeenCalledWith(expect.objectContaining({ thread: 'created-call-thread', prompt: 'Third spoken message' })), { timeout: 2500 });
  expect(client.start).toHaveBeenCalledTimes(1);
});


it('uses the main view for sidebar selection, including selection of the same thread from a sheet', async () => {
  render(<MobileApp client={clientWith()} />);
  await waitFor(() => expect(modeCalls().at(-1)?.[0]).toBe('dashboard'));
  await act(async () => { (shell.handlers.selectThread as (p: { id: string }) => void)({ id: 't1' }); });
  await waitFor(() => expect(modeCalls().at(-1)).toEqual(['conversation', expect.objectContaining({ threadSheet: false })]));
  await act(async () => { shell.handlers.dashboard(); });
  await act(async () => { (shell.handlers.dashboardAction as (p: unknown) => void)({ action: 'thread', project: 'p1', thread: 't1' }); });
  await waitFor(() => expect(modeCalls().at(-1)).toEqual(['conversation', expect.objectContaining({ threadSheet: true })]));
  await act(async () => { (shell.handlers.selectThread as (p: { id: string }) => void)({ id: 't1' }); });
  await waitFor(() => expect(modeCalls().at(-1)).toEqual(['conversation', expect.objectContaining({ threadSheet: false })]));
  await act(async () => { shell.handlers.newThread(); });
  expect(modeCalls().at(-1)?.[0]).toBe('new');
  expect(modeCalls().at(-1)?.[1]?.threadSheet).not.toBe(true);
});

it('dismisses a dashboard thread sheet back to its dashboard', async () => {
  const summaries = { get: vi.fn(async (date: string) => ({ date, summary: { date, markdown: 'Cached daily summary', generated_at: 1, provider: '', account: '', model: '', threads: 1 }, running: false, error: null, threads: 1 })), generate: vi.fn() };
  render(<MobileApp client={clientWith({ summaries })} />);
  const summaryText = () => (shell.setDashboard.mock.calls.at(-1)?.[0] as { summaries?: { text: string }[] })?.summaries?.[0]?.text;
  await waitFor(() => expect(summaryText()).toBe('Cached daily summary'));
  await waitFor(() => expect(modeCalls().at(-1)?.[0]).toBe('dashboard'));
  const dashboard = document.querySelector('.companion-dashboard-preserved')!;
  const office = dashboard.firstElementChild;
  await act(async () => { (shell.handlers.dashboardAction as (p: unknown) => void)({ action: 'thread', project: 'p1', thread: 't1' }); });
  await waitFor(() => expect(modeCalls().at(-1)?.[1]?.threadSheet).toBe(true));
  expect(document.querySelector('.companion-dashboard-preserved')).toBe(dashboard);
  expect(dashboard.hasAttribute('hidden')).toBe(true);
  expect(summaryText()).toBe('Cached daily summary');
  await act(async () => { shell.handlers.navBack(); });
  await waitFor(() => expect(modeCalls().at(-1)?.[0]).toBe('dashboard'));
  expect(document.querySelector('.companion-dashboard-preserved')).toBe(dashboard);
  expect(dashboard.firstElementChild).toBe(office);
  expect(dashboard.hasAttribute('hidden')).toBe(false);
  expect(summaryText()).toBe('Cached daily summary');
  expect(summaries.get).toHaveBeenCalledTimes(3);
  expect(summaries.generate).not.toHaveBeenCalled();
});


it('opens a conversation thread link as a sheet and returns to the original conversation', async () => {
  const snapshot = structuredClone(data);
  snapshot.threads[0].messages = [{ id: 'm1', role: 'assistant', text: 'See [Other thread](freddai://thread/t2).' }];
  snapshot.threads.push({ ...snapshot.threads[0], id: 't2', title: 'Linked thread', messages: [] });
  render(<MobileApp client={clientWith({ snapshot: async () => snapshot })} />);
  await waitFor(() => expect(modeCalls().at(-1)?.[0]).toBe('dashboard'));
  await act(async () => { (shell.handlers.selectThread as (p: { id: string }) => void)({ id: 't1' }); });
  fireEvent.click(await screen.findByRole('button', { name: 'Other thread' }));
  await waitFor(() => expect(modeCalls().at(-1)).toEqual(['conversation', expect.objectContaining({ title: 'Linked thread', threadSheet: true })]));
  await act(async () => { shell.handlers.navBack(); });
  await waitFor(() => expect(modeCalls().at(-1)).toEqual(['conversation', expect.objectContaining({ title: 'Old thread', threadSheet: false })]));
});
