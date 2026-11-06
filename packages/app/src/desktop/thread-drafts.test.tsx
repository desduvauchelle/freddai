import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { empty } from "./types";
import { DesktopApp } from "./DesktopApp";
import { resetDrafts } from "./drafts";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn(async (command: string) => {
  if (command === "snapshot_since") return { ...empty, full: true, revision: 1, projects: ["One", "Two"].map(id => ({ id, name: id, path: `/fixture/${id}`, color: "#888", policy: "inherit", account: null, last: null })), sessions: ["Alpha", "Beta"].map(title => ({ id: title, title, project: "", account: "", status: title === "Alpha" ? "running" : "idle", updated: 1, messages: [], pending: null, error: null })) };
  if (command === "stage_attachments") return [{ id: "draft-file", name: "notes.txt", bytes: 12, mime: "text/plain", sha256: "fixture" }];
  if (command === "updater_state") return { state: "idle" };
  return null;
}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => ["/fixture/notes.txt"]) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
const nativeDrops = vi.hoisted(() => ({ window: null as null | ((event: { payload: { type: string; paths: string[]; position: { x: number; y: number } } }) => void) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onDragDropEvent: vi.fn(async (handler) => { nativeDrops.window = handler; return () => { nativeDrops.window = null; }; }) }) }));
vi.mock("./Dormouse", () => ({ Dormouse: () => null }));
beforeEach(() => {
  localStorage.clear(); resetDrafts();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); resetDrafts(); vi.unstubAllGlobals(); });
it("keeps independent reply drafts when switching threads and visiting Home", async () => {
  render(<DesktopApp />);
  fireEvent.click(await screen.findByText("Alpha"));
  fireEvent.change(screen.getByRole("textbox", { name: "Message agent" }), { target: { value: "Unsent Alpha" } });
  fireEvent.click(screen.getByRole("button", { name: "Attach files" }));
  await screen.findByText("notes.txt");
  fireEvent.click(screen.getByText("Beta"));
  expect(screen.queryByText("notes.txt")).toBeNull();
  expect((screen.getByRole("textbox", { name: "Message agent" }) as HTMLTextAreaElement).value).toBe("");
  fireEvent.change(screen.getByRole("textbox", { name: "Message agent" }), { target: { value: "Unsent Beta" } });
  fireEvent.click(screen.getByText("Alpha"));
  expect((screen.getByRole("textbox", { name: "Message agent" }) as HTMLTextAreaElement).value).toBe("Unsent Alpha");
  expect(screen.getByText("notes.txt")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
  fireEvent.click(screen.getByText("Beta"));
  expect((screen.getByRole("textbox", { name: "Message agent" }) as HTMLTextAreaElement).value).toBe("Unsent Beta");
});

it("keeps new-thread text scoped to the selected project and global context", async () => {
  render(<DesktopApp />);
  await screen.findByText("Alpha");
  fireEvent.click(screen.getByRole("button", { name: "New thread" }));
  const editor = () => screen.getByRole("textbox", { name: "Task prompt" }) as HTMLTextAreaElement;
  fireEvent.change(editor(), { target: { value: "Global prompt" } });
  fireEvent.click(screen.getByRole("combobox", { name: "Project" }));
  fireEvent.click(screen.getByRole("option", { name: "One" }));
  expect(editor().value).toBe("");
  fireEvent.change(editor(), { target: { value: "Project One prompt" } });
  fireEvent.click(screen.getByRole("combobox", { name: "Project" }));
  fireEvent.click(screen.getByRole("option", { name: "Two" }));
  expect(editor().value).toBe("");
  fireEvent.change(editor(), { target: { value: "Project Two prompt" } });
  fireEvent.click(screen.getByText("Alpha"));
  fireEvent.click(screen.getByRole("button", { name: "New thread" }));
  expect(editor().value).toBe("Global prompt");
  fireEvent.click(screen.getByRole("combobox", { name: "Project" }));
  fireEvent.click(screen.getByRole("option", { name: "One" }));
  expect(editor().value).toBe("Project One prompt");
  fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
  fireEvent.click(screen.getByRole("button", { name: "New thread in One" }));
  expect((screen.getByLabelText("Prompt for One") as HTMLInputElement).value).toBe("Project One prompt");
});

it("accepts window-routed file drops into a running thread's next draft after the browser has been opened", async () => {
  render(<DesktopApp />);
  fireEvent.click(await screen.findByText("Alpha"));
  fireEvent.change(screen.getByRole("textbox", { name: "Message agent" }), { target: { value: "Next draft" } });
  // Tauri routes main-content drops to Window when a child browser webview exists.
  await act(async () => nativeDrops.window?.({ payload: { type: "drop", paths: ["/fixture/notes.txt"], position: { x: 800, y: 600 } } }));
  expect(screen.queryByText("notes.txt")).toBeTruthy();
  expect((screen.getByRole("textbox", { name: "Message agent" }) as HTMLTextAreaElement).value).toBe("Next draft");
  fireEvent.click(screen.getByText("Beta"));
  expect(screen.queryByText("notes.txt")).toBeNull();
  fireEvent.click(screen.getByText("Alpha"));
  expect(screen.getByText("notes.txt")).toBeTruthy();
});
