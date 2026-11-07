import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ActivityControls } from './ActivityControls';
afterEach(cleanup);

it('switches from Stop to Resume after interruption and dispatches only the chosen action', () => {
  const onStop = vi.fn(), onResume = vi.fn();
  const view = render(<ActivityControls active interrupted={false} onStop={onStop} onResume={onResume} />);
  fireEvent.click(screen.getByRole('button', { name: 'Stop current turn and pause queue' }));
  expect(onStop).toHaveBeenCalledOnce();
  expect(onResume).not.toHaveBeenCalled();
  view.rerender(<ActivityControls active={false} interrupted onStop={onStop} onResume={onResume} />);
  expect(screen.queryByRole('button', { name: /Stop/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
  expect(onResume).toHaveBeenCalledOnce();
});
it('blocks repeat actions while pending and hides actions for unsupported or completed threads', () => {
  const onResume = vi.fn();
  const view = render(<ActivityControls active={false} interrupted onResume={onResume} disabled />);
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
  expect(onResume).not.toHaveBeenCalled();
  view.rerender(<ActivityControls active={false} interrupted />);
  expect(screen.queryByRole('button')).toBeNull();
  view.rerender(<ActivityControls active={false} interrupted={false} onResume={onResume} />);
  expect(screen.queryByRole('button')).toBeNull();
});
