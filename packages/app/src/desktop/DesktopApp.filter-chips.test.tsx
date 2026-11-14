import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { empty } from "./types";
import { DesktopApp } from "./DesktopApp";

const fixture = vi.hoisted(() => ({ count: 20, commander: true }));
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
  localStorage.clear(); fixture.count = 20; fixture.commander = true;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });


async function choose(filter: string, option: string) {
  await userEvent.click(screen.getByRole("combobox", { name: filter }));
  fireEvent.keyDown(await screen.findByRole("option", { name: option }), { key: "Enter" });
  await waitFor(() => expect(screen.queryAllByRole("listbox")).toHaveLength(0));
}
const chipKinds = () => within(screen.getByRole("list", { name: "Active filters" })).getAllByRole("listitem").map(li => li.getAttribute("data-kind"));
const projectHeadings = () => within(screen.getByRole("region", { name: "Home" })).queryAllByRole("button", { name: /^Reorder (Alpha|Beta) project$/ }).map(e => e.getAttribute("aria-label"));

it("shows one removable chip per active filter, only while active, and clears just that filter", async () => {
  render(<DesktopApp />);
  await within(screen.getByLabelText("Thread list")).findByText("Thread 19");
  expect(screen.queryByRole("list", { name: "Active filters" })).toBeNull();
  await choose("Project filter", "Alpha project");
  await choose("Status filter", "Finished");
  expect(chipKinds()).toEqual(["project", "status"]);
  fireEvent.click(screen.getByRole("button", { name: "Remove status filter Finished" }));
  expect(chipKinds()).toEqual(["project"]);
  expect(screen.getByRole("combobox", { name: "Status filter" }).textContent).toContain("All threads");
  fireEvent.click(screen.getByRole("button", { name: "Remove project filter Alpha project" }));
  expect(screen.queryByRole("list", { name: "Active filters" })).toBeNull();
});

it("keeps Dashboard and Commander links, and the dashboard project list, independent of sidebar filters", async () => {
  render(<DesktopApp />);
  await within(screen.getByLabelText("Thread list")).findByText("Thread 19");
  fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
  const before = projectHeadings();
  expect(before.join(" ")).toContain("Alpha project");
  expect(before.join(" ")).toContain("Beta project");
  await choose("Project filter", "Alpha project");
  await choose("Status filter", "Running");
  fireEvent.change(screen.getByRole("textbox", { name: "Search threads" }), { target: { value: "zzz-no-match" } });
  expect(screen.getAllByRole("button", { name: "Open Commander" }).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "Dashboard" })).toBeTruthy();
  expect(projectHeadings()).toEqual(before);
});
