import { expect, it, vi } from 'vitest';
const invoke = vi.hoisted(() => vi.fn(async () => ({ projects: [], threads: [] })));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
import { nativeCompanionClient } from './native-client';
it('requests summaries on home and only the opened thread through the native bridge', async () => {
  const signal = new AbortController().signal;
  await nativeCompanionClient.snapshot(signal);
  expect(invoke).toHaveBeenCalledWith('companion_snapshot', { thread: null });
  await nativeCompanionClient.snapshot(signal, 'selected-thread');
  expect(invoke).toHaveBeenCalledWith('companion_snapshot', { thread: 'selected-thread' });
});
it('reads summaries without generating and generates only through the explicit command', async () => {
  await nativeCompanionClient.summaries!.get('2026-11-04');
  expect(invoke).toHaveBeenLastCalledWith('companion_composer', { operation: 'day_summary', input: { date: '2026-11-04' } });
  await nativeCompanionClient.summaries!.generate('2026-11-04', false);
  expect(invoke).toHaveBeenLastCalledWith('companion_composer', { operation: 'summarize_day', input: { date: '2026-11-04', force: false } });
});
it('passes the start flag to preview_open', async () => {
  const { previewOpen } = await import('./native-client');
  await previewOpen('t1', 'http://localhost:3000/');
  expect(invoke).toHaveBeenLastCalledWith('preview_open', { threadId: 't1', url: 'http://localhost:3000/', start: false });
  await previewOpen('t1', 'http://localhost:3000/', true);
  expect(invoke).toHaveBeenLastCalledWith('preview_open', { threadId: 't1', url: 'http://localhost:3000/', start: true });
});
it('streams bug walk upload progress from the Rust event around the send command', async () => {
  const handlers: Record<string, (e: { payload: { sent: number; total: number } }) => void> = {};
  const unlisten = vi.fn();
  vi.doMock('@tauri-apps/api/event', () => ({ listen: async (name: string, h: (e: { payload: { sent: number; total: number } }) => void) => { handlers[name] = h; return unlisten; } }));
  vi.resetModules();
  const { bugWalkSend, bugWalkStatus } = await import('./native-client');
  const core = await import('@tauri-apps/api/core');
  const mocked = core.invoke as unknown as ReturnType<typeof vi.fn>;
  mocked.mockImplementationOnce((async () => { handlers['bug-walk://upload']({ payload: { sent: 5, total: 10 } }); return { id: 'w1' }; }) as never);
  const progress = vi.fn();
  const video = { path: '/tmp/freddai-bugwalk/a.mp4', name: 'a.mp4', mime: 'video/mp4', bytes: 10, durationS: 3 };
  const opts = { project: 'p', permission_mode: 'ask' as const, split: 'single' as const };
  await expect(bugWalkSend(video, 'iPhone', opts, progress)).resolves.toEqual({ id: 'w1' });
  expect(progress).toHaveBeenCalledWith(5, 10);
  expect(mocked).toHaveBeenCalledWith('companion_bug_walk_send', { path: video.path, name: 'a.mp4', device: 'iPhone', opts });
  expect(unlisten).toHaveBeenCalled();
  await bugWalkStatus('w1');
  expect(mocked).toHaveBeenLastCalledWith('companion_bug_walk_status', { id: 'w1' });
});
