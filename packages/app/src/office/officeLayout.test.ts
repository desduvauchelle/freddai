import { expect, it } from "vitest";
import { bestFullLayout, deskCols, gridCols, layoutOffice, MINI_MAX_DESKS, MINI_MAX_ROOMS } from "./officeLayout";
import { officeModel } from "./officeModel";
import type { Project, Session } from "../desktop/types";

const NOW = 1_000_000_000_000;
const project = (i: number): Project => ({ id: `p${i}`, name: `P${i}`, path: "/", color: "#88aa44", policy: "inherit", account: null, last: null });
const thread = (id: string, p: number, status = "running"): Session => ({ id, title: id, project: `p${p}`, account: "a", status, updated: NOW, provider_id: null, messages: [], pending: status === "waiting" ? { id: 1 } : null, error: null });
const model = (rooms: number, per = 2, status = "running") => {
  const projects = Array.from({ length: rooms }, (_, i) => project(i));
  const sessions = projects.flatMap((_, p) => Array.from({ length: per }, (_, k) => thread(`t${p}-${k}`, p, status)));
  return officeModel(sessions, projects, NOW);
};

it("chooses grid columns from the room count", () => {
  expect([1, 2, 3, 4, 5, 6, 7].map(n => gridCols(n, "full"))).toEqual([1, 2, 2, 2, 3, 3, 4]);
  expect(gridCols(3, "mini")).toBe(3);
  expect([1, 2, 3, 4, 5, 7].map(deskCols)).toEqual([2, 2, 3, 4, 3, 4]);
});

it("lays rooms out inside the logical scene without overlap", () => {
  const l = layoutOffice(model(4, 3), "full");
  expect(l.rooms).toHaveLength(4);
  for (const r of l.rooms) { expect(r.x).toBeGreaterThanOrEqual(0); expect(r.x + r.w).toBeLessThanOrEqual(l.width); expect(r.y + r.h).toBeLessThanOrEqual(l.height); }
  expect(l.rooms[0].y).toBeLessThan(l.rooms[2].y);
});

it("mini is one row, caps rooms and desks, and keeps needs-you agents when it truncates", () => {
  const m = model(6, 1);
  const l = layoutOffice(m, "mini");
  expect(l.rooms).toHaveLength(MINI_MAX_ROOMS);
  expect(l.hiddenRooms).toBe(2);
  expect(new Set(l.rooms.map(r => r.y)).size).toBe(1);
  const busy = officeModel([thread("a", 0), thread("b", 0), thread("c", 0), thread("d", 0), thread("e", 0, "waiting")], [project(0)], NOW);
  const room = layoutOffice(busy, "mini").rooms[0];
  expect(room.agents).toHaveLength(MINI_MAX_DESKS);
  expect(room.hidden).toBe(2);
  expect(room.agents.some(a => a.agent.state === "needs-you")).toBe(true);
});

it("numbers needs-you agents for the reception list", () => {
  const l = layoutOffice(model(2, 2, "waiting"), "full");
  expect(l.needs.map(n => n.tag)).toEqual([1, 2, 3, 4]);
  expect(l.rooms.flatMap(r => r.agents).map(a => a.tag)).toEqual([1, 2, 3, 4]);
});

it("full mode picks the room grid that scales largest into the window", () => {
  const m = model(7, 2);
  const tall = bestFullLayout(m, 600, 1200), wide = bestFullLayout(m, 2000, 500);
  expect(tall.width / tall.height).toBeLessThan(wide.width / wide.height);
});
