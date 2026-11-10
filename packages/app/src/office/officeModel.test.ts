import { expect, it } from "vitest";
import { agentState, officeModel, OFFICE_LINGER_MS, projectTotals, totalsLabel } from "./officeModel";
import type { Project, Session } from "../desktop/types";

const NOW = new Date(2026, 10, 4, 15, 0).getTime();
const project = (id: string, name: string): Project => ({ id, name, path: `/p/${id}`, color: "#abc", policy: "inherit", account: null, last: null });
const thread = (id: string, over: Partial<Session> = {}): Session => ({ id, title: `T${id}`, project: "alpha", account: "a", status: "running", updated: NOW - 1000, provider_id: null, messages: [], pending: null, error: null, ...over });
const projects = [project("alpha", "Alpha"), project("beta", "Beta"), project("gamma", "Gamma")];
const pending = { id: 1, request: { subtype: "can_use_tool", tool_name: "Bash", input: {} } } as never;
const msgs = (user: number, assistant = 0) => [...Array(user).fill(0).map((_, i) => ({ id: `u${i}`, role: "user", text: "" })), ...Array(assistant).fill(0).map((_, i) => ({ id: `a${i}`, role: "assistant", text: "" }))];

it("maps run states to agent states, places, cue and label", () => {
  const m = officeModel([
    thread("w"), thread("n", { pending }), thread("f", { status: "failed" }), thread("s", { status: "starting" }),
    thread("d", { status: "done" }), thread("r", { status: "review" }), thread("i", { status: "idle" }),
  ], projects, NOW);
  const by = Object.fromEntries(m.agents.map(a => [a.threadId, a]));
  expect(by.w).toMatchObject({ state: "working", place: "desk", stateLabel: "Working" });
  expect(by.n).toMatchObject({ state: "needs-you", place: "lounge", cue: "?", tag: 1 });
  expect(by.f).toMatchObject({ state: "failed", place: "desk", cue: "!" });
  expect(by.s).toMatchObject({ state: "starting", place: "lobby" });
  expect(by.d).toMatchObject({ state: "done", place: "tray" });
  expect(by.r).toMatchObject({ state: "review", place: "tray" });
  expect(by.i).toBeUndefined();
  expect(agentState({ status: "idle", pending: null })).toBe("idle");
});

it("has one room per project in the order of the projects array, whatever the threads do", () => {
  const quiet = officeModel([], projects, NOW);
  expect(quiet.rooms.map(r => r.projectId)).toEqual(["alpha", "beta", "gamma"]);
  const busy = officeModel([thread("1", { project: "gamma", pending }), thread("2", { project: "gamma", updated: NOW }), thread("3", { project: "beta", status: "failed" })], projects, NOW);
  expect(busy.rooms.map(r => r.projectId)).toEqual(["alpha", "beta", "gamma"]);
  expect(busy.rooms[2].agents.map(a => a.threadId)).toEqual(["2"]);
  expect(officeModel([thread("x", { project: "unknown" })], projects, NOW).agents).toEqual([]);
});

it("keeps finished threads as tray folders inside the linger window, newest first, and drops archived or deleted ones", () => {
  const old = NOW - OFFICE_LINGER_MS - 1;
  const m = officeModel([
    thread("a", { archived: true }), thread("b", { deleted_at: 1 }), thread("c", { status: "done", updated: old }),
    thread("d", { updated: old }), thread("e", { status: "done", updated: NOW - 50 }), thread("f", { status: "review", updated: NOW - 10 }),
  ], projects, NOW);
  expect(m.tray.map(a => a.threadId)).toEqual(["f", "e"]);
  expect(m.agents.map(a => a.threadId).sort()).toEqual(["d", "e", "f"]);
});

it("numbers needs-you agents oldest first so numbers never shift when a newer one appears", () => {
  const first = officeModel([thread("a", { pending, updated: NOW - 100 }), thread("b", { pending, updated: NOW - 200 })], projects, NOW);
  expect(first.agents.map(a => [a.threadId, a.tag])).toEqual([["a", 2], ["b", 1]]);
  const next = officeModel([thread("a", { pending, updated: NOW - 100 }), thread("b", { pending, updated: NOW - 200 }), thread("c", { pending, updated: NOW })], projects, NOW);
  expect(Object.fromEntries(next.agents.map(a => [a.threadId, a.tag]))).toEqual({ a: 2, b: 1, c: 3 });
  expect(first.summary).toBe("2 need you");
});

it("sends settled threads with queued runs to the lobby", () => {
  const m = officeModel([thread("q", { status: "done" }), thread("p", { status: "done" })], projects, NOW, [], new Set(["q"]));
  expect(m.agents.find(a => a.threadId === "q")).toMatchObject({ place: "lobby", stateLabel: "Queued" });
  expect(m.tray.map(a => a.threadId)).toEqual(["p"]);
});

it("counts scoreboard totals over every live thread of the project, not just the lingering ones", () => {
  const old = NOW - 10 * OFFICE_LINGER_MS;
  const totals = projectTotals([
    thread("1", { messages: msgs(3, 4) }), thread("2", { status: "done", updated: old, messages: msgs(2) }),
    thread("3", { archived: true, messages: msgs(9) }), thread("4", { deleted_at: 5, messages: msgs(9) }),
    thread("5", { project: "beta", status: "starting", messages: msgs(1) }), thread("6", { project: "nope", messages: msgs(1) }),
  ], projects);
  expect(totals.get("alpha")).toEqual({ msgs: 5, threads: 2, working: 1 });
  expect(totals.get("beta")).toEqual({ msgs: 1, threads: 1, working: 1 });
  expect(totals.get("gamma")).toEqual({ msgs: 0, threads: 0, working: 0 });
  expect(totals.has("nope")).toBe(false);
  expect(totalsLabel({ msgs: 50, threads: 5, working: 2 })).toBe("50 msgs · 5 threads · 2 working");
  expect(totalsLabel({ msgs: 1, threads: 1, working: 0 })).toBe("1 msg · 1 thread · 0 working");
  expect(officeModel([thread("2", { status: "done", updated: old, messages: msgs(2) })], projects, NOW).rooms[0].totals.msgs).toBe(2);
});

it("is empty without threads and has no shrine without schedules", () => {
  expect(officeModel([], projects, NOW)).toMatchObject({ agents: [], tray: [], shrine: null, summary: "Office is empty" });
});

it("builds the clock shrine from enabled schedules sorted by due time", () => {
  const m = officeModel([], projects, NOW, [
    { id: "b", name: "B", project: "beta", next_due: NOW + 20, enabled: true },
    { id: "a", name: "A", project: "alpha", next_due: NOW + 10, enabled: true },
    { id: "x", name: "X", project: "alpha", next_due: NOW, enabled: false },
  ]);
  expect(m.shrine?.entries.map(e => e.id)).toEqual(["a", "b"]);
  expect(m.shrine?.next).toBe(NOW + 10);
});

it('keeps the boss room but does not clone Commander conversations into workers or folders', () => {
  const chief = { ...project('chief', 'Ada'), kind: 'commander' as const };
  const model = officeModel([thread('normal'), thread('chief-running', { project: 'chief' }), thread('chief-done', { project: 'chief', status: 'done' })], [chief, ...projects], NOW);
  expect(model.rooms[0].name).toBe('Ada');
  expect(model.agents.map(agent => agent.threadId)).toEqual(['normal']);
  expect(model.tray).toHaveLength(0);
  expect(model.summary).toBe('1 working');
});

const hold = (id: string, over: Record<string, unknown> = {}) => ({ id, tool: 'freddai_start_task', summary: `Start ${id}`, project: 'beta', arguments: { prompt: 'x' }, status: 'pending', ...over });

it('shows one Commander desk: working while any Commander thread runs, idle otherwise, never on project desks', () => {
  const chief = { ...project('chief', 'Ada'), kind: 'commander' as const };
  const busy = officeModel([thread('c1', { project: 'chief' }), thread('c2', { project: 'chief', status: 'done' })], [chief, ...projects], NOW);
  expect(busy.commander).toMatchObject({ projectId: 'chief', name: 'Ada', state: 'working', running: 1 });
  expect(busy.agents).toHaveLength(0);
  const quiet = officeModel([thread('c2', { project: 'chief', status: 'done' })], [chief, ...projects], NOW);
  expect(quiet.commander).toMatchObject({ state: 'idle', running: 0 });
  expect(officeModel([], projects, NOW).commander).toBeNull();
});

it('turns only pending freddai_start_task holds into cards, routed to the target room or the lobby', () => {
  const chief = { ...project('chief', 'Ada'), kind: 'commander' as const };
  const m = officeModel([], [chief, ...projects], NOW, [], new Set(), [
    hold('a'), hold('b', { project: 'nowhere' }), hold('c', { project: null }), hold('d', { project: 'chief' }),
    hold('e', { status: 'approved' }), hold('f', { tool: 'freddai_save_schedule' }), hold('g', { arguments: { title: 'Fix login' } }),
  ]);
  expect(m.cards.map(c => [c.proposalId, c.projectId])).toEqual([['a', 'beta'], ['b', null], ['c', null], ['d', null], ['g', 'beta']]);
  expect(m.cards.find(c => c.proposalId === 'g')?.title).toBe('Fix login');
  expect(m.cards[0].title).toBe('Start a');
});
