import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
import { createBugWalk } from "./bugWalk";
import { RecordingCard } from "./RecordingCard";

afterEach(() => { cleanup(); vi.useRealTimers(); });
function setup() {
  const call = vi.fn().mockResolvedValue({ id: "w1", duration_s: 3 });
  const store = createBugWalk(call as never, vi.fn() as never);
  store.applyState({ id: "w1", phase: "recording", elapsed_s: 0, level: 0.5 });
  return { call, store };
}
it("ticks every second from the recording start", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(1_000_000));
  const { store } = setup();
  render(<RecordingCard walk={store.getSnapshot().walk!} store={store} />);
  expect(screen.getByText("00:00")).toBeTruthy();
  act(() => { vi.advanceTimersByTime(65_000); });
  expect(screen.getByText("01:05")).toBeTruthy();
});
it("Stop invokes bug_walk_stop", () => {
  const { store, call } = setup();
  render(<RecordingCard walk={store.getSnapshot().walk!} store={store} />);
  act(() => { screen.getByRole("button", { name: /Stop/ }).click(); });
  expect(call).toHaveBeenCalledWith("bug_walk_stop", { id: "w1" });
});
it("Cancel asks inline first, No keeps recording, Yes discards", () => {
  const { store, call } = setup();
  render(<RecordingCard walk={store.getSnapshot().walk!} store={store} />);
  act(() => { screen.getByRole("button", { name: "Cancel" }).click(); });
  expect(screen.getByText("Discard recording?")).toBeTruthy();
  expect(call).not.toHaveBeenCalled();
  act(() => { screen.getByRole("button", { name: "No" }).click(); });
  expect(screen.queryByText("Discard recording?")).toBeNull();
  act(() => { screen.getByRole("button", { name: "Cancel" }).click(); });
  act(() => { screen.getByRole("button", { name: "Yes" }).click(); });
  expect(call).toHaveBeenCalledWith("bug_walk_cancel", { id: "w1" });
});
it("shows the region hint while selecting", () => {
  const store = createBugWalk(vi.fn() as never, vi.fn() as never);
  store.applyState({ id: "w1", phase: "selecting" });
  render(<RecordingCard walk={store.getSnapshot().walk!} store={store} />);
  expect(screen.getByText(/Drag a region on screen/)).toBeTruthy();
});
