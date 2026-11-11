import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MessageQueue } from './MessageQueue';
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
afterEach(cleanup);
const messages = [{ id: 'one', prompt: 'Check the phone', attachments: 2 }, { id: 'two', prompt: 'Check the tablet', attachments: 0 }];
it('exposes exactly steer, edit and delete for every visible message', () => {
  const onAction = vi.fn();
  render(<MessageQueue messages={messages} active disabled={false} onAction={onAction}/>);
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getAllByRole('button')).toHaveLength(6);
  expect(screen.getAllByRole('button').every(button => !button.textContent?.trim() && button.getAttribute('aria-label'))).toBe(true);
  expect(screen.queryByText(/Clear all|Steer/)).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: 'Steer instead' })[0]);
  expect(onAction).toHaveBeenCalledWith('steer', 'one', undefined);
  fireEvent.click(screen.getByRole('button', { name: 'Delete queued message: Check the tablet' }));
  expect(onAction).toHaveBeenCalledWith('delete', 'two', undefined);
});
it('retains failed edits and closes the editor after successful saving', async () => {
  const onAction = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(true);
  render(<MessageQueue messages={messages} disabled={false} onAction={onAction}/>);
  fireEvent.click(screen.getAllByRole('button', { name: 'Edit queued message' })[0]);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Updated phone check' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save queued message' }));
  await waitFor(() => expect(onAction).toHaveBeenCalledWith('edit', 'one', 'Updated phone check'));
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Updated phone check');
  fireEvent.click(screen.getByRole('button', { name: 'Save queued message' }));
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
});
it('disables mutations offline and announces paused state and errors', () => {
  render(<MessageQueue messages={messages} paused disabled error="Connection lost" onAction={vi.fn()}/>);
  expect(screen.getByRole('status').textContent).toContain('Paused');
  expect(screen.getByRole('alert').textContent).toBe('Connection lost');
  expect(screen.getAllByRole('button').filter(button => !/^Delete/.test(button.getAttribute('aria-label') ?? '')).every(button => (button as HTMLButtonElement).disabled)).toBe(true);
});
it('hides an empty queue', () => {
  const { container } = render(<MessageQueue messages={[]} disabled={false} onAction={vi.fn()}/>);
  expect(container.innerHTML).toBe('');
});

it('resumes an idle paused companion queue in FIFO order', () => {
  const onAction = vi.fn();
  render(<MessageQueue messages={messages} paused disabled={false} onAction={onAction}/>);
  fireEvent.click(screen.getAllByRole('button', { name: 'Resume queue' })[0]);
  expect(onAction).toHaveBeenCalledWith('resume', undefined, undefined);
});

it('keeps a deleted row mounted while it animates out, then unmounts it', async () => {
  vi.useFakeTimers();
  try {
    const { container, rerender } = render(<MessageQueue messages={messages} active disabled={false} onAction={vi.fn()}/>);
    rerender(<MessageQueue messages={[messages[1]]} active disabled={false} onAction={vi.fn()}/>);
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('li.message-queue-leaving')?.getAttribute('aria-hidden')).toBe('true');
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(container.querySelectorAll('li')).toHaveLength(1);
  } finally { vi.useRealTimers(); }
});
