import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { empty, type Database } from './types';
import { DesktopApp } from './DesktopApp';

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('./Dormouse', () => ({ Dormouse: () => null }));
vi.mock('./VoiceControls', () => ({ MicButton: () => null, VoiceNotice: () => null, useHoldToTalk: () => {} }));
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
  localStorage.clear();
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
  fireEvent.keyDown(window, { key: 'n', ctrlKey: true });
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
  if (destination === 'settings') expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeTruthy();
});

it('opens the acknowledged thread when the user stays on the original composer', async () => {
  await startPending();
  await act(async () => acknowledge('created'));
  expect(screen.queryByRole('region', { name: 'New conversation' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'Delayed new conversation' })).toBeTruthy();
});
