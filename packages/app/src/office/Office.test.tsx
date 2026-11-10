import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Office } from "./index";
import type { Project, Session } from "../desktop/types";

const NOW = new Date(2026, 10, 4, 15, 0).getTime();
const project = (id: string, name: string): Project => ({ id, name, path: `/p/${id}`, color: "#888888", policy: "inherit", account: null, last: null });
const thread = (id: string, over: Partial<Session> = {}): Session => ({ id, title: `Title ${id}`, project: "alpha", account: "a", status: "running", updated: NOW - 1000, provider_id: null, messages: [], pending: null, error: null, ...over });
const pending = { id: 1 } as never;
const projects = [project("alpha", "Alpha"), project("beta", "Beta")];
const sessions = [thread("1"), thread("2", { project: "beta", status: "waiting" })];
afterEach(() => { cleanup(); vi.useRealTimers(); });

const mini = (over = {}) => {
  const onOpenThread = vi.fn();
  render(<Office variant="mini" sessions={sessions} projects={projects} now={NOW} onOpenThread={onOpenThread} {...over} />);
  return onOpenThread;
};
const floors = () => [...document.querySelectorAll(".office-floor")].map(r => ["x", "y", "width", "height"].map(k => r.getAttribute(k)).join(","));
const at = (name: RegExp) => (screen.getByRole("button", { name }).querySelector(".office-char > g") as SVGGElement).getAttribute("transform")!;

it("mini renders characters as buttons with project, title and state text", () => {
  mini();
  expect(screen.getByRole("button", { name: "Alpha · Title 1 · Working" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Beta · Title 2 · Needs you" })).toBeTruthy();
  expect(screen.getByText("1 working · 1 needs you")).toBeTruthy();
});

it("clicking a character opens its thread", () => {
  const open = mini();
  fireEvent.click(screen.getByRole("button", { name: /Title 2/ }));
  expect(open).toHaveBeenCalledWith("2");
});

it("expand opens the full overlay, Escape closes it and restores focus", () => {
  const onExpand = vi.fn(), onClose = vi.fn();
  mini({ onExpand, onClose });
  const expand = screen.getByRole("button", { name: "Expand office" });
  expand.focus();
  fireEvent.click(expand);
  const dialog = screen.getByRole("dialog", { name: "Office" });
  expect(onExpand).toHaveBeenCalled();
  expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Close office" }));
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(onClose).toHaveBeenCalled();
  expect(document.activeElement).toBe(expand);
});

it("clicking the mini background expands; opening a character from full closes the overlay and opens the thread", () => {
  const open = mini();
  fireEvent.click(document.querySelector(".office-stage") as HTMLElement);
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: /Title 1/ }));
  expect(open).toHaveBeenCalledWith("1");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("full variant renders the overlay directly and traps Tab focus", () => {
  const onClose = vi.fn();
  render(<Office variant="full" sessions={sessions} projects={projects} now={NOW} onOpenThread={vi.fn()} onClose={onClose} />);
  const dialog = screen.getByRole("dialog");
  const buttons = within(dialog).getAllByRole("button");
  buttons[buttons.length - 1].focus();
  fireEvent.keyDown(dialog, { key: "Tab" });
  expect(document.activeElement).toBe(buttons[0]);
  fireEvent.click(within(dialog).getByRole("button", { name: "Close office" }));
  expect(onClose).toHaveBeenCalled();
});

it("shows the clock shrine only when schedules exist", () => {
  mini();
  expect(screen.queryByLabelText("Scheduled work")).toBeNull();
  cleanup();
  mini({ schedules: [{ id: "s", name: "Nightly", project: "alpha", next_due: NOW + 3600_000, enabled: true }] });
  expect(screen.getByLabelText("Scheduled work").textContent).toContain("1 scheduled");
});

it("draws one scaling SVG with a room and scoreboard per project plus lobby, coffee lounge and your desk", () => {
  mini({ sessions: [thread("1", { messages: [{ id: "m", role: "user", text: "" }, { id: "n", role: "user", text: "" }] }), thread("2", { project: "beta", status: "waiting" })] });
  const svg = document.querySelector("svg.office-svg") as SVGSVGElement;
  expect(svg.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
  expect(svg.getAttribute("viewBox")).toMatch(/^0 0 \d+ \d+$/);
  expect(svg.getAttribute("width")).toBeNull();
  expect(screen.getByLabelText("Alpha room")).toBeTruthy();
  expect(screen.getByLabelText("Alpha scoreboard").textContent).toBe("2 msgs · 1 thread · 1 working");
  expect(screen.getByLabelText("Beta scoreboard").textContent).toBe("0 msgs · 1 thread · 0 working");
  for (const name of ["Lobby", "Coffee lounge", "Your desk"]) expect(screen.getByLabelText(name)).toBeTruthy();
  expect(screen.getByLabelText("Coffee lounge").textContent).toContain("WAITING FOR YOU · 1");
  expect(screen.getByLabelText("Lobby").textContent).toContain("RECEPTION");
});

it("shows finished threads as in-tray folders that open the thread, and no idle characters", () => {
  const open = mini({ sessions: [thread("d", { status: "done" }), thread("i", { status: "idle" })] });
  fireEvent.click(within(screen.getByLabelText("Your desk")).getByRole("button", { name: "Alpha · Title d · Done" }));
  expect(open).toHaveBeenCalledWith("d");
  expect(screen.queryByRole("button", { name: /Title i/ })).toBeNull();
});

it("legend counts every state with text, and Enter on a character opens its thread", () => {
  const open = mini();
  const legend = screen.getByLabelText("Agent states");
  expect(legend.textContent).toContain("Needs you1");
  expect(legend.textContent).toContain("Working1");
  expect(legend.textContent).toContain("Finished0");
  fireEvent.keyDown(screen.getByRole("button", { name: /Title 1/ }), { key: "Enter" });
  expect(open).toHaveBeenCalledWith("1");
});

it("does not move or resize anything when thread states change", () => {
  const { rerender } = render(<Office variant="mini" sessions={sessions} projects={projects} now={NOW} onOpenThread={vi.fn()} />);
  const before = floors(), viewBox = document.querySelector("svg.office-svg")!.getAttribute("viewBox");
  const changed = [thread("1", { status: "done" }), thread("2", { project: "beta", status: "running" }), thread("3", { status: "failed" }), thread("4", { status: "starting" }), thread("5", { pending })];
  rerender(<Office variant="mini" sessions={changed} projects={projects} now={NOW} onOpenThread={vi.fn()} />);
  expect(floors()).toEqual(before);
  expect(document.querySelector("svg.office-svg")!.getAttribute("viewBox")).toBe(viewBox);
  rerender(<Office variant="mini" sessions={[]} projects={projects} now={NOW} onOpenThread={vi.fn()} />);
  expect(floors()).toEqual(before);
  rerender(<Office variant="mini" sessions={sessions} projects={[...projects, project("gamma", "Gamma")]} now={NOW} onOpenThread={vi.fn()} />);
  expect(floors()).not.toEqual(before);
});

it("places existing characters at their destination on first mount and walks new ones in through the door at constant speed", () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  const { rerender } = render(<Office variant="mini" sessions={sessions} projects={projects} now={NOW} onOpenThread={vi.fn()} />);
  const seated = at(/Title 1/);
  expect(seated).toMatch(/^translate\(/);
  vi.advanceTimersByTime(3000);
  vi.setSystemTime(Date.now() + 3000);
  rerender(<Office variant="mini" sessions={[...sessions, thread("3")]} projects={projects} now={NOW} onOpenThread={vi.fn()} />);
  expect(at(/Title 3/)).not.toBe(seated);
  const start = at(/Title 3/);
  act(() => { vi.advanceTimersByTime(1000); });
  const later = at(/Title 3/);
  expect(later).not.toBe(start);
  act(() => { vi.advanceTimersByTime(60_000); });
  expect(at(/Title 3/)).not.toBe(later);
  const arrived = at(/Title 3/);
  act(() => { vi.advanceTimersByTime(5000); });
  expect(at(/Title 3/)).toBe(arrived);
});

it("keeps a finished thread's character until it has left through the front door", () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  const { rerender } = render(<Office variant="mini" sessions={sessions} projects={projects} now={NOW} onOpenThread={vi.fn()} />);
  vi.advanceTimersByTime(3000);
  rerender(<Office variant="mini" sessions={[thread("1", { status: "done" }), sessions[1]]} projects={projects} now={NOW} onOpenThread={vi.fn()} />);
  expect(screen.queryByLabelText("Your desk")!.querySelector("[aria-label*='Title 1']")).toBeNull();
  expect(screen.getAllByRole("button", { name: /Title 1/ })).toHaveLength(1);
  act(() => { vi.advanceTimersByTime(120_000); });
  const buttons = screen.getAllByRole("button", { name: /Title 1/ });
  expect(buttons).toHaveLength(1);
  expect(within(screen.getByLabelText("Your desk")).getByRole("button", { name: /Title 1/ })).toBeTruthy();
});

it("gathers enabled schedules at a separate shrine with bounded admirers and overflow", () => {
  const schedules = Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, name: `Task ${i}`, project: 'alpha', next_due: NOW + (i + 1) * 3600_000, enabled: i !== 0 }));
  const { rerender } = render(<Office variant="mini" sessions={[]} projects={projects} schedules={schedules} now={NOW} onOpenThread={vi.fn()} />);
  const shrine = screen.getByLabelText('Clock shrine');
  expect(within(shrine).getAllByRole('img')).toHaveLength(4);
  expect(shrine.textContent).toContain('6 scheduled · +2 more');
  expect(within(shrine).queryByRole('img', { name: /Task 0/ })).toBeNull();
  expect(within(shrine).getByRole('img', { name: /Alpha · Task 1/ })).toBeTruthy();
  expect(within(shrine).queryByRole('button')).toBeNull();
  expect(screen.getByLabelText('Coffee lounge').contains(shrine)).toBe(false);
  const before = floors();
  rerender(<Office variant="mini" sessions={[]} projects={projects} schedules={[]} now={NOW} onOpenThread={vi.fn()} />);
  expect(floors()).toEqual(before);
  expect(screen.getByLabelText('Clock shrine').textContent).toContain('NO SCHEDULED TASKS');
  expect(screen.queryByLabelText('Scheduled work')).toBeNull();
});

it("keeps a project-colored reserve for every project even without threads", () => {
  mini({ sessions: [] });
  for (const p of projects) {
    const reserve = screen.getByRole('img', { name: `${p.name} · Ready for a task` });
    expect(reserve.querySelector(`rect[fill="${p.color}"]`)).toBeTruthy();
    expect(screen.getByLabelText('Lobby').contains(reserve)).toBe(true);
  }
});

it("walks a new task from its project reserve, then to coffee for confirmation and back to its desk", () => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  const { rerender } = render(<Office variant="mini" sessions={sessions} projects={projects} now={NOW} onOpenThread={vi.fn()} />);
  const reserve = screen.getByRole('img', { name: 'Alpha · Ready for a task' }).querySelector('g[transform]')!.getAttribute('transform');
  act(() => { vi.advanceTimersByTime(3000); });
  const updated = [...sessions, thread('new')];
  const paint = (items: Session[]) => rerender(<Office variant="mini" sessions={items} projects={projects} now={NOW} onOpenThread={vi.fn()} />);
  paint(updated);
  expect(at(/Title new/)).toBe(reserve);
  act(() => { vi.advanceTimersByTime(60_000); });
  const desk = at(/Title new/);
  expect(desk).not.toBe(reserve);
  paint([...sessions, thread('new', { status: 'failed', pending })]);
  act(() => { vi.advanceTimersByTime(60_000); });
  const coffee = at(/Title new/);
  expect(coffee).not.toBe(desk);
  expect(screen.getByRole('button', { name: /Title new · Needs you/ })).toBeTruthy();
  paint(updated);
  act(() => { vi.advanceTimersByTime(60_000); });
  expect(at(/Title new/)).toBe(desk);
});

it('selects a room for orders in mini and expanded views without opening a thread', () => {
  const controls = vi.fn((project: string) => <button>Mic for {project}</button>);
  const open = mini({ renderTaskControls: controls });
  fireEvent.click(screen.getByRole('button', { name: 'Give an order to Beta' }));
  expect(screen.getByText('Mic for beta')).toBeTruthy();
  expect(open).not.toHaveBeenCalled();
  const dialog = screen.getByRole('dialog');
  fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Give an order to Alpha' }), { key: 'Enter' });
  expect(within(dialog).getByText('Mic for alpha')).toBeTruthy();
});

it('gives a renamed Commander one executive office and opens Commander instead of a task', () => {
  const boss = { ...project('chief', 'Ada'), kind: 'commander' as const };
  const open = vi.fn(), controls = vi.fn(() => <button>Task microphone</button>);
  mini({ projects: [boss, ...projects], sessions: [thread('boss-1', { project: 'chief' }), thread('boss-2', { project: 'chief' }), ...sessions],
    onOpenCommander: open, renderTaskControls: controls });
  const office = screen.getByRole('button', { name: "Boss's office · Ada" });
  expect(office.querySelectorAll('.office-executive-desk')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Give an order to Ada' })).toBeNull();
  expect(screen.queryByLabelText('Ada · Ready for a task')).toBeNull();
  expect(screen.queryByRole('button', { name: /Ada · Title boss/ })).toBeNull();
  fireEvent.keyDown(office, { key: 'Enter' });
  expect(open).toHaveBeenCalledTimes(1);
  expect(controls).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Expand office' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: "Boss's office · Ada" }));
  expect(open).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('dialog')).toBeNull();
});

const hold = (id: string, project: string | null, summary = `Task ${id}`) => ({ id, tool: 'freddai_start_task', summary, project, arguments: {}, status: 'pending' });

it('puts a proposal card on an empty desk in the target room and wires Approve and Dismiss', async () => {
  const respond = vi.fn(async () => ({}));
  mini({ proposals: [hold('p1', 'beta', 'Fix login')], onProposalRespond: respond });
  const room = screen.getByRole('group', { name: 'Beta room' });
  expect(within(room).getByRole('group', { name: 'Proposed task: Fix login' })).toBeTruthy();
  fireEvent.click(within(room).getByRole('button', { name: 'Approve: Fix login' }));
  expect(respond).toHaveBeenCalledWith('p1', true);
  await vi.waitFor(() => expect(within(room).getByRole('button', { name: 'Dismiss: Fix login' }).getAttribute('aria-disabled')).toBeNull());
  fireEvent.click(within(room).getByRole('button', { name: 'Dismiss: Fix login' }));
  expect(respond).toHaveBeenCalledWith('p1', false);
});

it('shows a loud error when answering a proposal fails, and sends unrouted cards to the lobby', async () => {
  const respond = vi.fn(async () => { throw new Error('boom'); });
  mini({ proposals: [hold('p2', null, 'Orphan task')], onProposalRespond: respond });
  const lobby = screen.getByRole('group', { name: 'Lobby' });
  fireEvent.click(within(lobby).getByRole('button', { name: 'Approve: Orphan task' }));
  expect((await screen.findByRole('alert')).textContent).toContain('boom');
});

it('renders cards view-only without a respond handler and marks the Commander desk working', () => {
  const boss = { ...project('chief', 'Ada'), kind: 'commander' as const };
  mini({ projects: [boss, ...projects], sessions: [thread('b1', { project: 'chief' }), ...sessions], proposals: [hold('p3', 'alpha', 'View only')], onOpenCommander: vi.fn() });
  expect(screen.getByRole('group', { name: 'Proposed task: View only' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Approve: View only/ })).toBeNull();
  expect(document.querySelector('.office-boss-suite')?.getAttribute('data-state')).toBe('working');
});

it("keeps zoom controls in the footer and out of the floor plan in both views", () => {
  mini();
  const zoom = screen.getByRole("button", { name: "Zoom in" });
  expect(zoom.closest(".office-bar")).toBeTruthy();
  fireEvent.click(zoom);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "Fit all" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Expand office" }));
  const dialog = screen.getByRole("dialog");
  const fullZoom = within(dialog).getByRole("button", { name: "Zoom in" });
  expect(fullZoom.closest(".office-bar")).toBeTruthy();
  fireEvent.click(fullZoom);
  expect(within(dialog).getByRole("button", { name: "Fit all" }).getAttribute("aria-pressed")).toBe("true");
});
