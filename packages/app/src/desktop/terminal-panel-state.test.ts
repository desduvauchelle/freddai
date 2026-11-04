import { describe, expect, it, vi } from "vitest";
import { createTerminalPanelStore, DEFAULT_TERMINAL_HEIGHT, MIN_TERMINAL_HEIGHT, TERMINAL_PANEL_KEY } from "./terminal-panel-state";
import { commandFor } from "./shortcuts";

const memory = (initial?: string) => {
  const data = new Map<string, string>(initial ? [[TERMINAL_PANEL_KEY, initial]] : []);
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

describe("terminal panel state", () => {
  it("starts closed, toggles, notifies and persists", () => {
    const storage = memory();
    const store = createTerminalPanelStore(storage);
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.getSnapshot()).toEqual({ open: false, height: DEFAULT_TERMINAL_HEIGHT });
    store.toggle();
    expect(store.getSnapshot().open).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(createTerminalPanelStore(storage).getSnapshot().open).toBe(true);
    store.toggle();
    expect(store.getSnapshot().open).toBe(false);
  });
  it("remembers and clamps height", () => {
    const store = createTerminalPanelStore(memory());
    store.setHeight(10);
    expect(store.getSnapshot().height).toBe(MIN_TERMINAL_HEIGHT);
    store.setHeight(333);
    expect(store.getSnapshot().height).toBe(333);
  });
  it("warns and falls back on corrupt saved state", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(createTerminalPanelStore(memory("{nope")).getSnapshot().open).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it("Ctrl+` is the terminal shortcut", () => {
    expect(commandFor(new KeyboardEvent("keydown", { key: "`", ctrlKey: true }))).toBe("terminal");
  });
});
