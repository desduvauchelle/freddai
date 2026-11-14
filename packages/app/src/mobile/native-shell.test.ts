import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke, addPluginListener: vi.fn() }));

beforeEach(() => { vi.resetModules(); invoke.mockReset(); });
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function tauri() {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
}

it('uses the native plugin on an iPad with a Macintosh user agent', async () => {
  tauri();
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15' });
  invoke.mockResolvedValue({ installed: true });
  const shell = await import('./native-shell');
  expect(await shell.probeNativeShell()).toBe(true);
  expect(shell.isNativeShell()).toBe(true);
  expect(invoke).toHaveBeenCalledWith('plugin:native-shell|ping');
});

it('waits for the native root controller and shares simultaneous probes', async () => {
  tauri();
  vi.useFakeTimers();
  invoke.mockResolvedValueOnce({ installed: false }).mockResolvedValue({ installed: true });
  const shell = await import('./native-shell');
  const first = shell.probeNativeShell();
  expect(shell.probeNativeShell()).toBe(first);
  await vi.advanceTimersByTimeAsync(100);
  expect(await first).toBe(true);
  expect(invoke).toHaveBeenCalledTimes(2);
});

it('keeps browser previews inert', async () => {
  const shell = await import('./native-shell');
  expect(await shell.probeNativeShell()).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
});

it('keeps desktop Tauri builds without the plugin inert', async () => {
  tauri();
  invoke.mockRejectedValue(new Error('Plugin not found'));
  const shell = await import('./native-shell');
  expect(await shell.probeNativeShell()).toBe(false);
  expect(invoke).toHaveBeenCalledTimes(1);
});

it('drives the native mic button and appends dictated text through the plugin', async () => {
  tauri();
  invoke.mockResolvedValue({ installed: true });
  const shell = await import('./native-shell');
  await shell.probeNativeShell();
  invoke.mockClear();
  await shell.setVoice(true, 'transcribing');
  await shell.setVoice(false);
  await shell.appendComposerText('hello');
  expect(invoke).toHaveBeenNthCalledWith(1, 'plugin:native-shell|set_voice', { enabled: true, state: 'transcribing' });
  expect(invoke).toHaveBeenNthCalledWith(2, 'plugin:native-shell|set_voice', { enabled: false, state: null });
  expect(invoke).toHaveBeenNthCalledWith(3, 'plugin:native-shell|append_composer_text', { text: 'hello', submit: false });
});

async function nativeShell() {
  tauri();
  invoke.mockImplementation(async (cmd: string) => (cmd === 'plugin:native-shell|ping' ? { installed: true } : undefined));
  return import('./native-shell');
}
const video = { path: '/c/a.mp4', name: 'a.mp4', mime: 'video/mp4', bytes: 10, durationS: 3 };

it('bug walk bindings are inert outside the native shell', async () => {
  const shell = await import('./native-shell');
  expect(await shell.bugWalkRecordingAvailable()).toBe(false);
  await expect(shell.startBugWalkRecording({ microphone: true })).rejects.toThrow("isn't available");
  await expect(shell.pickBugWalkVideo()).rejects.toThrow("isn't available");
  await expect(shell.cancelBugWalkRecording()).resolves.toBeUndefined();
  expect(invoke).not.toHaveBeenCalled();
});

it('invokes the bug walk commands and unwraps results', async () => {
  const shell = await nativeShell();
  invoke.mockImplementation(async (cmd: string) => {
    if (cmd.endsWith('|ping')) return { installed: true };
    if (cmd.endsWith('|bug_walk_recording_available')) return { available: true };
    if (cmd.endsWith('|stop_bug_walk_recording')) return video;
    if (cmd.endsWith('|pick_bug_walk_video')) return { picked: true, video };
  });
  expect(await shell.bugWalkRecordingAvailable()).toBe(true);
  await shell.startBugWalkRecording({ microphone: false });
  expect(invoke).toHaveBeenCalledWith('plugin:native-shell|start_bug_walk_recording', { microphone: false });
  expect(await shell.stopBugWalkRecording()).toEqual(video);
  expect(await shell.pickBugWalkVideo()).toEqual(video);
  await shell.cancelBugWalkRecording();
  expect(invoke).toHaveBeenCalledWith('plugin:native-shell|cancel_bug_walk_recording', undefined);
});

it('resolves null when the picker is cancelled and surfaces native error messages', async () => {
  const shell = await nativeShell();
  invoke.mockImplementation(async (cmd: string) => {
    if (cmd.endsWith('|ping')) return { installed: true };
    if (cmd.endsWith('|pick_bug_walk_video')) return { picked: false };
    throw 'Screen recording permission was denied';
  });
  expect(await shell.pickBugWalkVideo()).toBeNull();
  await expect(shell.startBugWalkRecording({ microphone: true })).rejects.toThrow('Screen recording permission was denied');
});

it('subscribes to recording state and unsubscribes, even before registration finishes', async () => {
  const shell = await nativeShell();
  const unregister = vi.fn();
  let handler: ((p: unknown) => void) | undefined;
  const core = await import('@tauri-apps/api/core');
  vi.mocked(core.addPluginListener).mockImplementation((async (_p: string, event: string, h: (p: unknown) => void) => {
    expect(event).toBe('bug-walk-recording-state');
    handler = h;
    return { unregister };
  }) as never);
  const seen: unknown[] = [];
  const off = shell.onBugWalkRecordingState(s => seen.push(s));
  await new Promise(r => setTimeout(r, 0));
  handler?.({ state: 'recording', elapsedS: 4 });
  handler?.({ state: 'bogus' });
  expect(seen).toEqual([{ state: 'recording', elapsedS: 4 }, { state: 'idle', elapsedS: 0 }]);
  off();
  expect(unregister).toHaveBeenCalled();
  const early = shell.onBugWalkRecordingState(() => {});
  early();
  await new Promise(r => setTimeout(r, 0));
  // Unsubscribing before registration finishes never registers a listener at all.
  expect(core.addPluginListener).toHaveBeenCalledTimes(1);
  expect(unregister).toHaveBeenCalledTimes(1);
});
