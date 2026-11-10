import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => native);
import { MicButton } from './VoiceControls';
import { voice } from './voice';
beforeEach(async () => {
  native.invoke.mockImplementation(async (command: string) => command === 'voice_status' ? { ready: true, shortcut: 'AltRight' } : command === 'voice_stop_recording' ? { text: 'Hello', durationMs: 500, model: 'test' } : command === 'voice_recording_level' ? 0.2 : undefined);
  await voice.refresh(); vi.useFakeTimers();
});
afterEach(async () => { cleanup(); await voice.cancel(); vi.useRealTimers(); vi.clearAllMocks(); });
it('keeps recording after a quick tap and sends only on explicit Send', async () => {
  const onText = vi.fn(); render(<MicButton target={false} onText={onText} />);
  const mic = screen.getByRole('button', { name: 'Dictate' });
  await act(async () => { fireEvent.pointerDown(mic, { button: 0, pointerId: 1 }); });
  fireEvent.pointerUp(mic); fireEvent.lostPointerCapture(mic);
  expect(screen.getByRole('button', { name: 'Send recording' })).toBeTruthy();
  await act(async () => { vi.advanceTimersByTime(1100); });
  expect(screen.getByRole('timer').textContent).toBe('0:01');
  expect(onText).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send recording' })); });
  expect(onText).toHaveBeenCalledWith('Hello', mic);
});
it('transcribes on release after a hold', async () => {
  const onText = vi.fn(); render(<MicButton target={false} onText={onText} />);
  const mic = screen.getByRole('button', { name: 'Dictate' });
  await act(async () => { fireEvent.pointerDown(mic, { button: 0, pointerId: 1 }); });
  await act(async () => { vi.advanceTimersByTime(350); fireEvent.pointerUp(mic); });
  expect(onText).toHaveBeenCalledTimes(1);
});
it('cancels without transcribing and excludes other microphones', async () => {
  const onText = vi.fn(); render(<><MicButton target={false} label="One" onText={onText} /><MicButton target={false} label="Two" onText={onText} /></>);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'One' }), { detail: 0 }); });
  expect((screen.getByRole('button', { name: 'Two' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel recording' })); });
  expect(native.invoke).toHaveBeenCalledWith('voice_cancel_recording');
  expect(native.invoke).not.toHaveBeenCalledWith('voice_stop_recording');
  expect(onText).not.toHaveBeenCalled();
});
