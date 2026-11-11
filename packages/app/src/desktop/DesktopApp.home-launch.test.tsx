import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { empty, type Database } from './types';
import { DesktopApp } from './DesktopApp';
import { resetDrafts } from './drafts';

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onDragDropEvent: async () => () => {} }) }));
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
    if (command === 'launch') return new Promise<string>(resolve => { acknowledge = resolve; });
    return null;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('opens the project card + with the last-used agent, then returns to the dashboard with a Sending row', async () => {
  render(<DesktopApp />);
  const card = await screen.findByRole('article', { name: 'Project Unit project' });
  fireEvent.click(within(card).getByRole('button', { name: 'New thread in Unit project' }));
  const prompt = await screen.findByRole('textbox', { name: 'Task prompt' });
  fireEvent.change(prompt, { target: { value: 'Ship the thing' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start thread' }));
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('launch', expect.objectContaining({ project: 'p', account: 'agent-b', prompt: 'Ship the thing' })));
  // Dialog closed, dashboard visible, pending row under the project (name unchanged).
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Task prompt' })).toBeNull());
  const home = screen.getByRole('region', { name: 'Home' });
  const tile = within(home).getByRole('article', { name: 'Project Unit project' });
  const row = within(tile).getByRole('button', { name: /Ship the thing/ });
  expect(within(row).getByRole('img', { name: 'Sending…' })).toBeTruthy();
  await act(async () => acknowledge('created'));
});
