import { describe, expect, it, vi, beforeEach } from "vitest";
import { createVoice, holdKeyAction, joinDictation, formatBytes, downloadPercent, NO_SPEECH_NOTICE } from "./voice";

describe("joinDictation", () => {
  it("adds one space only when needed", () => {
    expect(joinDictation("", "hello")).toBe("hello");
    expect(joinDictation("hi", "there")).toBe("hi there");
    expect(joinDictation("hi ", "there")).toBe("hi there");
    expect(joinDictation("hi\n", "there")).toBe("hi\nthere");
  });
});
describe("holdKeyAction", () => {
  const ev = (type: "keydown" | "keyup", code: string, repeat = false) => ({ type, code, repeat });
  it("starts on the shortcut key, ignoring repeats", () => {
    expect(holdKeyAction(ev("keydown", "AltRight"), "AltRight", false)).toBe("start");
    expect(holdKeyAction(ev("keydown", "AltRight", true), "AltRight", true)).toBe("ignore");
    expect(holdKeyAction(ev("keydown", "AltLeft"), "AltRight", false)).toBe("ignore");
  });
  it("cancels when another key is pressed while held", () => {
    expect(holdKeyAction(ev("keydown", "KeyA"), "AltRight", true)).toBe("cancel");
    expect(holdKeyAction(ev("keydown", "KeyA"), "AltRight", false)).toBe("ignore");
  });
  it("stops on keyup of the shortcut only while held", () => {
    expect(holdKeyAction(ev("keyup", "AltRight"), "AltRight", true)).toBe("stop");
    expect(holdKeyAction(ev("keyup", "AltRight"), "AltRight", false)).toBe("ignore");
    expect(holdKeyAction(ev("keyup", "KeyA"), "AltRight", true)).toBe("ignore");
  });
});
it("formats sizes and percentages", () => {
  expect(formatBytes(574_000_000)).toBe("574 MB");
  expect(formatBytes(1_600_000_000)).toBe("1.6 GB");
  expect(downloadPercent({ downloadedBytes: 50, totalBytes: 200 })).toBe(25);
  expect(downloadPercent({ downloadedBytes: 5, totalBytes: 0 })).toBe(0);
});

describe("recording state machine", () => {
  let calls: string[];
  const deferred = () => { let resolve!: () => void, reject!: (e: unknown) => void; const promise = new Promise<void>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
  beforeEach(() => { calls = []; vi.spyOn(console, "info").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {}); });
  const make = (impl: (cmd: string) => Promise<unknown> | unknown) => createVoice((async (cmd: string) => { calls.push(cmd); return impl(cmd); }) as never);

  it("start then stop returns the trimmed transcript and goes idle", async () => {
    const v = make(cmd => cmd === "voice_stop_recording" ? { text: " hello ", durationMs: 10, model: "m" } : undefined);
    expect(await v.start("hotkey")).toBe(true);
    expect(v.getSnapshot().phase).toBe("recording");
    expect(await v.stop()).toBe("hello");
    expect(v.getSnapshot().phase).toBe("idle");
    expect(calls).toEqual(["voice_start_recording", "voice_stop_recording"]);
  });
  it("guards against double start", async () => {
    const v = make(() => undefined);
    await Promise.all([v.start("button"), v.start("button")]);
    expect(calls.filter(c => c === "voice_start_recording")).toHaveLength(1);
  });
  it("stop during a pending start waits for it", async () => {
    const gate = deferred();
    const v = make(cmd => cmd === "voice_start_recording" ? gate.promise : { text: "ok", durationMs: 1, model: "m" });
    const started = v.start("button");
    const stopped = v.stop();
    await Promise.resolve();
    expect(calls).toEqual(["voice_start_recording"]);
    gate.resolve();
    expect(await stopped).toBe("ok");
    await started;
    expect(calls).toEqual(["voice_start_recording", "voice_stop_recording"]);
  });
  it("cancel during a pending start cancels after it resolves", async () => {
    const gate = deferred();
    const v = make(cmd => cmd === "voice_start_recording" ? gate.promise : undefined);
    const started = v.start("hotkey");
    await v.cancel();
    gate.resolve(); await started;
    expect(calls).toEqual(["voice_start_recording", "voice_cancel_recording"]);
    expect(v.getSnapshot().phase).toBe("idle");
  });
  it("surfaces start errors and allows a new attempt after dismissal", async () => {
    const v = make(() => { throw "Microphone access denied"; });
    expect(await v.start("button")).toBe(false);
    expect(v.getSnapshot()).toMatchObject({ phase: "error", error: "Microphone access denied" });
    v.clearError();
    expect(v.getSnapshot().phase).toBe("idle");
  });
  it("surfaces transcription errors", async () => {
    const v = make(cmd => { if (cmd === "voice_stop_recording") throw "model missing"; });
    await v.start("button");
    expect(await v.stop()).toBeNull();
    expect(v.getSnapshot()).toMatchObject({ phase: "error", error: "model missing" });
  });
  it("shows a notice and returns null for an empty transcript", async () => {
    const v = make(cmd => cmd === "voice_stop_recording" ? { text: "  ", durationMs: 1, model: "m" } : undefined);
    await v.start("hotkey");
    expect(await v.stop()).toBeNull();
    expect(v.getSnapshot()).toMatchObject({ phase: "idle", notice: NO_SPEECH_NOTICE });
  });
  it("logs transitions", async () => {
    const v = make(cmd => cmd === "voice_stop_recording" ? { text: "x", durationMs: 1, model: "m" } : undefined);
    await v.start("button"); await v.stop();
    expect(console.info).toHaveBeenCalledWith("[voice]", "idle", "→", "recording", "button");
  });
  it("keeps action errors visible across a successful background refresh", async () => {
    let fail = true;
    const v = make(cmd => { if (cmd === "voice_download_model" && fail) { fail = false; throw "disk full"; } return { models: [], ready: false }; });
    await v.downloadModel("m");
    await v.refresh();
    expect(v.getSnapshot().statusError).toBe("disk full");
    await v.downloadModel("m");
    expect(v.getSnapshot().statusError).toBeNull();
  });
});
