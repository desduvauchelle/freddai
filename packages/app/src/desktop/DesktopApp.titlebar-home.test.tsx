import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useImperativeHandle, useState, type ReactNode, type Ref } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { empty, type Database } from './types';
import { DesktopApp } from './DesktopApp';

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onDragDropEvent: async () => () => {} }) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('./Dormouse', () => ({ Dormouse: () => null }));
vi.mock('./VoiceControls', () => ({ MicButton: () => null, VoiceNotice: () => null, useHoldToTalk: () => {} }));
vi.mock('./use-app-update', () => ({ useAppUpdate: () => ({ state: { state: 'idle' } }) }));
// jsdom has no layout, so the real panel never collapses: this stand-in honours collapse()/expand() and reports the size.
vi.mock('@freddai/ui/components/resizable', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ResizablePanel: ({ children, panelRef, onResize }: { children?: ReactNode; panelRef?: Ref<unknown>; onResize?: (size: { asPercentage: number }) => void }) => {
      const [collapsed, setCollapsed] = useState(false);
      useImperativeHandle(panelRef, () => ({
        isCollapsed: () => collapsed,
        collapse: () => { setCollapsed(true); onResize?.({ asPercentage: 0 }); },
        expand: () => { setCollapsed(false); onResize?.({ asPercentage: 42 }); },
      }), [collapsed, onResize]);
      return <div hidden={collapsed}>{children}</div>;
    },
  };
});

const snapshot: Database = {
  ...empty,
  accounts: [{ id: 'unit-agent', name: 'Unit agent', provider: 'claude', color: '#777' }],
  projects: [{ id: 'p', name: 'Unit project', path: '/unit', color: '#777', policy: 'fixed', account: 'unit-agent', last: null }],
  sessions: [{ id: 'old', project: 'p', account: 'unit-agent', title: 'Existing conversation', status: 'done', updated: 10, provider_id: null, pending: null, error: null, messages: [{ id: 'm', role: 'user', text: 'Original conversation message' }] }],
};
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  bridge.invoke.mockReset().mockImplementation(async (command: string) => command === 'snapshot_since' ? { ...snapshot, revision: 1, hostId: 'unit-host', full: true } : null);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('shows a titlebar Dashboard button only while the thread list is hidden', async () => {
  render(<DesktopApp />);
  await screen.findAllByText('Unit project');
  const header = document.querySelector('header.app-titlebar') as HTMLElement;
  expect(within(header).queryByRole('button', { name: 'Dashboard' })).toBeNull();
  fireEvent.click(screen.getAllByText('Existing conversation')[0]);
  expect(screen.queryByRole('region', { name: 'Home' })).toBeNull();
  fireEvent.click(within(header).getByRole('button', { name: 'Hide thread list' }));
  const home = await within(header).findByRole('button', { name: 'Dashboard' });
  expect(home.previousElementSibling).toBe(within(header).getByRole('button', { name: 'Show thread list' }));
  expect(home.getAttribute('aria-current')).toBeNull();
  fireEvent.click(home);
  expect(await screen.findByRole('region', { name: 'Home' })).toBeTruthy();
  expect(home.getAttribute('aria-current')).toBe('page');
  fireEvent.click(within(header).getByRole('button', { name: 'Show thread list' }));
  await waitFor(() => expect(within(header).queryByRole('button', { name: 'Dashboard' })).toBeNull());
});
