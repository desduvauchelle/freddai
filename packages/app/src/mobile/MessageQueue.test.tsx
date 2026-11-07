import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MessageQueue } from './MessageQueue';
afterEach(cleanup);
const messages = [{ id: 'one', prompt: 'Check the layout on a small phone', attachments: 2 }, { id: 'two', prompt: 'Then check the tablet', attachments: 0 }];
it('starts compact and reveals ordered messages and removal on expansion', () => {
  const onAction = vi.fn();
  render(<MessageQueue messages={messages} disabled={false} onAction={onAction}/>);
  const toggle = screen.getByRole('button', { name: /Up next/ });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('list')).toBeNull();
  fireEvent.click(toggle);
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getByText('2 files')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Remove queued message 2' }));
  expect(onAction).toHaveBeenCalledWith('delete', 'two');
  fireEvent.click(screen.getByRole('button', { name: 'Clear queue' }));
  expect(onAction).toHaveBeenCalledWith('clear');
});
it('distinguishes a paused queue and dispatches resume without expanding', () => {
  const onAction = vi.fn();
  render(<MessageQueue messages={messages} paused disabled={false} onAction={onAction}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Resume queued messages' }));
  expect(onAction).toHaveBeenCalledWith('resume');
  expect(screen.queryByRole('list')).toBeNull();
});
it('keeps messages inspectable while disconnected but disables mutations', () => {
  const onAction = vi.fn();
  render(<MessageQueue messages={messages} disabled onAction={onAction} error="Queue could not resume"/>);
  fireEvent.click(screen.getByRole('button', { name: /Up next/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Pause queued messages' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove queued message 1' }));
  expect(onAction).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toBe('Queue could not resume');
});
it('hides an empty queue', () => {
  render(<MessageQueue messages={[]} disabled={false} onAction={vi.fn()}/>);
  expect(screen.queryByRole('region')).toBeNull();
});

it('lets an active conversation steer a queued message', () => {
  const onAction = vi.fn();
  render(<MessageQueue messages={messages} active disabled={false} onAction={onAction}/>);
  fireEvent.click(screen.getByRole('button', { name: /Up next/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Steer queued message 1' }));
  expect(onAction).toHaveBeenCalledWith('steer', 'one');
});

it.each([{ active: false, disabled: false }, { active: true, disabled: true }])('disables steering without an active connection and turn: %j', props => {
  const onAction = vi.fn();
  render(<MessageQueue messages={messages} {...props} onAction={onAction}/>);
  fireEvent.click(screen.getByRole('button', { name: /Up next/ }));
  const steer = screen.getByRole('button', { name: 'Steer queued message 1' }) as HTMLButtonElement;
  expect(steer.disabled).toBe(true);
  fireEvent.click(steer);
  expect(onAction).not.toHaveBeenCalled();
});
