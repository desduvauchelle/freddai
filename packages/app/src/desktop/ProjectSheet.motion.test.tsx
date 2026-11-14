import { cleanup, render, fireEvent, screen, act } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectSheet } from './ProjectSheet';
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('finishes closing even when dashboard snapshots rerender the sheet', () => {
  vi.useFakeTimers();
  const close = vi.fn();
  const props = { project: { name: 'Test', color: '#567' }, sessions: [], read: {}, now: 0, threadId: null,
    onSelectThread: () => {}, onBack: () => {}, renderThread: () => null };
  const view = render(<ProjectSheet {...props} onClose={() => close()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(close).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(200));
  view.rerender(<ProjectSheet {...props} now={1} onClose={() => close()} />);
  act(() => vi.advanceTimersByTime(80));
  expect(close).toHaveBeenCalledTimes(1);
});
