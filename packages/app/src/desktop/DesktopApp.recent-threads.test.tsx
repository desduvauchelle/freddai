import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { empty } from "./types";
import { DesktopApp } from "./DesktopApp";

const fixture = vi.hoisted(() => ({ count: 20, commander: false }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn(async (command: string) => {
  if (command === "snapshot_since") return { ...empty, full: true, revision: 1,
    projects: [...(fixture.commander ? [{ id: "cmd", name: "Commander", path: "/fixture/cmd", kind: "commander", color: "#888", policy: "inherit", account: null, last: null }] : []), ...["Alpha", "Beta"].map(id => ({ id, name: `${id} project`, path: `/fixture/${id}`, color: "#888", policy: "inherit", account: null, last: null }))],
    sessions: [
      ...(fixture.commander ? [
        { id: 'cmd-main', title: 'Commander main chat', project: 'cmd', account: '', status: 'running', updated: 99999, messages: [] },
        { id: 'delegated', title: 'Hidden delegated work', project: 'Alpha', origin: { kind: 'commander' }, account: '', status: 'running', updated: 99998, messages: [] },
      ] : []),
      ...Array.from({ length: fixture.count }, (_, i) => ({ id: `t${i}`, title: `Thread ${String(i).padStart(2, "0")}`, project: i % 2 ? "Alpha" : "Beta", account: "", status: "done", updated: 100 + i, messages: [], pending: null, error: null })),
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
  localStorage.clear(); fixture.count = 20; fixture.commander = false;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const rows = () => within(document.querySelector<HTMLElement>('[aria-label="Thread list"]')!).queryAllByText(/^Thread \d\d$/).map(e => e.textContent);
const toggle = (name: string) => fireEvent.click(within(screen.getByRole("group", { name: "Thread view" })).getByRole("button", { name: `${name} view` }));

it("defaults to Projects and the Recent toggle shows the five newest threads across projects with project tags", async () => {
  render(<DesktopApp />);
  await screen.findByText("Thread 19");
  const group = screen.getByRole("group", { name: "Thread view" });
  expect(within(group).getByRole("button", { name: "Projects view" }).getAttribute("aria-pressed")).toBe("true");
  toggle("Recent");
  expect(rows()).toEqual(["Thread 19", "Thread 18", "Thread 17", "Thread 16", "Thread 15"]);
  expect(screen.queryByText("Archived thread")).toBeNull();
  expect(screen.getAllByText(/^(Alpha|Beta) project$/).length).toBeGreaterThanOrEqual(5);
  expect(localStorage.getItem("freddai.threadNavView")).toBe('"recent"');
});

it("Show more reveals ten more per click and Show less collapses back to five", async () => {
  render(<DesktopApp />);
  await screen.findByText("Thread 19");
  toggle("Recent");
  fireEvent.click(screen.getByRole("button", { name: "Show more" }));
  expect(rows()).toHaveLength(15);
  fireEvent.click(screen.getByRole("button", { name: "Show more" }));
  expect(rows()).toHaveLength(20);
  expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show less" }));
  // Departing rows linger briefly for their exit animation.
  await waitFor(() => expect(rows()).toHaveLength(5));
  expect(screen.getByRole("button", { name: "Show more" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Show less" })).toBeNull();
});

it("restores the saved view and opens a thread from a Recent row", async () => {
  localStorage.setItem("freddai.threadNavView", '"recent"');
  render(<DesktopApp />);
  await screen.findByText("Thread 19");
  expect(within(screen.getByRole("group", { name: "Thread view" })).getByRole("button", { name: "Recent view" }).getAttribute("aria-pressed")).toBe("true");
  const row = screen.getByText("Thread 17").closest(".task-row")!;
  fireEvent.click(row);
  expect(row.getAttribute("aria-current")).toBe("true");
});

it("shows an empty state when there are no recent threads", async () => {
  fixture.count = 0;
  localStorage.setItem("freddai.threadNavView", '"recent"');
  render(<DesktopApp />);
  expect(await screen.findByText("No recent threads")).toBeTruthy();
});

it('shows one Commander entry and hides its conversations and delegated work in Projects and Recent', async () => {
  fixture.commander = true;
  render(<DesktopApp />);
  await screen.findByText('Thread 19');
  expect(within(screen.getByRole('region', { name: 'Commander threads' })).getByRole('button', { name: 'Open Commander' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'New task in Commander' })).toBeNull();
  expect(screen.queryByText('Commander main chat')).toBeNull();
  expect(screen.queryByText('Hidden delegated work')).toBeNull();
  toggle('Recent');
  expect(screen.queryByText('Commander main chat')).toBeNull();
  expect(screen.queryByText('Hidden delegated work')).toBeNull();
});
