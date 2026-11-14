import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { AgentsSources } from "./AgentsSources";
import { makeActions, makeDb, makeState } from "./testFixtures";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@freddai/shared/apps/registry", () => ({ openApp: vi.fn(async () => {}) }));

const mockInvoke = vi.mocked(invoke);
afterEach(() => { cleanup(); mockInvoke.mockReset(); });

const detection = {
  connections: [
    { id: "gmail|dana@x.com", kind: "email", provider: "gmail", label: "Gmail", account: "dana@x.com", found_via: ["freddai_google_account"] },
    { id: "zoom|", kind: "meetings", provider: "zoom", label: "Zoom", account: "", found_via: ["installed_app", "agent_mcp:claude"] },
    { id: "gmail|you@livecase.example", kind: "email", provider: "gmail", label: "Gmail", account: "you@livecase.example", found_via: ["freddai_google_account"] },
  ],
  warnings: [{ signal: "agent_mcp:gemini", message: "settings.json is not valid JSON" }],
};

function answer(connections: unknown) {
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "detect_agents") return [];
    if (cmd === "scout_detect_connections") { if (connections instanceof Error) throw connections; return connections; }
    return null;
  });
}
const view = (variant: "settings" | "onboarding", actions = makeActions()) =>
  render(<AgentsSources state={makeState()} db={makeDb()} actions={actions} variant={variant} />);

describe("Detected connections", () => {
  it.each(["settings", "onboarding"] as const)("lists detections and warnings in the %s variant", async variant => {
    answer(detection);
    view(variant);
    expect(screen.getByText("Checking this computer…")).toBeTruthy();
    const section = await screen.findByRole("region", { name: "Also on this computer" });
    expect(section.textContent).toContain("dana@x.com");
    expect(section.textContent).toContain("Zoom");
    expect(section.textContent).toContain("via installed app, claude MCP");
    expect(section.textContent).toContain("Couldn’t check gemini MCP config: settings.json is not valid JSON");
    expect(mockInvoke).toHaveBeenCalledWith("scout_detect_connections");
  });

  it("shows already-saved sources as added and saves new ones with Add", async () => {
    answer(detection);
    const actions = makeActions();
    view("settings", actions);
    await screen.findByRole("region", { name: "Also on this computer" });
    expect(screen.queryByRole("button", { name: "Add Gmail you@livecase.example" })).toBeNull(); // makeState already has it
    await userEvent.click(screen.getByRole("button", { name: "Add Zoom" }));
    await waitFor(() => expect(actions.sourceSave).toHaveBeenCalledTimes(1));
    expect(actions.sourceSave).toHaveBeenCalledWith(expect.objectContaining({
      account: "a1", kind: "custom", label: "Zoom", detail: "", access: "computer_use", enabled: true, status: "not_connected",
    }));
    await userEvent.click(screen.getByRole("button", { name: "Add Gmail dana@x.com" }));
    expect(actions.sourceSave).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "gmail", detail: "dana@x.com", access: "direct" }));
  });

  it("shows the empty state", async () => {
    answer({ connections: [], warnings: [] });
    view("onboarding");
    expect(await screen.findByText("No email, calendar or chat apps found on this computer")).toBeTruthy();
  });

  it("shows an error when detection itself fails", async () => {
    answer(new Error("host unreachable"));
    view("settings");
    expect(await screen.findByText(/Could not check for connections: host unreachable/)).toBeTruthy();
    expect(screen.queryByText("No email, calendar or chat apps found on this computer")).toBeNull();
  });
});
