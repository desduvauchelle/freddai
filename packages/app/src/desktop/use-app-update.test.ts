import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const { invoke, listen, handlers, stop } = vi.hoisted(() => ({
  invoke: vi.fn(), listen: vi.fn(), handlers: new Map<string, () => void>(), stop: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));
import { useAppUpdate } from "./use-app-update";

beforeEach(() => {
  vi.clearAllMocks(); handlers.clear();
  invoke.mockResolvedValue({ state: "idle" });
  listen.mockImplementation(async (name: string, handler: () => void) => {
    handlers.set(name, handler);
    return stop;
  });
});

it("runs a manual check from the native menu and displays up-to-date feedback", async () => {
  const { result, unmount } = renderHook(() => useAppUpdate(true, vi.fn()));
  await waitFor(() => expect(handlers.has("updater://check-requested")).toBe(true));
  await act(async () => { handlers.get("updater://check-requested")!(); });
  expect(invoke).toHaveBeenCalledWith("check_for_updates");
  expect(result.current.notice).toBe("Freddai is up to date.");
  unmount();
  expect(stop).toHaveBeenCalledTimes(2);
});

it("does not register native menu listeners in the browser", () => {
  renderHook(() => useAppUpdate(false, vi.fn()));
  expect(listen).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
});
