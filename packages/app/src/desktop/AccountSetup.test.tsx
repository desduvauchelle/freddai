import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountSetup } from "./AccountSetup";
import { empty, type Database } from "./types";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
afterEach(cleanup);
beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (command: string) => command === "auth_status" ? true : command === "detect_agents" ? [{ provider: "codex", path: "/fixture/codex" }] : command === "detect_existing_sign_ins" ? [] : null);
});
const database = (): Database => ({ ...empty, host_update_pending: true,
  accounts: [{ id: "a", name: "Work", provider: "codex", color: "blue" }],
  sessions: [{ id: "s", account: "a", project: "p", title: "Active", status: "running", updated: 1, provider_id: "saved", messages: [], pending: null, error: null }],
});
async function openMenu() {
  render(<AccountSetup db={database()} native onRefresh={vi.fn().mockResolvedValue(undefined)} />);
  await userEvent.click(await screen.findByRole("button", { name: "Actions for Work" }));
}
it("allows renaming while a host update and active work are pending", async () => {
  await openMenu();
  const rename = screen.getByRole("menuitem", { name: "Rename…" });
  expect(rename.getAttribute("data-disabled")).toBeNull();
  await userEvent.click(rename);
  const name = await screen.findByLabelText("Connection name");
  fireEvent.change(name, { target: { value: "New work name" } });
  await userEvent.click(screen.getByRole("button", { name: "Save name" }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("rename_account", { account: "a", name: "New work name" }));
});
it("lets active connections reach removal confirmation without stopping work on menu selection", async () => {
  await openMenu();
  const remove = screen.getByRole("menuitem", { name: "Remove connection…" });
  expect(remove.getAttribute("data-disabled")).toBeNull();
  await userEvent.click(remove);
  expect(await screen.findByRole("group", { name: "Remove Work connection" })).toBeTruthy();
  expect(invoke.mock.calls.some(([c]) => c === "stop" || c === "remove_account")).toBe(false);
  expect(screen.getByRole("button", { name: "Stop work and remove connection" })).toBeTruthy();
});

it("saves a detected Claude login with a name and color without opening sign-in", async () => {
  invoke.mockImplementation(async (command: string) => command === "detect_agents" ? [{ provider: "claude", path: "/fixture/claude" }] : command === "detect_existing_sign_ins" ? [{ provider: "claude", signed_in: true, error: null }] : command === "save_claude_login" ? { id: "saved", provider: "claude" } : null);
  render(<AccountSetup db={{ ...empty }} native onRefresh={vi.fn().mockResolvedValue(undefined)} />);
  const add = await screen.findByRole("button", { name: "Add Claude Code account" });
  await waitFor(() => expect(add.hasAttribute("disabled")).toBe(false));
  await userEvent.click(add);
  await userEvent.click(screen.getByRole("menuitem", { name: "Save current Terminal login…" }));
  fireEvent.change(await screen.findByLabelText("Account name"), { target: { value: "Personal" } });
  await userEvent.click(screen.getByRole("button", { name: "Save account" }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_claude_login", { provider: "claude", name: "Personal", color: "#b59ae9" }));
  expect(invoke.mock.calls.some(([c]) => c === "login" || c === "add_account")).toBe(false);
});

it("requires saving a shared Claude connection before adding a second account", async () => {
  invoke.mockImplementation(async (command: string) => command === "auth_status" ? true : command === "detect_agents" ? [{ provider: "claude", path: "/fixture/claude" }] : command === "detect_existing_sign_ins" ? [{ provider: "claude", signed_in: true, error: null }] : null);
  render(<AccountSetup db={{ ...empty, accounts: [{ id: "shared", provider: "claude", name: "Personal", color: "#8ec6a2", config_home: "/fixture/shared" }] }} native onRefresh={vi.fn()} />);
  const add = await screen.findByRole("button", { name: "Add Claude Code account" });
  await waitFor(() => expect(add.hasAttribute("disabled")).toBe(false));
  await userEvent.click(add);
  expect(screen.getByRole("menuitem", { name: "Add separate account…" }).hasAttribute("data-disabled")).toBe(true);
  await userEvent.click(screen.getByRole("menuitem", { name: "Save current Terminal login…" }));
  expect((await screen.findByLabelText("Account name") as HTMLInputElement).value).toBe("Personal");
});
