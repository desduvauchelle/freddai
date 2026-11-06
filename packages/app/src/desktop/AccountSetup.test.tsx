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
