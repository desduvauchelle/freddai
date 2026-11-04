import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { disconnectedClient } from './companion';
import { ConnectionBanner } from './ConnectionBanner';
import { initialConnectionStatus, onAttempt, onFailure, onSuccess, type ConnectionStatus } from './connection-status';

afterEach(cleanup);
const downWith = (error: string): ConnectionStatus => onFailure(onFailure(onSuccess(initialConnectionStatus, 0).status, error, 1).status, error, 20_000).status;
const props = (status: ConnectionStatus, extra = {}) => ({ status, client: disconnectedClient, onTryAgain: vi.fn(), onDismiss: vi.fn(), now: () => 12 * 60_000, ...extra });

it('explains a network outage with history and a primary Try again', () => {
  render(<ConnectionBanner {...props(downWith('Relay unavailable'), { onPairAgain: vi.fn() })} />);
  expect(screen.getByText("Can't reach your Mac")).toBeTruthy();
  expect(screen.getByText(/Make sure Freddai is open on your Mac/)).toBeTruthy();
  expect(screen.getByText(/Last connected 12 min ago · tried 2 times/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Pair again…' })).toBeTruthy();
});

it('shows Checking… disabled during a manual check and ignores double taps', () => {
  const p = props(downWith('Relay unavailable'));
  const { rerender } = render(<ConnectionBanner {...p} />);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  fireEvent.click(screen.getByRole('button', { name: /Checking/ }));
  expect(p.onTryAgain).toHaveBeenCalledTimes(1);
  const checking = screen.getByRole('button', { name: /Checking/ }) as HTMLButtonElement;
  expect(checking.disabled).toBe(true);
  rerender(<ConnectionBanner {...p} status={onAttempt(p.status, 'manual', 5)} />);
  expect((screen.getByRole('button', { name: /Checking/ }) as HTMLButtonElement).disabled).toBe(true);
});

it('reports a failed manual check once the minimum checking time passes', async () => {
  const base = downWith('Relay unavailable');
  const failed = onFailure(onAttempt(base, 'manual', 5), 'Relay unavailable', 6).status;
  render(<ConnectionBanner {...props(failed)} />);
  await waitFor(() => expect(screen.getByText(/Still can't reach it — checked just now/)).toBeTruthy());
});

it('requires confirmation before pairing again, and Cancel keeps the pairing', () => {
  const onPairAgain = vi.fn();
  render(<ConnectionBanner {...props(downWith('Relay unavailable'), { onPairAgain })} />);
  fireEvent.click(screen.getByRole('button', { name: 'Pair again…' }));
  expect(onPairAgain).not.toHaveBeenCalled();
  expect(screen.getByText(/Your current pairing stays until the new one succeeds/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByText(/Your current pairing stays/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Pair again…' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(onPairAgain).toHaveBeenCalledTimes(1);
});

it('makes Pair again primary only for auth failures', () => {
  const auth = onFailure(onSuccess(initialConnectionStatus, 0).status, 'Device revoked', 5).status;
  render(<ConnectionBanner {...props(auth, { onPairAgain: vi.fn() })} />);
  expect(screen.getByText(/pairing was rejected/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Pair again…' }).className).toMatch(/bg-primary/);
  expect(screen.getByRole('button', { name: 'Try again' }).className).not.toMatch(/bg-primary /);
});

it('shows protocol specifics in an expandable Details row and copies a report', async () => {
  const writeText = vi.fn(async () => {});
  Object.assign(navigator, { clipboard: { writeText } });
  render(<ConnectionBanner {...props(downWith('Invalid response from your Mac: HTTP 502 (text/html)'))} />);
  expect(screen.getByText(/Updating both apps usually fixes this/)).toBeTruthy();
  expect(screen.queryByText('HTTP 502 (text/html)')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Details/ }));
  expect(screen.getByText('HTTP 502 (text/html)')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Copy details' }));
  expect(writeText).toHaveBeenCalledTimes(1);
  const text = (writeText.mock.calls as unknown as string[][])[0][0];
  expect(text).toMatch(/kind: protocol/); expect(text).toMatch(/HTTP 502/); expect(text).toMatch(/failureCount: 2/);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy());
});
