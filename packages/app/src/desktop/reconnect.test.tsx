import { ThreadError } from "./ThreadError";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { AccountOverview } from "./AccountOverview";
import { AccountSetup } from "./AccountSetup";
import { ProgressCard } from "./bug-walk/ProgressCard";
import { isAuthError } from "./reconnect";
import { resetAccountAuth } from "./accountAuth";
import { empty } from "./types";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
beforeEach(() => { invoke.mockReset(); resetAccountAuth(); });
afterEach(cleanup);
const account = { id: "c1", name: "Work", provider: "codex" as const, color: "#fff" };
const expired = "Codex sign-in needed. Reconnect this account.";

it("classifies provider auth failures", () => {
  expect(isAuthError("Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.")).toBe(true);
  expect(isAuthError(expired)).toBe(true);
  expect(isAuthError("codex account authentication required to read rate limits")).toBe(true);
  expect(isAuthError("429 too many requests")).toBe(false);
});
it("shows a Reconnect button on an auth-expired usage card and runs login for that account", async () => {
  invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "account_usage") throw expired;
    if (cmd === "login_state") return { status: "pending", error: null };
  });
  render(<AccountOverview db={{ ...empty, accounts: [account] }} native onManage={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Reconnect" }));
  expect(invoke).toHaveBeenCalledWith("login", { account: "c1" });
  expect(await screen.findByText("Waiting for sign-in…")).toBeTruthy();
});
it("does not offer an inline Reconnect on the usage card for a generic (non-auth) Codex error", async () => {
  const generic = "The Codex request failed. Refresh usage and check account sign-in before retrying.";
  invoke.mockImplementation(async (cmd: string) => { if (cmd === "account_usage") throw generic; });
  render(<AccountOverview db={{ ...empty, accounts: [account] }} native onManage={() => {}} />);
  expect(await screen.findByText(generic)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
});
it("does not offer Reconnect for providers without a browser re-login", async () => {
  invoke.mockImplementation(async (cmd: string) => { if (cmd === "account_usage") throw "429 too many requests"; });
  render(<AccountOverview db={{ ...empty, accounts: [{ ...account, provider: "claude" as const }] }} native onManage={() => {}} />);
  expect(await screen.findByText("429 too many requests")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
});
it("pending sign-in shows Copy sign-in link and Cancel restores the Reconnect button", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "account_usage") throw expired;
    if (cmd === "login_state") return { status: "pending", error: null, url: "https://auth.openai.com/oauth/authorize?x=1" };
  });
  render(<AccountOverview db={{ ...empty, accounts: [account] }} native onManage={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Reconnect" }));
  fireEvent.click(await screen.findByRole("button", { name: "Copy sign-in link" }, { timeout: 3000 }));
  expect(writeText).toHaveBeenCalledWith("https://auth.openai.com/oauth/authorize?x=1");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(await screen.findByRole("button", { name: "Reconnect" })).toBeTruthy();
  expect(invoke).toHaveBeenCalledWith("cancel_login", { account: "c1" });
});
it("shows an inline error when reconnect fails", async () => {
  invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "account_usage") throw expired;
    if (cmd === "login") throw "codex not found";
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(<AccountOverview db={{ ...empty, accounts: [account] }} native onManage={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Reconnect" }));
  expect((await screen.findByRole("alert")).textContent).toContain("codex not found");
});
const setup = (check: unknown) => {
  invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "auth_check") return check;
    if (cmd === "detect_agents") return [{ provider: "codex", path: "/bin/codex" }];
    if (cmd === "detect_existing_sign_ins") return [];
    if (cmd === "login_state") return null;
  });
  render(<AccountSetup db={{ ...empty, accounts: [{ ...account, config_home: "/home/.codex" }] }} native onRefresh={async () => {}} />);
};
it("AccountSetup row shows Sign-in expired (not Signed in) with Reconnect when the token is dead", async () => {
  setup({ state: "expired", error: "refresh token was already used" });
  expect(await screen.findByText("Sign-in expired")).toBeTruthy();
  expect(screen.queryByText("Signed in")).toBeNull();
  expect(screen.getByRole("button", { name: "Reconnect" })).toBeTruthy();
});
it("AccountSetup row shows Signed in when the token validates", async () => {
  setup({ state: "valid" });
  expect(await screen.findByText("Signed in")).toBeTruthy();
});
it("AccountSetup row shows Couldn't verify (and logs) when validation fails for another reason", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  setup({ state: "unverified", error: "timed out" });
  expect(await screen.findByText(/Couldn't verify sign-in: timed out/)).toBeTruthy();
  expect(screen.queryByText("Signed in")).toBeNull();
});
it("thread error card offers Reconnect for the account, then Retry", async () => {
  invoke.mockImplementation(async (cmd: string) => cmd === "login_state" ? { status: "ready", error: null } : null);
  const onRetry = vi.fn();
  render(<ThreadError error="Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again."
    account={{ id: "c1", provider: "codex", name: "LC" }} onOpenAccounts={() => {}} onRetry={onRetry} />);
  expect(screen.getByText("Codex · LC sign-in expired.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Open Accounts" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }, { timeout: 3000 }));
  expect(onRetry).toHaveBeenCalled();
});
it("bug walk failure card names the account and offers Reconnect on auth errors", () => {
  const walk = { id: "w", phase: "error", elapsed: 0, startedAt: null, level: 0, error: "Your access token could not be refreshed because your refresh token was already used.",
    sendOpts: { project: "p", account: "c1", permission_mode: "default" } } as never;
  render(<ProgressCard walk={walk} accounts={[account]} />);
  expect(screen.getByText("Codex · Work sign-in expired.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Reconnect" })).toBeTruthy();
});
