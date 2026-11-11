import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountPicker } from "./AccountPicker";
import { resetAccountUsage } from "./useAccountUsage";
import type { Account } from "./types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(cleanup);
const accounts: Account[] = [{ id: "a", name: "Work", provider: "codex", color: "#77b9df" }, { id: "b", name: "Home", provider: "claude", color: "#e89cbd" }];
beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  resetAccountUsage({ a: { usage: { windows: [{ label: "Weekly", used_percent: 18, resets_at: 2000000000 }], checked_at: Date.now() } } });
});

it("shows name, usage text and a coloured ring for each account in the open menu", async () => {
  const onChange = vi.fn();
  render(<AccountPicker accounts={accounts} value="b" onChange={onChange}/>);
  await userEvent.click(screen.getByRole("combobox", { name: "Agent and account" }));
  const option = (await screen.findAllByRole("option")).find(o => o.textContent?.includes("Work"))!;
  expect(option.textContent).toMatch(/82% left/);
  expect(option.querySelector(".usage-ring-fill")?.getAttribute("stroke")).toBe("#77b9df");
  const other = screen.getAllByRole("option").find(o => o.textContent?.includes("Home"))!;
  expect(other.textContent).toMatch(/Retrieving usage/);
  await userEvent.click(option);
  expect(onChange).toHaveBeenCalledWith("a");
});
