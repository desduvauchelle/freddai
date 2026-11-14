import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { apps, currentAppId, openApp } from "./registry";

describe("app registry", () => {
  beforeEach(() => { invoke.mockReset(); invoke.mockResolvedValue(undefined); });

  it("lists Freddai, Scout and Tucky (soon)", () => {
    expect(apps.map(a => [a.id, a.status])).toEqual([["freddai", "ready"], ["scout", "ready"], ["tucky", "soon"]]);
  });

  it("opens Scout in its own window", async () => {
    await openApp("scout");
    expect(invoke).toHaveBeenCalledWith("open_app_window", { id: "scout" });
  });

  it("focuses the main window for Freddai", async () => {
    await openApp("freddai");
    expect(invoke).toHaveBeenCalledWith("focus_main_window");
  });

  it("refuses apps that are not available yet", async () => {
    await expect(openApp("tucky")).rejects.toThrow("Tucky is not available yet");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("propagates invoke failures", async () => {
    invoke.mockRejectedValueOnce("window failed");
    await expect(openApp("scout")).rejects.toBe("window failed");
  });

  it("reads the current app from ?app=", () => {
    window.history.replaceState(null, "", "/?app=scout");
    expect(currentAppId()).toBe("scout");
    window.history.replaceState(null, "", "/");
    expect(currentAppId()).toBe("freddai");
  });
});
