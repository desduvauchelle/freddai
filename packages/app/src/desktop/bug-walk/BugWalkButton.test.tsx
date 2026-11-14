import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
import { createBugWalk } from "./bugWalk";
import { BugWalkButton } from "./BugWalkButton";

afterEach(() => { cleanup(); });
it("opens a Zone / App choice and starts in the chosen mode", async () => {
  const call = vi.fn().mockResolvedValue({ id: "w1" });
  const store = createBugWalk(call as never, vi.fn() as never);
  render(<BugWalkButton origin={{ project: "p1" }} store={store} />);
  const trigger = screen.getByRole("button", { name: "Bug walk" });
  expect(call).not.toHaveBeenCalled();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const items = await screen.findAllByRole("menuitem");
  expect(items.map(i => i.textContent)).toEqual(["ZoneDrag a region of the screen", "AppClick an app window to record it"]);
  await userEvent.click(screen.getByRole("menuitem", { name: /App/ }));
  expect(call).toHaveBeenCalledWith("bug_walk_start", { origin: { project: "p1" }, mode: "app" });
});
it("Esc closes the choice without starting", async () => {
  const call = vi.fn();
  const store = createBugWalk(call as never, vi.fn() as never);
  render(<BugWalkButton store={store} />);
  fireEvent.keyDown(screen.getByRole("button", { name: "Bug walk" }), { key: "ArrowDown" });
  await screen.findAllByRole("menuitem");
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("menuitem")).toBeNull();
  expect(call).not.toHaveBeenCalled();
});
it("is a plain disabled button while a walk is running", () => {
  const store = createBugWalk(vi.fn() as never, vi.fn() as never);
  store.applyState({ id: "w1", phase: "recording" });
  render(<BugWalkButton store={store} />);
  expect((screen.getByRole("button", { name: "Bug walk" }) as HTMLButtonElement).disabled).toBe(true);
});
