import { describe, expect, it, vi } from 'vitest';
import { maxCursors, migrateLocalRead, readFromThreads } from './read-sync';
import { threadListStatus, threadInActiveList } from './desktop/types';

const store = (initial: Record<string, string>) => {
  const data = { ...initial };
  return { data, getItem: (k: string) => data[k] ?? null, removeItem: (k: string) => { delete data[k]; } };
};

describe('read cursors', () => {
  it('merges with max semantics and never moves backwards', () => {
    expect(maxCursors({ a: 5, b: 9 }, { a: 3, b: 12, c: 1 })).toEqual({ a: 5, b: 12, c: 1 });
    expect(readFromThreads([{ id: 'a', read_at: 10 }], { a: 4, b: 2 })).toEqual({ a: 10, b: 2 });
  });
  it('derives unread status from the host snapshot read_at', () => {
    const thread = { id: 't', status: 'done', updated: 100 };
    expect(threadListStatus(thread, readFromThreads([{ id: 't', read_at: null }]))).toBe('unread');
    expect(threadListStatus(thread, readFromThreads([{ id: 't', read_at: 99 }]))).toBe('unread');
    expect(threadListStatus(thread, readFromThreads([{ id: 't', read_at: 100 }]))).toBe('done');
    // An optimistic overlay clears unread before the host echoes it.
    expect(threadInActiveList(thread, readFromThreads([{ id: 't' }], { t: 100 }), '', true, 'all')).toBe(false);
    expect(threadInActiveList(thread, readFromThreads([{ id: 't' }]), '', true, 'all')).toBe(true);
  });
});

describe('migrateLocalRead', () => {
  it('sends the legacy map and removes the key only after success', async () => {
    const s = store({ 'freddai.read': '{"a":3,"b":"x"}' });
    const send = vi.fn().mockResolvedValue(null);
    expect(await migrateLocalRead('freddai.read', s, send)).toBe('migrated');
    expect(send).toHaveBeenCalledWith({ a: 3 });
    expect(s.data['freddai.read']).toBeUndefined();
  });
  it('keeps the key and logs loudly when the host call fails', async () => {
    const s = store({ 'freddai.read': '{"a":3}' });
    const log = vi.fn();
    expect(await migrateLocalRead('freddai.read', s, () => Promise.reject(new Error('Unknown host command: merge_read')), log)).toBe('failed');
    expect(s.data['freddai.read']).toBe('{"a":3}');
    expect(log.mock.calls[0][0]).toContain('[read-sync]');
  });
  it('does nothing without a key and keeps unparsable data', async () => {
    const send = vi.fn();
    expect(await migrateLocalRead('k', store({}), send)).toBe('none');
    const bad = store({ k: '{' });
    expect(await migrateLocalRead('k', bad, send, vi.fn())).toBe('failed');
    expect(bad.data.k).toBe('{');
    expect(send).not.toHaveBeenCalled();
  });
});
