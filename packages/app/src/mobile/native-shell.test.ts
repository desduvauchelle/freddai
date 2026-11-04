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
