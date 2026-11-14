import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => native);
import { MicButton, VoiceNotice } from './VoiceControls';
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
it.each(['cancel', 'send', 'return'] as const)('tracks diagonal drags on separate rails and handles %s release', async action => {
  class Pointer extends MouseEvent { pointerId = 1; }
  vi.stubGlobal('PointerEvent', Pointer);
  const onText = vi.fn(); render(<MicButton target={false} onText={onText} />);
  const mic = screen.getByRole('button', { name: 'Dictate' });
  await act(async () => { fireEvent.pointerDown(mic, { button: 0, clientX: 300, clientY: 400 }); });
  fireEvent.pointerMove(mic, { clientX: 250, clientY: 390 });
  const cancel = screen.getByRole('button', { name: 'Cancel recording' });
  const send = screen.getByRole('button', { name: 'Send recording' });
  expect(cancel.style.transform).toMatch(/translate\([^,]+px, 0px\)/);
  expect(send.style.transform).toContain('translate(0px, 0px)');
  fireEvent.pointerMove(mic, { clientX: 290, clientY: 360 });
  expect(cancel.style.transform).toContain('translate(0px, 0px)');
  expect(send.style.transform).toMatch(/translate\(0px, [^)]+px\)/);
  const point = action === 'cancel' ? { clientX: 204, clientY: 380 } : action === 'send' ? { clientX: 280, clientY: 336 } : { clientX: 300, clientY: 400 };
  fireEvent.pointerMove(mic, point);
  await act(async () => { fireEvent.pointerUp(mic, point); });
  if (action === 'send') expect(onText).toHaveBeenCalledTimes(1);
  else expect(onText).not.toHaveBeenCalled();
  if (action === 'return') expect(screen.getByRole('button', { name: 'Send recording' })).toBeTruthy();
  if (action === 'cancel') expect(native.invoke).toHaveBeenCalledWith('voice_cancel_recording');
  vi.unstubAllGlobals();
});

it('keeps project recording feedback out of the unrelated composer', async () => {
  render(<><MicButton target={false} label="Project mic" onText={vi.fn()} /><div data-testid="composer"><VoiceNotice target /></div></>);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Project mic' })); });
  expect(screen.getByTestId('composer').textContent).toBe('');
  expect(screen.getByRole('group', { name: 'Voice recording' }).parentElement).toBe(document.body);
});
it('keeps transcription busy feedback inside the originating button without extra rows', async () => {
  let finish!: (value: unknown) => void;
  native.invoke.mockImplementation(async (command: string) => command === 'voice_stop_recording' ? new Promise(resolve => { finish = resolve; }) : undefined);
  const onText = vi.fn();
  render(<><MicButton target={false} label="Project mic" onText={onText}/><VoiceNotice target /></>);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Project mic' })); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send recording' })); });
  expect(screen.getByRole('button', { name: 'Transcribing…' }).hasAttribute('disabled')).toBe(true);
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByText('Transcribing…')).toBeNull();
  await act(async () => { finish({ text: 'Project task' }); });
  expect(onText).toHaveBeenCalledWith('Project task', expect.any(HTMLElement));
});
