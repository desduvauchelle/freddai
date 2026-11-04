import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HomeView, todayProjects } from "./HomeView";
import { resolveHomeLaunch, type HomeLaunchPlan } from "./home-launch";
import type { Account, Project, Session } from "./types";

const NOW = new Date(2026, 10, 4, 15, 0).getTime();
const MIDNIGHT = new Date(2026, 10, 4).getTime();
const project = (id: string, name: string): Project => ({ id, name, path: `/p/${id}`, color: "#888", policy: "inherit", account: null, last: null });
const account: Account = { id: "a", name: "Main", provider: "claude", color: "#fff" };
const thread = (id: string, over: Partial<Session> = {}): Session => ({ id, title: `Title ${id}`, project: "alpha", account: "a", status: "done", updated: NOW - 1000, provider_id: null, messages: [], pending: null, error: null, ...over });
const pending = { id: 1, request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls" } } };
// Read-only host stub: summaries never reach a real host or provider in tests.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (_cmd: string, args: { date: string }) => ({ date: args.date, summary: null, running: false, error: null, threads: 0 })) }));
vi.mock("./Dormouse", () => ({ Dormouse: ({ label }: { label: string }) => <div data-testid="dormouse" aria-label={label} /> }));
const mic = vi.hoisted(() => ({ ready: false }));
// Dictation controller stand-in: mirrors the real MicButton, which renders nothing unless dictation is ready.
vi.mock("./VoiceControls", () => ({
  MicButton: ({ onText }: { onText: (t: string, b: HTMLElement) => void }) => mic.ready ? <button type="button" aria-label="Dictate" onClick={e => onText("ship it", e.currentTarget)} /> : null,
  VoiceNotice: () => null,
}));
afterEach(() => { cleanup(); mic.ready = false; });

const db = (over: Record<string, unknown> = {}) => ({ accounts: [account], projects: [project("alpha", "Alpha"), project("beta", "Beta")], sessions: [], preferences: { fallback: "a" }, ...over }) as never;
const props = (sessions: Session[], projects = [project("alpha", "Alpha"), project("beta", "Beta")]) => ({
  sessions, projects, accounts: [account], now: NOW, canCreate: true,
  onOpenThread: vi.fn(), resolveLaunch: vi.fn((id: string): HomeLaunchPlan => resolveHomeLaunch(db(), id, "bypass")), onAddProject: vi.fn(), onCreateThread: vi.fn(async () => {}), onRespond: vi.fn(async () => {}),
});

it("lists only projects with activity since local midnight, newest first", () => {
  const rows = todayProjects([
    thread("1", { project: "alpha", updated: NOW - 5000 }),
    thread("2", { project: "beta", updated: NOW - 1000 }),
    thread("3", { project: "gamma", updated: MIDNIGHT - 1 }),
  ], [project("alpha", "Alpha"), project("beta", "Beta"), project("gamma", "Gamma")], NOW);
  expect(rows.map(r => r.project.id)).toEqual(["beta", "alpha"]);
});

it("counts working, done today and needs-you per project with text labels", () => {
  render(<HomeView {...props([
    thread("1", { status: "running" }),
    thread("2", { status: "starting" }),
    thread("3", { status: "done" }),
    thread("4", { status: "done", updated: MIDNIGHT - 5000 }),
    thread("5", { status: "running", pending }),
  ])} />);
  const tile = within(screen.getByRole("article", { name: "Project Alpha" }));
  expect(tile.getByText("2 working")).toBeTruthy();
  expect(tile.getByText("1 done")).toBeTruthy();
  expect(tile.getByText("1 needs you")).toBeTruthy();
  expect(screen.queryByRole("article", { name: "Project Beta" })).toBeNull();
});

it("renders a needs-you card for any project, even without activity today, and opens the thread", () => {
  const p = props([thread("9", { project: "beta", title: "Fix the build", updated: MIDNIGHT - 86_400_000, pending })]);
  render(<HomeView {...p} />);
  const card = within(screen.getByRole("article", { name: "Request in Fix the build" }));
  expect(card.getByText("Beta")).toBeTruthy();
  expect(card.getByText("Fix the build")).toBeTruthy();
  expect(screen.getByText("Approval needed")).toBeTruthy();
  fireEvent.click(card.getByRole("button", { name: /Open thread/ }));
  expect(p.onOpenThread).toHaveBeenCalledWith("9");
});

it("submits the inline prompt to the create-thread callback with the tile's project", async () => {
  const p = props([thread("1", { project: "alpha" }), thread("2", { project: "beta" })]);
  render(<HomeView {...p} />);
  fireEvent.click(screen.getByRole("button", { name: "New thread in Beta" }));
  fireEvent.change(screen.getByLabelText("Prompt for Beta"), { target: { value: "Do the thing" } });
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  await screen.findByRole("button", { name: "New thread in Beta" });
  expect(p.onCreateThread).toHaveBeenCalledTimes(1);
  expect(p.onCreateThread).toHaveBeenCalledWith("beta", "Do the thing");
});

it("renders the three daily summary sections without generating", async () => {
  render(<HomeView {...props([])} />);
  const region = screen.getByRole("region", { name: "Daily summaries" });
  expect(await within(region).findByText("No activity")).toBeTruthy();
  expect(region.querySelectorAll(".day-summary").length).toBe(3);
  expect(within(region).queryByRole("button", { name: /Generate summary/ })).toBeNull();
});

it("hides the per-project mic when dictation is disabled", () => {
  render(<HomeView {...props([thread("1")])} />);
  expect(screen.queryByRole("button", { name: "Dictate" })).toBeNull();
});

it("creates a thread in the tile's project from a dictated transcript", async () => {
  mic.ready = true;
  const p = props([thread("1"), thread("2", { project: "beta" })]);
  render(<HomeView {...p} />);
  fireEvent.click(within(screen.getByRole("article", { name: "Project Beta" })).getByRole("button", { name: "Dictate" }));
  await waitFor(() => expect(p.onCreateThread).toHaveBeenCalledWith("beta", "ship it"));
});

it("shows a visible error when creating the dictated thread fails", async () => {
  mic.ready = true;
  const p = props([thread("1")]);
  p.onCreateThread.mockRejectedValueOnce(new Error("no account"));
  render(<HomeView {...p} />);
  fireEvent.click(screen.getByRole("button", { name: "Dictate" }));
  expect((await screen.findByRole("alert")).textContent).toContain("no account");
});

it("shows the resolved agent chip as soon as + is pressed", () => {
  render(<HomeView {...props([thread("1")])} />);
  expect(screen.queryByLabelText(/^Agent:/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "New thread in Alpha" }));
  expect(screen.getByLabelText("Agent: Claude Code · Main · default model · default effort")).toBeTruthy();
});

it("shows the chip when the mic is pressed", () => {
  mic.ready = true;
  render(<HomeView {...props([thread("1")])} />);
  fireEvent.pointerDown(screen.getByRole("button", { name: "Dictate" }));
  expect(screen.getByLabelText(/^Agent: Claude Code · Main/)).toBeTruthy();
});

it("disables submit and shows an error when no account resolves", () => {
  const p = props([thread("1")]);
  p.resolveLaunch.mockReturnValue(resolveHomeLaunch(db({ preferences: {} }), "alpha", "bypass"));
  render(<HomeView {...p} />);
  fireEvent.click(screen.getByRole("button", { name: "New thread in Alpha" }));
  fireEvent.change(screen.getByLabelText("Prompt for Alpha"), { target: { value: "x" } });
  expect((screen.getByRole("button", { name: "Start" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain("No default account");
});

it("creating from a tile keeps Home, confirms inline and does not open the thread", async () => {
  const p = props([thread("1")]);
  p.onCreateThread.mockResolvedValueOnce("Ship the thing" as never);
  render(<HomeView {...p} />);
  fireEvent.click(screen.getByRole("button", { name: "New thread in Alpha" }));
  fireEvent.change(screen.getByLabelText("Prompt for Alpha"), { target: { value: "Ship the thing now" } });
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  await waitFor(() => expect(screen.getByText("Started · Ship the thing")).toBeTruthy());
  expect(screen.queryByLabelText("Prompt for Alpha")).toBeNull();
  expect(screen.getByRole("region", { name: "Home" })).toBeTruthy();
  expect(p.onOpenThread).not.toHaveBeenCalled();
});

it("resolveHomeLaunch picks the project's fixed account and reports missing ones", () => {
  const other: Account = { id: "b", name: "Work", provider: "codex", color: "#000" };
  const fixed = { ...project("alpha", "Alpha"), policy: "fixed" as const, account: "b" };
  const plan = resolveHomeLaunch(db({ accounts: [account, other], projects: [fixed] }), "alpha", "ask");
  expect(plan).toMatchObject({ ok: true, account: "b", provider: "codex", permission_mode: "ask", model: null, label: "Codex · Work · default model · default effort" });
  expect(resolveHomeLaunch(db({ accounts: [] }), "alpha", "ask")).toMatchObject({ ok: false });
  expect(resolveHomeLaunch(db(), "nope", "ask")).toMatchObject({ ok: false });
});
