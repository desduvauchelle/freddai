import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { empty, type Database } from './types';
import { DesktopApp } from './DesktopApp';
import { getDraft, resetDrafts } from './drafts';

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), events: {} as Record<string, (event: { payload: unknown }) => void> }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onDragDropEvent: async () => () => {} }) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async (name: string, handler: (event: { payload: unknown }) => void) => { bridge.events[name] = handler; return () => { delete bridge.events[name]; }; } }));
vi.mock('./Dormouse', () => ({ Dormouse: () => null }));
vi.mock('./VoiceControls', () => ({ MicButton: ({ label, onText }: { label?: string; onText: (text: string) => void }) => label ? <button aria-label={label} onClick={() => onText('Dictated sidebar task')} /> : null, VoiceNotice: () => null, useHoldToTalk: () => {} }));
vi.mock('./use-app-update', () => ({ useAppUpdate: () => ({ state: { state: 'idle' } }) }));

// In-memory bridge only: never invokes a host, signs in or starts a provider turn.
const snapshot: Database = {
  ...empty,
  accounts: [{ id: 'unit-agent', name: 'Unit agent', provider: 'claude', color: '#777' }],
  projects: [{ id: 'p', name: 'Unit project', path: '/unit', color: '#777', policy: 'fixed', account: 'unit-agent', last: null }],
  sessions: [{ id: 'old', project: 'p', account: 'unit-agent', title: 'Existing conversation', status: 'done', updated: 10, provider_id: null, pending: null, error: null, messages: [{ id: 'm', role: 'user', text: 'Original conversation message' }] }],
};
let acknowledge: (id: string) => void;
beforeEach(() => {
  localStorage.clear(); resetDrafts();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  bridge.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === 'snapshot_since') return { ...snapshot, revision: 1, hostId: 'unit-host', full: true };
    if (command === 'launch') return new Promise<string>(resolve => { acknowledge = resolve; });
    return null;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function startPending() {
  render(<DesktopApp />);
  await screen.findAllByText('Unit project');
  fireEvent.click(screen.getByRole('button', { name: 'New task in Unit project' }));
  const prompt = await screen.findByRole('textbox', { name: 'Task prompt' });
  fireEvent.change(prompt, { target: { value: 'Delayed new conversation' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start thread' }));
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('launch', expect.objectContaining({ prompt: 'Delayed new conversation' })));
}

it.each(['thread', 'home', 'settings'])('keeps newer %s navigation after a delayed launch', async destination => {
  await startPending();
  if (destination === 'thread') fireEvent.click(screen.getByText('Existing conversation'));
  if (destination === 'home') fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
  if (destination === 'settings') fireEvent.keyDown(window, { key: ',', ctrlKey: true });
  await act(async () => acknowledge('created'));
  if (destination === 'thread') expect(screen.getByText('Original conversation message')).toBeTruthy();
  if (destination === 'home') expect(screen.getByRole('region', { name: 'Home' })).toBeTruthy();
  if (destination === 'settings') {
    expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Workspaces' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    expect(screen.getByRole('heading', { name: 'Workspaces' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create workspace' })).toBeTruthy();
    expect(screen.getByLabelText('New workspace name')).toBeTruthy();
  }
});

it('opens the acknowledged thread when the user stays on the original composer', async () => {
  await startPending();
  await act(async () => acknowledge('created'));
  expect(screen.queryByRole('region', { name: 'New conversation' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'Delayed new conversation' })).toBeTruthy();
});

it('focuses the composer when an existing thread is clicked', async () => {
  render(<DesktopApp />);
  const row = await within(screen.getByLabelText('Thread list')).findByText('Existing conversation');
  expect(screen.queryByRole('combobox', { name: 'Workspace filter' })).toBeNull();
  const stats = screen.getByRole('group', { name: 'Thread statistics' });
  expect(stats.textContent).toBe('0 today1 lifetime');
  expect(stats.children).toHaveLength(2);
  const call = screen.getByRole('button', { name: 'Call Commander' });
  expect(stats.nextElementSibling).toBe(call);
  expect(call.closest('header')).toBe(stats.closest('header'));
  expect(call.nextElementSibling?.getAttribute('aria-label')).toBe('New thread');
  fireEvent.click(row);
  await screen.findByText('Original conversation message');
  await waitFor(() => expect(document.activeElement).toBe(document.querySelector('.chat-composer textarea')));
});


it('keeps project dictation next to Plus and launches in that project without replacing the draft', async () => {
  render(<DesktopApp />);
  const mic = await screen.findByRole('button', { name: 'Dictate new task in Unit project' });
  expect(mic.nextElementSibling?.getAttribute('aria-label')).toBe('New task in Unit project');
  fireEvent.click(mic);
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('launch', expect.objectContaining({ project: 'p', account: 'unit-agent', prompt: 'Dictated sidebar task' })));
  await act(async () => acknowledge('dictated'));
});

it.each([true, false])('scopes grouped=%s sidebar threads and empty projects to the saved workspace', async grouped => {
  localStorage.setItem('freddai.workspace', JSON.stringify('w'));
  localStorage.setItem('freddai.grouped', JSON.stringify(grouped));
  const scoped = { ...snapshot, preferences: { ...snapshot.preferences, workspaces: [{ id: 'w', name: 'Selected workspace', color: '#112233', projects: ['p'] }] },
    projects: [...snapshot.projects, { ...snapshot.projects[0], id: 'outside', name: 'Outside project' }, { ...snapshot.projects[0], id: 'empty', name: 'Empty outside project' }],
    sessions: [...snapshot.sessions, { ...snapshot.sessions[0], id: 'outside-thread', project: 'outside', title: 'Outside conversation' }] };
  bridge.invoke.mockImplementation(async (command: string) => command === 'snapshot_since' ? { ...scoped, revision: 1, hostId: 'unit-host', full: true } : null);
  render(<DesktopApp/>);
  await within(screen.getByLabelText('Thread list')).findByText('Existing conversation');
  expect(within(screen.getByLabelText('Thread list')).queryByText('Outside conversation')).toBeNull();
  expect(screen.queryByRole('button', { name: 'New task in Empty outside project' })).toBeNull();
  expect(screen.getByRole('combobox', { name: 'Workspace filter' }).textContent).toContain('Selected workspace');
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.scrollIntoView = () => {};
  fireEvent.change(screen.getByLabelText('Search threads'), { target: { value: 'no match' } });
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Workspace filter' }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: 'All workspaces' }));
  await within(screen.getByLabelText('Thread list')).findByText('Outside conversation');
  expect((screen.getByLabelText('Search threads') as HTMLInputElement).value).toBe('');
  expect(screen.getByRole('combobox', { name: 'Project filter' }).textContent).toContain('All projects');
  expect(screen.getByRole('combobox', { name: 'Status filter' }).textContent).toContain('All threads');
});

it('All workspaces shows assigned and unassigned projects, including projects with only archived history', async () => {
  const assigned = { ...snapshot.projects[0], id: 'assigned', name: 'Assigned project' };
  const noHistory = { ...snapshot.projects[0], id: 'empty-assigned', name: 'Empty assigned project' };
  const scoped = { ...snapshot, projects: [...snapshot.projects, assigned, noHistory],
    preferences: { ...snapshot.preferences, workspaces: [{ id: 'w', name: 'Work', color: '#112233', projects: ['assigned', 'empty-assigned'] }] },
    sessions: [...snapshot.sessions, { ...snapshot.sessions[0], id: 'archived-member', project: 'assigned', archived: true }] };
  bridge.invoke.mockImplementation(async (command: string) => command === 'snapshot_since' ? { ...scoped, revision: 1, hostId: 'unit-host', full: true } : null);
  render(<DesktopApp/>);
  await within(screen.getByLabelText('Thread list')).findByText('Existing conversation');
  expect(screen.getByRole('combobox', { name: 'Workspace filter' }).textContent).toContain('All workspaces');
  expect(screen.getByRole('button', { name: 'New task in Unit project' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'New task in Assigned project' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'New task in Empty assigned project' })).toBeTruthy();
});


it.each(['projects', 'recent'])('keeps Commander beside Dashboard in %s view with a workspace and search filter', async navView => {
  localStorage.setItem('freddai.workspace', JSON.stringify('w'));
  localStorage.setItem('freddai.threadNavView', JSON.stringify(navView));
  const commander = { ...snapshot.projects[0], id: 'chief', name: 'Commander-in-Chief', kind: 'commander' };
  const scoped = { ...snapshot, projects: [...snapshot.projects, commander],
    preferences: { ...snapshot.preferences, workspaces: [{ id: 'w', name: 'Work', color: '#112233', projects: ['p'] }] } };
  bridge.invoke.mockImplementation(async (command: string) => command === 'snapshot_since' ? { ...scoped, revision: 1, hostId: 'unit-host', full: true } : null);
  render(<DesktopApp />);
  const link = await screen.findByRole('button', { name: 'Open Commander-in-Chief' });
  expect(screen.getByRole('button', { name: 'Dashboard' }).nextElementSibling).toBe(link);
  expect(screen.queryByRole('region', { name: 'Commander-in-Chief threads' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Search threads'), { target: { value: 'no match' } });
  expect(screen.getByRole('button', { name: 'Open Commander-in-Chief' })).toBe(link);
});


it('starts a call from the empty composer and keeps the draft when speech creates a conversation', async () => {
  render(<DesktopApp />);
  await screen.findAllByText('Unit project');
  fireEvent.click(screen.getByRole('button', { name: 'New task in Unit project' }));
  const prompt = await screen.findByRole('textbox', { name: 'Task prompt' });
  fireEvent.change(prompt, { target: { value: 'Keep this draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start voice call' }));
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('voice_call_start', {}));
  expect(bridge.invoke.mock.calls.some(([name]) => name === 'launch')).toBe(false);
  await act(async () => { bridge.events['voice-call://segment']({ payload: { text: 'Spoken new task' } }); });
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('launch', expect.objectContaining({ prompt: 'Spoken new task', project: 'p' })), { timeout: 2500 });
  await act(async () => acknowledge('created-call'));
  expect(screen.getByRole('button', { name: 'End call' })).toBeTruthy();
  expect(bridge.invoke.mock.calls.some(([name]) => name === 'voice_call_stop')).toBe(false);
  expect(getDraft('new-thread:p')).toBe('Keep this draft');
  fireEvent.click(screen.getByRole('button', { name: 'End call' }));
});

 it('opens the full project composer from the dashboard plus without launching a thread', async () => {
  render(<DesktopApp />);
  fireEvent.click(await screen.findByRole('button', { name: 'Dashboard' }));
  fireEvent.click(await screen.findByRole('button', { name: 'New thread in Unit project' }));
  expect(await screen.findByRole('textbox', { name: 'Task prompt' })).toBeTruthy();
  expect(screen.queryByLabelText('Prompt for Unit project')).toBeNull();
  expect(bridge.invoke.mock.calls.some(([command]) => command === 'launch')).toBe(false);
});
