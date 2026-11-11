import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
import { createBugWalk, type BugWalk } from "./bugWalk";
import { ProgressCard } from "./ProgressCard";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const walk = (over: Partial<BugWalk>): BugWalk => ({ id: "w1", phase: "transcribing", elapsed: 5, startedAt: null, level: 0, ...over });
const opts = { project: "p", account: "a", permission_mode: "ask" as const, reply_to_thread: "t1" };

it("marks finished, active and pending steps", () => {
  render(<ProgressCard walk={walk({ phase: "framing" })} />);
  const steps = screen.getAllByRole("listitem");
  expect(steps.map(s => s.getAttribute("data-step"))).toEqual(["done", "done", "active", "todo"]);
  expect(screen.getByText("Grabbing frames")).toBeTruthy();
});
it("offers Open thread when done and auto-dismisses after 10 seconds", async () => {
  vi.useFakeTimers();
  const store = createBugWalk(vi.fn() as never, vi.fn() as never);
  store.seed({ id: "w1", startedAt: 0 });
  store.applyState({ id: "w1", phase: "done", session_id: "s9" });
  const onOpen = vi.fn();
  render(<ProgressCard walk={store.getSnapshot().walk!} store={store} onOpenThread={onOpen} />);
  act(() => { screen.getByRole("button", { name: "Open thread" }).click(); });
  expect(onOpen).toHaveBeenCalledWith("s9");
  expect(store.getSnapshot().walk).toBeNull();
  store.seed({ id: "w2", startedAt: 0 });
  store.applyState({ id: "w2", phase: "done", session_id: "s10" });
  render(<ProgressCard walk={store.getSnapshot().walk!} store={store} />);
  act(() => { vi.advanceTimersByTime(9_900); });
  expect(store.getSnapshot().walk).not.toBeNull();
  act(() => { vi.advanceTimersByTime(200); });
  expect(store.getSnapshot().walk).toBeNull();
});
it("shows Starting thread n/m while launching several threads", () => {
  render(<ProgressCard walk={walk({ phase: "launching", launched: 2, total: 5 })} />);
  expect(screen.getByText("Starting thread 3/5")).toBeTruthy();
  cleanup();
  render(<ProgressCard walk={walk({ phase: "launching", launched: 0, total: 1 })} />);
  expect(screen.getByText("Starting thread")).toBeTruthy();
});
it("offers Open first thread and a count when several threads were started", () => {
  const store = createBugWalk(vi.fn() as never, vi.fn() as never);
  store.seed({ id: "w1", startedAt: 0 });
  store.applyState({ id: "w1", phase: "done", session_id: "s1", session_ids: ["s1", "s2", "s3"] });
  const onOpen = vi.fn();
  render(<ProgressCard walk={store.getSnapshot().walk!} store={store} onOpenThread={onOpen} />);
  expect(screen.getByText("3 threads started")).toBeTruthy();
  act(() => { screen.getByRole("button", { name: "Open first thread" }).click(); });
  expect(onOpen).toHaveBeenCalledWith("s1");
});
it("on error shows the transcript and sends it as is with the same options", async () => {
  const call = vi.fn().mockResolvedValue(undefined);
  const store = createBugWalk(call as never, vi.fn() as never);
  store.seed({ id: "w1", startedAt: 0 });
  await store.send(opts);
  store.applyState({ id: "w1", phase: "error", error: "Analysis returned non-JSON", transcript: "the save button is dead" });
  render(<ProgressCard walk={store.getSnapshot().walk!} store={store} />);
  expect(screen.getByRole("alert").textContent).toContain("Analysis returned non-JSON");
  expect(screen.getByText("the save button is dead")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Send transcript as is" }));
  expect(call).toHaveBeenLastCalledWith("bug_walk_send_transcript", { id: "w1", opts: { ...opts, split: "single" } });
});
it("Discard cancels the walk", async () => {
  const call = vi.fn().mockResolvedValue(undefined);
  const store = createBugWalk(call as never, vi.fn() as never);
  store.seed({ id: "w1", startedAt: 0 });
  store.applyState({ id: "w1", phase: "error", error: "boom" });
  render(<ProgressCard walk={store.getSnapshot().walk!} store={store} />);
  await userEvent.click(screen.getByRole("button", { name: "Discard" }));
  expect(call).toHaveBeenCalledWith("bug_walk_cancel", { id: "w1" });
  expect(store.getSnapshot().walk).toBeNull();
});
