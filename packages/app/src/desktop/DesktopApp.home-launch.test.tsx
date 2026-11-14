import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { empty, type Database } from './types';
import { DesktopApp } from './DesktopApp';
import { resetDrafts } from './drafts';

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onDragDropEvent: async () => () => {} }) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => ['/offline-fixture/attachment.txt']) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('./Dormouse', () => ({ Dormouse: () => null }));
vi.mock('./VoiceControls', () => ({ MicButton: () => null, VoiceNotice: () => null, useHoldToTalk: () => {} }));
vi.mock('./use-app-update', () => ({ useAppUpdate: () => ({ state: { state: 'idle' } }) }));

// In-memory bridge only: no host, no provider turn.
const snapshot: Database = {
  ...empty,
  accounts: [
    { id: 'agent-a', name: 'Agent A', provider: 'claude', color: '#777' },
    { id: 'agent-b', name: 'Agent B', provider: 'codex', color: '#888' },
  ],
  projects: [{ id: 'p', name: 'Unit project', path: '/unit', color: '#777', policy: 'inherit', account: null, last: 'agent-b' }],
  sessions: [],
  preferences: { prefer_last: false, fallback: 'agent-a', last: null },
};
let acknowledge: (id: string) => void;
beforeEach(() => {
  localStorage.clear(); resetDrafts();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  bridge.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === 'snapshot_since') return { ...snapshot, revision: 1, hostId: 'unit-host', full: true };
    if (command === 'stage_attachments') return [{ id: 'fixture-file', name: 'attachment.txt', bytes: 1, mime: 'text/plain', sha256: '' }];
    if (command === 'launch') return new Promise<string>(resolve => { acknowledge = resolve; });
    return null;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('opens the project card + with the last-used agent, then returns to the dashboard with a Sending row', async () => {
  render(<DesktopApp />);
  const card = await screen.findByRole('article', { name: 'Project Unit project' });
  fireEvent.click(within(card).getByRole('button', { name: 'New thread in Unit project' }));
  // The + opens the composer in the side panel; the dashboard route is never left.
  const prompt = await screen.findByRole('textbox', { name: 'Task prompt' });
  fireEvent.change(prompt, { target: { value: 'Ship the thing' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start thread' }));
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('launch', expect.objectContaining({ project: 'p', account: 'agent-b', prompt: 'Ship the thing' })));
  // Escape twice (panel composer -> list -> closed) returns to the untouched dashboard with a pending row under the project.
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const home = screen.getByRole('region', { name: 'Home' });
  const tile = within(home).getByRole('article', { name: 'Project Unit project' });
  const row = within(tile).getByRole('button', { name: /Ship the thing/ });
  expect(within(row).getByRole('img', { name: 'Sending…' })).toBeTruthy();
  await act(async () => acknowledge('created'));
});

it('uses the complete composer and opens the acknowledged canonical thread inside the dashboard sheet', async () => {
  render(<DesktopApp />);
  fireEvent.click(await screen.findByRole('button', { name: 'New thread in Unit project' }));
  const sheet = screen.getByRole('dialog', { name: 'New thread' });
  for (const name of ['Attach files', 'Separate worktree', 'Assistant and difficulty', 'Start voice call']) {
    expect(within(sheet).getByRole('button', { name })).toBeTruthy();
  }
  const prompt = within(sheet).getByRole('textbox', { name: 'Task prompt' });
  fireEvent.change(prompt, { target: { value: 'Canonical conversation' } });
  fireEvent.keyDown(prompt, { key: 'Enter' });
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('launch', expect.objectContaining({ project: 'p', prompt: 'Canonical conversation' })));
  expect(within(sheet).getByLabelText('Starting conversation')).toBeTruthy();
  await act(async () => acknowledge('exact-returned-id'));
  const conversation = screen.getByRole('dialog', { name: 'Conversation' });
  expect(within(conversation).getByRole('textbox', { name: 'Message agent' })).toBeTruthy();
  expect(within(conversation).getByRole('heading', { name: 'Canonical conversation' })).toBeTruthy();
  expect(document.querySelector('.home-pane')).toBeTruthy();
  fireEvent.click(within(conversation).getByRole('button', { name: 'Attach files' }));
  expect(await within(conversation).findByRole('button', { name: 'Remove attachment.txt' })).toBeTruthy();
  fireEvent.click(within(conversation).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('region', { name: 'Home' })).toBeTruthy();
});
