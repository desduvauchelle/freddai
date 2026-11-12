import { VOICE_CALL_SUFFIX } from "../conversation/voiceCallMarkup";
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
const base: Database = {
  ...empty,
  accounts: [{ id: 'cx', name: 'Codex', provider: 'codex', color: '#777' }, { id: 'cl', name: 'Claude', provider: 'claude', color: '#777' }],
  projects: [{ id: 'p', name: 'Unit project', path: '/unit', color: '#777', policy: 'inherit', account: null, last: 'cx' }],
  sessions: [],
};
function setup(preferences: Partial<Database['preferences']>) {
  localStorage.clear(); resetDrafts();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  bridge.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === 'snapshot_since') return { ...base, preferences: { ...base.preferences, fallback: 'cx', ...preferences }, revision: 1, hostId: 'unit-host', full: true };
    if (command === 'launch') return new Promise<string>(() => {});
    return null;
  });
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function launchedAccount() {
  render(<DesktopApp />);
  await screen.findAllByText('Unit project');
  fireEvent.click(screen.getByRole('button', { name: 'New task in Unit project' }));
  fireEvent.change(await screen.findByRole('textbox', { name: 'Task prompt' }), { target: { value: 'Hello' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start thread' }));
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('launch', expect.anything()));
  return (bridge.invoke.mock.calls.find(c => c[0] === 'launch')![1] as { account: string }).account;
}

it('a new chat starts with the agent last picked, not the project last-used or the global default', async () => {
  setup({ new_thread_policy: 'last_selected', last_selected: 'cl' });
  expect(await launchedAccount()).toBe('cl');
});

it('keeps the project last-used agent when the policy is not last selected', async () => {
  setup({ new_thread_policy: 'project' });
  expect(await launchedAccount()).toBe('cx');
});
