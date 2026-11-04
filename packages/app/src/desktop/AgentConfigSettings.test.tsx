import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
import { AgentConfigSettings, looksSecret, maskValue } from "./AgentConfigSettings";

const accounts = [{ id: "a1", name: "Work", provider: "claude" as const, color: "x", config_home: "/h/.claude-work" }];
const list = (servers: object[]) => ({ servers, scopes: [{ id: "user", label: "User", path: "/h/.claude-work/.claude.json" }], notes: [] });
const server = { name: "gh", scope: "user", type: "stdio", command: "npx", args: ["-y", "gh"], env: { GITHUB_TOKEN: "ghp_secret", MODE: "fast" }, url: "", headers: {}, enabled: null, source: "/x" };
beforeEach(() => { invoke.mockReset(); vi.spyOn(window, "confirm").mockReturnValue(true); });
afterEach(cleanup);

it("flags secret-looking values", () => {
  expect(looksSecret("API_KEY", "x")).toBe(true);
  expect(looksSecret("MODE", "fast")).toBe(false);
  expect(maskValue("X", "sk-abc")).toBe("••••••••");
});
it("lists MCP servers with secrets masked and profile passed through", async () => {
  invoke.mockResolvedValue(list([server]));
  render(<AgentConfigSettings native accounts={accounts} projects={[]} />);
  expect(await screen.findByText("gh")).toBeTruthy();
  expect(screen.getByText("GITHUB_TOKEN=••••••••")).toBeTruthy();
  expect(screen.getByText("MODE=fast")).toBeTruthy();
  expect(screen.queryByText(/ghp_secret/)).toBeNull();
  expect(invoke).toHaveBeenCalledWith("agent_config", { request: expect.objectContaining({ op: "mcp_list", provider: "claude", configHome: "/h/.claude-work" }) });
});
it("edits a server and sends the whole form to the backend", async () => {
  invoke.mockResolvedValueOnce(list([server])).mockResolvedValueOnce(list([{ ...server, command: "node" }]));
  render(<AgentConfigSettings native accounts={accounts} projects={[]} />);
  await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
  const cmd = screen.getByLabelText("Command");
  await userEvent.clear(cmd); await userEvent.type(cmd, "node");
  expect((screen.getByLabelText("Environment value 1") as HTMLInputElement).type).toBe("password");
  await userEvent.click(screen.getByRole("button", { name: "Save server" }));
  await waitFor(() => expect(invoke).toHaveBeenLastCalledWith("agent_config", { request: expect.objectContaining({ op: "mcp_save", originalName: "gh", server: expect.objectContaining({ name: "gh", command: "node", args: ["-y", "gh"], env: { GITHUB_TOKEN: "ghp_secret", MODE: "fast" } }) }) }));
  expect(await screen.findByText(/node -y gh/)).toBeTruthy();
});
it("shows backend validation errors with field paths", async () => {
  invoke.mockResolvedValueOnce(list([])).mockRejectedValueOnce("server.name: required; server.command: required for stdio servers");
  render(<AgentConfigSettings native accounts={accounts} projects={[]} />);
  await userEvent.click(await screen.findByRole("button", { name: "Add MCP server" }));
  await userEvent.click(screen.getByRole("button", { name: "Save server" }));
  expect((await screen.findByRole("alert")).textContent).toContain("server.command");
});
it("explains the browser preview", () => {
  render(<AgentConfigSettings native={false} accounts={accounts} projects={[]} />);
  expect(screen.getByText("Agent configuration needs the Mac app.")).toBeTruthy();
});
