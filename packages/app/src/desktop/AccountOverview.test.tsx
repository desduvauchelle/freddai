import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AccountOverview } from "./AccountOverview";
import { empty } from "./types";
const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
afterEach(cleanup);
it.each([false, true])("allows a reset on a preserved host; unsupported command=%s", async (unsupported) => {
  invoke.mockImplementation(async (command: string) => command === "account_usage" ? {
    windows: [], plan: null, checked_at: Date.now(),
    reset_credits: { available_count: 1, credits: [{ id: "chosen", title: "Full reset", status: "available", expires_at: null, expiry_known: true }] },
  } : unsupported ? Promise.reject("Unknown host command: consume_reset") : "nothingToReset");
  render(<AccountOverview native db={{ ...empty, host_update_pending: true, accounts: [{ id: "a", name: "Work", provider: "codex", color: "blue" }] }} onManage={() => {}}/>);
  const button = await screen.findByRole("button", { name: "Use Full reset for Codex · Work" });
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  expect(screen.getByText(new RegExp(`Times shown in ${Intl.DateTimeFormat().resolvedOptions().timeZone}`))).toBeTruthy();
  fireEvent.click(button);
  expect(invoke.mock.calls.some(([c]) => c === "consume_reset")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Confirm use reset" }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("consume_reset", { account: "a", creditId: "chosen", idempotencyKey: expect.any(String) }));
  if (unsupported) expect(await screen.findByText(/background host needs an update to use resets/)).toBeTruthy();
});
