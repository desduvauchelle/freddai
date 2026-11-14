import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FailedTurnRecovery, failedTurnMessage } from './FailedTurnRecovery';
vi.mock('../desktop/ComposerAgentPicker', () => ({ ComposerAgentPicker: ({ onAgentChange }: { onAgentChange: (agent: string) => void }) => <button onClick={() => onAgentChange('other')}>Change model</button> }));
const file = { id: 'attachment', name: 'image.png', bytes: 10, mime: 'image/png', sha256: '' };
const messages = [{ id: 'first', role: 'user', text: 'old' }, { id: 'last', role: 'user', text: 'failed message', attachments: [file] }, { id: 'tool', role: 'tool', text: 'output' }];
describe('failed turn recovery', () => {
  it('selects the last user message with its attachments', () => {
    expect(failedTurnMessage(messages)).toBe(messages[1]);
    expect(failedTurnMessage([])).toBeUndefined();
  });
  it('resends with a changed agent and retains a request id after a delivery error', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('Disconnected')).mockResolvedValue(undefined);
    render(<FailedTurnRecovery messages={messages} options={[{ id: 'old', label: 'Old' }, { id: 'other', label: 'Other' }]} initialAgent="old" initialSelection={{ model: 'old-model', effort: 'high' }} native={false} onResend={send}/>);
    fireEvent.click(screen.getByText('Change model'));
    fireEvent.click(screen.getByText('Resend in new thread'));
    await screen.findByText('Disconnected');
    expect(send.mock.calls[0][0]).toEqual(messages[1]);
    expect(send.mock.calls[0][1]).toEqual({ agent: 'other', model: 'freddai-level:normal', effort: 'default' });
    fireEvent.click(screen.getByText('Resend in new thread'));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1][2]).toBe(send.mock.calls[0][2]);
  });
});
