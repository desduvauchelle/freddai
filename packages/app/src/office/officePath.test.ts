import { expect, it } from "vitest";
import { advance, assignSlots, makeNav, planRoute, routeLength, routeWaypoints, startCursor } from "./officePath";

const nav = makeNav({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, c: { x: 100, y: 50 }, d: { x: 0, y: 50 }, far: { x: 300, y: 300 } }, [["a", "b"], ["b", "c"], ["c", "d"], ["d", "a"]]);

it("finds the shortest route and returns null when unreachable or unknown", () => {
  expect(planRoute(nav, "a", "c")).toEqual(["a", "d", "c"]);
  expect(planRoute(nav, "a", "a")).toEqual(["a"]);
  expect(planRoute(nav, "a", "far")).toBeNull();
  expect(planRoute(nav, "a", "nope")).toBeNull();
  expect(() => makeNav({ a: { x: 0, y: 0 } }, [["a", "z"]])).toThrow();
});

it("builds waypoints with dwell and measures length", () => {
  const pts = routeWaypoints(nav, "a", "c", { b: 500 })!;
  expect(pts.map(p => p.node)).toEqual(["a", "d", "c"]);
  expect(routeLength(pts)).toBe(150);
  expect(routeWaypoints(nav, "a", "b", { b: 500 })![1].dwell).toBe(500);
});

it("advances at constant speed regardless of frame size", () => {
  const pts = routeWaypoints(nav, "a", "c", {})!;
  const oneShot = advance(pts, startCursor(pts), 1000, 90);
  let c = startCursor(pts), last = { ...oneShot };
  for (let i = 0; i < 60; i++) { last = advance(pts, c, 1000 / 60, 90); c = last; }
  expect(oneShot).toMatchObject({ x: 40, y: 50, moving: true, done: false });
  expect(Math.hypot(c.x - oneShot.x, c.y - oneShot.y)).toBeLessThan(0.01);
  const end = advance(pts, c, 5000, 90);
  expect(end).toMatchObject({ x: 100, y: 50, done: true });
  expect(advance(pts, { x: end.x, y: end.y, next: end.next, wait: end.wait }, 1000, 90).moving).toBe(false);
});

it("pauses at dwell nodes, reports facing, and only finishes after the pause", () => {
  const pts = routeWaypoints(nav, "a", "b", { b: 800 })!;
  let s = advance(pts, startCursor(pts), 500, 90);
  expect(s.dx).toBe(1);
  s = advance(pts, s, 700, 90);
  expect(s).toMatchObject({ x: 100, done: false });
  expect(s.wait).toBeGreaterThan(0);
  expect(advance(pts, s, 1000, 90).done).toBe(true);
});

it("keeps slots stable and fills the lowest free one", () => {
  const first = assignSlots(new Map(), ["a", "b", "c"], 4);
  expect([...first]).toEqual([["a", 0], ["b", 1], ["c", 2]]);
  const second = assignSlots(first, ["a", "c", "d"], 4);
  expect(Object.fromEntries(second)).toEqual({ a: 0, c: 2, d: 1 });
  const full = assignSlots(second, ["a", "c", "d", "e", "f"], 4);
  expect(Object.fromEntries(full)).toEqual({ a: 0, c: 2, d: 1, e: 3 });
  expect(full.has("f")).toBe(false);
});
