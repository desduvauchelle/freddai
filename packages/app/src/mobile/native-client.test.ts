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
