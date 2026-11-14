import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mergeHistory, useThreadHistory } from './use-thread-history';
import type { CompanionClient, CompanionThread } from './companion';
const message = (id: string, text = id) => ({ id, text, role: 'assistant' });
const thread = (id = 't', messages = [message('60'), message('61')]): CompanionThread => ({ id, messages, historyBefore: '60', project: 'p', title: id, status: 'done', updated: 1, canReply: true, queued: 0, error: null });
const viewport = () => ({ current: Object.assign(document.createElement('div'), { scrollTop: 10 }) });
describe('paged companion history', () => {
  it('deduplicates overlapping pages and updates streaming entries', () => {
    expect(mergeHistory([message('a'), message('b')], [message('b', 'updated'), message('c')])).toEqual([message('a'), message('b', 'updated'), message('c')]);
  });
  it('keeps older pages across polls and anchors the viewport', async () => {
    const view = viewport(); let height = 200;
    Object.defineProperty(view.current, 'scrollHeight', { get: () => height });
    const client = { history: vi.fn(async () => ({ messages: [message('59'), message('60')], before: null })) } as unknown as CompanionClient;
    const { result, rerender } = renderHook(({ task }) => useThreadHistory(task, client, view), { initialProps: { task: thread() } });
    await act(async () => { await result.current.loadOlder(); height = 300; });
    expect(view.current.scrollTop).toBe(110);
    rerender({ task: thread('t', [message('60'), message('61', 'streaming'), message('62')]) });
    expect(result.current.messages.map(m => m.id)).toEqual(['59', '60', '61', '62']);
    expect(result.current.messages[2].text).toBe('streaming');
    expect(result.current.hasOlder).toBe(false);
  });
  it('discards a page completing after a thread switch', async () => {
    let resolve!: (value: { messages: ReturnType<typeof message>[]; before: null }) => void;
    const client = { history: vi.fn(() => new Promise(r => { resolve = r; })) } as unknown as CompanionClient;
    const view = viewport();
    const { result, rerender } = renderHook(({ task }) => useThreadHistory(task, client, view), { initialProps: { task: thread() } });
    act(() => { void result.current.loadOlder(); });
    rerender({ task: thread('other', [message('x')]) });
    await act(async () => { resolve({ messages: [message('old')], before: null }); });
    expect(result.current.messages).toEqual([message('x')]);
  });
  it('allows retry after failure and resets disjoint snapshots instead of hiding gaps', async () => {
    const client = { history: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ messages: [message('59')], before: null }) } as unknown as CompanionClient;
    const view = viewport();
    const { result, rerender } = renderHook(({ task }) => useThreadHistory(task, client, view), { initialProps: { task: thread() } });
    await act(async () => { await result.current.loadOlder(); });
    expect(result.current.error).toContain('offline');
    await act(async () => { await result.current.loadOlder(); });
    expect(result.current.error).toBe('');
    rerender({ task: { ...thread('t', [message('200')]), historyBefore: '200' } });
    await waitFor(() => expect(result.current.messages).toEqual([message('200')]));
    expect(result.current.hasOlder).toBe(true);
  });
});
