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
