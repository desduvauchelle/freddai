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
