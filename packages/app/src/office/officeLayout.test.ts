import { expect, it } from "vitest";
import { BAND_H, DESKS, floorPlan, planCols, miniCols, bestFullLayout, ROOM_H, ROOM_W, SOUTH, TRAY_MAX, type Layout } from "./officeLayout";
import { planRoute, routeWaypoints } from "./officePath";

const projects = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Project ${i}`, color: "#88aa44" }));

it("gives every project a room at least the minimum size with four desks, in project order", () => {
  const l = floorPlan(projects(7), 3);
  expect(l.rooms.map(r => r.project.id)).toEqual(projects(7).map(p => p.id));
  for (const r of l.rooms) {
    expect(r.w).toBeGreaterThanOrEqual(ROOM_W); expect(r.h).toBe(ROOM_H);
    expect(r.desks).toHaveLength(DESKS);
    expect(r.x).toBeGreaterThanOrEqual(0); expect(r.x + r.w).toBeLessThanOrEqual(l.width); expect(r.y + r.h).toBeLessThanOrEqual(l.band.y);
  }
  for (const a of l.rooms) for (const b of l.rooms) if (a !== b) expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
  expect(l.height).toBe(l.band.y + BAND_H + 8);
});

it("is a pure function of the project list and column count, so thread states can never move anything", () => {
  const a = floorPlan(projects(6), 3), b = floorPlan(projects(6), 3);
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  // Same rooms for the same projects at any viewport that picks the same columns.
  expect(planCols(6, 1440, 900)).toBe(planCols(6, 1440, 900));
  // A different project list is the only thing that changes the plan.
  expect(floorPlan(projects(7), 3).rooms).toHaveLength(7);
  // Adding projects may rebalance rows; activity cannot.
});

it("chooses the grid that scales largest into the box, preferring fewer columns on ties", () => {
  expect(planCols(6, 1000, 260)).toBe(6);
  expect(planCols(6, 700, 900)).toBeLessThan(6);
  expect(planCols(1, 1000, 900)).toBe(1);
  expect(planCols(0, 1000, 900)).toBe(1);
  expect(planCols(6, 0, 0)).toBe(3);
});

it("renders an empty plan with a corridor and the shared spaces", () => {
  const l = floorPlan([], 1);
  expect(l.rooms).toHaveLength(0);
  expect(l.corridors).toHaveLength(1);
  expect(planRoute(l.nav, "door", "tray")).not.toBeNull();
});

const edges = (l: Layout) => Object.entries(l.nav.adj).flatMap(([a, ns]) => ns.filter(n => a < n).map(n => [a, n] as const));

it("only has axis-aligned walkways, so nothing walks diagonally through a wall", () => {
  const l = floorPlan(projects(6), 3);
  for (const [a, b] of edges(l)) { const p = l.nav.nodes[a], q = l.nav.nodes[b]; expect(p.x === q.x || p.y === q.y, `${a} - ${b}`).toBe(true); }
});

it.each([[1, 1], [2, 2], [6, 3], [9, 8], [10, 8], [20, 8]])("keeps walkways inside walls and doorways for %i projects with %i columns", (count, cols) => {
  const l = floorPlan(projects(count), cols);
  for (const [a, b] of edges(l)) {
    const p = l.nav.nodes[a], q = l.nav.nodes[b];
    for (let t = 0; t <= 1; t += 0.05) {
      const x = p.x + (q.x - p.x) * t, y = p.y + (q.y - p.y) * t;
      for (const r of l.rooms) {
        if (y <= r.y || y >= r.y + r.h || x < r.x || x > r.x + r.w) continue;
        expect(x, `${a}-${b} touches room ${r.index}'s side wall`).toBeGreaterThan(r.x + 4);
        expect(x).toBeLessThan(r.x + r.w - 4);
        if (y > r.y + r.h - SOUTH) expect(Math.abs(x - r.doorX), `${a}-${b} crosses the south wall`).toBeLessThanOrEqual(15);
      }
    }
  }
});

it("reaches every desk, bench, lounge spot and the tray from the front door and back", () => {
  const l = floorPlan(projects(6), 3);
  const targets = [...l.rooms.flatMap(r => r.desks.flatMap(d => [d.seat.node, d.stand.node])), ...l.benches.map(b => b.node), ...l.loungeSpots.map(s => s.node), "tray"];
  for (const t of targets) {
    expect(planRoute(l.nav, "door", t), t).not.toBeNull();
    expect(planRoute(l.nav, t, "door"), t).not.toBeNull();
  }
  const walk = routeWaypoints(l.nav, "door", l.rooms[5].desks[3].seat.node)!;
  expect(walk[1].node).toBe("entry");
  expect(walk[2].node).toBe("recep");
  expect(l.tray.cells).toHaveLength(TRAY_MAX);
});

const projectsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, color: "#5b7fd1" }));
it("mini plan: one row up to six rooms, two rows beyond, wider only when the card would get too tall", () => {
  expect(miniCols(6)).toBe(6);
  expect(miniCols(8)).toBe(4);
  expect(miniCols(8, 1194, 522)).toBe(8);
  expect(miniCols(8, 544, 405)).toBeGreaterThan(4);
  expect(miniCols(2, 1000, 500)).toBe(2);
});
it("full plan picks the largest scale for the real stage and may exceed 1", () => {
  const l = bestFullLayout(projectsOf(8), 1650, 1080);
  expect(Math.min(1650 / l.width, 1080 / l.height)).toBeGreaterThan(1.5);
});

for (const count of [1, 2, 3, 7, 9, 10, 20, 25]) for (const cols of [1, 3, 5, 8]) {
  it(`balances ${count} projects with column limit ${cols}, fills rows, and keeps desks reachable`, () => {
    const l = floorPlan(projects(count), cols);
    const rows = l.corridors.map((_, i) => l.rooms.filter(r => r.y === l.rooms[0].y + i * (ROOM_H + 40)));
    expect(Math.max(...rows.map(r => r.length)) - Math.min(...rows.map(r => r.length))).toBeLessThanOrEqual(1);
    for (const row of rows) {
      expect(row[0].x).toBe(36);
      expect(row.at(-1)!.x + row.at(-1)!.w).toBe(l.width - 8);
      for (let i = 1; i < row.length; i++) expect(row[i].x).toBe(row[i - 1].x + row[i - 1].w);
    }
    for (const room of l.rooms) for (const desk of room.desks) {
      expect(desk.x).toBeGreaterThan(room.x);
      expect(desk.x + 80).toBeLessThan(room.x + room.w);
      expect(planRoute(l.nav, "door", desk.seat.node)).not.toBeNull();
    }
    for (const [a, b] of edges(l)) {
      const p = l.nav.nodes[a], q = l.nav.nodes[b];
      expect(p.x === q.x || p.y === q.y).toBe(true);
    }
  });
}

it("turns eight-plus-two into five-plus-five with wider rooms", () => {
  const l = floorPlan(projects(10), 8);
  expect(l.rooms.filter(r => r.y === l.rooms[0].y)).toHaveLength(5);
  expect(l.rooms.every(r => r.w > ROOM_W)).toBe(true);
});

it.each([1, 2, 9, 20, 40])("fits a compact reception and connected reserve for every one of %i projects", count => {
  const l = floorPlan(projects(count), 8);
  expect(l.projectWaiting).toHaveLength(count);
  expect(l.reception.w).toBeLessThan(50);
  for (const spot of l.projectWaiting) {
    expect(spot.x - 10).toBeGreaterThan(l.lobby.x);
    expect(spot.x + 10).toBeLessThan(l.lobby.x + l.lobby.w);
    expect(spot.y - 24).toBeGreaterThan(l.band.y);
    const room = l.rooms.find(r => r.project.id === spot.project.id)!;
    expect(planRoute(l.nav, spot.node, room.desks[0].seat.node)).not.toBeNull();
  }
});
