import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { empty } from "./types";
import { DesktopApp } from "./DesktopApp";
import { resetDrafts } from "./drafts";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn(async (command: string) => {
  if (command === "snapshot_since") return { ...empty, full: true, revision: 1, sessions: ["Alpha", "Beta"].map(title => ({ id: title, title, project: "", account: "", status: "idle", updated: 1, messages: [], pending: null, error: null })) };
  if (command === "stage_attachments") return [{ id: "draft-file", name: "notes.txt", bytes: 12, mime: "text/plain", sha256: "fixture" }];
  if (command === "updater_state") return { state: "idle" };
  return null;
}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => ["/fixture/notes.txt"]) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: vi.fn(async () => () => {}) }) }));
vi.mock("./Dormouse", () => ({ Dormouse: () => null }));
beforeEach(() => {
  localStorage.clear(); resetDrafts();
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
