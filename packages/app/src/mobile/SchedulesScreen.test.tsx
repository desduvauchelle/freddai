import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SchedulesScreen } from './SchedulesScreen';
import type { Schedule } from '../desktop/types';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
HTMLElement.prototype.scrollIntoView = vi.fn();
HTMLElement.prototype.hasPointerCapture = () => false;
HTMLElement.prototype.releasePointerCapture = vi.fn();
HTMLElement.prototype.setPointerCapture = vi.fn();
afterEach(cleanup);

const base: Schedule = { id: 's1', name: 'Morning digest', project: 'p', account: 'a', routing: 'fixed', cron: '0 9 * * 1-5', timezone: 'UTC', prompt: 'Summarize', enabled: true, options: {}, next_due: Date.now() + 3600000, runs: [{ id: 'r1', due: Date.now() - 3600000, state: 'done', session: 'thread-1', reason: null }] };
const paused: Schedule = { ...base, id: 's2', name: 'Weekly review', enabled: false, next_due: 0, runs: [] };
const ended: Schedule = { ...base, id: 's3', name: 'Old campaign', max_runs: 1 };
const projects = [{ id: 'p', name: 'Project' }];
const accounts = [{ id: 'a', name: 'Claude', provider: 'claude' }];
function setup(over: Partial<Parameters<typeof SchedulesScreen>[0]> = {}) {
  const command = vi.fn(async () => undefined), onRefresh = vi.fn(async () => {}), onOpenThread = vi.fn(), onBack = vi.fn();
  render(<SchedulesScreen schedules={[base, paused, ended]} projects={projects} accounts={accounts} connected command={command} onRefresh={onRefresh} onOpenThread={onOpenThread} onBack={onBack} {...over} />);
  return { command, onRefresh, onOpenThread, onBack };
}
const card = (name: string) => screen.getByRole('article', { name });

it('groups schedules into Active, Paused and Ended and hides empty groups', () => {
  setup();
  expect(within(screen.getByRole('region', { name: 'Active' })).getByText('Morning digest')).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'Paused' })).getByText('Weekly review')).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'Ended' })).getByText('Old campaign')).toBeTruthy();
  expect(screen.getAllByText(/Weekdays at/).length).toBe(3);
  cleanup();
  setup({ schedules: [base] });
  expect(screen.queryByRole('region', { name: 'Paused' })).toBeNull();
});

it('opens the last run thread', async () => {
  const { onOpenThread } = setup({ schedules: [base] });
  await userEvent.click(within(card('Morning digest')).getByRole('button', { name: /ago|hour/ }));
  expect(onOpenThread).toHaveBeenCalledWith('thread-1');
});

it('pauses, resumes and runs, refreshing after each', async () => {
  const { command, onRefresh } = setup();
  await userEvent.click(within(card('Morning digest')).getByRole('button', { name: 'Pause' }));
  await waitFor(() => expect(command).toHaveBeenLastCalledWith('schedule_action', { schedule: 's1', action: 'pause' }));
  await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  await userEvent.click(within(card('Weekly review')).getByRole('button', { name: 'Resume' }));
  await waitFor(() => expect(command).toHaveBeenLastCalledWith('schedule_action', { schedule: 's2', action: 'resume' }));
  await userEvent.click(within(card('Morning digest')).getByRole('button', { name: 'Run now' }));
  await waitFor(() => expect(command).toHaveBeenLastCalledWith('schedule_action', { schedule: 's1', action: 'run' }));
  await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(3));
});

it('deletes only after a second confirming tap, and Cancel backs out', async () => {
  const { command, onRefresh } = setup({ schedules: [base] });
  const c = card('Morning digest');
  await userEvent.click(within(c).getByRole('button', { name: 'Delete' }));
  expect(command).not.toHaveBeenCalled();
  await userEvent.click(within(c).getByRole('button', { name: 'Cancel' }));
  expect(within(c).getByRole('button', { name: 'Delete' })).toBeTruthy();
  await userEvent.click(within(c).getByRole('button', { name: 'Delete' }));
  await userEvent.click(within(c).getByRole('button', { name: 'Delete?' }));
  await waitFor(() => expect(command).toHaveBeenCalledExactlyOnceWith('schedule_action', { schedule: 's1', action: 'delete' }));
  await waitFor(() => expect(onRefresh).toHaveBeenCalled());
});

it('shows the host error on the card and clears it after the next success', async () => {
  const command = vi.fn().mockRejectedValueOnce(new Error('Host refused: schedule locked')).mockResolvedValue(undefined);
  const { onRefresh } = setup({ schedules: [base], command });
  await userEvent.click(within(card('Morning digest')).getByRole('button', { name: 'Pause' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Host refused: schedule locked');
  expect(onRefresh).not.toHaveBeenCalled();
  await userEvent.click(within(card('Morning digest')).getByRole('button', { name: 'Pause' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(onRefresh).toHaveBeenCalledTimes(1);
});

it('is read-only with an offline notice when disconnected', () => {
  setup({ connected: false });
  expect(screen.getByRole('status').textContent).toMatch(/offline/i);
  for (const name of ['Pause', 'Run now', 'Edit', 'Delete']) expect((within(card('Morning digest')).getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: /New/ }) as HTMLButtonElement).disabled).toBe(true);
});

it('shows an empty state that starts the create flow', async () => {
  setup({ schedules: [] });
  expect(screen.getByText(/No scheduled tasks yet/)).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'New scheduled task' }));
  expect(screen.getByRole('heading', { name: 'New scheduled task' })).toBeTruthy();
});

it('creates a schedule with the form payload, refreshes and returns to the list', async () => {
  const { command, onRefresh } = setup({ schedules: [] });
  await userEvent.click(screen.getByRole('button', { name: 'New scheduled task' }));
  await userEvent.type(screen.getByLabelText('Name'), 'Nightly');
  await userEvent.type(screen.getByLabelText('Task'), 'Do the thing');
  await userEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
  await waitFor(() => expect(command).toHaveBeenCalledWith('save_schedule', { schedule: expect.objectContaining({ id: '', name: 'Nightly', prompt: 'Do the thing', project: 'p', account: 'a', cron: '0 9 * * 1-5', enabled: true }) }));
  await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  expect(await screen.findByRole('heading', { name: 'Scheduled tasks' })).toBeTruthy();
});

it('keeps the form open and shows the host error when saving fails', async () => {
  const command = vi.fn().mockRejectedValue(new Error('Use five cron fields'));
  setup({ schedules: [base], command });
  await userEvent.click(within(card('Morning digest')).getByRole('button', { name: 'Edit' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Use five cron fields');
  expect(screen.getByRole('heading', { name: 'Edit scheduled task' })).toBeTruthy();
});
