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
    expect(screen.queryByLabelText('Commander call') !== null).toBe(!hideLauncher);
    await act(async () => { emit({ type: 'segment', text: 'For HCCI, add search' }); await vi.advanceTimersByTimeAsync(SEND_DELAY_MS); });
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0]?.[0]).toContain('For HCCI, add search');
    await act(async () => { ui.rerender(<DashboardCall {...props} visible={false} view={{ busy: false, messages: [{ id: 'u', role: 'user', text: String(sendText.mock.calls[0]?.[0]) }, { id: 'a', role: 'assistant', text: '<spoken>I have proposed the search task for HCCI.</spoken>' }] }} />); });
    expect(io.speak).toHaveBeenCalledWith('I have proposed the search task for HCCI.');
    await act(async () => { ui.rerender(<DashboardCall {...props} visible={false} connected={false} />); });
    expect(io.stop).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Commander call')).toBeNull();
  });

  function makeIo() {
    let emit!: (event: CallEvent) => void;
    const io: CallIo = { start: vi.fn(async () => {}), stop: vi.fn(async () => {}), setListening: vi.fn(async () => {}), speak: vi.fn(async () => {}), stopSpeaking: vi.fn(async () => {}), listen: vi.fn(async handler => { emit = handler; return () => {}; }) };
    return { io, emit: (e: CallEvent) => emit(e) };
  }
  const baseView = { busy: false, messages: [] };

  describe('compact call pill', () => {
    it('shows a timer that advances, with mute and End call buttons', async () => {
      vi.useFakeTimers();
      const { io } = makeIo();
      render(<DashboardCall visible enabled io={io} sendText={async () => {}} view={baseView} />);
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Call Commander' })); });
      const pill = screen.getByLabelText('Commander call');
      expect(pill.textContent).toContain('0:00');
      expect(screen.queryByText(/Details/)).toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(65_000); });
      expect(screen.getByLabelText('Call duration').textContent).toBe('1:05');
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mute' })); });
      expect(screen.getByRole('button', { name: 'Unmute' })).toBeTruthy();
      expect(pill.getAttribute('data-phase')).toBe('paused');
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'End call' })); });
      expect(io.stop).toHaveBeenCalled();
      expect(screen.queryByLabelText('Commander call')).toBeNull();
    });

    it('draws no pill with the native header but the call stays controllable by window events', async () => {
      vi.useFakeTimers();
      const { io } = makeIo();
      const states: unknown[] = [];
      render(<DashboardCall visible enabled hideLauncher io={io} sendText={async () => {}} view={baseView} onCallState={s => states.push(s)} />);
      await act(async () => { window.dispatchEvent(new Event('freddai:start-dashboard-call')); });
      expect(io.start).toHaveBeenCalledTimes(1);
      expect(screen.queryByLabelText('Commander call')).toBeNull();
      expect(states.at(-1)).toMatchObject({ active: true, muted: false, startedAt: expect.any(Number) });
      await act(async () => { window.dispatchEvent(new Event('freddai:toggle-dashboard-call-mute')); });
      expect(states.at(-1)).toMatchObject({ active: true, muted: true, phase: 'paused' });
      await act(async () => { window.dispatchEvent(new Event('freddai:end-dashboard-call')); });
      expect(io.stop).toHaveBeenCalled();
      expect(states.at(-1)).toEqual({ active: false, startedAt: null, muted: false, phase: 'idle' });
    });

    it('keeps errors visible, with and without the pill', async () => {
      vi.useFakeTimers();
      for (const hideLauncher of [false, true]) {
        const { io } = makeIo();
        io.start = vi.fn(async () => { throw new Error('mic denied'); });
        const ui = render(<DashboardCall visible enabled hideLauncher={hideLauncher} io={io} sendText={async () => {}} view={baseView} syncError="Sync is behind" />);
        await act(async () => { window.dispatchEvent(new Event('freddai:start-dashboard-call')); });
        const alert = screen.getByRole('alert');
        expect(alert.textContent).toContain('mic denied');
        expect(alert.textContent).toContain('Sync is behind');
        ui.unmount();
        cleanup();
      }
    });
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
      expect(screen.getByRole('status').textContent).toMatch(/Listening for|Speaking/);
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
    it('shows the review card in a non-modal sheet that leaves the page interactive', async () => {
      vi.useFakeTimers();
      const reviews: boolean[] = [];
      const { io } = makeIo();
      let emit!: (e: CallEvent) => void;
      io.listen = vi.fn(async h => { emit = h; return () => {}; });
      const launch = vi.fn(async (_a: unknown) => {});
      render(<DashboardCall visible enabled io={io} sendText={async () => {}} view={baseView} onReview={r => reviews.push(r)} commandCenter={{ projects, accounts, native: false, homeSelections: {}, launch }} />);
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Call Commander' })); });
      await act(async () => { emit({ type: 'segment', text: 'Freddie, in HCCI, add a retry' }); await vi.advanceTimersByTimeAsync(SEND_DELAY_MS); });
      const card = screen.getByLabelText('Command review');
      const sheet = card.closest('.dashboard-review-sheet') as HTMLElement;
      expect(sheet.parentElement).toBe(document.body);
      expect(sheet.getAttribute('data-placement')).toBe('top-right');
      expect(document.querySelector('[data-slot="sheet-overlay"], [data-radix-dialog-overlay], .dashboard-review-backdrop')).toBeNull();
      expect(document.body.style.overflow).toBe('');
      expect(document.body.hasAttribute('data-scroll-locked')).toBe(false);
      expect(document.body.getAttribute('aria-hidden')).toBeNull();
      expect(reviews.at(-1)).toBe(true);
      await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });
      expect(screen.queryByLabelText('Command review')).toBeNull();
      expect(reviews.at(-1)).toBe(false);
      expect(launch).not.toHaveBeenCalled();
    });

    it('uses a full-screen sheet when the native shell presents the review', async () => {
      vi.useFakeTimers();
      const { io } = makeIo();
      let emit!: (e: CallEvent) => void;
      io.listen = vi.fn(async h => { emit = h; return () => {}; });
      render(<DashboardCall visible enabled hideLauncher io={io} sendText={async () => {}} view={baseView} commandCenter={{ projects: [{ id: 'p1', name: 'HCCI' }] as never[], launchDraft: async () => {}, renderReview: p => <section aria-label="Command review"><button onClick={p.onDismiss}>x</button></section> }} />);
      await act(async () => { window.dispatchEvent(new Event('freddai:start-dashboard-call')); });
      await act(async () => { emit({ type: 'segment', text: 'Freddie, in HCCI, add a retry' }); await vi.advanceTimersByTimeAsync(SEND_DELAY_MS); });
      expect(screen.getByLabelText('Command review').closest('.dashboard-review-sheet')?.getAttribute('data-placement')).toBe('native');
      await act(async () => { window.dispatchEvent(new Event('freddai:dismiss-dashboard-review')); });
      expect(screen.queryByLabelText('Command review')).toBeNull();
    });
  });
});
