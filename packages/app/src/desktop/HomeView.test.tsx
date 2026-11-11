import { resetDrafts } from "./drafts";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HomeView, homeProjects } from "./HomeView";
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
afterEach(() => { cleanup(); resetDrafts(); mic.ready = false; });

const db = (over: Record<string, unknown> = {}) => ({ accounts: [account], projects: [project("alpha", "Alpha"), project("beta", "Beta")], sessions: [], preferences: { fallback: "a" }, ...over }) as never;
const props = (sessions: Session[], projects = [project("alpha", "Alpha"), project("beta", "Beta")]) => ({
  sessions, projects, accounts: [account], now: NOW, canCreate: true,
  onOpenThread: vi.fn(), resolveLaunch: vi.fn((id: string): HomeLaunchPlan => resolveHomeLaunch(db(), id, "bypass")), onAddProject: vi.fn(), onCreateThread: vi.fn(async () => {}), onRespond: vi.fn(async () => {}),
});

HTMLElement.prototype.scrollIntoView ??= () => {};
function chooseDashboard(label: string, option: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'Enter' });
  fireEvent.click(screen.getByRole('option', { name: option }));
}
it("lists all projects in their configured order regardless of thread activity", () => {
  const projects = [project("alpha", "Alpha"), project("beta", "Beta"), project("gamma", "Gamma"), project("empty", "Empty")];
  const rows = homeProjects([
    thread("1", { project: "alpha", updated: NOW - 5000 }),
    thread("2", { project: "beta", updated: NOW - 1000 }),
    thread("3", { project: "gamma", updated: MIDNIGHT - 1 }),
  ], projects, NOW);
  expect(rows.map(r => r.project.id)).toEqual(projects.map(p => p.id));
  expect(rows[3]).toMatchObject({ working: 0, done: 0, needs: 0, failed: 0, latest: null });
});

it("keeps project controls and a draft in place across activity updates and midnight", () => {
  const p = props([thread("1"), thread("2", { project: "beta", updated: NOW - 5000 })]);
  const { rerender } = render(<HomeView {...p} />);
  const alpha = screen.getByRole("article", { name: "Project Alpha" });
  const beta = screen.getByRole("article", { name: "Project Beta" });
  const tiles = alpha.parentElement!.parentElement!;
  fireEvent.click(within(alpha).getByRole("button", { name: "New thread in Alpha" }));
  fireEvent.change(screen.getByLabelText("Prompt for Alpha"), { target: { value: "My draft" } });
  const input = screen.getByLabelText("Prompt for Alpha");
  for (const now of [NOW + 2000, MIDNIGHT + 86_400_000]) {
    rerender(<HomeView {...p} now={now} sessions={[...p.sessions, thread("3", { project: "beta", status: "running", updated: now })]} />);
    expect(Array.from(tiles.children).map(card => card.querySelector("article"))).toEqual([alpha, beta]);
    expect(screen.getByLabelText("Prompt for Alpha")).toBe(input);
    expect((input as HTMLInputElement).value).toBe("My draft");
    expect(within(beta).getByLabelText("1 working")).toBeTruthy();
  }
});

it("counts working, done today and needs-you per project with accessible icon counts", () => {
  render(<HomeView {...props([
    thread("1", { status: "running" }),
    thread("2", { status: "starting" }),
    thread("3", { status: "done" }),
    thread("4", { status: "done", updated: MIDNIGHT - 5000 }),
    thread("5", { status: "running", pending }),
  ])} />);
  const tile = within(screen.getByRole("article", { name: "Project Alpha" }));
  expect(tile.getByLabelText("2 working")).toBeTruthy();
  expect(tile.getByLabelText("1 done today")).toBeTruthy();
  expect(tile.getByLabelText("1 needs you")).toBeTruthy();
  expect(screen.getByRole("article", { name: "Project Beta" })).toBeTruthy();
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
  fireEvent.click(within(screen.getByRole("article", { name: "Project Alpha" })).getByRole("button", { name: "Dictate" }));
  expect((await screen.findByRole("alert")).textContent).toContain("no account");
});

it("shows the resolved agent chip as soon as + is pressed", () => {
  render(<HomeView {...props([thread("1")])} />);
  expect(screen.queryByLabelText(/^Agent:/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "New thread in Alpha" }));
  expect(screen.getByLabelText("Agent: Claude · Main · default model · default effort")).toBeTruthy();
});

it("shows the chip when the mic is pressed", () => {
  mic.ready = true;
  render(<HomeView {...props([thread("1")])} />);
  fireEvent.pointerDown(within(screen.getByRole("article", { name: "Project Alpha" })).getByRole("button", { name: "Dictate" }));
  expect(screen.getByLabelText(/^Agent: Claude · Main/)).toBeTruthy();
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

it("changes the single shared Home model under Projects", () => {
  const onHomeSelection = vi.fn();
  render(<HomeView {...props([thread("1")])} homeSelections={{ a: { model: "opus", effort: "default" } }} onHomeSelection={onHomeSelection} />);
  const header = screen.getByRole("group", { name: "Dashboard task defaults" });
  expect(within(header).getByRole("combobox", { name: "Model" }).textContent).toContain("Opus");
  chooseDashboard("Model", "Sonnet");
  expect(onHomeSelection).toHaveBeenCalledWith("a", { model: "sonnet", effort: "default" });
});

it("opens the first-thread prompt for an empty project without opening a missing thread", () => {
  const p = props([]);
  render(<HomeView {...p} />);
  fireEvent.click(screen.getByRole("button", { name: "New thread in Beta" }));
  expect(screen.getByLabelText("Prompt for Beta")).toBeTruthy();
  expect(p.onOpenThread).not.toHaveBeenCalled();
});

it("restores a project's unsent prompt after leaving Home and returning", () => {
  const p = props([]);
  const first = render(<HomeView {...p} />);
  fireEvent.click(screen.getByRole("button", { name: "New thread in Alpha" }));
  fireEvent.change(screen.getByLabelText("Prompt for Alpha"), { target: { value: "Keep Alpha" } });
  first.unmount();
  render(<HomeView {...p} />);
  fireEvent.click(screen.getByRole("button", { name: "New thread in Beta" }));
  expect((screen.getByLabelText("Prompt for Beta") as HTMLInputElement).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "New thread in Alpha" }));
  expect((screen.getByLabelText("Prompt for Alpha") as HTMLInputElement).value).toBe("Keep Alpha");
});

it("clears only the submitted project draft and retains text after failure", async () => {
  const p = props([]);
  render(<HomeView {...p} />);
  fireEvent.click(screen.getByRole("button", { name: "New thread in Beta" }));
  fireEvent.change(screen.getByLabelText("Prompt for Beta"), { target: { value: "Keep Beta" } });
  fireEvent.click(screen.getByRole("button", { name: "New thread in Alpha" }));
  fireEvent.change(screen.getByLabelText("Prompt for Alpha"), { target: { value: "Send Alpha" } });
  p.onCreateThread.mockRejectedValueOnce(new Error("Not delivered"));
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  await screen.findByText("Not delivered");
  expect((screen.getByLabelText("Prompt for Alpha") as HTMLInputElement).value).toBe("Send Alpha");
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  await waitFor(() => expect(screen.queryByLabelText("Prompt for Alpha")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "New thread in Alpha" }));
  expect((screen.getByLabelText("Prompt for Alpha") as HTMLInputElement).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "New thread in Beta" }));
  expect((screen.getByLabelText("Prompt for Beta") as HTMLInputElement).value).toBe("Keep Beta");
});

it('keeps Commander out of ordinary project cards', () => {
  const p = props([]), open = vi.fn();
  p.projects = [{ ...p.projects[0], id: 'chief', name: 'Ada', kind: 'commander' }, ...p.projects];
  render(<HomeView {...p} commander={{ onOpen: open, onSend: vi.fn(async () => {}) }} />);
  expect(screen.queryByRole('article', { name: 'Project Ada' })).toBeNull();
  expect(screen.queryByRole('button', { name: "Boss's office · Ada" })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: "Open Commander" }));
  expect(open).toHaveBeenCalledTimes(1);
});


it("shows at most three recent live project threads and opens the chosen thread", () => {
  const p = props([
    thread("old", { updated: NOW - 9000 }),
    thread("second", { updated: NOW - 2000 }),
    thread("latest", { updated: NOW, status: "running" }),
    thread("third", { updated: NOW - 3000 }),
    thread("archived", { updated: NOW + 1, archived: true }),
    thread("deleted", { updated: NOW + 2, deleted_at: NOW }),
    thread("other", { project: "beta" }),
  ]);
  render(<HomeView {...p} />);
  const recent = within(screen.getByRole("list", { name: "Recent threads in Alpha" }));
  expect(recent.getAllByRole("button").map(button => button.textContent)).toEqual(["Title latest", "Title second", "Title third"]);
  fireEvent.click(recent.getAllByRole("button")[1]);
  expect(p.onOpenThread).toHaveBeenCalledWith("second");
});

it("reorders dashboard projects with the shared move callback and preserves drafts across moves", () => {
  const p = props([]), onMoveProject = vi.fn();
  const { rerender } = render(<HomeView {...p} onMoveProject={onMoveProject} />);
  fireEvent.click(screen.getByRole("button", { name: "New thread in Alpha" }));
  fireEvent.change(screen.getByLabelText("Prompt for Alpha"), { target: { value: "Keep this draft" } });
  fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Alpha" }), { altKey: true, key: "ArrowDown" });
  expect(onMoveProject).toHaveBeenCalledWith("alpha", "beta", true);
  rerender(<HomeView {...p} projects={[p.projects[1], p.projects[0]]} onMoveProject={onMoveProject} />);
  expect(screen.getAllByRole("article").map(node => node.getAttribute("aria-label"))).toEqual(["Project Beta", "Project Alpha"]);
  expect((screen.getByLabelText("Prompt for Alpha") as HTMLInputElement).value).toBe("Keep this draft");
});

it("drops a dragged tile after the target and cancels without moving", () => {
  const onMoveProject = vi.fn();
  render(<HomeView {...props([])} onMoveProject={onMoveProject} />);
  const handle = screen.getByRole("button", { name: "Reorder Alpha" });
  const target = screen.getByRole("article", { name: "Project Beta" }).parentElement!;
  handle.setPointerCapture = vi.fn();
  handle.hasPointerCapture = () => true;
  vi.stubGlobal("PointerEvent", MouseEvent);
  document.elementFromPoint = vi.fn(() => target);
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ left: 0, width: 100 } as DOMRect);
  fireEvent.pointerDown(handle, { button: 0 });
  fireEvent.pointerMove(handle, { clientX: 75, clientY: 10 });
  expect(target.dataset.drop).toBe("after");
  fireEvent.pointerUp(handle, { clientX: 75, clientY: 10 });
  expect(onMoveProject).toHaveBeenCalledWith("alpha", "beta", true);
  onMoveProject.mockClear();
  fireEvent.pointerDown(handle, { button: 0 });
  fireEvent.pointerMove(handle, { clientX: 25, clientY: 10 });
  fireEvent.pointerCancel(handle);
  fireEvent.pointerUp(handle);
  expect(onMoveProject).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it("lets the dashboard choose a connected provider and shows that account's model", () => {
  const onHomeAccount = vi.fn(), onHomeSelection = vi.fn();
  const p = props([]);
  const accounts: Account[] = [account, { ...account, id: "b", name: "Coding", provider: "codex" }];
  const view = render(<HomeView {...p} accounts={accounts} homeAccount="" onHomeAccount={onHomeAccount} onHomeSelection={onHomeSelection} />);
  chooseDashboard("Agent provider for dashboard threads", "Codex · Coding");
  expect(onHomeAccount).toHaveBeenCalledWith("b");
  view.rerender(<HomeView {...p} accounts={accounts} homeAccount="b" onHomeAccount={onHomeAccount} onHomeSelection={onHomeSelection} homeSelections={{ b: { model: "chosen-codex-model", effort: "default" } }} />);
  expect((screen.getByLabelText("Custom model ID") as HTMLInputElement).value).toBe("chosen-codex-model");

  chooseDashboard("Agent provider for dashboard threads", "Project defaults");
  expect(onHomeAccount).toHaveBeenLastCalledWith("");
});

it("updates recent thread status with the shared sidebar status and read cursors", () => {
  const p = props([thread("live", { status: "starting", updated: NOW })]);
  const { rerender } = render(<HomeView {...p} />);
  const recent = () => within(screen.getByRole("list", { name: "Recent threads in Alpha" }));
  expect(recent().getByRole("img", { name: "Starting" }).className).toContain("state-In-progress");
  const completed = { ...p, sessions: [thread("live", { status: "done", updated: NOW })] };
  rerender(<HomeView {...completed} />);
  expect(recent().getByRole("img", { name: "Unread reply" }).className).toContain("state-Needs-you");
  rerender(<HomeView {...completed} read={{ live: NOW }} />);
  expect(recent().getByRole("img", { name: "Completed" }).className).toContain("state-Done");
});

it('displays the last-selected integration while keeping automatic dashboard selection', () => {
  const accounts = [account, { ...account, id: 'rs', name: 'RS', provider: 'codex' as const }];
  const onHomeAccount = vi.fn();
  const preferences = { new_thread_policy: 'last_selected', last_selected: 'rs', fallback: 'a' };
  const resolveLaunch = (id: string) => resolveHomeLaunch(db({ accounts, preferences }), id, 'bypass');
  const p = { ...props([]), accounts, resolveLaunch, onHomeAccount };
  const view = render(<HomeView {...p} />);
  expect(screen.getByRole('combobox', { name: 'Agent provider for dashboard threads' }).textContent).toBe('Codex · RS');
  preferences.last_selected = 'a';
  view.rerender(<HomeView {...p} />);
  expect(screen.getByRole('combobox', { name: 'Agent provider for dashboard threads' }).textContent).toBe('Claude · Main');
  expect(onHomeAccount).not.toHaveBeenCalled();
});

it('groups dashboard projects by workspace with shared memberships and unassigned projects', () => {
  const p = props([], [project('alpha', 'Alpha'), project('beta', 'Beta'), project('other', 'Other')]);
  render(<HomeView {...p} workspaces={[
    { id: 'work', name: 'Work', color: '#888', projects: ['beta', 'alpha'] },
    { id: 'empty', name: 'Empty workspace', color: '#888', projects: ['missing'] },
    { id: 'personal', name: 'Personal', color: '#888', projects: ['alpha'] },
  ]} />);
  expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Work', 'Personal', 'Other projects']);
  expect(within(screen.getByRole('region', { name: 'Work' })).getAllByRole('article').map(a => a.getAttribute('aria-label'))).toEqual(['Project Alpha', 'Project Beta']);
  expect(within(screen.getByRole('region', { name: 'Personal' })).getByRole('article', { name: 'Project Alpha' })).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'Other projects' })).getByRole('article', { name: 'Project Other' })).toBeTruthy();
  expect(screen.queryByText('Empty workspace')).toBeNull();
});

it("shows a Sending row for an in-flight launch and drops it once the real thread arrives", () => {
  const launch = [{ id: "req", project: "alpha", title: "Fix the build", threadId: "new1" }];
  const p = props([thread("1")]);
  const { rerender } = render(<HomeView {...p} pendingLaunches={[{ ...launch[0], threadId: undefined }]} />);
  const alpha = screen.getByRole("article", { name: "Project Alpha" });
  expect(within(alpha).getByRole("button", { name: /Fix the build/ })).toBeTruthy();
  expect(within(alpha).getByRole("img", { name: "Sending…" })).toBeTruthy();
  expect(within(alpha).getByText("Alpha")).toBeTruthy();
  rerender(<HomeView {...p} pendingLaunches={launch} sessions={[thread("1"), thread("new1", { title: "Fix the build", status: "running", updated: NOW })]} />);
  expect(within(alpha).getAllByText("Fix the build")).toHaveLength(1);
  expect(within(alpha).queryByRole("img", { name: "Sending…" })).toBeNull();
});

it("labels sending and queued statuses", async () => {
  const { labelStatus } = await import("./ThreadStatus");
  expect(labelStatus("sending")).toBe("Sending…");
  expect(labelStatus("queued")).toBe("Queued");
});

it("opens a project sheet from the name, shows threads latest first, a thread inside the sheet, and keeps Home mounted", () => {
  const p = props([thread("old", { title: "Old one", updated: NOW - 9000 }), thread("new", { title: "New one", updated: NOW - 1000 }), thread("other", { project: "beta", title: "Beta one" })]);
  const renderThread = vi.fn((id: string) => <div data-testid="convo">conversation {id}</div>);
  render(<HomeView {...p} renderThread={renderThread} />);
  const home = screen.getByRole("region", { name: "Home" });
  const tile = screen.getByRole("article", { name: "Project Alpha" });
  fireEvent.click(screen.getByRole("button", { name: "New thread in Alpha" }));
  fireEvent.change(screen.getByLabelText("Prompt for Alpha") as HTMLElement, { target: { value: "keep me" } });
  fireEvent.click(screen.getByRole("button", { name: "Show threads in Alpha" }));
  const list = within(screen.getByRole("dialog")).getByRole("list", { name: "Threads in Alpha" });
  expect(within(list).getAllByRole("button").map(b => b.textContent)).toEqual([expect.stringContaining("New one"), expect.stringContaining("Old one")]);
  expect(p.onOpenThread).not.toHaveBeenCalled();
  fireEvent.click(within(list).getByRole("button", { name: /Old one/ }));
  expect(screen.getByTestId("convo").textContent).toBe("conversation old");
  expect(p.onOpenThread).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Back to threads" }));
  expect(screen.queryByTestId("convo")).toBeNull();
  expect(screen.getByRole("list", { name: "Threads in Alpha" })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("region", { name: "Home" })).toBe(home);
  expect(screen.getByRole("article", { name: "Project Alpha" })).toBe(tile);
  expect((screen.getByLabelText("Prompt for Alpha") as HTMLInputElement).value).toBe("keep me");
});

it("shows an empty project sheet with a New thread action", () => {
  const onNewThread = vi.fn();
  render(<HomeView {...props([])} onNewThread={onNewThread} renderThread={() => null} />);
  fireEvent.click(screen.getByRole("button", { name: "Show threads in Beta" }));
  expect(screen.getByText("No threads yet")).toBeTruthy();
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "New thread" }));
  expect(onNewThread).toHaveBeenCalledWith("beta");
  expect(screen.queryByRole("dialog")).toBeNull();
});
