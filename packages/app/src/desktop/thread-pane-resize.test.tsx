import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DesktopApp } from './DesktopApp';
import { empty } from './types';
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: async (command: string) => command === 'snapshot_since' ? { ...empty, revision: 1, hostId: 'offline', full: true } : null }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onDragDropEvent: async () => () => {} }) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('./Dormouse', () => ({ Dormouse: () => null }));
vi.mock('./VoiceControls', () => ({ MicButton: () => null, VoiceNotice: () => null, useHoldToTalk: () => {} }));
vi.mock('./use-app-update', () => ({ useAppUpdate: () => ({ state: { state: 'idle' } }) }));
// Capture constraints at the application/library boundary, without creating accounts or turns.
const panel = vi.hoisted(() => ({ props: {} as Record<string, unknown> }));
vi.mock('@freddai/ui/components/resizable', async importOriginal => {
  const original = await importOriginal<typeof import('@freddai/ui/components/resizable')>();
  return { ...original, ResizablePanel: (props: React.ComponentProps<typeof original.ResizablePanel>) => {
    if (props.id === 'thread-list') panel.props = props;
    return <original.ResizablePanel {...props} />;
  } };
});
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
it('allows a compact thread list and requires an intentional edge drag to collapse', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  render(<DesktopApp />);
  await screen.findByRole('region', { name: 'Threads' });
  expect(panel.props.minSize).toBe('220px');
  expect(panel.props.collapsedThreshold).toBe('180px');
  expect(panel.props.collapsible).toBe(true);
  expect(panel.props.collapsedSize).toBe('0%');
});
