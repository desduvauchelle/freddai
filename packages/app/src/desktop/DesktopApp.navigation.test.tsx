import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesktopApp } from "./DesktopApp";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(async () => null) }));
vi.mock("./Dormouse", () => ({ Dormouse: () => null }));
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it.each(["button", "shortcut"])("Dashboard is reachable after Settings via %s", async navigation => {
  render(<DesktopApp />);
  fireEvent.keyDown(window, { key: ",", ctrlKey: true });
  expect(screen.getByRole("navigation", { name: "Settings sections" })).toBeTruthy();
  if (navigation === "button") {
    fireEvent.click(screen.getByRole("button", { name: "Back to threads" }));
    fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
  }
  else fireEvent.keyDown(window, { key: "1", ctrlKey: true });
  expect(screen.queryByRole("navigation", { name: "Settings sections" })).toBeNull();
  expect(screen.getByRole("region", { name: "Home" })).toBeTruthy();
});
