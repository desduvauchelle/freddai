import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { SettingsTab } from "../contracts";
import { SettingsView } from "./SettingsView";
import { makeActions, makeDb, makeState } from "./testFixtures";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (cmd: string) => (cmd === "detect_agents" ? [{ provider: "claude", path: "/usr/local/bin/claude" }] : null)) }));
vi.mock("@freddai/shared/apps/registry", () => ({ openApp: vi.fn(async () => {}) }));

afterEach(cleanup);

function Harness({ actions, initial = "agents" as SettingsTab }: { actions: ReturnType<typeof makeActions>; initial?: SettingsTab }) {
  const [tab, setTab] = useState<SettingsTab>(initial);
  return <SettingsView state={makeState()} db={makeDb()} actions={actions} tab={tab} onTab={setTab} onBack={() => {}} />;
}

describe("SettingsView", () => {
  it("switches tabs", async () => {
    render(<Harness actions={makeActions()} />);
    expect(screen.getByRole("heading", { name: "Agents and sources" })).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "Rules" }));
    expect(screen.getByRole("heading", { name: "Rules" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Rules" }).getAttribute("aria-selected")).toBe("true");
    await userEvent.click(screen.getByRole("tab", { name: "Workspaces" }));
    expect(screen.getByText("LiveCase")).toBeTruthy();
  });

  it("shows the account's sources honestly and detected agents", async () => {
    render(<Harness actions={makeActions()} />);
    expect(screen.getByText("Not connected yet")).toBeTruthy();
    expect(screen.queryByText("Connected")).toBeNull();
    await waitFor(() => expect(screen.getByText("Found on this computer")).toBeTruthy());
  });

  it("toggling a source calls sourceSave with enabled flipped", async () => {
    const actions = makeActions();
    render(<Harness actions={actions} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Use Gmail you@livecase.example" }));
    expect(actions.sourceSave).toHaveBeenCalledWith(expect.objectContaining({ id: "s1", enabled: false }));
  });

  it("a rule template prefills when/then and saves", async () => {
    const actions = makeActions();
    render(<Harness actions={actions} initial="rules" />);
    await userEvent.click(screen.getByRole("button", { name: "New rule" }));
    await userEvent.click(screen.getByRole("button", { name: "Meeting notes" }));
    expect((screen.getByLabelText("When") as HTMLTextAreaElement).value).toBe("a meeting ends");
    expect((screen.getByLabelText("Then") as HTMLTextAreaElement).value).toMatch(/action items/);
    await userEvent.click(screen.getByRole("button", { name: "Save rule" }));
    expect(actions.ruleSave).toHaveBeenCalledWith(expect.objectContaining({ name: "Meeting notes", when_text: "a meeting ends", enabled: true, project: null }));
  });
});
