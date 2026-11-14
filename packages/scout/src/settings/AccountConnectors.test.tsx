import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import type { AccountConnector, AccountDetection, Source } from "../api";
import { AgentsSources } from "./AgentsSources";
import { makeActions, makeDb, makeState } from "./testFixtures";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@freddai/shared/apps/registry", () => ({ openApp: vi.fn(async () => {}) }));

const mockInvoke = vi.mocked(invoke);
afterEach(() => { cleanup(); mockInvoke.mockReset(); });

const conn = (provider: string, label: string, status: AccountConnector["status"] = "connected", kind: AccountConnector["kind"] = "email"): AccountConnector =>
  ({ key: `claude_ai_connector:${label}`, provider, label, kind, status, via: "claude_ai_connector", raw_name: label });
const GMAIL = conn("gmail", "Gmail");
const ZOOM = conn("zoom", "Zoom", "needs_auth", "meetings");

function answer(accounts: AccountDetection["accounts"] | Error, machine = { connections: [] as unknown[], warnings: [] as unknown[] }) {
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "detect_agents") return [];
    if (cmd === "scout_detect_connections") return machine;
    if (cmd === "scout_detect_account_connectors") { if (accounts instanceof Error) throw accounts; return { accounts }; }
    return null;
  });
}
const detectedSource = (c: AccountConnector, enabled: boolean): Source =>
  ({ id: "d1", account: "a1", kind: "gmail", label: c.label, detail: `detected:${c.key}`, access: "direct", enabled, status: "not_connected" });
const view = (variant: "settings" | "onboarding" = "onboarding", actions = makeActions(), sources: Source[] | null = null, db = makeDb()) => {
  const state = makeState();
  if (sources) state.sources = sources;
  render(<AgentsSources state={state} db={db} actions={actions} variant={variant} />);
  return actions;
};

describe("Per-account detected connectors", () => {
  it.each(["settings", "onboarding"] as const)("renders chips with statuses per account (%s)", async variant => {
    answer([{ account: "a1", connectors: [GMAIL, ZOOM, conn("slack", "Slack", "failed", "chat")], warning: null }]);
    view(variant);
    const card = await screen.findByRole("region", { name: "Claude Code · Work" });
    const gmail = await within(card).findByRole("switch", { name: "Gmail" });
    expect(gmail.getAttribute("aria-checked")).toBe("true");
    expect(within(card).queryByRole("switch", { name: /Zoom/ })).toBeNull();
    await userEvent.click(within(card).getByRole("button", { name: "1 not signed in" }));
    const zoom = within(card).getByRole("switch", { name: /Zoom, Sign in via Claude Code/ }) as HTMLButtonElement;
    expect(zoom.disabled).toBe(true);
    expect(zoom.getAttribute("aria-checked")).toBe("false");
    const slack = within(card).getByRole("switch", { name: /Slack, Failed in Claude Code/ }) as HTMLButtonElement;
    expect(slack.disabled).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("scout_detect_account_connectors");
  });

  it("hides claude_plugin_mcp connectors and never auto-adds them", async () => {
    const plugin = { ...conn("other", "amplitude", "connected", "other"), key: "claude_plugin_mcp:amplitude", via: "claude_plugin_mcp" };
    answer([{ account: "a1", connectors: [GMAIL, plugin], warning: null }]);
    const actions = view("onboarding", makeActions(), []);
    await screen.findByRole("switch", { name: "Gmail" });
    await waitFor(() => expect(actions.sourceSave).toHaveBeenCalledTimes(1));
    await new Promise(r => setTimeout(r, 30));
    expect(screen.queryByRole("switch", { name: /amplitude/ })).toBeNull();
    expect(actions.sourceSave).toHaveBeenCalledTimes(1);
    expect(actions.sourceSave).not.toHaveBeenCalledWith(expect.objectContaining({ label: "amplitude" }));
  });

  it("orders chips by kind, then status, then label", async () => {
    answer([{ account: "a1", connectors: [
      conn("notion", "Notion", "connected", "other"),
      conn("drive", "Drive", "connected", "files"),
      conn("slack", "Slack", "failed", "chat"),
      conn("slack", "Discord", "connected", "chat"),
      conn("zoom", "Zoom", "connected", "meetings"),
      conn("gcal", "Calendar", "connected", "calendar"),
      conn("gmail", "Outlook", "unknown", "email"),
      conn("gmail", "Gmail", "connected", "email"),
      conn("gmail", "Yahoo", "connected", "email"),
    ], warning: null }]);
    view();
    const card = await screen.findByRole("region", { name: "Claude Code · Work" });
    await within(card).findByRole("switch", { name: "Gmail" });
    const labels = within(card).getAllByRole("switch").map(el => el.querySelector(".st-chip__label")?.textContent);
    expect(labels).toEqual(["Gmail", "Yahoo", "Outlook", "Calendar", "Discord", "Slack", "Zoom", "Drive", "Notion"]);
  });

  it("collapses needs_auth chips behind a toggle that expands them inline", async () => {
    answer([{ account: "a1", connectors: [GMAIL, ZOOM, conn("slack", "Slack", "needs_auth", "chat")], warning: null }]);
    view();
    const card = await screen.findByRole("region", { name: "Claude Code · Work" });
    await within(card).findByRole("switch", { name: "Gmail" });
    expect(within(card).getAllByRole("switch")).toHaveLength(1);
    const toggle = within(card).getByRole("button", { name: "2 not signed in" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle);
    expect(within(card).getAllByRole("switch")).toHaveLength(3);
    expect(within(card).getByRole("switch", { name: /Slack, Sign in via/ })).toBeTruthy();
  });

  it("shows a skeleton while detecting", async () => {
    mockInvoke.mockImplementation(() => new Promise(() => {}));
    view();
    expect(await screen.findByRole("status", { name: "Checking connections" })).toBeTruthy();
  });

  it("auto-adds each connected connector once and never needs_auth ones", async () => {
    answer([{ account: "a1", connectors: [GMAIL, ZOOM], warning: null }]);
    const actions = view("onboarding", makeActions(), []);
    await waitFor(() => expect(actions.sourceSave).toHaveBeenCalledTimes(1));
    expect(actions.sourceSave).toHaveBeenCalledWith(expect.objectContaining({
      account: "a1", kind: "gmail", label: "Gmail", detail: "detected:claude_ai_connector:Gmail", access: "direct", enabled: true,
    }));
    await new Promise(r => setTimeout(r, 30));
    expect(actions.sourceSave).toHaveBeenCalledTimes(1);
  });

  it("maps unknown providers to custom", async () => {
    answer([{ account: "a1", connectors: [conn("notion", "Notion", "connected", "other")], warning: null }]);
    const actions = view("onboarding", makeActions(), []);
    await waitFor(() => expect(actions.sourceSave).toHaveBeenCalledWith(expect.objectContaining({ kind: "custom", label: "Notion" })));
  });

  it("does not re-create a source the user switched off, and re-ticking enables it", async () => {
    answer([{ account: "a1", connectors: [GMAIL], warning: null }]);
    const actions = view("settings", makeActions(), [detectedSource(GMAIL, false)]);
    const chip = await screen.findByRole("switch", { name: "Gmail" });
    expect(chip.getAttribute("aria-checked")).toBe("false");
    await new Promise(r => setTimeout(r, 30));
    expect(actions.sourceSave).not.toHaveBeenCalled();
    await userEvent.click(chip);
    expect(actions.sourceSave).toHaveBeenCalledWith(expect.objectContaining({ id: "d1", enabled: true }));
    expect(actions.sourceDelete).not.toHaveBeenCalled();
  });

  it("unticking saves the same source with enabled:false", async () => {
    answer([{ account: "a1", connectors: [GMAIL], warning: null }]);
    const actions = view("onboarding", makeActions(), [detectedSource(GMAIL, true)]);
    await userEvent.click(await screen.findByRole("switch", { name: "Gmail" }));
    expect(actions.sourceSave).toHaveBeenCalledTimes(1);
    expect(actions.sourceSave).toHaveBeenCalledWith({ ...detectedSource(GMAIL, true), enabled: false });
    expect(actions.sourceDelete).not.toHaveBeenCalled();
  });

  it("shows the per-account warning on the card", async () => {
    answer([{ account: "a1", connectors: [GMAIL], warning: "claude mcp list timed out" }]);
    view();
    const card = await screen.findByRole("region", { name: "Claude Code · Work" });
    expect((await within(card).findByRole("alert")).textContent).toBe("Couldn’t fully check this account: claude mcp list timed out");
  });

  it("shows a page error when the whole call fails, with no chips", async () => {
    answer(new Error("command not found"));
    view();
    expect(await screen.findByText(/Could not check your agents’ connections: command not found/)).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("counts only enabled sources in the header pill", async () => {
    answer([]);
    view("settings", makeActions(), [detectedSource(GMAIL, false), { ...detectedSource(GMAIL, true), id: "d2", detail: "x" }]);
    expect(await screen.findByText("1 source")).toBeTruthy();
  });

  it("the picker adds a machine connection to the chosen account", async () => {
    answer([], { connections: [{ id: "zoom|", kind: "meetings", provider: "zoom", label: "Zoom", account: "", found_via: ["installed_app"] }], warnings: [] });
    const db = makeDb();
    (db.accounts as unknown[]).push({ id: "a2", name: "Home", provider: "codex", color: "#111" });
    const actions = view("onboarding", makeActions(), [], db);
    await userEvent.selectOptions(await screen.findByLabelText("Account for Zoom"), "a2");
    await userEvent.click(screen.getByRole("button", { name: "Add Zoom" }));
    expect(actions.sourceSave).toHaveBeenCalledWith(expect.objectContaining({ account: "a2", label: "Zoom", kind: "custom" }));
  });

  it("manual add is a small link that still opens the dialog", async () => {
    answer([]);
    view();
    await userEvent.click(screen.getByRole("button", { name: "Add a source manually" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });
});
