import { expect, it } from "vitest";
import { officeModel } from "./officeModel";
import { floorPlan, LOUNGE_MAX } from "./officeLayout";
import { newSlotMemory, resolveDestinations } from "./officeStage";
import type { Project, Session } from "../desktop/types";

const NOW = new Date(2026, 10, 4, 15, 0).getTime();
const project = (id: string): Project => ({ id, name: id, path: "/", color: "#abc", policy: "inherit", account: null, last: null });
const projects = [project("alpha"), project("beta")];
const layout = floorPlan(projects.map(p => ({ id: p.id, name: p.name, color: p.color })), 2);
const pending = { id: 1 } as never;
const thread = (id: string, over: Partial<Session> = {}): Session => ({ id, title: id, project: "alpha", account: "a", status: "running", updated: NOW, provider_id: null, messages: [], pending: null, error: null, ...over });
const resolve = (sessions: Session[], memory = newSlotMemory()) => resolveDestinations(officeModel(sessions, projects, NOW), layout, memory);

it("seats working agents at desks, failed ones standing, waiting ones in the lounge and starting ones on benches", () => {
  const d = resolve([thread("w"), thread("f", { status: "failed" }), thread("n", { pending }), thread("s", { status: "starting" }), thread("done", { status: "done" })]);
  expect(d.dest.get("agent:w")).toMatchObject({ pose: "seated", node: expect.stringMatching(/^seat:0:/) });
  expect(d.dest.get("agent:f")).toMatchObject({ pose: "stand", node: expect.stringMatching(/^stand:0:/) });
  expect(d.dest.get("agent:n")).toEqual({ node: "lounge:0", pose: "cup" });
  expect(d.dest.get("agent:s")).toEqual({ node: "lobby:0", pose: "sit" });
  expect(d.dest.has("agent:done")).toBe(false);
});

it("keeps a desk reserved while its owner waits in the lounge, and gives it back to the same agent", () => {
  const memory = newSlotMemory();
  const seatOf = (d: ReturnType<typeof resolve>, id: string) => d.dest.get(id)?.node;
  const t = (n: boolean) => [thread("a"), thread("b", n ? { pending } : {}), thread("c")];
  const before = resolve(t(false), memory);
  const waiting = resolve(t(true), memory);
  expect(waiting.dest.get("agent:b")?.node).toBe("lounge:0");
  expect(waiting.owners.get(0)?.get(1)?.threadId).toBe("b");
  const after = resolve(t(false), memory);
  for (const id of ["agent:a", "agent:b", "agent:c"]) expect(seatOf(after, id)).toBe(seatOf(before, id));
});

it("does not swap desks when a neighbour finishes", () => {
  const memory = newSlotMemory();
  const d1 = resolve([thread("a"), thread("b"), thread("c")], memory);
  const d2 = resolve([thread("a"), thread("c"), thread("d")], memory);
  expect(d2.dest.get("agent:a")).toEqual(d1.dest.get("agent:a"));
  expect(d2.dest.get("agent:c")).toEqual(d1.dest.get("agent:c"));
  expect(d2.dest.get("agent:d")?.node).toBe(d1.dest.get("agent:b")?.node);
});

it("never resizes a room: a fifth agent is counted as overflow and gets no desk", () => {
  const d = resolve(["a", "b", "c", "d", "e", "f"].map(id => thread(id)));
  expect(d.overflow.get(0)).toBe(2);
  expect([...d.dest.keys()]).toHaveLength(4);
  expect(layout.rooms[0].desks).toHaveLength(4);
});

it("counts lounge agents beyond the cup spots as extra", () => {
  const many = Array.from({ length: LOUNGE_MAX + 3 }, (_, i) => thread(`n${i}`, { pending, project: i % 2 ? "beta" : "alpha" }));
  const d = resolve(many);
  expect(d.loungeExtra).toBeGreaterThanOrEqual(3 - 0);
  expect([...d.dest.values()].filter(x => x.pose === "cup").length).toBe(layout.loungeSpots.length);
});
