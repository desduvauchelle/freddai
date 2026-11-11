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
  invoke.mockImplementation(async (command: string) => command === "auth_check" ? { state: "valid" } : command === "detect_agents" ? [{ provider: "codex", path: "/fixture/codex" }] : command === "detect_existing_sign_ins" ? [] : null);
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
  invoke.mockImplementation(async (command: string) => command === "auth_check" ? { state: "valid" } : command === "detect_agents" ? [{ provider: "claude", path: "/fixture/claude" }] : command === "detect_existing_sign_ins" ? [{ provider: "claude", signed_in: true, error: null }] : null);
  render(<AccountSetup db={{ ...empty, accounts: [{ id: "shared", provider: "claude", name: "Personal", color: "#8ec6a2", config_home: "/fixture/shared" }] }} native onRefresh={vi.fn()} />);
  const add = await screen.findByRole("button", { name: "Add Claude Code account" });
  await waitFor(() => expect(add.hasAttribute("disabled")).toBe(false));
  await userEvent.click(add);
  expect(screen.getByRole("menuitem", { name: "Add separate account…" }).hasAttribute("data-disabled")).toBe(true);
  await userEvent.click(screen.getByRole("menuitem", { name: "Save current Terminal login…" }));
  expect((await screen.findByLabelText("Account name") as HTMLInputElement).value).toBe("Personal");
});

it("shows a Copilot CLI card with the one-click current-connection path", async () => {
  invoke.mockImplementation(async (command: string) => command === "auth_check" ? { state: "valid" } : command === "detect_agents" ? [{ provider: "copilot", path: "/fixture/copilot" }] : command === "detect_existing_sign_ins" ? [{ provider: "copilot", signed_in: true, error: null }] : null);
  render(<AccountSetup db={{ ...empty }} native onRefresh={vi.fn().mockResolvedValue(undefined)} />);
  expect(await screen.findByText("Copilot CLI")).toBeTruthy();
  const add = await screen.findByRole("button", { name: "Add Copilot CLI account" });
  await waitFor(() => expect(add.hasAttribute("disabled")).toBe(false));
  await userEvent.click(add);
  expect(await screen.findByRole("menuitem", { name: "Use current CLI sign-in" })).toBeTruthy();
  expect(screen.queryByRole("menuitem", { name: "Add separate account…" })).toBeNull();
});

it("renders accounts in db order and persists a keyboard reorder", async () => {
  const onRefresh = vi.fn().mockResolvedValue(undefined);
  const db = { ...empty, accounts: [
    { id: "x", name: "First", provider: "codex", color: "#111" },
    { id: "y", name: "Second", provider: "claude", color: "#222" },
  ] } as Database;
  render(<AccountSetup db={db} native onRefresh={onRefresh} />);
  const handles = await screen.findAllByRole("button", { name: /^Reorder / });
  expect(handles.map(h => h.getAttribute("aria-label"))).toEqual(["Reorder First", "Reorder Second"]);
  fireEvent.keyDown(handles[0], { key: "ArrowDown", altKey: true });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("save_account_order", { order: ["y", "x"] }));
  await waitFor(() => expect(onRefresh).toHaveBeenCalled());
});

it("shows an alert when saving the account order fails", async () => {
  invoke.mockImplementation(async (command: string) => { if (command === "save_account_order") throw new Error("disk full"); return command === "detect_agents" ? [] : command === "detect_existing_sign_ins" ? [] : null; });
  const db = { ...empty, accounts: [
    { id: "x", name: "First", provider: "codex", color: "#111" },
    { id: "y", name: "Second", provider: "claude", color: "#222" },
  ] } as Database;
  render(<AccountSetup db={db} native onRefresh={vi.fn()} />);
  fireEvent.keyDown((await screen.findAllByRole("button", { name: /^Reorder / }))[0], { key: "ArrowDown", altKey: true });
  expect((await screen.findByText(/Could not save account order: .*disk full/)).getAttribute("role")).toBe("alert");
});
