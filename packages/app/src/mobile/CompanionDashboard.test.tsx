import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CompanionDashboard } from './CompanionDashboard';
import { disconnectedClient, type CompanionSnapshot } from './companion';
afterEach(cleanup);
HTMLElement.prototype.scrollIntoView ??= () => {};
function chooseDashboard(label: string, option: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'Enter' });
  fireEvent.click(screen.getByRole('option', { name: option }));
}
it('counts activity across projects, retains empty projects and opens pending decisions', () => {
  const now = new Date(2026, 10, 4, 12).getTime(), onOpen = vi.fn(), onNew = vi.fn();
  const base = { project: 'p', updated: now, messages: [], canReply: true, queued: 0, error: null };
  const snapshot: CompanionSnapshot = { projects: [{ id: 'p', name: 'Project', color: '#777', canStart: true }, { id: 'empty', name: 'Empty', color: '#777', canStart: false }], threads: [
    { ...base, id: 'running', title: 'Working', status: 'starting' },
    { ...base, id: 'pending', title: 'Approval', status: 'running', pending: { id: 'approval' } as never },
    { ...base, id: 'done', title: 'Finished', status: 'done' },
    { ...base, id: 'old', title: 'Yesterday', status: 'done', updated: now - 86400000 },
    { ...base, id: 'failed', title: 'Failed', status: 'failed' },
  ] };
  render(<CompanionDashboard snapshot={snapshot} connected onOpen={onOpen} onNew={onNew} now={now} />);
  expect(screen.queryByText('1 working · 1 need you · 1 done today · 1 failed today')).toBeNull();
  expect(screen.getByRole('article', { name: 'Project Empty' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Open project Empty' }));
  expect((screen.getByRole('button', { name: 'New thread in Empty' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.click(screen.getByRole('button', { name: /Approval.*Review decision/ }));
  expect(onOpen).toHaveBeenCalledWith('pending');
  fireEvent.click(screen.getByRole('button', { name: 'Open project Project' }));
  fireEvent.click(screen.getByRole('button', { name: 'New thread in Project' }));
  expect(onNew).toHaveBeenCalledWith('p', undefined);
});
it('offers one global coding agent and passes the choice to new threads', () => {
  const onNew = vi.fn();
  render(<CompanionDashboard connected onNew={onNew} onOpen={vi.fn()} snapshot={{ projects: [{ id: 'p', name: 'Project', color: '#777', canStart: true, defaultAssistant: 'a', assistants: [{ id: 'a', name: 'Personal', provider: 'claude' }, { id: 'b', name: 'Work', provider: 'codex' }] }], threads: [] }} />);
  chooseDashboard('Coding agent', 'Codex · Work');
  fireEvent.click(screen.getByRole('button', { name: 'Open project Project' }));
  fireEvent.click(screen.getByRole('button', { name: 'New thread in Project' }));
  expect(onNew).toHaveBeenCalledWith('p', 'b');
});
it('applies the global agent across projects and keeps thread navigation in the project panel', () => {
  const onNew = vi.fn(), onOpen = vi.fn();
  const assistants = [{ id: 'a', name: 'Personal', provider: 'claude' }, { id: 'b', name: 'Work', provider: 'codex' }];
  render(<CompanionDashboard connected onNew={onNew} onOpen={onOpen} snapshot={{
    projects: ['One', 'Two'].map(name => ({ id: name, name, color: '#777', canStart: true, defaultAssistant: 'a', assistants })),
    threads: [{ id: 't', project: 'Two', title: 'Existing task', updated: 1, status: 'done', messages: [], canReply: true, queued: 0, error: null }],
  }} />);
  expect(screen.queryByText('Open latest thread')).toBeNull();
  expect(screen.getAllByRole('combobox', { name: 'Coding agent' })).toHaveLength(1);
  chooseDashboard('Coding agent', 'Codex · Work');
  for (const name of ['One', 'Two']) {
    fireEvent.click(screen.getByRole('button', { name: `Open project ${name}` }));
    fireEvent.click(screen.getByRole('button', { name: `New thread in ${name}` }));
    expect(onNew).toHaveBeenLastCalledWith(name, 'b');
  }
  fireEvent.click(screen.getByRole('button', { name: 'Open project Two' }));
  fireEvent.click(screen.getByRole('button', { name: 'Existing task' }));
  expect(onOpen).toHaveBeenCalledWith('t');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('exposes launch and microphone controls directly on cards and honors global fallback and readiness', () => {
  const onNew = vi.fn();
  const snapshot: CompanionSnapshot = { projects: [
    { id: 'p', name: 'Project', color: '#777', canStart: true, defaultAssistant: 'a', assistants: [{ id: 'a', name: 'Personal', provider: 'claude' }, { id: 'b', name: 'Work', provider: 'codex' }] },
    { id: 'fallback', name: 'Fallback', color: '#777', canStart: true, defaultAssistant: 'a', assistants: [{ id: 'a', name: 'Personal', provider: 'claude' }] },
    { id: 'blocked', name: 'Blocked', color: '#777', canStart: false },
  ], threads: [] };
  const props = { snapshot, onNew, onOpen: vi.fn(), onDictation: vi.fn(), client: { ...disconnectedClient, transcribeAudio: vi.fn() } };
  const { rerender } = render(<CompanionDashboard {...props} connected />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect((screen.getByRole('button', { name: 'Dictate task in Project' }) as HTMLButtonElement).disabled).toBe(false);
  chooseDashboard('Coding agent', 'Codex · Work');
  fireEvent.click(screen.getByRole('button', { name: 'New thread in Project' }));
  expect(onNew).toHaveBeenLastCalledWith('p', 'b');
  fireEvent.click(screen.getByRole('button', { name: 'New thread in Fallback' }));
  expect(onNew).toHaveBeenLastCalledWith('fallback', 'a');
  expect((screen.getByRole('button', { name: 'New thread in Blocked' }) as HTMLButtonElement).disabled).toBe(true);
  rerender(<CompanionDashboard {...props} connected={false} />);
  for (const name of ['New thread in Project', 'Dictate task in Project']) {
    expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
  }
});

it('leaves only Office in the web surface when native dashboard content is supported', () => {
  const get = vi.fn();
  render(<CompanionDashboard nativeCards nativeContent connected snapshot={{ projects: [], threads: [] }} onOpen={vi.fn()} onNew={vi.fn()}
    client={{ ...disconnectedClient, summaries: { get, generate: vi.fn() } }} />);
  expect(screen.queryByText('Your projects')).toBeNull();
  expect(screen.queryByRole('region', { name: 'Daily summaries' })).toBeNull();
  expect(get).not.toHaveBeenCalled();
});

it.each([false, true])('routes an office recording to the selected project with native cards=%s', async nativeCards => {
  const { waitFor } = await import('@testing-library/react');
  class Recorder {
    static isTypeSupported() { return true; }
    state = 'inactive'; mimeType = 'audio/mp4';
    ondataavailable = (_event: { data: Blob }) => {}; onstop = () => {};
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob(['audio']) }); this.onstop(); }
  }
  const original = navigator.mediaDevices;
  vi.stubGlobal('MediaRecorder', Recorder);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) } });
  const start = vi.fn().mockResolvedValue('new-thread');
  const snapshot: CompanionSnapshot = { threads: [], projects: [
    { id: 'one', name: 'One', color: '#777777', canStart: true },
    { id: 'two', name: 'Two', color: '#777777', canStart: true, provider: 'codex', defaultAssistant: 'agent', assistants: [{ id: 'agent', provider: 'codex', name: 'Agent' }] },
  ] };
  try {
    render(<CompanionDashboard nativeCards={nativeCards} snapshot={snapshot} connected onOpen={vi.fn()} onNew={vi.fn()}
      controls={{ 'new:two:agent:codex': { selection: { model: 'chosen', effort: 'high' } } }}
      client={{ ...disconnectedClient, start, voice: async () => ({ enabled: true, ready: true }), transcribeAudio: async () => ({ text: 'Fix the bug' }) }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Give an order to Two' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dictate task in Two' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop recording in Two' }));
    await waitFor(() => expect(start).toHaveBeenCalledWith(expect.objectContaining({ project: 'two', assistant: 'agent', prompt: 'Fix the bug', options: expect.objectContaining({ model: 'chosen', effort: 'high' }) })));
    expect(start).toHaveBeenCalledTimes(1);
  } finally { Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: original }); vi.unstubAllGlobals(); }
});

it('shows one shared model and difficulty row outside project cards and saves its selection', () => {
  const onSelectionChange = vi.fn();
  render(<CompanionDashboard connected onNew={vi.fn()} onOpen={vi.fn()} onSelectionChange={onSelectionChange}
    snapshot={{ projects: [{ id: 'p', name: 'Project', color: '#777', canStart: true, defaultAssistant: 'a', assistants: [{ id: 'a', name: 'Personal', provider: 'claude' }] }], threads: [] }} />);
  expect(screen.getAllByRole('combobox', { name: 'Model' })).toHaveLength(1);
  expect(screen.getByRole('combobox', { name: 'Model' }).closest('.companion-project-card')).toBeNull();
  chooseDashboard('Model', 'Opus');
  chooseDashboard('Difficulty', 'High');
  expect(onSelectionChange).toHaveBeenLastCalledWith('new:p:a:claude', { model: 'opus', effort: 'high' });
});

it('shows the resolved saved provider and follows changes without pinning it', () => {
  const onNew = vi.fn(), onGlobalAssistantChange = vi.fn();
  const assistants = [{ id: 'a', name: 'Personal', provider: 'claude' }, { id: 'b', name: 'RS', provider: 'codex' }];
  const snapshot = (id: string): CompanionSnapshot => ({ projects: [{ id: 'p', name: 'Project', color: '#777', canStart: true, defaultAssistant: id, assistants }], threads: [] });
  const props = { connected: true, onNew, onOpen: vi.fn(), onGlobalAssistantChange, globalAssistant: '' };
  const view = render(<CompanionDashboard {...props} snapshot={snapshot('b')} />);
  expect(screen.getByRole('combobox', { name: 'Coding agent' }).textContent).toBe('Codex · RS');
  view.rerender(<CompanionDashboard {...props} snapshot={snapshot('a')} />);
  expect(screen.getByRole('combobox', { name: 'Coding agent' }).textContent).toBe('Claude · Personal');
  fireEvent.click(screen.getByRole('button', { name: 'New thread in Project' }));
  expect(onNew).toHaveBeenCalledWith('p', 'a');
  expect(onGlobalAssistantChange).not.toHaveBeenCalled();
});
it('passes snapshot schedules to the Office so the recent-only toggle hides stale projects and keeps scheduled ones', () => {
  localStorage.removeItem('freddai.office.recent-only.v1');
  const now = new Date(2026, 10, 4, 12).getTime(), old = now - 30 * 86400000;
  const base = { updated: old, messages: [], canReply: true, queued: 0, error: null, status: 'done' };
  const snapshot = { projects: [{ id: 'fresh', name: 'Fresh', color: '#777', canStart: true }, { id: 'stale', name: 'Stale', color: '#777', canStart: true }, { id: 'sched', name: 'Sched', color: '#777', canStart: true }],
    threads: [{ ...base, id: 't1', project: 'fresh', title: 'A', updated: now }, { ...base, id: 't2', project: 'stale', title: 'B' }, { ...base, id: 't3', project: 'sched', title: 'C' }],
    schedules: [{ id: 's', name: 'Nightly', project: 'sched', enabled: true, next_due: now + 3600000 }] } as unknown as CompanionSnapshot;
  render(<CompanionDashboard snapshot={snapshot} connected onNew={vi.fn()} onOpen={vi.fn()} now={now} />);
  const toggle = screen.getByRole('button', { name: /Showing recent projects only \(1 hidden\)/ });
  expect(toggle).toBeTruthy();
  localStorage.removeItem('freddai.office.recent-only.v1');
});

it('shows a pending row under the project instead of a Sending message paragraph', () => {
  const onOpen = vi.fn();
  const outbox = [{ id: 'o1', thread: '', project: 'p', prompt: 'Ship the release', ordinal: 1, startsTurn: true, acknowledged: false, attachments: [] }];
  render(<CompanionDashboard connected onNew={vi.fn()} onOpen={onOpen} outbox={outbox} snapshot={{ projects: [{ id: 'p', name: 'Project', color: '#777', canStart: true }], threads: [] }} />);
  expect(screen.queryByText('Sending message…')).toBeNull();
  expect(screen.getByRole('heading', { name: 'Project' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Ship the release/ }));
  expect(onOpen).toHaveBeenCalledWith('outbox:o1');
});
