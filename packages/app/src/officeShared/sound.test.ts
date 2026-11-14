import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createOfficeSound, readSoundEnabled, SOUND_KEY, writeSoundEnabled } from "./sound";

let oscillators = 0, contexts = 0;
class FakeParam { value = 0; setValueAtTime() {} linearRampToValueAtTime() {} exponentialRampToValueAtTime() {} }
class FakeCtx {
  currentTime = 0; destination = {};
  constructor() { contexts++; }
  createGain() { return { gain: new FakeParam(), connect() {} }; }
  createBiquadFilter() { return { type: "", frequency: new FakeParam(), connect() {} }; }
  createOscillator() { oscillators++; return { type: "", frequency: new FakeParam(), connect() {}, start() {}, stop() {} }; }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}
beforeEach(() => { oscillators = 0; contexts = 0; vi.stubGlobal("AudioContext", FakeCtx); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); });

it("defaults off, persists the flag, and is silent while off", () => {
  expect(readSoundEnabled()).toBe(false);
  const s = createOfficeSound();
  s.play("arrive");
  expect(contexts).toBe(0);
  writeSoundEnabled(true);
  expect(localStorage.getItem(SOUND_KEY)).toBe("true");
  expect(readSoundEnabled()).toBe(true);
});

it("lazily creates the context and rate limits per kind", () => {
  const s = createOfficeSound();
  s.setEnabled(true);
  s.play("complete"); s.play("complete");
  expect(oscillators).toBe(2); // one two-note cue only
  vi.advanceTimersByTime(1600);
  s.play("complete");
  expect(oscillators).toBe(4);
});

it("caps overall cues at 4 per second", () => {
  const s = createOfficeSound();
  s.setEnabled(true);
  (["arrive", "fail", "stuck", "leave", "review"] as const).forEach(k => s.play(k));
  expect(oscillators).toBe(1 + 1 + 1 + 1); // arrive, fail, stuck, leave; review dropped
});
