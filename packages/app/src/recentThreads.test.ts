import { expect, it } from 'vitest';
import { COMPANION_RECENT_PAGING, RECENT_PAGING, asThreadNavView, recentLimit, selectRecentThreads } from './recentThreads';

const t = (id: string, updated: number, extra: Record<string, unknown> = {}) => ({ id, updated, status: 'done', ...extra });
const many = (n: number) => Array.from({ length: n }, (_, i) => t(`t${String(i).padStart(2, '0')}`, i + 1));

it('sorts newest first by last user message, falling back to updated', () => {
  const out = selectRecentThreads([t('a', 10), t('b', 5, { last_user_message_at: 50 }), t('c', 20)]);
  expect(out.threads.map(x => x.id)).toEqual(['b', 'c', 'a']);
});

it('breaks ties by id for a stable order', () => {
  expect(selectRecentThreads([t('b', 1), t('a', 1)]).threads.map(x => x.id)).toEqual(['a', 'b']);
});

it('excludes archived and deleted threads', () => {
  const out = selectRecentThreads([t('a', 1), t('b', 2, { archived: true }), t('c', 3, { status: 'archived' }), t('d', 4, { deleted_at: 9 }), t('e', 5, { status: 'deleted' })]);
  expect(out.threads.map(x => x.id)).toEqual(['a']);
  expect(out.total).toBe(1);
});

it('pages 5, then 15, then 25 and reports what remains', () => {
  const all = many(40);
  expect(recentLimit(0)).toBe(5); expect(recentLimit(1)).toBe(15); expect(recentLimit(2)).toBe(25);
  const first = selectRecentThreads(all, 0);
  expect([first.threads.length, first.remaining, first.expanded]).toEqual([5, 35, false]);
  expect(first.threads[0].id).toBe('t39');
  const second = selectRecentThreads(all, 1);
  expect([second.threads.length, second.remaining, second.expanded]).toEqual([15, 25, true]);
  expect(selectRecentThreads(all, 2).threads.length).toBe(25);
  expect(selectRecentThreads(all, 4).remaining).toBe(0);
});

it('has nothing remaining when everything fits, and is empty for no threads', () => {
  expect(selectRecentThreads(many(5)).remaining).toBe(0);
  expect(selectRecentThreads([]).threads).toEqual([]);
});

it('does not mutate its input and tolerates bad page counts', () => {
  const input = [t('a', 1), t('b', 2)];
  selectRecentThreads(input);
  expect(input.map(x => x.id)).toEqual(['a', 'b']);
  expect(recentLimit(-3)).toBe(5); expect(recentLimit(NaN)).toBe(5);
});

it('defaults unknown stored views to projects', () => {
  expect(asThreadNavView('recent')).toBe('recent');
  expect(asThreadNavView('x')).toBe('projects'); expect(asThreadNavView(null)).toBe('projects');
});

it('takes page sizes per caller: desktop 5/+10, companion Recent view 25/+25', () => {
  const all = Array.from({ length: 80 }, (_, i) => t(`t${i}`, i));
  expect(RECENT_PAGING).toEqual({ initial: 5, step: 10 });
  expect(selectRecentThreads(all).threads).toHaveLength(5);
  expect(selectRecentThreads(all, 1, RECENT_PAGING).threads).toHaveLength(15);
  expect([0, 1, 2, 3].map(p => selectRecentThreads(all, p, COMPANION_RECENT_PAGING).threads.length)).toEqual([25, 50, 75, 80]);
  expect(selectRecentThreads(all, 0, COMPANION_RECENT_PAGING)).toMatchObject({ remaining: 55, expanded: false });
  expect(recentLimit(2, { initial: 3, step: 4 })).toBe(11);
});
