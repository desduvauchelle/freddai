import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectedAccounts } from './ConnectedAccounts';
import { createMockGoogleHost, mockAccounts, mockDeliveryDb, mockTriggers } from '../desktop/google-mocks';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
HTMLElement.prototype.scrollIntoView = vi.fn();
HTMLElement.prototype.hasPointerCapture = () => false;
HTMLElement.prototype.releasePointerCapture = vi.fn();
HTMLElement.prototype.setPointerCapture = vi.fn();
afterEach(cleanup);

it('tells the user to connect and configure Google on the Mac, with no connect or client controls', async () => {
  const host = createMockGoogleHost({ accounts: mockAccounts, triggers: mockTriggers });
  render(<ConnectedAccounts command={host.command} connected db={mockDeliveryDb} />);
  expect(await screen.findByText(/Connect Google accounts and edit the Google client ID and secret in Freddai on your Mac/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Connect Google account/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /Reconnect/ })).toBeNull();
  expect(screen.queryByLabelText('Client ID')).toBeNull();
  expect(screen.queryByLabelText('Client secret')).toBeNull();
  await waitFor(() => expect(host.calls.map(c => c.operation).sort()).toEqual(['google_accounts', 'google_capability', 'google_triggers']));
});

it('shows accounts, status and ungranted services, and points reconnecting at the Mac', async () => {
  const host = createMockGoogleHost({ accounts: mockAccounts, triggers: [] });
  render(<ConnectedAccounts command={host.command} connected db={mockDeliveryDb} />);
  const reauth = (await screen.findByText('alex@studio.example', { selector: 'p' })).closest('li')!;
  expect(within(reauth).getByText(/Needs reconnecting/)).toBeTruthy();
  expect(within(reauth).getByText(/Reconnect it in Freddai on your Mac/)).toBeTruthy();
  expect(within(reauth).getByText('Drive not granted')).toBeTruthy();
});

it('disconnects after confirmation and surfaces a host failure verbatim', async () => {
  const host = createMockGoogleHost({ accounts: mockAccounts, triggers: [], fail: { google_disconnect: 'Mac is busy: try again' } });
  render(<ConnectedAccounts command={host.command} connected db={mockDeliveryDb} />);
  await userEvent.click(await screen.findByRole('button', { name: /Disconnect\s*alex@example.com/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Disconnect account' }));
  expect(await screen.findByText('Mac is busy: try again')).toBeTruthy();
  expect(screen.getByText('alex@example.com', { selector: 'p' })).toBeTruthy();
});

it('manages the full triggers list, editor and toggle', async () => {
  const host = createMockGoogleHost({ accounts: mockAccounts, triggers: mockTriggers });
  render(<ConnectedAccounts command={host.command} connected db={mockDeliveryDb} />);
  expect(await screen.findByText('Triage billing emails', { selector: 'p' })).toBeTruthy();
  expect(screen.getByText(/Calendar API has not been used/)).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: /Edit\s*Triage billing emails/ }));
  expect(screen.getByLabelText('Gmail search')).toBeTruthy();
  await userEvent.clear(screen.getByLabelText('Name'));
  await userEvent.type(screen.getByLabelText('Name'), 'Billing');
  await userEvent.click(screen.getByRole('button', { name: 'Save trigger' }));
  await waitFor(() => expect(host.calls.find(c => c.operation === 'google_trigger_save')?.input.trigger).toMatchObject({ id: 't1', name: 'Billing' }));
  await userEvent.click(await screen.findByRole('switch', { name: 'Watch the contracts folder enabled' }));
  await waitFor(() => expect(screen.getByRole('switch', { name: 'Watch the contracts folder enabled' }).getAttribute('aria-checked')).toBe('true'));
});

it('disables everything with an explanation while the Mac is unreachable', async () => {
  const host = createMockGoogleHost({ accounts: mockAccounts, triggers: mockTriggers });
  render(<ConnectedAccounts command={host.command} connected={false} db={mockDeliveryDb} />);
  expect(screen.getByText('Connect to your Mac to manage connected accounts.')).toBeTruthy();
  expect(host.calls).toEqual([]);
  expect((screen.getByRole('button', { name: 'Add trigger' }) as HTMLButtonElement).disabled).toBe(true);
});

it('shows a prominent restart notice instead of Google controls when the Mac host predates Google accounts', async () => {
  const host = createMockGoogleHost({ hostSupportsGoogle: false, accounts: mockAccounts, triggers: mockTriggers });
  render(<ConnectedAccounts command={host.command} connected db={mockDeliveryDb} />);
  const notice = await screen.findByRole('alert');
  expect(notice.textContent).toContain('still running the previous version');
  expect(notice.textContent).toContain('quit Freddai (⌘Q), then reopen it from Applications');
  expect(screen.queryByText('alex@example.com')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Add trigger' })).toBeNull();
  expect(host.calls.map(c => c.operation)).toEqual(['google_capability']);
});

it('treats a Mac app that does not know the probe as outdated', async () => {
  const host = createMockGoogleHost({ accounts: mockAccounts, triggers: [], fail: { google_capability: 'Unknown composer operation' } });
  render(<ConnectedAccounts command={host.command} connected db={mockDeliveryDb} />);
  expect((await screen.findByRole('alert')).textContent).toContain('previous version');
});

it('defaults a new trigger to asking, warns when Full access is turned on, and badges full-access triggers in the list', async () => {
  const host = createMockGoogleHost({ accounts: mockAccounts, triggers: mockTriggers.map(t => t.id === 't1' ? { ...t, options: { ...t.options, permission_mode: 'bypass' as const } } : t) });
  render(<ConnectedAccounts command={host.command} connected db={mockDeliveryDb} />);
  const row = (await screen.findByText('Triage billing emails', { selector: 'p' })).closest('li')!;
  expect(within(row).getByText('Full access')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Add trigger' }));
  expect(screen.getByRole('switch', { name: 'Full access' }).getAttribute('aria-checked')).toBe('false');
  expect(screen.queryByText(/Full access lets this agent act without asking/)).toBeNull();
  await userEvent.click(screen.getByRole('switch', { name: 'Full access' }));
  expect(screen.getByText(/Trigger runs are started by content other people wrote/)).toBeTruthy();
});
