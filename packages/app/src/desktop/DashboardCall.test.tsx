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

  describe('command center', () => {
    const accounts = [{ id: 'a1', name: 'Claude', provider: 'claude' as const, color: '#fff' }];
    const projects = [{ id: 'p1', name: 'HCCI', path: '/tmp/hcci', color: '#0af', policy: 'inherit' as const, account: null, last: null }] as never[];
    async function setup(launch: (a: unknown) => Promise<void>) {
      let emit!: (event: CallEvent) => void;
      const io: CallIo = { start: vi.fn(async () => {}), stop: vi.fn(async () => {}), setListening: vi.fn(async () => {}), speak: vi.fn(async () => {}), stopSpeaking: vi.fn(async () => {}), listen: vi.fn(async handler => { emit = handler; return () => {}; }) };
      const sendText = vi.fn(async (_text: string) => {});
      const commandCenter = { projects, accounts, native: false, homeSelections: {}, launch };
      render(<DashboardCall visible enabled io={io} sendText={sendText} view={{ busy: false, messages: [] }} commandCenter={commandCenter} />);
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Call Commander' })); });
      const say = (text: string) => act(async () => { emit({ type: 'segment', text }); await vi.advanceTimersByTimeAsync(SEND_DELAY_MS); });
      return { io, sendText, say };
    }

    it('consumes speech without the wake word', async () => {
      vi.useFakeTimers();
      const { sendText, say } = await setup(vi.fn(async () => {}));
      expect(screen.getByText(/Listening for/)).toBeTruthy();
      await say('add search to HCCI');
      expect(sendText).not.toHaveBeenCalled();
      expect(screen.queryByLabelText('Command review')).toBeNull();
    });

    it('opens the card, launches on go with the selected values, then returns to listening', async () => {
      vi.useFakeTimers();
      const launch = vi.fn(async (_a: unknown) => {});
      const { sendText, say, io } = await setup(launch);
      await say('Freddie, in HCCI, add a retry');
      expect(screen.getByLabelText('Command review')).toBeTruthy();
      expect((screen.getByLabelText('Instruction') as HTMLTextAreaElement).value).toBe('add a retry');
      await say('go');
      expect(launch).toHaveBeenCalledWith({ projectId: 'p1', accountId: 'a1', model: '', effort: 'default', prompt: 'add a retry' });
      expect(sendText).not.toHaveBeenCalled();
      expect(io.speak).toHaveBeenCalledWith('Starting in HCCI');
      expect(screen.queryByLabelText('Command review')).toBeNull();
      expect(screen.getByText(/Listening for/)).toBeTruthy();
    });

    it('cancel closes the card without launching', async () => {
      vi.useFakeTimers();
      const launch = vi.fn(async (_a: unknown) => {});
      const { say } = await setup(launch);
      await say('Freddie, for HCCI, add a retry');
      await say('cancel');
      expect(screen.queryByLabelText('Command review')).toBeNull();
      expect(launch).not.toHaveBeenCalled();
    });

    it('keeps the card open and shows the error when launch fails', async () => {
      vi.useFakeTimers();
      const { say, io } = await setup(vi.fn(async () => { throw new Error('no folder'); }));
      await say('Freddie, in HCCI, add a retry');
      await say('send it');
      expect(screen.getByRole('alert').textContent).toContain('no folder');
      expect(screen.getByLabelText('Command review')).toBeTruthy();
      expect(io.speak).toHaveBeenCalledWith(expect.stringContaining('no folder'));
    });
  });
});
