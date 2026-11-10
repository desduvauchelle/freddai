import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompletionCards } from './CompletionCards';
import { ThreadLinksProvider } from './ThreadLinksContext';
afterEach(cleanup);
const notices = [{ id: 'commander-completions-a', prompt: 'Light notice (not a user message): finished\n- Saved result (aaaaaaaa-1111) ended done\n- Failed task (bbbbbbbb-2222) ended failed' }];
it('identifies every thread, opens it, and prepares only the selected action', async () => {
  const onOpen = vi.fn(), onPrepare = vi.fn(), onDismiss = vi.fn();
  render(<ThreadLinksProvider threads={[]} projects={[]} onOpen={onOpen}><CompletionCards notices={notices} onPrepare={onPrepare} onDismiss={onDismiss} /></ThreadLinksProvider>);
  expect(onPrepare).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Open thread: Failed task' }));
  expect(onOpen).toHaveBeenCalledWith('bbbbbbbb-2222');
  await userEvent.click(screen.getAllByRole('button', { name: 'Summarize' })[0]);
  expect(onPrepare).toHaveBeenCalledWith(expect.stringContaining('(aaaaaaaa-1111)'));
  expect(screen.getByRole('status').textContent).toContain('Review and send');
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(onDismiss).toHaveBeenCalledWith('commander-completions-a');
});
it('keeps actions disabled offline and reports draft failures without claiming success', async () => {
  const onPrepare = vi.fn().mockRejectedValue(new Error('Composer unavailable'));
  const { rerender } = render(<CompletionCards notices={notices} disabled onPrepare={onPrepare} />);
  expect((screen.getAllByRole('button', { name: 'Follow up' })[0] as HTMLButtonElement).disabled).toBe(true);
  rerender(<CompletionCards notices={notices} onPrepare={onPrepare} />);
  await userEvent.click(screen.getAllByRole('button', { name: 'Follow up' })[1]);
  expect(screen.getByRole('alert').textContent).toContain('Composer unavailable');
  expect(screen.queryByText(/Added to your draft/)).toBeNull();
});
