// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ProjectSheet } from './ProjectSheet';
import type { Session } from './types';

it('shows pins once, pending deliveries and queued work before recent completed threads', () => {
  const sessions = [
    { id: 'recent', title: 'Recent', status: 'done', updated: 100 },
    { id: 'pin', title: 'Pin', status: 'running', updated: 1, pinned: true },
    { id: 'queued', title: 'Queued', status: 'done', updated: 2 },
  ] as Session[];
  render(<ProjectSheet project={{ name: 'Test', color: '#567' }} sessions={[...sessions, sessions[1]]}
    pending={[{ id: 'pending', title: 'Sending', status: 'sending' }]} queuedThreadIds={new Set(['queued'])}
    read={{ recent: 100, queued: 2 }} now={200} threadId={null} onSelectThread={() => {}} onBack={() => {}}
    onClose={() => {}} renderThread={() => null} />);
  const rows = [...document.querySelectorAll('.project-sheet-list li')].map(el => el.textContent);
  expect(rows).toHaveLength(4);
  expect(rows[0]).toBe('Pin');
  expect(rows[1]).toContain('Sending');
  expect(rows.slice(2)).toEqual(['Queued', 'Recent']);
});
