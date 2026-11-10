import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OfficeOrder } from './OfficeOrder';
afterEach(cleanup);
it('retains a failed transcript and reuses its request id when retried', async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error('Disconnected')).mockResolvedValueOnce('thread');
  render(<OfficeOrder disabled={false} onSend={send} renderMic={(onText, disabled) => <button disabled={disabled} onClick={() => onText('Build it')}>Mic</button>} />);
  fireEvent.click(screen.getByText('Mic'));
  await screen.findByText('Disconnected');
  expect(screen.getByText('Build it')).toBeTruthy();
  fireEvent.click(screen.getByText('Retry order'));
  await screen.findByText('Task started');
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
});
it('does not dispatch empty, disabled, or unmounted recordings', async () => {
  const send = vi.fn(); let transcript!: (text: string) => void;
  const view = render(<OfficeOrder disabled={false} onSend={send} renderMic={onText => { transcript = onText; return null; }} />);
  transcript('   ');
  view.unmount(); transcript('Late transcript');
  await waitFor(() => expect(send).not.toHaveBeenCalled());
});
