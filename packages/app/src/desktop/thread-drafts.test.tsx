import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (name, handler, options) => {
  if (name === "tauri://drag-drop") {
    const callback: NonNullable<typeof nativeDrops.raw> = (target, payload) => {
      if (options?.target?.kind === "AnyLabel" && options.target.label === target.label) handler({ payload });
    };
    nativeDrops.raw = callback;
    return () => { if (nativeDrops.raw === callback) nativeDrops.raw = null; };
  }
  return () => {};
}) }));
const nativeDrops = vi.hoisted(() => ({ raw: null as null | ((target: { kind: string; label: string }, payload: { paths: string[]; position: { x: number; y: number } }) => void) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
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
  await waitFor(() => expect(nativeDrops.raw).toBeTypeOf("function"));
  await act(async () => nativeDrops.raw?.({ kind: "Window", label: "main" }, { paths: ["/fixture/notes.txt"], position: { x: 800, y: 600 } }));
  expect(screen.queryByText("notes.txt")).toBeTruthy();
  expect((screen.getByRole("textbox", { name: "Message agent" }) as HTMLTextAreaElement).value).toBe("Next draft");
  fireEvent.click(screen.getByText("Beta"));
  expect(screen.queryByText("notes.txt")).toBeNull();
  fireEvent.click(screen.getByText("Alpha"));
  expect(screen.getByText("notes.txt")).toBeTruthy();
});

it("accepts webview-routed Finder drops into the conversation draft", async () => {
  render(<DesktopApp />);
  fireEvent.click(await screen.findByText("Alpha"));
  await waitFor(() => expect(nativeDrops.raw).toBeTypeOf("function"));
  await act(async () => nativeDrops.raw?.({ kind: "Webview", label: "main" }, { paths: ["/fixture/notes.txt"], position: { x: 800, y: 600 } }));
  expect(screen.queryByText("notes.txt")).toBeTruthy();
});

it("ignores drops intended for a separate conversation window", async () => {
  render(<DesktopApp />);
  fireEvent.click(await screen.findByText("Alpha"));
  await waitFor(() => expect(nativeDrops.raw).toBeTypeOf("function"));
  await act(async () => nativeDrops.raw?.({ kind: "Webview", label: "thread-other" }, { paths: ["/fixture/notes.txt"], position: { x: 800, y: 600 } }));
  expect(screen.queryByText("notes.txt")).toBeNull();
});

it("accepts webview drops into the new-thread draft", async () => {
  render(<DesktopApp />);
  await screen.findByText("Alpha");
  fireEvent.click(screen.getByRole("button", { name: "New thread" }));
  await waitFor(() => expect(nativeDrops.raw).toBeTypeOf("function"));
  await act(async () => nativeDrops.raw?.({ kind: "Webview", label: "main" }, { paths: ["/fixture/notes.txt"], position: { x: 800, y: 600 } }));
  expect(screen.queryByText("notes.txt")).toBeTruthy();
});
