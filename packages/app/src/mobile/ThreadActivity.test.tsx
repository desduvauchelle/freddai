import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThreadActivity } from './ThreadActivity';
import type { CompanionThread } from './companion';
vi.mock('../desktop/Dormouse', () => ({ Dormouse: () => null }));
afterEach(cleanup);
import { companionActivity } from './ThreadActivity';

describe('companion activity', () => {
  it.each([
    ['starting', 2, 'Starting…'], ['running', 2, 'Working…'],
    ['waiting', 4, 'Waiting for you'], ['done', 6, 'Completed'],
    ['interrupted', 7, 'Interrupted'], ['failed', 8, 'Failed · Needs attention'],
    ['idle', 0, 'Ready'],
  ])('reflects %s in the avatar and readable status', (status, mood, label) => {
    expect(companionActivity({ status }, 'ok')).toMatchObject({ mood, label });
  });
  it('gives pending input precedence over running but preserves terminal errors', () => {
    expect(companionActivity({ status: 'running', pending: {} }, 'ok').state).toBe('waiting');
    for (const status of ['failed', 'interrupted']) expect(companionActivity({ status, pending: {} }, 'ok').state).toBe(status);
  });
  it('does not present cached running state as live while disconnected', () => {
    for (const connection of ['down', 'connecting'] as const) expect(companionActivity({ status: 'running' }, connection)).toMatchObject({ mood: 0, state: 'offline' });
  });
  it('distinguishes queue pause from an active turn, and loading from ready', () => {
    expect(companionActivity({ status: 'done', queuePaused: true }, 'ok').state).toBe('paused');
    expect(companionActivity({ status: 'running', queuePaused: true }, 'ok').state).toBe('running');
    expect(companionActivity(undefined, 'ok').state).toBe('loading');
  });
});

it('offers turn controls in the companion activity row and removes them offline', () => {
  const thread = { status: 'running' } as CompanionThread;
  const onStop = vi.fn(), onResume = vi.fn();
  const view = render(<ThreadActivity thread={thread} connection="ok" onStop={onStop} onResume={onResume} />);
  fireEvent.click(screen.getByRole('button', { name: /Stop current turn/ }));
  expect(onStop).toHaveBeenCalledOnce();
  view.rerender(<ThreadActivity thread={{ ...thread, status: 'interrupted' }} connection="ok" onStop={onStop} onResume={onResume} />);
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
  expect(onResume).toHaveBeenCalledOnce();
  view.rerender(<ThreadActivity thread={{ ...thread, status: 'interrupted' }} connection="down" onStop={onStop} onResume={onResume} />);
  expect(screen.queryByRole('button')).toBeNull();
});
