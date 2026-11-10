import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectedAccountsSettings } from './ConnectedAccountsSettings';
import { createMockGoogleHost, mockAccounts, mockDeliveryDb, mockTriggers } from './google-mocks';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
HTMLElement.prototype.scrollIntoView = vi.fn();
HTMLElement.prototype.hasPointerCapture = () => false;
HTMLElement.prototype.releasePointerCapture = vi.fn();
HTMLElement.prototype.setPointerCapture = vi.fn();
afterEach(() => { cleanup(); vi.useRealTimers(); });
const saved = { clientId: 'client.apps.googleusercontent.com', hasClientSecret: true, secretStorage: 'keychain' as const };
function setup(options: Parameters<typeof createMockGoogleHost>[0] = {}, extra: { openExternal?: (url: string) => Promise<void> } = {}) {
  const host = createMockGoogleHost(options);
  const openExternal = extra.openExternal ?? vi.fn(async () => {});
  render(<ConnectedAccountsSettings db={mockDeliveryDb} native command={host.command} openExternal={openExternal} pollMs={10} />);
  return { ...host, openExternal };
}

it('shows the empty state and keeps Connect disabled with an explanation until a client ID is saved', async () => {
  setup();
  expect(await screen.findByText('No Google accounts connected yet')).toBeTruthy();
  expect((screen.getByRole('button', { name: /Connect Google account/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('Save a Google client ID above before connecting an account.')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Add trigger' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/Connect a Google account first/)).toBeTruthy();
  expect(screen.getByText('How to get these')).toBeTruthy();
  expect(screen.getByText(/stored in your system Keychain/)).toBeTruthy();
});

it('saves the client ID, leaves the stored secret alone when blank, and then enables Connect', async () => {
  const { calls } = setup();
  await screen.findByText('No Google accounts connected yet');
  await userEvent.type(screen.getByLabelText('Client ID'), '  abc.apps.googleusercontent.com ');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(calls.find(c => c.operation === 'google_config_set')?.input).toEqual({ clientId: 'abc.apps.googleusercontent.com' }));
  expect(await screen.findByText('Saved.')).toBeTruthy();
  await waitFor(() => expect((screen.getByRole('button', { name: /Connect Google account/ }) as HTMLButtonElement).disabled).toBe(false));
});

it('mentions the local file when the keychain is unavailable and never prints the secret', async () => {
  setup({ config: { ...saved, secretStorage: 'file' } });
  expect(await screen.findByText(/stored in a local file on this computer/)).toBeTruthy();
  expect((screen.getByLabelText('Client secret') as HTMLInputElement).value).toBe('');
  expect(screen.getByText('A client secret is saved. Leave this blank to keep it.')).toBeTruthy();
  expect((screen.getByLabelText('Client secret') as HTMLInputElement).placeholder).toBe('Leave blank to keep the saved secret');
});

it('connects an account: opens the browser, polls while pending, then lists it', async () => {
  const { openExternal, calls } = setup({ config: saved, statuses: [{ state: 'pending' }, { state: 'pending' }, { state: 'connected', email: mockAccounts[0].email }], connects: mockAccounts[0] });
  await waitFor(() => expect((screen.getByRole('button', { name: /Connect Google account/ }) as HTMLButtonElement).disabled).toBe(false));
  await userEvent.click(screen.getByRole('button', { name: /Connect Google account/ }));
  expect(await screen.findByText('Waiting for Google sign-in…')).toBeTruthy();
  expect(openExternal).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?mock=1');
  await waitFor(() => expect(screen.queryByText('Waiting for Google sign-in…')).toBeNull());
  expect(await screen.findByText('Connected alex@example.com.')).toBeTruthy();
  expect(screen.getByText('Alex Morgan')).toBeTruthy();
  expect(calls.filter(c => c.operation === 'google_connect_status').length).toBeGreaterThanOrEqual(3);
  expect(calls.find(c => c.operation === 'google_connect_status')?.input).toEqual({ flowId: 'flow-1' });
});

it('shows the exact failure text when sign-in fails, and can be cancelled while waiting', async () => {
  setup({ config: saved, statuses: [{ state: 'failed', error: 'access_denied: the user cancelled' }] });
  await waitFor(() => expect((screen.getByRole('button', { name: /Connect Google account/ }) as HTMLButtonElement).disabled).toBe(false));
  await userEvent.click(screen.getByRole('button', { name: /Connect Google account/ }));
  expect(await screen.findByText('access_denied: the user cancelled')).toBeTruthy();
  cleanup();
  setup({ config: saved, statuses: [{ state: 'pending' }] });
  await waitFor(() => expect((screen.getByRole('button', { name: /Connect Google account/ }) as HTMLButtonElement).disabled).toBe(false));
  await userEvent.click(screen.getByRole('button', { name: /Connect Google account/ }));
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  expect(screen.queryByText('Waiting for Google sign-in…')).toBeNull();
  expect(screen.getByText('Sign-in cancelled.')).toBeTruthy();
});

it('shows expired and polling errors loudly', async () => {
  setup({ config: saved, statuses: [{ state: 'expired', error: 'The sign-in link expired after 5 minutes.' }] });
  await waitFor(() => expect((screen.getByRole('button', { name: /Connect Google account/ }) as HTMLButtonElement).disabled).toBe(false));
  await userEvent.click(screen.getByRole('button', { name: /Connect Google account/ }));
  expect(await screen.findByText('The sign-in link expired after 5 minutes.')).toBeTruthy();
});

it('reports a browser that will not open without losing the sign-in link', async () => {
  setup({ config: saved }, { openExternal: vi.fn(async () => { throw 'denied by the system'; }) });
  await waitFor(() => expect((screen.getByRole('button', { name: /Connect Google account/ }) as HTMLButtonElement).disabled).toBe(false));
  await userEvent.click(screen.getByRole('button', { name: /Connect Google account/ }));
  expect((await screen.findAllByRole('alert')).some(a => a.textContent?.includes('denied by the system'))).toBe(true);
  expect(screen.getByRole('link', { name: 'Open the sign-in link' })).toBeTruthy();
});

it('renders ok, needs_reauth and error accounts and flags services that were not granted', async () => {
  setup({ config: saved, accounts: [mockAccounts[0], mockAccounts[1], { ...mockAccounts[0], email: 'broken@example.com', name: 'Broken', status: 'error', lastError: 'invalid_grant: Token has been expired or revoked.' }] });
  const reauth = (await screen.findByText('alex@studio.example', { selector: 'p' })).closest('li')!;
  expect(within(reauth).getByText(/Needs reconnecting/)).toBeTruthy();
  expect(within(reauth).getByText('Drive not granted')).toBeTruthy();
  expect(within(reauth).getByText('Gmail')).toBeTruthy();
  const ok = screen.getByText('alex@example.com', { selector: 'p' }).closest('li')!;
  expect(within(ok).queryByText(/not granted/)).toBeNull();
  expect(within(ok).queryByText(/Needs reconnecting/)).toBeNull();
  expect(screen.getByText('invalid_grant: Token has been expired or revoked.')).toBeTruthy();
});

it('asks before disconnecting and shows a revoke error verbatim', async () => {
  const host = createMockGoogleHost({ config: saved, accounts: [mockAccounts[0]] });
  const command = vi.fn(async (op: Parameters<typeof host.command>[0], input: Record<string, unknown>) => op === 'google_disconnect' ? { ok: true, revokeError: 'Google revoke returned HTTP 400' } : host.command(op, input));
  render(<ConnectedAccountsSettings db={mockDeliveryDb} native command={command} />);
  await userEvent.click(await screen.findByRole('button', { name: /Disconnect\s*alex@example.com/ }));
  expect(command).not.toHaveBeenCalledWith('google_disconnect', expect.anything());
  await userEvent.click(screen.getByRole('button', { name: 'Disconnect account' }));
  await waitFor(() => expect(command).toHaveBeenCalledWith('google_disconnect', { email: 'alex@example.com' }));
  expect(await screen.findByText(/Google did not revoke its access: Google revoke returned HTTP 400/)).toBeTruthy();
});

it('lists triggers with status, shows last_error prominently, and toggles enabled only after the host confirms', async () => {
  const { calls } = setup({ config: saved, accounts: mockAccounts, triggers: mockTriggers });
  expect(await screen.findByText('Triage billing emails', { selector: 'p' })).toBeTruthy();
  expect(screen.getByText(/A new email arrives · alex@example.com/)).toBeTruthy();
  expect(screen.getByText(/14 runs/)).toBeTruthy();
  expect(screen.getAllByText(/Never fired/).length).toBe(1);
  expect(screen.getByText(/Calendar API has not been used in project 123456/)).toBeTruthy();
  await userEvent.click(screen.getByRole('switch', { name: 'Watch the contracts folder enabled' }));
  await waitFor(() => expect(calls.some(c => c.operation === 'google_trigger_save' && (c.input.trigger as { id: string; enabled: boolean }).id === 't3' && (c.input.trigger as { enabled: boolean }).enabled)).toBe(true));
  await waitFor(() => expect((screen.getByRole('switch', { name: 'Watch the contracts folder enabled' }) as HTMLButtonElement).getAttribute('aria-checked')).toBe('true'));
});

it('shows a host error from a failed toggle and does not flip the switch', async () => {
  setup({ config: saved, accounts: mockAccounts, triggers: mockTriggers, fail: { google_trigger_save: 'Unknown host command: google_trigger_save' } });
  await userEvent.click(await screen.findByRole('switch', { name: 'Watch the contracts folder enabled' }));
  expect(await screen.findByText('Unknown host command: google_trigger_save')).toBeTruthy();
  expect(screen.getByRole('switch', { name: 'Watch the contracts folder enabled' }).getAttribute('aria-checked')).toBe('false');
});

it('shows event-specific fields in the trigger editor and saves a clean trigger', async () => {
  const { calls } = setup({ config: saved, accounts: mockAccounts, triggers: [] });
  await userEvent.click(await screen.findByRole('button', { name: 'Add trigger' }));
  expect(screen.getByLabelText('Gmail search').getAttribute('placeholder')).toBe('from:billing@example.com has:attachment');
  expect(screen.queryByLabelText('Calendar ID')).toBeNull();
  await userEvent.click(screen.getByRole('combobox', { name: 'Trigger event' }));
  await userEvent.click(await screen.findByRole('option', { name: 'A calendar event changes' }));
  expect(screen.getByLabelText('Matching text')).toBeTruthy();
  expect(screen.getByLabelText('Calendar ID').getAttribute('placeholder')).toBe('primary');
  await userEvent.click(screen.getByRole('combobox', { name: 'Trigger event' }));
  await userEvent.click(await screen.findByRole('option', { name: 'A Drive file changes' }));
  expect(screen.getByLabelText('File name contains')).toBeTruthy();
  expect(screen.getByLabelText('Folder ID')).toBeTruthy();
  await userEvent.type(screen.getByLabelText('Name'), 'Invoices');
  await userEvent.type(screen.getByLabelText('Folder ID'), 'folder-9');
  await userEvent.type(screen.getByLabelText('Task'), 'Summarize the new file.');
  await userEvent.click(screen.getByRole('button', { name: 'Save trigger' }));
  await waitFor(() => expect(calls.find(c => c.operation === 'google_trigger_save')).toBeTruthy());
  expect(calls.find(c => c.operation === 'google_trigger_save')!.input.trigger).toMatchObject({ id: '', name: 'Invoices', google_account: 'alex@example.com', event: 'drive_file_changed', filter: null, resource: 'folder-9', prompt: 'Summarize the new file.', project: 'p1', account: 'claude-personal', new_chat: true, enabled: true });
  expect(await screen.findByText('Invoices', { selector: 'p' })).toBeTruthy();
});

it('only offers accounts that granted the needed service', async () => {
  setup({ config: saved, accounts: [mockAccounts[1], { ...mockAccounts[0], email: 'drive@example.com', services: ['drive'] }], triggers: [] });
  await userEvent.click(await screen.findByRole('button', { name: 'Add trigger' }));
  await userEvent.click(screen.getByRole('combobox', { name: 'Trigger event' }));
  await userEvent.click(await screen.findByRole('option', { name: 'A Drive file changes' }));
  await userEvent.click(screen.getByRole('combobox', { name: 'Trigger Google account' }));
  expect(await screen.findByRole('option', { name: 'drive@example.com' })).toBeTruthy();
  expect(screen.queryByRole('option', { name: 'alex@studio.example' })).toBeNull();
});

it('shows the host error verbatim when saving a trigger fails and keeps the editor open', async () => {
  setup({ config: saved, accounts: mockAccounts, triggers: [], fail: { google_trigger_save: 'filter: invalid Gmail search "from:("' } });
  await userEvent.click(await screen.findByRole('button', { name: 'Add trigger' }));
  await userEvent.type(screen.getByLabelText('Name'), 'Bad');
  await userEvent.type(screen.getByLabelText('Task'), 'Do it');
  await userEvent.click(screen.getByRole('button', { name: 'Save trigger' }));
  expect(await screen.findByText('filter: invalid Gmail search "from:("')).toBeTruthy();
  expect(screen.getByRole('form', { name: 'New trigger' })).toBeTruthy();
});

it('confirms before deleting a trigger', async () => {
  const { calls } = setup({ config: saved, accounts: mockAccounts, triggers: mockTriggers });
  await userEvent.click((await screen.findAllByRole('button', { name: /Delete…/ }))[0]);
  expect(calls.some(c => c.operation === 'google_trigger_delete')).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: 'Delete trigger' }));
  await waitFor(() => expect(calls.find(c => c.operation === 'google_trigger_delete')?.input).toEqual({ id: 't1' }));
  await waitFor(() => expect(screen.queryByText('Triage billing emails', { selector: 'p' })).toBeNull());
});

it('shows list-loading failures from the host', async () => {
  setup({ config: saved, fail: { google_accounts: 'Unknown host command: google_accounts', google_triggers: 'Unknown host command: google_triggers' } });
  expect((await screen.findAllByText(/Unknown host command: google_/)).length).toBe(2);
  expect(screen.getByText('Accounts could not be loaded')).toBeTruthy();
});

it('states only that sign-in tokens stay local, without claiming anything about mail content', async () => {
  setup();
  expect(await screen.findByText(/Sign-in tokens stay on this computer\./)).toBeTruthy();
  expect(screen.queryByText(/never pass through anyone/)).toBeNull();
});

it('formats trigger times as epoch milliseconds', async () => {
  setup({ config: saved, accounts: mockAccounts, triggers: mockTriggers });
  const expected = new Date(mockTriggers[0].last_fired as number).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  expect(await screen.findByText((text) => text.includes(`Last fired ${expected}`))).toBeTruthy();
});

it('replaces the controls with a restart notice when the background host predates Google accounts', async () => {
  const { calls } = setup({ hostSupportsGoogle: false, accounts: mockAccounts, triggers: mockTriggers });
  const notice = await screen.findByRole('alert');
  expect(notice.textContent).toContain('still running the previous version');
  expect(notice.textContent).toContain('quit Freddai (⌘Q), then reopen it from Applications');
  expect(screen.queryByLabelText('Client ID')).toBeNull();
  expect(screen.queryByRole('button', { name: /Connect Google account/ })).toBeNull();
  expect(calls.map(c => c.operation)).toEqual(['google_capability']);
});

const WARNING = /Full access lets this agent act without asking/;
it('defaults a new trigger to asking for a Claude account, keeps that when the account changes, and warns only while Full access is on', async () => {
  const { calls } = setup({ config: saved, accounts: mockAccounts, triggers: [] });
  await userEvent.click(await screen.findByRole('button', { name: 'Add trigger' }));
  expect(screen.getByRole('combobox', { name: 'Trigger account' }).textContent).toContain('Personal');
  const full = screen.getByRole('switch', { name: 'Full access' });
  expect(full.getAttribute('aria-checked')).toBe('false');
  expect(screen.queryByText(WARNING)).toBeNull();
  await userEvent.click(screen.getByRole('combobox', { name: 'Trigger account' }));
  await userEvent.click(await screen.findByRole('option', { name: /Work/ }));
  expect(screen.getByRole('switch', { name: 'Full access' }).getAttribute('aria-checked')).toBe('false');
  await userEvent.click(screen.getByRole('switch', { name: 'Full access' }));
  expect(screen.getByText(WARNING)).toBeTruthy();
  await userEvent.click(screen.getByRole('switch', { name: 'Full access' }));
  expect(screen.queryByText(WARNING)).toBeNull();
  await userEvent.type(screen.getByLabelText('Name'), 'Invoices');
  await userEvent.type(screen.getByLabelText('Task'), 'Summarize.');
  await userEvent.click(screen.getByRole('button', { name: 'Save trigger' }));
  await waitFor(() => expect(calls.find(c => c.operation === 'google_trigger_save')).toBeTruthy());
  expect((calls.find(c => c.operation === 'google_trigger_save')!.input.trigger as { options: { permission_mode: string } }).options.permission_mode).toBe('ask');
});

it('badges only triggers that run with full access in the list', async () => {
  setup({ config: saved, accounts: mockAccounts, triggers: mockTriggers.map(t => t.id === 't2' ? { ...t, options: { ...t.options, permission_mode: 'bypass' as const } } : t) });
  const row = (await screen.findByText('Prep for meetings', { selector: 'p' })).closest('li')!;
  expect(within(row).getByText('Full access')).toBeTruthy();
  expect(screen.getAllByText('Full access')).toHaveLength(1);
});
