// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ProjectThreadList } from './ProjectThreadList';
import type { CompanionSnapshot } from './companion';

const t = (id: string, project: string, title: string) => ({ id, project, title, status: 'done', updated: 5, messages: [], canReply: true, queued: 0, error: null });

it('lists only the tapped project\'s threads', () => {
  const snapshot = { projects: [], threads: [t('a', 'p1', 'Mine'), t('b', 'p2', 'Other project')] } as unknown as CompanionSnapshot;
  const { container } = render(<ProjectThreadList project="p1" snapshot={snapshot} connected onOpen={() => {}} onNew={() => {}} />);
  expect(screen.getByText('Mine')).toBeTruthy();
  expect(screen.queryByText('Other project')).toBeNull();
  expect(container.querySelectorAll('.companion-row').length).toBe(1);
});

it('prioritizes old pins and ongoing threads before paging recent threads without repeating pins', () => {
  const recent = Array.from({ length: 25 }, (_, i) => ({ ...t(`recent-${i}`, 'p', `Recent ${i}`), updated: 100 - i }));
  const pin = { ...t('pin', 'p', 'Pinned running'), pinned: true, status: 'running', updated: 1 };
  const active = { ...t('active', 'p', 'Ongoing'), status: 'running', updated: 2 };
  const snapshot = { projects: [], threads: [...recent, pin, active, pin] } as unknown as CompanionSnapshot;
  const read = Object.fromEntries(recent.map(t => [t.id, t.updated]));
  const { container } = render(<ProjectThreadList project="p" snapshot={snapshot} read={read} connected onOpen={() => {}} onNew={() => {}} />);
  const titles = [...container.querySelectorAll('.companion-row strong')].map(el => el.textContent);
  expect(titles.slice(0, 3)).toEqual(['Pinned running', 'Ongoing', 'Recent 0']);
  expect(titles.filter(t => t === 'Pinned running')).toHaveLength(1);
  expect(titles).toHaveLength(20);
});
