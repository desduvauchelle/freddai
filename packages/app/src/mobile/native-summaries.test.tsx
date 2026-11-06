import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useNativeSummaries } from './native-summaries';
afterEach(cleanup);
it('reads cached summaries, reports empty/error states and only generates on an explicit action', async () => {
  const get = vi.fn(async (date: string) => ({ date, summary: null, running: false, error: null, threads: 2 }));
  const generate = vi.fn(async (date: string) => ({ date, summary: null, running: true, error: null, threads: 2 }));
  const client = { get, generate };
  const { result, rerender } = renderHook(({ enabled }) => useNativeSummaries(client, enabled), { initialProps: { enabled: true } });
  await waitFor(() => expect(result.current.summaries[0].action).toBe('Generate'));
  expect(get).toHaveBeenCalledTimes(3); expect(generate).not.toHaveBeenCalled();
  await act(() => result.current.generate(result.current.summaries[0].date));
  expect(generate).toHaveBeenCalledTimes(1);
  expect(result.current.summaries[0].busy).toBe(true);
  rerender({ enabled: false });
  expect(result.current.summaries).toEqual([]);
});
it('shows cached text and read failures without starting provider work', async () => {
  let calls = 0;
  const client = { get: vi.fn(async (date: string) => {
    if (++calls === 2) throw new Error('Offline');
    return { date, summary: calls === 1 ? { date, markdown: 'Completed tasks', generated_at: 1, provider: '', account: '', model: '', threads: 1 } : null, running: false, error: null, threads: 0 };
  }), generate: vi.fn() };
  const { result } = renderHook(() => useNativeSummaries(client, true));
  await waitFor(() => expect(result.current.summaries[0].text).toBe('Completed tasks'));
  expect(result.current.summaries[1].text).toContain('Offline');
  expect(result.current.summaries[2].text).toBe('No activity');
  expect(client.generate).not.toHaveBeenCalled();
});
