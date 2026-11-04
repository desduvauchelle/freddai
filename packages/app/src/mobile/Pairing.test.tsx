import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke }));
import { Pairing } from './Pairing';
beforeEach(() => {
  bridge.invoke.mockReset();
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === 'companion_pairing_status') return false;
    if (command === 'companion_pair_claim') return true;
  });
});
afterEach(cleanup);
it('passes user supplied Mac setup to native pairing and waits for approval before showing conversations', async () => {
  render(<Pairing>{() => <p>Conversations ready</p>}</Pairing>);
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('companion_pairing_status'));
  fireEvent.change(screen.getByLabelText('Mac setup'), {target: {value: '{"endpoint":"https://my-mac.local:49744","certificate":"public"}'}});
  fireEvent.change(screen.getByLabelText('Pairing code'), {target: {value: '123456'}});
  fireEvent.click(screen.getByRole('button', {name:'Connect'}));
  await screen.findByText('Conversations ready');
  expect(bridge.invoke).toHaveBeenCalledWith('companion_pair', expect.objectContaining({code:'123456', setup:expect.stringContaining('my-mac.local')}));
  expect(bridge.invoke).toHaveBeenCalledWith('companion_pair_claim');
});
it('keeps setup available to correct after native validation rejects it', async () => {
  bridge.invoke.mockImplementation(async (command: string) => {
    if(command === 'companion_pairing_status') return false;
    if(command === 'companion_pair') throw new Error('Invalid Mac certificate');
  });
  render(<Pairing>{() => <p>Conversations ready</p>}</Pairing>);
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText('Mac setup'), {target:{value:'bad setup'}});
  fireEvent.change(screen.getByLabelText('Pairing code'), {target:{value:'123456'}});
  fireEvent.click(screen.getByRole('button', {name:'Connect'}));
  expect((await screen.findByRole('alert')).textContent).toContain('Invalid Mac certificate');
  expect((screen.getByLabelText('Mac setup') as HTMLTextAreaElement).value).toBe('bad setup');
  expect(screen.queryByText('Conversations ready')).toBeNull();
});
