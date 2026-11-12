import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { empty } from "./types";
import { DesktopApp } from "./DesktopApp";

const fixture = vi.hoisted(() => ({ count: 20, commander: true, hostPending: false }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn(async (command: string) => {
  if (command === "snapshot_since") return { ...empty, full: true, revision: 1, host_update_pending: fixture.hostPending,
    projects: [...(fixture.commander ? [{ id: "cmd", name: "Commander", path: "/fixture/cmd", kind: "commander", color: "#888", policy: "inherit", account: null, last: null }] : []), ...["Alpha", "Beta"].map(id => ({ id, name: `${id} project`, path: `/fixture/${id}`, color: "#888", policy: "inherit", account: null, last: null }))],
    sessions: [
      ...(fixture.commander ? [
        { id: 'cmd-main', title: 'Commander main chat', project: 'cmd', account: '', status: 'running', updated: 99999, messages: [] },
        { id: 'delegated', title: 'Hidden delegated work', project: 'Alpha', origin: { kind: 'commander' }, account: '', status: 'running', updated: 99998, messages: [] },
      ] : []),
      ...Array.from({ length: fixture.count }, (_, i) => ({ id: `t${i}`, title: `Thread ${String(i).padStart(2, "0")}`, project: i % 2 ? "Alpha" : "Beta", account: "", status: "done", updated: 100 + i, messages: [], pending: null, error: null })),
      ...(fixture.hostPending ? [{ id: "intr", title: "Interrupted thread", project: "Alpha", account: "", status: "interrupted", updated: 9998, messages: [], pending: null, error: null }] : []),
      ...(fixture.count ? [{ id: "gone", title: "Archived thread", project: "Alpha", account: "", status: "archived", archived: true, updated: 9999, messages: [], pending: null, error: null }] : []),
    ] };
  if (command === "updater_state") return { state: "idle" };
  return null;
}) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onDragDropEvent: vi.fn(async () => () => {}) }) }));
vi.mock("./Dormouse", () => ({ Dormouse: () => null }));
beforeEach(() => {
  vi.stubGlobal("PointerEvent", MouseEvent);

  localStorage.clear(); fixture.count = 20; fixture.commander = true; fixture.hostPending = false;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });


it("offers Delete in an existing conversation header and opens confirmation without deleting", async () => {
  render(<DesktopApp />);
  await userEvent.click(await within(screen.getByLabelText("Thread list")).findByText("Thread 19"));
  fireEvent.keyDown(await screen.findByRole("button", { name: "Thread actions" }), { key: "ArrowDown" });
  await userEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }));
  expect(await screen.findByRole("dialog", { name: "Delete thread" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Delete permanently" })).toBeTruthy();
});

it("returns to the dashboard after deleting a conversation", async () => {
  render(<DesktopApp />);
  await userEvent.click(await within(screen.getByLabelText("Thread list")).findByText("Thread 19"));
  fireEvent.keyDown(await screen.findByRole("button", { name: "Thread actions" }), { key: "ArrowDown" });
  await userEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }));
  await userEvent.click(await screen.findByRole("button", { name: "Delete permanently" }));
  await waitFor(() => expect(document.querySelector(".home-pane")).toBeTruthy());
});

it("keeps Delete enabled in the header for an interrupted thread while a host update is pending", async () => {
  fixture.hostPending = true;
  render(<DesktopApp />);
  await userEvent.click(await within(screen.getByLabelText("Thread list")).findByText("Interrupted thread"));
  fireEvent.keyDown(await screen.findByRole("button", { name: "Thread actions" }), { key: "ArrowDown" });
  const item = await screen.findByRole("menuitem", { name: "Delete…" });
  expect(item.getAttribute("aria-disabled")).not.toBe("true");
  expect(item.hasAttribute("data-disabled")).toBe(false);
});
