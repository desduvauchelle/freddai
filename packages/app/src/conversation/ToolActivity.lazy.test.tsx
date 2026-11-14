import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ThreadTranscript } from './ThreadTranscript';

it('reads tool output only when its individual call opens and releases it on close', async () => {
  const read = vi.fn(async () => ({ text: 'loaded output', offset: 0, nextOffset: null, totalBytes: 13, hash: 'hash' }));
  render(<ThreadTranscript messages={[{ id: 'tool', role: 'tool', text: '{}', toolTextBytes: 13, toolTextHash: 'hash' }]} readToolText={read} />);
  expect(read).not.toHaveBeenCalled();
  const group = screen.getByText('Tool activity · 1 call').closest('details')!;
  await act(async () => { group.open = true; fireEvent(group, new Event('toggle')); });
  expect(read).not.toHaveBeenCalled();
  const call = screen.getByText('Call 1').closest('details')!;
  await act(async () => { call.open = true; fireEvent(call, new Event('toggle')); });
  await waitFor(() => expect(screen.getByText('loaded output')).toBeTruthy());
  expect(read).toHaveBeenCalledExactlyOnceWith('tool', 0, 'hash');
  await act(async () => { group.open = false; fireEvent(group, new Event('toggle')); });
  expect(screen.queryByText('loaded output')).toBeNull();
});
