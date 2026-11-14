import { resetDrafts, getDraft, setDraft, newThreadDraftKey } from "./drafts";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeView, homeProjects } from "./HomeView";
import { HOME_RECENT_ONLY_KEY } from "../office/officeFilter";
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
afterEach(() => { cleanup(); resetDrafts(); mic.ready = false; localStorage.removeItem(HOME_RECENT_ONLY_KEY); });

const db = (over: Record<string, unknown> = {}) => ({ accounts: [account], projects: [project("alpha", "Alpha"), project("beta", "Beta")], sessions: [], preferences: { fallback: "a" }, ...over }) as never;
const props = (sessions: Session[], projects = [project("alpha", "Alpha"), project("beta", "Beta")]) => ({
  sessions, projects, accounts: [account], now: NOW, canCreate: true,
  onNewThread: vi.fn(), onOpenThread: vi.fn(), resolveLaunch: vi.fn((id: string): HomeLaunchPlan => resolveHomeLaunch(db(), id, "bypass")), onAddProject: vi.fn(), onCreateThread: vi.fn(async () => {}), onRespond: vi.fn(async () => {}),
});

HTMLElement.prototype.scrollIntoView ??= () => {};
function chooseDashboard(label: string, option: string) {
  if (!screen.queryByRole('dialog')) fireEvent.click(screen.getByRole('button', { name: 'Assistant and difficulty' }));
  screen.queryByRole('button', { name: '← Levels' }) && fireEvent.click(screen.getByRole('button', { name: '← Levels' }));
  if (label === 'Difficulty') fireEvent.click(screen.getByRole('button', { name: 'Project defaults' }));
  else if (screen.queryByRole('button', { name: /Back to assistants/ })) fireEvent.click(screen.getByRole('button', { name: /Back to assistants/ }));
  fireEvent.click(screen.getByRole('button', { name: option }));
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
  setDraft(newThreadDraftKey("alpha"), "My draft");
  for (const now of [NOW + 2000, MIDNIGHT + 86_400_000]) {
    rerender(<HomeView {...p} now={now} sessions={[...p.sessions, thread("3", { project: "beta", status: "running", updated: now })]} />);
    expect(Array.from(tiles.children).map(card => card.querySelector("article"))).toEqual([alpha, beta]);
    expect(getDraft(newThreadDraftKey("alpha"))).toBe("My draft");
    expect(within(beta).queryByLabelText("1 working")).toBeNull();
  }
});

it("does not render a counters row or project colour square on project cards", () => {
  render(<HomeView {...props([
    thread("1", { status: "running" }),
    thread("2", { status: "starting" }),
    thread("3", { status: "done" }),
    thread("4", { status: "done", updated: MIDNIGHT - 5000 }),
    thread("5", { status: "running", pending }),
  ])} />);
  const tile = within(screen.getByRole("article", { name: "Project Alpha" }));
  expect(tile.queryByLabelText("2 working")).toBeNull();
  expect(document.querySelector(".home-counts, .home-tile .home-project-dot")).toBeNull();
  const actions = screen.getByRole("button", { name: "New thread in Alpha" }).parentElement!;
  expect(actions.querySelector("button")?.getAttribute("aria-label")).toBe("New thread in Alpha");
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



it("shows the chip when the mic is pressed", () => {
  mic.ready = true;
  render(<HomeView {...props([thread("1")])} />);
  fireEvent.pointerDown(within(screen.getByRole("article", { name: "Project Alpha" })).getByRole("button", { name: "Dictate" }));
  expect(screen.getByLabelText(/^Agent: Claude · Main/)).toBeTruthy();
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
  expect(within(header).getByRole("button", { name: "Assistant and difficulty" }).textContent).toContain("Opus");
  chooseDashboard("Difficulty", "Fast");
  expect(onHomeSelection).toHaveBeenCalledWith("a", { model: "freddai-level:fast", effort: "default" });
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
  setDraft(newThreadDraftKey("alpha"), "Keep this draft");
  fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Alpha" }), { altKey: true, key: "ArrowDown" });
  expect(onMoveProject).toHaveBeenCalledWith("alpha", "beta", true);
  rerender(<HomeView {...p} projects={[p.projects[1], p.projects[0]]} onMoveProject={onMoveProject} />);
  expect(screen.getAllByRole("article").map(node => node.getAttribute("aria-label"))).toEqual(["Project Beta", "Project Alpha"]);
  expect(getDraft(newThreadDraftKey("alpha"))).toBe("Keep this draft");
});

it("renders one sortable group per workspace with a handle per card", () => {
  const p = props([]);
  const workspaces = [{ id: "w1", name: "Work", color: "#111", projects: ["alpha"] }, { id: "w2", name: "Play", color: "#222", projects: [] }];
  render(<HomeView {...p} workspaces={workspaces} onMoveProject={vi.fn()} onMoveProjectToWorkspace={vi.fn()} />);
  expect(screen.getByRole("region", { name: "Work" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Other projects" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Reorder Beta" })).toBeTruthy();
});

it("lets the dashboard choose a connected provider and shows that account's model", () => {
  const onHomeAccount = vi.fn(), onHomeSelection = vi.fn();
  const p = props([]);
  const accounts: Account[] = [account, { ...account, id: "b", name: "Coding", provider: "codex" }];
  const view = render(<HomeView {...p} accounts={accounts} homeAccount="" onHomeAccount={onHomeAccount} onHomeSelection={onHomeSelection} />);
  chooseDashboard("Agent provider for dashboard threads", "Codex · Coding");
  expect(onHomeAccount).toHaveBeenCalledWith("b");
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  view.rerender(<HomeView {...p} accounts={accounts} homeAccount="b" onHomeAccount={onHomeAccount} onHomeSelection={onHomeSelection} homeSelections={{ b: { model: "chosen-codex-model", effort: "default" } }} />);
  expect(screen.getByRole("button", { name: "Assistant and difficulty" }).textContent).toContain("Chosen-codex-model");
  expect(screen.queryByLabelText("Custom model ID")).toBeNull();

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
  expect(screen.getByRole('button', { name: 'Assistant and difficulty' }).textContent).toContain('Codex · RS');
  preferences.last_selected = 'a';
  view.rerender(<HomeView {...p} />);
  expect(screen.getByRole('button', { name: 'Assistant and difficulty' }).textContent).toContain('Claude · Main');
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
});

describe("project panel", () => {
  const setup = (extra: object = {}) => {
    const p = props([thread("a", { title: "Alpha thread", updated: NOW - 1000 })]);
    const renderThread = (id: string) => <div data-testid="convo">conversation {id}<textarea aria-label="Reply" /></div>;
    const onNewThread = vi.fn();
    const utils = render(<HomeView {...p} renderThread={renderThread} onNewThread={onNewThread} {...extra} />);
    return { p, onNewThread, ...utils, home: screen.getByRole("region", { name: "Home" }) };
  };
  const esc = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

  it("opens the sheet from a tile click with sidebar-style thread rows", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Show threads in Alpha" }));
    const row = within(screen.getByRole("list", { name: "Threads in Alpha" })).getByRole("button", { name: /Alpha thread/ });
    expect(row.className).toContain("task-row");
    expect(row.className).toContain("compact-session");
    expect(row.querySelector(".session-title")?.textContent).toBe("Alpha thread");
  });

  it("opens a thread in the panel without leaving the dashboard, with a full-page action", () => {
    const { p, home } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Show threads in Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: /Alpha thread/ }));
    expect(screen.getByTestId("convo").textContent).toContain("conversation a");
    expect(p.onOpenThread).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Home" })).toBe(home);
    fireEvent.click(screen.getByRole("button", { name: /Open full page/ }));
    expect(p.onOpenThread).toHaveBeenCalledWith("a");
  });



  it("Escape steps back from thread to list, then closes, leaving the dashboard mounted", () => {
    const { home } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Show threads in Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: /Alpha thread/ }));
    esc();
    expect(screen.queryByTestId("convo")).toBeNull();
    expect(screen.getByRole("list", { name: "Threads in Alpha" })).toBeTruthy();
    esc();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("region", { name: "Home" })).toBe(home);
  });



  it("does not close the panel while an inner listbox popup is open", () => {
    setup({ renderThread: () => <div><ul role="listbox" aria-label="Slash commands"><li role="option" aria-selected>/x</li></ul></div> });
    fireEvent.click(screen.getByRole("button", { name: "Show threads in Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: /Alpha thread/ }));
    esc();
    expect(screen.getByRole("listbox", { name: "Slash commands" })).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

it("shows an empty project sheet with a New thread action", () => {
  const onNewThread = vi.fn();
  render(<HomeView {...props([])} onNewThread={onNewThread} renderThread={() => null} />);
  fireEvent.click(screen.getByRole("button", { name: "Show threads in Beta" }));
  expect(screen.getByText("No threads yet")).toBeTruthy();
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "New thread" }));
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(onNewThread).toHaveBeenCalledWith("beta");
});

describe("old projects filter", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const mixed = () => ({ ...props([thread("new", { project: "alpha", updated: NOW - DAY }), thread("old", { project: "beta", updated: NOW - 8 * DAY })]), schedules: [] });
  const names = () => screen.queryAllByRole("article").map(n => n.getAttribute("aria-label"));

  it("hides projects with no recent activity by default", () => {
    render(<HomeView {...mixed()} />);
    expect(names()).toEqual(["Project Alpha"]);
  });
  it("shows a counted toggle that reveals old projects, flips its label and persists", () => {
    const p = mixed();
    const { unmount } = render(<HomeView {...p} />);
    const toggle = screen.getByRole("button", { name: /Show old projects \(1\)/ });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.getAttribute("title")).toContain("last 7 days");
    fireEvent.click(toggle);
    expect(names()).toEqual(["Project Alpha", "Project Beta"]);
    expect(screen.getByRole("button", { name: /Hide old projects/ }).getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem(HOME_RECENT_ONLY_KEY)).toBe("false");
    unmount();
    render(<HomeView {...p} />);
    expect(names()).toEqual(["Project Alpha", "Project Beta"]);
  });
  it("renders no toggle when nothing is old", () => {
    render(<HomeView {...props([thread("a"), thread("b", { project: "beta" })])} schedules={[]} />);
    expect(screen.queryByRole("button", { name: /old projects/ })).toBeNull();
  });
  it("offers a way back when every project is old", () => {
    render(<HomeView {...props([thread("a", { updated: NOW - 9 * DAY }), thread("b", { project: "beta", updated: NOW - 9 * DAY })])} schedules={[]} />);
    expect(screen.getByText(/All 2 projects are old\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show old projects." }));
    expect(names()).toEqual(["Project Alpha", "Project Beta"]);
  });
  it("keeps an old project with an enabled schedule", () => {
    const p = mixed();
    render(<HomeView {...p} schedules={[{ id: "s1", name: "Nightly", project: "beta", next_due: NOW + DAY, enabled: true }]} />);
    expect(names()).toEqual(["Project Alpha", "Project Beta"]);
  });
  it("reorders relative to a visible neighbour so hidden projects keep their place in the saved order", () => {
    const projects = [project("alpha", "Alpha"), project("hidden", "Hidden"), project("gamma", "Gamma")];
    const p = props([thread("a", { project: "alpha" }), thread("g", { project: "gamma" }), thread("h", { project: "hidden", updated: NOW - 9 * DAY })], projects);
    const onMoveProject = vi.fn();
    render(<HomeView {...p} schedules={[]} onMoveProject={onMoveProject} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Alpha" }), { altKey: true, key: "ArrowDown" });
    expect(onMoveProject).toHaveBeenCalledWith("alpha", "gamma", true);
  });
});

describe("needs you section", () => {
  afterEach(cleanup);
  it("is hidden when nothing is waiting", () => {
    render(<HomeView {...props([thread("a")])} schedules={[]} />);
    expect(screen.queryByRole("region", { name: "Needs you" })).toBeNull();
    expect(screen.queryByText("Nothing is waiting on you.")).toBeNull();
  });
  it("appears before Projects when a thread is waiting", () => {
    render(<HomeView {...props([thread("a", { pending })])} schedules={[]} />);
    const needs = screen.getByRole("region", { name: "Needs you" });
    const projects = screen.getByRole("region", { name: "Projects" });
    expect(needs.compareDocumentPosition(projects) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

it('routes every project plus to the host composer without adding a local message form', () => {
  const p = props([]);
  render(<HomeView {...p} renderThread={() => null} />);
  for (const name of ['Alpha', 'Beta']) fireEvent.click(screen.getByRole('button', { name: 'New thread in ' + name }));
  expect(p.onNewThread.mock.calls).toEqual([['alpha'], ['beta']]);
  expect(p.onCreateThread).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox')).toBeNull();
});
