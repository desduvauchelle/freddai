import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardCall, serialDispatch } from './DashboardCall';
import { SEND_DELAY_MS, type CallEvent, type CallIo } from './voiceCall';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('dashboard Commander calls', () => {
  it('serializes rapid project requests and continues after a failed dispatch', async () => {
    let finish!: () => void;
    const send = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const dispatch = serialDispatch(send);
    const first = dispatch('Freddai: add a feature');
    const second = dispatch('Recursive Engine: fix this');
    const rejected = expect(second).rejects.toThrow('offline');
    const third = dispatch('HCCI: update this');
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    finish(); await first; await rejected; await third;
    expect(send.mock.calls.map(args => args[0])).toEqual(['Freddai: add a feature', 'Recursive Engine: fix this', 'HCCI: update this']);
  });

  it.each([false, true])('keeps Commander call routing with native header launcher %s', async hideLauncher => {
    vi.useFakeTimers();
    let emit!: (event: CallEvent) => void;
    const io: CallIo = { start: vi.fn(async () => {}), stop: vi.fn(async () => {}), setListening: vi.fn(async () => {}), speak: vi.fn(async () => {}), stopSpeaking: vi.fn(async () => {}), listen: vi.fn(async handler => { emit = handler; return () => {}; }) };
    const sendText = vi.fn(async (_text: string) => {});
    const props = { visible: true, enabled: true, hideLauncher, connected: true, io, sendText, view: { busy: false, messages: [] } };
    const ui = render(<DashboardCall {...props} />);
    expect(screen.queryByRole('button', { name: 'Call Commander' }) !== null).toBe(!hideLauncher);
    await act(async () => {
      if (hideLauncher) window.dispatchEvent(new Event('freddai:start-dashboard-call'));
      else fireEvent.click(screen.getByRole('button', { name: 'Call Commander' }));
    });
    expect(io.start).toHaveBeenCalledTimes(1);
    ui.rerender(<DashboardCall {...props} visible={false} />);
    expect(screen.getByLabelText('Commander call')).toBeTruthy();
    await act(async () => { emit({ type: 'segment', text: 'For HCCI, add search' }); await vi.advanceTimersByTimeAsync(SEND_DELAY_MS); });
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0]?.[0]).toContain('For HCCI, add search');
    await act(async () => { ui.rerender(<DashboardCall {...props} visible={false} view={{ busy: false, messages: [{ id: 'u', role: 'user', text: String(sendText.mock.calls[0]?.[0]) }, { id: 'a', role: 'assistant', text: '<spoken>I have proposed the search task for HCCI.</spoken>' }] }} />); });
    expect(io.speak).toHaveBeenCalledWith('I have proposed the search task for HCCI.');
    await act(async () => { ui.rerender(<DashboardCall {...props} visible={false} connected={false} />); });
    expect(io.stop).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Commander call')).toBeNull();
  });
});
