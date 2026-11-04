import { expect, it } from "vitest";
import { officeModel, OFFICE_LINGER_MS } from "./officeModel";
import type { Project, Session } from "../desktop/types";

const NOW = new Date(2026, 10, 4, 15, 0).getTime();
const project = (id: string, name: string): Project => ({ id, name, path: `/p/${id}`, color: "#abc", policy: "inherit", account: null, last: null });
const thread = (id: string, over: Partial<Session> = {}): Session => ({ id, title: `T${id}`, project: "alpha", account: "a", status: "running", updated: NOW - 1000, provider_id: null, messages: [], pending: null, error: null, ...over });
const projects = [project("alpha", "Alpha"), project("beta", "Beta")];
const pending = { id: 1, request: { subtype: "can_use_tool", tool_name: "Bash", input: {} } } as never;

it("maps run states to agent states with cue and label", () => {
  const m = officeModel([
    thread("w"), thread("n", { pending }), thread("f", { status: "failed" }),
    thread("d", { status: "done" }), thread("r", { status: "review" }), thread("i", { status: "idle" }),
  ], projects, NOW);
  const by = Object.fromEntries(m.agents.map(a => [a.threadId, a]));
  expect(by.w).toMatchObject({ state: "working", stateLabel: "Working" });
  expect(by.n).toMatchObject({ state: "needs-you", cue: "?" });
  expect(by.f).toMatchObject({ state: "failed", cue: "!" });
  expect(by.d.state).toBe("done"); expect(by.r.state).toBe("review"); expect(by.i.state).toBe("idle");
});

it("groups one desk per thread into project rooms, needs-you rooms first", () => {
  const m = officeModel([thread("1"), thread("2", { updated: NOW - 5 }), thread("3", { project: "beta", status: "waiting" })], projects, NOW);
  expect(m.rooms.map(r => r.projectId)).toEqual(["beta", "alpha"]);
  expect(m.rooms[1].agents.map(a => a.threadId)).toEqual(["2", "1"]);
  expect(m.rooms[1].agents.map(a => a.desk)).toEqual([0, 1]);
  expect(m.summary).toBe("2 working · 1 needs you");
});

it("drops archived, deleted and stale finished threads but keeps stale running ones", () => {
  const old = NOW - OFFICE_LINGER_MS - 1;
  const m = officeModel([thread("a", { archived: true }), thread("b", { deleted_at: 1 }), thread("c", { status: "done", updated: old }), thread("d", { updated: old })], projects, NOW);
  expect(m.agents.map(a => a.threadId)).toEqual(["d"]);
});

it("is empty without active threads and has no shrine without schedules", () => {
  const m = officeModel([], projects, NOW);
  expect(m).toMatchObject({ rooms: [], agents: [], shrine: null, summary: "Office is empty" });
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
