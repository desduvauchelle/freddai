import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SubThreads } from './SubThreads';
import { isCommanderThread } from '../../commanderThreads';
afterEach(cleanup);
it('identifies both internal and delegated threads while leaving user project threads alone', () => {
  expect(isCommanderThread({ project: 'cmd' }, 'cmd')).toBe(true);
  expect(isCommanderThread({ project: 'project', origin: { kind: 'commander' } }, 'cmd')).toBe(true);
  expect(isCommanderThread({ project: 'project' }, 'cmd')).toBe(false);
});
it('opens a background thread from the tools list with its project and current status', () => {
  const open = vi.fn();
  render(<SubThreads threads={[{ id: 'bg', title: 'Check the invoices', project: 'p', status: 'running', updated: 3 }]} projects={[{ id: 'p', name: 'Finance' }]} onOpenThread={open} />);
  expect(screen.getByText('Finance')).toBeTruthy(); expect(screen.getByText('running')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Check the invoices' }));
  expect(open).toHaveBeenCalledWith('bg');
});
