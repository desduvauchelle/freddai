import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
import { createBugWalk, elapsedSeconds, formatClock, permissionProblem, prettyShortcut, type BugWalkStateEvent } from "./bugWalk";

const region = { x: 10, y: 20, width: 640, height: 400, scale: 2 };
function setup() {
  const call = vi.fn();
  const handlers: Record<string, (e: { payload: unknown }) => void> = {};
  const subscribe = vi.fn(async (name: string, h: (e: { payload: unknown }) => void) => { handlers[name] = h; return () => { delete handlers[name]; }; });
  let t = 1_000_000;
  const store = createBugWalk(call as never, subscribe as never, () => t);
  const emit = (e: BugWalkStateEvent) => store.applyState(e);
  return { call, store, emit, handlers, advance: (ms: number) => { t += ms; } };
}
beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });

it("walks through the state events and computes elapsed client-side", async () => {
  const { call, store, emit, advance } = setup();
  call.mockResolvedValueOnce({ id: "w1" });
  await store.attach();
  expect(await store.start({ thread: "t1" })).toBe(true);
  expect(call).toHaveBeenCalledWith("bug_walk_start", { origin: { thread: "t1" } });
  expect(store.getSnapshot().walk).toMatchObject({ id: "w1", phase: "selecting", origin: { thread: "t1" } });
  emit({ id: "w1", phase: "recording", region });
  const w = store.getSnapshot().walk!;
  expect(w.region).toEqual(region);
  advance(65_000);
  expect(formatClock(elapsedSeconds(w, 1_000_000 + 65_000))).toBe("01:05");
  emit({ id: "w1", phase: "recording", level: 0.4, elapsed_s: 70 });
  expect(store.getSnapshot().walk).toMatchObject({ level: 0.4, elapsed: 70 });
  emit({ id: "w1", phase: "stopped" });
  expect(store.getSnapshot().walk).toMatchObject({ phase: "stopped", level: 0, elapsed: 70, region });
  emit({ id: "w1", phase: "analyzing" });
  expect(store.getSnapshot().walk!.phase).toBe("analyzing");
  emit({ id: "w1", phase: "done", session_id: "s9" });
  expect(store.getSnapshot().walk).toMatchObject({ phase: "done", sessionId: "s9" });
  store.dismiss();
  expect(store.getSnapshot().walk).toBeNull();
});
it("clears the walk on cancelled events", async () => {
  const { call, store, emit } = setup();
  call.mockResolvedValueOnce({ id: "w1" });
  await store.start();
  emit({ id: "w1", phase: "cancelled" });
  expect(store.getSnapshot().walk).toBeNull();
});
it("toggles on the hotkey: start when idle, stop while recording, ignore otherwise", async () => {
  const { call, store, emit, handlers } = setup();
  await store.attach();
  call.mockResolvedValueOnce({ id: "w1" });
  handlers["bug-walk://hotkey"]({ payload: null });
  await vi.waitFor(() => expect(store.getSnapshot().walk?.id).toBe("w1"));
  emit({ id: "w1", phase: "recording", region });
  call.mockResolvedValueOnce({ id: "w1", duration_s: 12, region });
  handlers["bug-walk://hotkey"]({ payload: null });
  await vi.waitFor(() => expect(store.getSnapshot().walk?.phase).toBe("stopped"));
  expect(call).toHaveBeenLastCalledWith("bug_walk_stop", { id: "w1" });
  expect(store.getSnapshot().walk!.elapsed).toBe(12);
  const calls = call.mock.calls.length;
  handlers["bug-walk://hotkey"]({ payload: null });
  expect(call.mock.calls.length).toBe(calls);
});
it("shows start failures loudly, including permission hints", async () => {
  const { call, store } = setup();
  call.mockRejectedValueOnce("screen-recording-permission: Allow Freddai under Privacy & Security");
  expect(await store.start()).toBe(false);
  const { startError, walk } = store.getSnapshot();
  expect(walk).toBeNull();
  expect(permissionProblem(startError)).toEqual({ kind: "screen-recording", hint: "Allow Freddai under Privacy & Security" });
  expect(permissionProblem("microphone-permission Enable it")?.kind).toBe("microphone");
  expect(permissionProblem("boom")).toBeNull();
});
it("keeps the error and transcript, and resends the transcript with the same opts", async () => {
  const { call, store, emit } = setup();
  call.mockResolvedValueOnce({ id: "w1" });
  await store.start();
  const opts = { project: "p", account: "a", permission_mode: "ask" as const };
  call.mockResolvedValueOnce(undefined);
  await store.send(opts);
  expect(call).toHaveBeenLastCalledWith("bug_walk_send", { id: "w1", opts });
  emit({ id: "w1", phase: "error", error: "analysis timed out", transcript: "it is broken" });
  expect(store.getSnapshot().walk).toMatchObject({ phase: "error", error: "analysis timed out", transcript: "it is broken", sendOpts: opts });
  expect(store.getSnapshot().walk!.id).toBe("w1");
  call.mockResolvedValueOnce(undefined);
  await store.sendTranscript();
  expect(call).toHaveBeenLastCalledWith("bug_walk_send_transcript", { id: "w1", opts: { ...opts, split: "single" } });
  call.mockRejectedValueOnce("nope");
  await store.sendTranscript();
  expect(store.getSnapshot().walk).toMatchObject({ phase: "error", error: "nope" });
});
it("handles orphans: list, open for sending, discard", async () => {
  const { call, store } = setup();
  call.mockResolvedValueOnce([{ id: "o1", started_at: 1, duration_s: 30 }, { id: "o2", started_at: 2, duration_s: 5 }]);
  await store.loadOrphans();
  expect(store.getSnapshot().orphans).toHaveLength(2);
  store.openOrphan(store.getSnapshot().orphans[0]);
  expect(store.getSnapshot().walk).toMatchObject({ id: "o1", phase: "stopped", elapsed: 30, orphan: true });
  call.mockResolvedValueOnce(undefined);
  await store.discardOrphan("o2");
  expect(call).toHaveBeenLastCalledWith("bug_walk_cancel", { id: "o2" });
  expect(store.getSnapshot().orphans).toHaveLength(0);
});
it("formats shortcuts", () => { expect(prettyShortcut("CommandOrControl+Shift+R")).toBe("⌘⇧R"); });

it("treats an Esc cancel from bug_walk_start as no walk, even after the cancelled event", async () => {
  const { call, store, emit } = setup();
  call.mockImplementationOnce(async () => { emit({ id: "w2", phase: "selecting" }); emit({ id: "w2", phase: "cancelled" }); return { id: "w2", cancelled: true }; });
  expect(await store.start()).toBe(false);
  expect(store.getSnapshot().walk).toBeNull();
  emit({ id: "w2", phase: "recording", level: 0.1 });
  expect(store.getSnapshot().walk).toBeNull();
});

it("shows a notice on max-duration stop, ignores late level ticks, and keeps startup errors out of the walk", () => {
  const { store, emit } = setup();
  emit({ id: "", phase: "error", error: "shortcut-unavailable: taken" });
  expect(store.getSnapshot().walk).toBeNull();
  expect(store.getSnapshot().startError).toContain("shortcut-unavailable");
  emit({ id: "w3", phase: "recording", region });
  emit({ id: "w3", phase: "stopped", elapsed_s: 1800, reason: "max-duration" });
  emit({ id: "w3", phase: "recording", level: 0.2 });
  expect(store.getSnapshot().walk).toMatchObject({ phase: "stopped", notice: expect.stringContaining("30-minute") });
});

it("carries launched/total and session_ids through state events", () => {
  const store = createBugWalk(vi.fn() as never, vi.fn() as never);
  store.seed({ id: "w1", startedAt: 0 });
  store.applyState({ id: "w1", phase: "launching", launched: 1, total: 3 });
  expect(store.getSnapshot().walk).toMatchObject({ phase: "launching", launched: 1, total: 3 });
  store.applyState({ id: "w1", phase: "done", session_id: "s1", session_ids: ["s1", "s2", "s3"] });
  expect(store.getSnapshot().walk).toMatchObject({ phase: "done", sessionId: "s1", sessionIds: ["s1", "s2", "s3"] });
});
