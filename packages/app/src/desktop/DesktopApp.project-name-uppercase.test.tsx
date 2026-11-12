import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { empty } from "./types";
import { DesktopApp } from "./DesktopApp";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onDragDropEvent: vi.fn(async () => () => {}) }) }));
vi.mock("./Dormouse", () => ({ Dormouse: () => null }));
beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "snapshot_since") return { ...empty, full: true, revision: 1,
      projects: [{ id: "Alpha", name: "Alpha project", path: "/fixture/Alpha", color: "#888", policy: "inherit", account: null, last: null }],
      sessions: [{ id: "t1", title: "Thread one", project: "Alpha", account: "", status: "done", updated: 100, messages: [], pending: null, error: null }] };
    if (command === "updater_state") return { state: "idle" };
    return null;
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("Uppercase project names switch uppercases project headers and persists to Rust", async () => {
  const view = render(<DesktopApp />);
  expect((await screen.findAllByText("Alpha project")).length).toBeGreaterThan(0);
  fireEvent.keyDown(window, { key: ",", ctrlKey: true });
  fireEvent.click(await screen.findByRole("button", { name: /Thread display/ }));
  fireEvent.click(await screen.findByRole("switch", { name: "Uppercase project names" }));
  expect((await screen.findAllByText("ALPHA PROJECT")).length).toBeGreaterThan(0);
  expect(localStorage.getItem("freddai.projectNameUppercase")).toBe("true");
  await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("save_thread_list", { settings: expect.objectContaining({ projectNameUppercase: true }) }));
  expect(invokeMock.mock.calls.some(([command]) => /rename_project|update_project/.test(command))).toBe(false);
  view.unmount();
  render(<DesktopApp />);
  expect((await screen.findAllByText("ALPHA PROJECT")).length).toBeGreaterThan(0);
  fireEvent.keyDown(window, { key: ",", ctrlKey: true });
  fireEvent.click(await screen.findByRole("button", { name: /Thread display/ }));
  fireEvent.click(await screen.findByRole("switch", { name: "Uppercase project names" }));
  expect((await screen.findAllByText("Alpha project")).length).toBeGreaterThan(0);
  expect(localStorage.getItem("freddai.projectNameUppercase")).toBe("false");
  await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("save_thread_list", { settings: expect.objectContaining({ projectNameUppercase: false }) }));
});
