import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEND_DELAY_MS, VoiceCallController, type CallEvent, type CallIo, type CallThread } from "./voiceCall";
import { VOICE_CALL_SUFFIX } from "../conversation/voiceCallMarkup";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

function setup(opts: { busy?: boolean; speak?: boolean; mode?: "interrupt" | "queue" } = {}) {
  const calls: string[] = [];
  let handler: (e: CallEvent) => void = () => {};
  const io: CallIo = {
    start: vi.fn(async () => { calls.push("start"); }),
    stop: vi.fn(async () => { calls.push("stop"); }),
    setListening: vi.fn(async (l: boolean) => { calls.push(`listening:${l}`); }),
    speak: vi.fn(async (t: string) => { calls.push(`speak:${t}`); }),
    stopSpeaking: vi.fn(async () => { calls.push("stopSpeaking"); }),
    listen: vi.fn(async h => { handler = h; return () => {}; }),
  };
  const state = { busy: opts.busy ?? false };
  const thread: CallThread = {
    isBusy: () => state.busy,
    stopTurn: vi.fn(async () => { calls.push("stopTurn"); }),
    sendText: vi.fn(async (t: string) => { calls.push(`send:${t}`); }),
  };
  const c = new VoiceCallController(io, () => thread, { speak: opts.speak ?? false, mode: opts.mode ?? "interrupt" });
  return { c, io, thread, calls, state, emit: (e: CallEvent) => handler(e) };
}

describe("VoiceCallController", () => {
  beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); });
  afterEach(() => vi.useRealTimers());

  it("bundles consecutive segments into one message", async () => {
    const t = setup();
    await t.c.begin();
    t.emit({ type: "speech-start" });
    t.emit({ type: "segment", text: "hello" });
    expect(t.c.getSnapshot().pending).toBe("hello");
    await vi.advanceTimersByTimeAsync(SEND_DELAY_MS - 100);
    t.emit({ type: "speech-start" });
    t.emit({ type: "segment", text: "world" });
    await vi.advanceTimersByTimeAsync(SEND_DELAY_MS - 1);
    expect(t.thread.sendText).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(t.thread.sendText).toHaveBeenCalledTimes(1);
    expect(t.thread.sendText).toHaveBeenCalledWith("hello world");
    expect(t.c.getSnapshot().pending).toBe("");
  });

  it("drops punctuation-only utterances and purges voice queue on end", async () => {
    const t = setup();
    const purge = vi.fn().mockResolvedValue(undefined);
    (t.thread as { purgeVoiceQueue?: unknown }).purgeVoiceQueue = purge;
    await t.c.begin();
    t.emit({ type: "segment", text: "." });
    await vi.advanceTimersByTimeAsync(SEND_DELAY_MS);
    expect(t.thread.sendText).not.toHaveBeenCalled();
    expect(t.c.getSnapshot().pending).toBe("");
    await t.c.end();
    expect(purge).toHaveBeenCalledTimes(1);
  });

  it("speech-start cancels the pending send timer", async () => {
    const t = setup();
    await t.c.begin();
    t.emit({ type: "segment", text: "one" });
    await vi.advanceTimersByTimeAsync(600);
    t.emit({ type: "speech-start" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.thread.sendText).not.toHaveBeenCalled();
    expect(t.c.getSnapshot().pending).toBe("one");
  });

  it("interrupt mode stops the turn only when the agent is busy", async () => {
    const t = setup({ busy: false });
    await t.c.begin();
    t.emit({ type: "speech-start" });
    expect(t.thread.stopTurn).not.toHaveBeenCalled();
    t.state.busy = true;
    t.emit({ type: "speech-start" });
    expect(t.thread.stopTurn).toHaveBeenCalledTimes(1);
  });

  it("queue mode never stops the turn", async () => {
    const t = setup({ busy: true, mode: "queue" });
    await t.c.begin();
    t.emit({ type: "speech-start" });
    t.emit({ type: "segment", text: "later" });
    await vi.advanceTimersByTimeAsync(SEND_DELAY_MS);
    expect(t.thread.stopTurn).not.toHaveBeenCalled();
    expect(t.thread.sendText).toHaveBeenCalledWith("later");
  });

  it("appends the voice-call suffix and speaks the reply, pausing and resuming the mic", async () => {
    const t = setup({ speak: true });
    await t.c.begin();
    t.c.observeThread({ busy: false, messages: [] });
    t.emit({ type: "segment", text: "status?" });
    await vi.advanceTimersByTimeAsync(SEND_DELAY_MS);
    expect(t.thread.sendText).toHaveBeenCalledWith(`status?${VOICE_CALL_SUFFIX}`);
    // optimistic user message, agent working
    const user = { id: "u1", role: "user", text: `status?${VOICE_CALL_SUFFIX}` };
    t.c.observeThread({ busy: true, messages: [user] });
    expect(t.io.speak).not.toHaveBeenCalled();
    t.c.observeThread({ busy: false, messages: [user, { id: "a1", role: "assistant", text: "<spoken>All green.</spoken>\n\nDetails" }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.calls.slice(-2)).toEqual(["listening:false", "speak:All green."]);
    expect(t.c.getSnapshot().speaking).toBe(true);
    t.emit({ type: "tts-end" });
    expect(t.calls.at(-1)).toBe("listening:true");
    expect(t.c.getSnapshot().speaking).toBe(false);
  });

  it("does not re-speak an older reply while a newer message is pending", async () => {
    const t = setup({ speak: true });
    await t.c.begin();
    const old = [{ id: "u0", role: "user", text: `x${VOICE_CALL_SUFFIX}` }, { id: "a0", role: "assistant", text: "<spoken>Old.</spoken>" }];
    t.c.observeThread({ busy: false, messages: old });
    t.emit({ type: "segment", text: "again" });
    await vi.advanceTimersByTimeAsync(SEND_DELAY_MS);
    t.c.observeThread({ busy: false, messages: old });
    expect(t.io.speak).not.toHaveBeenCalled();
  });

  it("stopSpeaking resumes listening unless muted", async () => {
    const t = setup({ speak: true });
    await t.c.begin();
    t.emit({ type: "tts-start" });
    t.c.toggleMute();
    t.c.stopSpeaking();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.io.stopSpeaking).toHaveBeenCalled();
    expect(t.calls).not.toContain("listening:true");
  });

  it("surfaces send failures and engine errors loudly", async () => {
    const t = setup();
    (t.thread.sendText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
    await t.c.begin();
    t.emit({ type: "segment", text: "hi" });
    await vi.advanceTimersByTimeAsync(SEND_DELAY_MS);
    expect(t.c.getSnapshot().error).toContain("boom");
    t.c.dismissError();
    t.emit({ type: "state", state: "error", error: "no mic" });
    expect(t.c.getSnapshot().error).toBe("no mic");
  });

  it("persists speak and mode", async () => {
    const t = setup();
    t.c.setSpeak(true); t.c.setMode("queue");
    expect(JSON.parse(localStorage.getItem("freddai.voiceCall.prefs")!)).toEqual({ speak: true, mode: "queue" });
  });

  it("end stops the call and read-out", async () => {
    const t = setup();
    await t.c.begin();
    await t.c.end();
    expect(t.io.stop).toHaveBeenCalled();
    expect(t.io.stopSpeaking).toHaveBeenCalled();
    expect(t.c.getSnapshot().active).toBe(false);
  });

  it("records the start time while active and clears it on end", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const t = setup();
    expect(t.c.getSnapshot().startedAt).toBeNull();
    await t.c.begin();
    expect(t.c.getSnapshot().startedAt).toBe(Date.parse("2026-01-01T00:00:00Z"));
    await t.c.end();
    expect(t.c.getSnapshot().startedAt).toBeNull();
  });
});
