import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class { static getByLabel = vi.fn().mockResolvedValue(null); constructor() { throw new Error("not allowed: webview.create_webview_window"); } },
}));
import { createBugWalk } from "./bugWalk";
import { BugWalkHost } from "./BugWalkHost";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("shows the recording card and a loud banner when the pill window cannot be created", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const store = createBugWalk(vi.fn().mockResolvedValue([]) as never, vi.fn().mockResolvedValue(() => {}) as never);
  render(<BugWalkHost enabled db={{ accounts: [], projects: [], sessions: [], preferences: {} } as never} defaultPermission={"ask" as never} onOpenThread={() => {}} onOpenVoiceSettings={() => {}} store={store} />);
  await act(async () => { store.applyState({ id: "w1", phase: "recording", elapsed_s: 0, region: { x: 100, y: 100, width: 300, height: 200, scale: 2 } }); });
  expect(screen.getByText("Recording bug walk")).toBeTruthy();
  const banner = await screen.findByText(/Floating Stop button unavailable: not allowed/);
  expect(banner.getAttribute("role")).toBe("alert");
  expect(err).toHaveBeenCalledWith("[bug-walk] pill failed", expect.any(Error));
});
