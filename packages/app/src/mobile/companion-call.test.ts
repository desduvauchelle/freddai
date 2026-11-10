import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { companionCallIo } from './companion-call';
import { VoiceCallController, type CallEvent } from '../desktop/voiceCall';
import type { CompanionClient } from './companion';
const native = vi.hoisted(() => ({ supported: true, handler: (_event: unknown) => {}, unregister: vi.fn(), invoke: vi.fn(async () => {}) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke, addPluginListener: vi.fn(async (_plugin, _event, handler) => { native.handler = handler; return { unregister: native.unregister }; }) }));
vi.mock('./native-shell', () => ({ hasNativeVoiceCall: () => native.supported, discardFiles: vi.fn() }));
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function setup() {
  const client = { voice: vi.fn(async () => ({ enabled: true, ready: true })), transcribe: vi.fn(async () => ({ text: 'Hello from the phone' })) } as unknown as CompanionClient;
  return { client, io: companionCallIo(client) };
}
beforeEach(() => { native.supported = true; vi.clearAllMocks(); localStorage.clear(); });
describe('companion call transport', () => {
  it('transcribes native utterances on the Mac and forwards segments', async () => {
    const { io, client } = setup(); const events: CallEvent[] = [];
    const off = await io.listen(e => events.push(e)); await io.start();
    native.handler({ type: 'recording', path: '/tmp/utterance.m4a' }); await flush();
    expect(client.transcribe).toHaveBeenCalledWith({ path: '/tmp/utterance.m4a' });
    expect(events).toContainEqual({ type: 'segment', text: 'Hello from the phone' });
    await io.setListening(false); await io.speak('Hello'); await io.stopSpeaking(); await io.stop(); off();
    expect(native.invoke).toHaveBeenCalledWith('plugin:native-shell|call_control', { action: 'pause', text: null });
    expect(native.invoke).toHaveBeenCalledWith('plugin:native-shell|call_control', { action: 'speak', text: 'Hello' });
    expect(native.unregister).toHaveBeenCalled();
  });
  it('does not deliver a transcription after hangup', async () => {
    const { io, client } = setup(); const events: CallEvent[] = [];
    let resolve!: (result: { text: string }) => void;
    vi.mocked(client.transcribe!).mockImplementation(() => new Promise(done => { resolve = done as typeof resolve; }));
    await io.listen(e => events.push(e)); await io.start();
    native.handler({ type: 'recording', path: '/tmp/a.m4a' }); await flush();
    await io.stop(); resolve({ text: 'late words' }); await flush();
    expect(events).toEqual([]);
  });
  it('checks Mac readiness before opening the microphone', async () => {
    const { io, client } = setup();
    vi.mocked(client.voice!).mockResolvedValue({ enabled: false, ready: false });
    await expect(io.start()).rejects.toThrow('Enable voice');
    expect(native.invoke).not.toHaveBeenCalled();
  });
  it('hangup while registering listeners prevents a delayed microphone start', async () => {
    const start = vi.fn(async () => {}), off = vi.fn();
    let register!: (off: () => void) => void;
    const controller = new VoiceCallController({ start, stop: async () => {}, setListening: async () => {}, speak: async () => {}, stopSpeaking: async () => {}, listen: () => new Promise(done => { register = done; }) }, () => ({ isBusy: () => false, stopTurn: async () => {}, sendText: async () => {} }), { speak: false, mode: 'queue' });
    const pending = controller.begin(); await controller.end(); register(off); await pending;
    expect(start).not.toHaveBeenCalled(); expect(off).toHaveBeenCalled();
  });
});


afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('releases browser microphone access that arrives after hangup', async () => {
  native.supported = false;
  let grant!: (stream: MediaStream) => void;
  const track = { stop: vi.fn() };
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => new Promise<MediaStream>(done => { grant = done; }) } });
  const { io } = setup();
  await io.listen(() => {});
  const starting = io.start(); await flush();
  await io.stop();
  grant({ getTracks: () => [track] } as unknown as MediaStream);
  await starting;
  expect(track.stop).toHaveBeenCalledTimes(1);
});

it('segments browser speech, transcribes it, and releases capture on hangup', async () => {
  vi.useFakeTimers(); native.supported = false;
  const track = { stop: vi.fn(), enabled: true };
  const audio = { getTracks: () => [track], getAudioTracks: () => [track] };
  let amplitude = 0.04;
  const close = vi.fn(async () => {});
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => audio } });
  vi.stubGlobal('AudioContext', class {
    resume = async () => {}; close = close;
    createAnalyser() { return { fftSize: 2048, getFloatTimeDomainData: (samples: Float32Array) => samples.fill(amplitude) }; }
    createMediaStreamSource() { return { connect() {} }; }
  });
  vi.stubGlobal('MediaRecorder', class {
    static isTypeSupported() { return true; }
    state = 'inactive'; mimeType = 'audio/mp4';
    ondataavailable?: (event: { data: Blob }) => void;
    onstop?: () => void;
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['audio']) }); this.onstop?.(); }
  });
  const { client } = setup(); client.transcribeAudio = vi.fn(async () => ({ text: 'Browser utterance' }));
  const io = companionCallIo(client), events: CallEvent[] = [];
  const off = await io.listen(e => events.push(e)); await io.start();
  await vi.advanceTimersByTimeAsync(80); amplitude = 0;
  await vi.advanceTimersByTimeAsync(960);
  expect(client.transcribeAudio).toHaveBeenCalledTimes(1);
  expect(events).toContainEqual({ type: 'segment', text: 'Browser utterance' });
  await io.stop(); off();
  expect(track.stop).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1);
});
