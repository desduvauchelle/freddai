import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DashboardMic } from './DashboardMic';
import { disconnectedClient } from './companion';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('checks Mac readiness before requesting microphone access', async () => {
  const voice = vi.fn().mockResolvedValue({ enabled: false, ready: false });
  render(<DashboardMic client={{ ...disconnectedClient, voice, transcribeAudio: vi.fn() }} project="Project" disabled={false} onText={vi.fn()} />);
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Enable voice dictation'));
});
it('stops the microphone and sends transcription to the chosen project callback', async () => {
  const stop = vi.fn(), onText = vi.fn();
  class Recorder {
    static isTypeSupported() { return true; }
    state = 'inactive'; mimeType = 'audio/mp4';
    ondataavailable = (_event: { data: Blob }) => {}; onstop = () => {};
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob(['audio']) }); this.onstop(); }
  }
  vi.stubGlobal('MediaRecorder', Recorder);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) } });
  const transcribeAudio = vi.fn().mockResolvedValue({ text: 'Build it' });
  render(<DashboardMic client={{ ...disconnectedClient, voice: async () => ({ enabled: true, ready: true }), transcribeAudio }} project="Project" disabled={false} onText={onText} />);
  fireEvent.click(screen.getByRole('button'));
  await screen.findByRole('button', { name: 'Stop recording in Project' });
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(onText).toHaveBeenCalledWith('Build it'));
  expect(stop).toHaveBeenCalled(); expect(transcribeAudio).toHaveBeenCalledWith(expect.any(Blob));
});
it('releasing a hold before readiness returns never opens the microphone', async () => {
  class Pointer extends MouseEvent { pointerId = 1; }
  vi.stubGlobal('PointerEvent', Pointer);
  let ready!: (value: { enabled: boolean; ready: boolean }) => void;
  const voice = vi.fn(() => new Promise<{ enabled: boolean; ready: boolean }>(resolve => { ready = resolve; }));
  const getUserMedia = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  render(<DashboardMic client={{ ...disconnectedClient, voice, transcribeAudio: vi.fn() }} project="Project" disabled={false} onText={vi.fn()} />);
  const mic = screen.getByRole('button');
  fireEvent.pointerDown(mic, { button: 0 });
  fireEvent.pointerUp(mic, { button: 0 });
  ready({ enabled: true, ready: true });
  await waitFor(() => expect(mic.textContent).toContain('Hold to dictate'));
  expect(getUserMedia).not.toHaveBeenCalled();
});
it.each([false, true])('a browser hold releases to transcribe or cancels without transcription (cancel=%s)', async cancel => {
  class Pointer extends MouseEvent { pointerId = 1; }
  vi.stubGlobal('PointerEvent', Pointer);
  const stop = vi.fn(), onText = vi.fn();
  class Recorder {
    static isTypeSupported() { return true; }
    state = 'inactive'; mimeType = 'audio/mp4';
    ondataavailable = (_event: { data: Blob }) => {}; onstop = () => {};
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob(['audio']) }); this.onstop(); }
  }
  vi.stubGlobal('MediaRecorder', Recorder);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) } });
  const transcribeAudio = vi.fn().mockResolvedValue({ text: 'A draft' });
  render(<DashboardMic client={{ ...disconnectedClient, voice: async () => ({ enabled: true, ready: true }), transcribeAudio }} project="Project" disabled={false} onText={onText} />);
  fireEvent.pointerDown(screen.getByRole('button'), { button: 0 });
  const mic = await screen.findByRole('button', { name: 'Stop recording in Project' });
  if (cancel) fireEvent.pointerCancel(mic); else fireEvent.pointerUp(mic);
  await waitFor(() => expect(stop).toHaveBeenCalled());
  if (cancel) { expect(transcribeAudio).not.toHaveBeenCalled(); expect(onText).not.toHaveBeenCalled(); }
  else await waitFor(() => expect(onText).toHaveBeenCalledWith('A draft'));
});
