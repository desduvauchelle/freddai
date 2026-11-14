import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const shell = vi.hoisted(() => ({
  bugWalkRecordingAvailable: vi.fn(async () => true), startBugWalkRecording: vi.fn(async () => {}), stopBugWalkRecording: vi.fn(),
  cancelBugWalkRecording: vi.fn(async () => {}), pickBugWalkVideo: vi.fn(), onBugWalkRecordingState: vi.fn(() => () => {}),
}));
vi.mock('./native-shell', () => shell);
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
import { BugWalkScreen } from './BugWalkScreen';
import type { CompanionClient } from './companion';
import type { BugWalkStatus } from './bugWalk';

afterEach(() => { cleanup(); vi.useRealTimers(); });
const video = { path: '/tmp/freddai-bugwalk/a.mp4', name: 'a.mp4', mime: 'video/mp4', bytes: 1000, durationS: 65 };
const projects = [{ id: 'p1', name: 'Alpha' }, { id: 'p2', name: 'Beta' }];
function setup(client: Partial<CompanionClient>) {
  shell.pickBugWalkVideo.mockResolvedValue(video);
  const onOpenThread = vi.fn(), onBack = vi.fn();
  render(<BugWalkScreen client={client as CompanionClient} projects={projects} onOpenThread={onOpenThread} onBack={onBack} />);
  return { onOpenThread, onBack };
}
const toSend = async () => { await userEvent.click(await screen.findByRole('button', { name: 'Choose a screen recording' })); await userEvent.click(await screen.findByRole('button', { name: 'Send to Mac' })); };

it('shows the record step with the in-app-only note and hides Record when unavailable', async () => {
  setup({});
  expect(await screen.findByRole('button', { name: 'Record Freddai' })).toBeTruthy();
  expect(screen.getByText(/only this app/)).toBeTruthy();
  cleanup();
  shell.bugWalkRecordingAvailable.mockResolvedValueOnce(false);
  setup({});
  await screen.findByRole('button', { name: 'Choose a screen recording' });
  expect(screen.queryByRole('button', { name: 'Record Freddai' })).toBeNull();
});

it('records, shows the timer, and moves to the send step after stop', async () => {
  shell.stopBugWalkRecording.mockResolvedValue(video);
  setup({});
  await userEvent.click(await screen.findByRole('button', { name: 'Record Freddai' }));
  expect(shell.startBugWalkRecording).toHaveBeenCalledWith({ microphone: true });
  await userEvent.click(await screen.findByRole('button', { name: 'Stop recording' }));
  expect(await screen.findByRole('button', { name: 'Send to Mac' })).toBeTruthy();
});

it('sends with chosen options, reports progress, walks the phases and opens the thread', async () => {
  const statuses: BugWalkStatus[] = [{ id: 'w', phase: 'transcribing' }, { id: 'w', phase: 'done', sessions: ['t9'] }];
  let i = 0;
  const bugWalkSend = vi.fn(async (_v, _d, _o, onProgress) => { onProgress?.(500, 1000); return { id: 'w' }; });
  const bugWalkStatus = vi.fn(async () => statuses[Math.min(i++, 1)]);
  const { onOpenThread } = setup({ bugWalkSend, bugWalkStatus });
  await userEvent.click(await screen.findByRole('button', { name: 'Choose a screen recording' }));
  await userEvent.selectOptions(screen.getByLabelText('Project'), 'p2');
  await userEvent.click(screen.getByRole('button', { name: 'Bypass' }));
  await userEvent.click(screen.getByRole('button', { name: 'One per issue' }));
  await userEvent.click(screen.getByRole('button', { name: 'Send to Mac' }));
  expect(bugWalkSend).toHaveBeenCalledWith(video, expect.stringMatching(/iPhone|iPad/), { project: 'p2', permission_mode: 'bypass', split: 'per_item' }, expect.any(Function));
  expect(await screen.findByText('Transcribing…')).toBeTruthy();
  const open = await screen.findByRole('button', { name: 'Open thread' }, { timeout: 4000 });
  await userEvent.click(open);
  expect(onOpenThread).toHaveBeenCalledWith('t9');
}, 10000);

it('shows an upload error inline and retries', async () => {
  const bugWalkSend = vi.fn().mockRejectedValueOnce(new Error('Screen recording is too large (max 400 MB)')).mockResolvedValueOnce({ id: 'w' });
  setup({ bugWalkSend, bugWalkStatus: vi.fn(async () => ({ id: 'w', phase: 'error' as const, reason: 'boom' })) });
  await toSend();
  expect((await screen.findByRole('alert')).textContent).toContain('too large');
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Failed: boom')).toBeTruthy();
  expect(bugWalkSend).toHaveBeenCalledTimes(2);
});

it('keeps polling and explains when the Mac has not picked the recording up', async () => {
  const bugWalkStatus = vi.fn(async () => ({ id: 'w', phase: 'missing' as const }));
  setup({ bugWalkSend: vi.fn(async () => ({ id: 'w' })), bugWalkStatus });
  await toSend();
  expect(await screen.findByText(/Is Freddai open on your Mac/)).toBeTruthy();
  await waitFor(() => expect(bugWalkStatus.mock.calls.length).toBeGreaterThan(1), { timeout: 5000 });
}, 10000);
