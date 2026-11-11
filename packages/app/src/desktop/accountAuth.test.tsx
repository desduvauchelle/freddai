import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountSetup } from "./AccountSetup";
import { checkAccountAuth, getAccountAuth, reportLoginSuccess, reportUsageResult, resetAccountAuth } from "./accountAuth";
import { empty } from "./types";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
beforeEach(() => { invoke.mockReset(); resetAccountAuth(); });
afterEach(cleanup);
const codex = { id: "lc", name: "LC", provider: "codex" as const, color: "#fff" };
let check: unknown = { state: "valid" };
let loginState: unknown = null;
const setup = () => {
  invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "auth_check") return check;
    if (cmd === "login_state") return loginState;
    if (cmd === "detect_agents") return [{ provider: "codex", path: "/bin/codex" }];
    if (cmd === "detect_existing_sign_ins") return [];
    return null;
  });
  render(<AccountSetup db={{ ...empty, accounts: [codex] }} native onRefresh={async () => {}} />);
};

it("store transitions: usage success -> valid, auth error -> expired, other error leaves state alone", () => {
  expect(getAccountAuth("a").status).toBe("unknown");
  reportUsageResult("a", null);
  expect(getAccountAuth("a").status).toBe("valid");
  reportUsageResult("a", "429 too many requests");
  expect(getAccountAuth("a").status).toBe("valid");
  reportUsageResult("a", "Codex sign-in needed. Reconnect this account.");
  expect(getAccountAuth("a").status).toBe("expired");
});
it("store: auth_check maps states, shows checking in between, never throws, and recovery refreshes usage", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const refresh = vi.fn();
  window.addEventListener("freddai:usage-refresh", refresh);
  invoke.mockResolvedValueOnce({ state: "expired" });
  const p = checkAccountAuth("a");
  expect(getAccountAuth("a").status).toBe("checking");
  expect((await p).status).toBe("expired");
  invoke.mockResolvedValueOnce({ state: "unverified", error: "timed out" });
  expect((await checkAccountAuth("a")).message).toContain("timed out");
  invoke.mockRejectedValueOnce("boom");
  expect((await checkAccountAuth("a")).status).toBe("unverified");
  invoke.mockResolvedValueOnce({ state: "required" });
  expect(await checkAccountAuth("a")).toMatchObject({ status: "expired", message: "Sign-in required" });
  invoke.mockResolvedValueOnce({ state: "valid" });
  expect((await reportLoginSuccess("a")).status).toBe("valid");
  expect(refresh).toHaveBeenCalled();
  window.removeEventListener("freddai:usage-refresh", refresh);
});
it("valid row: green Signed in, NO inline Reconnect, Reconnect… lives in the menu", async () => {
  check = { state: "valid" };
  setup();
  expect(await screen.findByText("Signed in")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Actions for LC" }));
  expect(screen.getByRole("menuitem", { name: "Reconnect…" })).toBeTruthy();
});
it("expired row: warning status with inline Reconnect", async () => {
  check = { state: "expired", error: "x" };
  setup();
  expect(await screen.findByText("Sign-in expired")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Reconnect" })).toBeTruthy();
  expect(screen.queryByText("Signed in")).toBeNull();
});
it("a stale 'ready' login result does not force Signed in over a failing live check", async () => {
  check = { state: "expired" };
  loginState = { status: "ready", error: null };
  setup();
  expect(await screen.findByText("Sign-in expired")).toBeTruthy();
  expect(screen.queryByText("Signed in")).toBeNull();
  expect(screen.getByRole("button", { name: "Reconnect" })).toBeTruthy();
  loginState = null;
});
it("Check connection runs auth_check and flips status and button together", async () => {
  check = { state: "valid" };
  setup();
  await screen.findByText("Signed in");
  invoke.mockClear();
  check = { state: "expired" };
  await userEvent.click(screen.getByRole("button", { name: "Actions for LC" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Check connection" }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("auth_check", { account: "lc" }));
  expect(await screen.findByText("Sign-in expired")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Reconnect" })).toBeTruthy();
  // A usage read elsewhere proving the token works updates this row too.
  act(() => reportUsageResult("lc", null));
  expect(await screen.findByText("Signed in")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
});
it("thread error with an old auth failure shows no Reconnect once the live check says the account is valid", async () => {
  const { ThreadError } = await import("./ThreadError");
  check = { state: "valid" };
  invoke.mockImplementation(async (cmd: string) => cmd === "auth_check" ? check : null);
  render(<ThreadError error="Codex sign-in needed. Reconnect this account." account={{ id: "lc", provider: "codex", name: "LC" }} onRetry={() => {}} />);
  expect(await screen.findByText("Reconnected.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
  expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
});
