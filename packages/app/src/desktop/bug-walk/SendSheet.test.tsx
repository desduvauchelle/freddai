import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
import { createBugWalk, type BugWalk } from "./bugWalk";
import { SendSheet, buildSendOpts } from "./SendSheet";
import { createVoice } from "../voice";
import type { Database } from "../types";

afterEach(cleanup);
const db: Pick<Database, "accounts" | "projects" | "sessions" | "preferences"> = {
  accounts: [{ id: "a1", name: "Work", provider: "claude", color: "#fff" }, { id: "a2", name: "Home", provider: "codex", color: "#000" }],
  projects: [{ id: "p1", name: "Alpha", path: "/a", color: "#fff", policy: "inherit", account: null, last: null }, { id: "p2", name: "Beta", path: "/b", color: "#fff", policy: "inherit", account: null, last: null }],
  sessions: [{ id: "t1", project: "p2", account: "a2", title: "Fix header", status: "done", updated: 1, provider_id: null, pending: null, error: null, messages: [], options: { permission_mode: "ask", model: "gpt-x", effort: "high" } }],
  preferences: { prefer_last: false, fallback: "a1", last: null },
};
const walk = (over: Partial<BugWalk> = {}): BugWalk => ({ id: "w1", phase: "stopped", elapsed: 83, startedAt: null, level: 0, region: { x: 0, y: 0, width: 640, height: 400, scale: 2 }, ...over });
const voiceWith = (installed: boolean) => {
  const status = { enabled: true, activeModel: null, shortcut: "AltRight", language: "auto", removeFillerWords: true, ready: false, recording: false, models: [{ id: "m", name: "Base", description: "", languageLabel: "", sizeBytes: 1, recommended: true, installed, download: null }] };
  return createVoice((async () => status) as never);
};
async function setup(w: BugWalk, installed = true) {
  const call = vi.fn().mockResolvedValue(undefined);
  const store = createBugWalk(call as never, vi.fn() as never);
  store.seed({ id: "w1", startedAt: 0, phase: "stopped" });
  const voiceController = voiceWith(installed);
  const onOpenVoiceSettings = vi.fn();
  render(<SendSheet walk={w} db={db} store={store} voiceController={voiceController} defaultPermission="bypass" onOpenVoiceSettings={onOpenVoiceSettings} />);
  await vi.waitFor(() => expect(voiceController.getSnapshot().status).not.toBeNull());
  return { call, store, onOpenVoiceSettings };
}

it("disables Send until a voice model is installed and links to Voice settings", async () => {
  const { onOpenVoiceSettings } = await setup(walk(), false);
  expect((await screen.findByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain("Download a voice model first");
  await userEvent.click(screen.getByRole("button", { name: "Open Voice settings" }));
  expect(onOpenVoiceSettings).toHaveBeenCalled();
});
it("sends the chosen opts for a new thread", async () => {
  const { call } = await setup(walk());
  expect(screen.getByText(/01:23 recorded · 1280×800 px/)).toBeTruthy();
  await userEvent.selectOptions(screen.getByLabelText("Project"), "p2");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(call).toHaveBeenCalledWith("bug_walk_send", { id: "w1", opts: { project: "p2", account: "a1", model: null, effort: null, speed: null, permission_mode: "bypass", split: "single" } });
});
it("preselects project, agent and reply_to_thread from a thread origin", async () => {
  const { call } = await setup(walk({ origin: { thread: "t1", project: "p2" } }));
  expect((screen.getByLabelText("Project") as HTMLSelectElement).value).toBe("p2");
  await userEvent.click(screen.getByRole('button', {name:'Assistant and difficulty'}));
  expect(screen.queryByRole('button', {name:'Claude · Work'})).toBeNull();
  expect(screen.getByRole('button', {name:'Codex · Home'})).toBeTruthy();
  await userEvent.click(screen.getByRole('button', {name:'Close'}));
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(call).toHaveBeenCalledWith("bug_walk_send", { id: "w1", opts: { project: "p2", account: "a2", model: "gpt-x", effort: "high", speed: null, permission_mode: "ask", split: "single", reply_to_thread: "t1" } });
});
it("sends the Threads choice and defaults it from last_split", async () => {
  const call = vi.fn(async (cmd: string) => cmd === "bug_walk_settings_get" ? { shortcut: "x", enabled: true, last_split: "per_item" } : undefined);
  const store = createBugWalk(call as never, vi.fn() as never);
  store.seed({ id: "w1", startedAt: 0, phase: "stopped" });
  const voiceController = voiceWith(true);
  render(<SendSheet walk={walk()} db={db} store={store} voiceController={voiceController} />);
  await vi.waitFor(() => expect(voiceController.getSnapshot().status).not.toBeNull());
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "One per bug" }).getAttribute("aria-pressed")).toBe("true"));
  await userEvent.click(screen.getByRole("button", { name: "One thread" }));
  await userEvent.click(screen.getByRole("button", { name: "One per bug" }));
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(call).toHaveBeenCalledWith("bug_walk_send", { id: "w1", opts: expect.objectContaining({ split: "per_item" }) });
});
it("hides the Threads toggle when started from a thread", async () => {
  await setup(walk({ origin: { thread: "t1", project: "p2" } }));
  expect(screen.queryByRole("group", { name: "Threads" })).toBeNull();
  expect(screen.queryByRole("button", { name: "One per bug" })).toBeNull();
});
it("Cancel discards the recording", async () => {
  const { call, store } = await setup(walk());
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(call).toHaveBeenCalledWith("bug_walk_cancel", { id: "w1" });
});
it("buildSendOpts drops effort and permissions for providers that ignore them", () => {
  expect(buildSendOpts({ project: "p", account: "a", provider: "gemini", selection: { model: " m ", effort: "high" }, permission: "bypass" }))
    .toEqual({ project: "p", account: "a", model: "m", effort: null, speed: null, permission_mode: "ask", split: "single" });
});
