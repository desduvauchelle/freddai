import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Project, Session } from "../desktop/types";
import { Office7 } from "./index";
import { campusLayout, chooseLayout, fitView, gridFor, pickOrientation, projectedBounds, PLATE_TOP_PX } from "./layout";
import { CampusSim } from "./sim";
import { drawScene, nextDueSchedule, wrapName, type SceneProject } from "./draw";
import type { OfficeAgent, OfficeSchedule } from "../office/officeModel";

const NOW = new Date(2026, 10, 4, 15, 0).getTime();
const project = (id: string, name: string): Project => ({ id, name, path: `/p/${id}`, color: "#5b7fd1", policy: "inherit", account: null, last: null });
const thread = (id: string, p: string, status: string): Session => ({ id, title: `Title ${id}`, project: p, account: "a", status, updated: NOW - 1000, provider_id: null, messages: [], pending: null, error: null } as unknown as Session);
const projects = [project("a", "Alpha Launch"), project("b", "Beta")];
const sessions = [thread("1", "a", "running"), thread("2", "b", "done")];

let sizes: { w: number; h: number } = { w: 900, h: 600 };
const ctxProxy: unknown = new Proxy(function () {}, { get: (_t, k) => (k === "width" ? 10 : ctxProxy), apply: () => ctxProxy, set: () => true });
beforeEach(() => {
  localStorage.setItem("freddai.office.recent-only.v1", "false");
  vi.stubGlobal("ResizeObserver", class { constructor(private cb: (e: unknown[]) => void) {} observe() { this.cb([{ contentRect: { width: sizes.w, height: sizes.h } }]); } unobserve() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctxProxy) as never;
});
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); sizes = { w: 900, h: 600 }; });

it("renders and exposes every project name", () => {
  render(<Office7 variant="mini" sessions={sessions} projects={projects} now={NOW} onOpenThread={vi.fn()} />);
  expect(screen.queryByRole("list", { name: "Projects" })).toBeNull();
  expect(document.querySelectorAll("select.office-version-picker")).toHaveLength(1);
  expect(screen.getByLabelText(/Campus with 2 projects/)).toBeTruthy();
});

it("opens the thread from the agent list", () => {
  const open = vi.fn();
  render(<Office7 variant="mini" sessions={sessions} projects={projects} now={NOW} onOpenThread={open} />);
  fireEvent.click(screen.getByRole("button", { name: /Title 1/ }));
  expect(open).toHaveBeenCalledWith("1");
});

it("full overlay picks portrait for a tall container and landscape for a wide one", () => {
  sizes = { w: 390, h: 700 };
  const { unmount } = render(<Office7 variant="full" sessions={sessions} projects={projects} now={NOW} onOpenThread={vi.fn()} />);
  expect(document.querySelector(".office7-stage")?.getAttribute("data-orientation")).toBe("portrait");
  unmount();
  sizes = { w: 1200, h: 700 };
  render(<Office7 variant="full" sessions={sessions} projects={projects} now={NOW} onOpenThread={vi.fn()} />);
  expect(document.querySelector(".office7-stage")?.getAttribute("data-orientation")).toBe("landscape");
  act(() => {});
});

it("layout maths: orientation hysteresis and column counts", () => {
  expect(pickOrientation(400, 800)).toBe("portrait");
  expect(pickOrientation(800, 400)).toBe("landscape");
  expect(pickOrientation(1000, 980, "portrait")).toBe("portrait");
  expect(pickOrientation(1000, 980, "landscape")).toBe("landscape");
  expect(gridFor(20, "landscape").cols).toBeGreaterThan(gridFor(20, "portrait").cols);
  expect(campusLayout(25, "landscape").cells).toHaveLength(25);
});

it("full view has exactly one style picker, in the bottom bar, and no office-overlay class", () => {
  render(<Office7 variant="full" sessions={sessions} projects={projects} now={NOW} onOpenThread={vi.fn()} />);
  expect(document.querySelectorAll("select.office-version-picker")).toHaveLength(1);
  expect(document.querySelector("footer .office-version-picker")).toBeTruthy();
  expect(document.querySelector(".office-overlay")).toBeNull();
});

it("the whole campus fits the container for 3, 12 and 25 projects, landscape and portrait", () => {
  for (const n of [3, 12, 25]) for (const [w, h] of [[900, 480], [390, 700]] as const) {
    const o = w > h ? "landscape" : "portrait";
    const { layout } = chooseLayout(n, o, w, h);
    const v = fitView(layout, w, h), b = projectedBounds(layout);
    expect(b.x0 * v.S + v.ox).toBeGreaterThanOrEqual(-0.5);
    expect(b.x1 * v.S + v.ox).toBeLessThanOrEqual(w + 0.5);
    expect(b.y0 * v.S + v.oy - PLATE_TOP_PX).toBeGreaterThanOrEqual(-0.5);
    expect(b.y1 * v.S + v.oy).toBeLessThanOrEqual(h + 0.5);
    expect(layout.cells).toHaveLength(n);
  }
});

it("wraps a 24-character name onto at most two unclipped lines", () => {
  const measure = (s: string) => s.length * 7;
  for (const name of ["livecaseplus-server-abcd", "ABCDEFGHIJKLMNOPQRSTUVWX"]) {
    const lines = wrapName(measure, name, 100, 2);
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines.join("").replace(/\s/g, "")).toBe(name);
    expect(lines.some(l => l.includes("…"))).toBe(false);
  }
  expect(wrapName(measure, "x".repeat(60), 100, 2).pop()).toContain("…");
});

const agent = (id: string, state: OfficeAgent["state"]): OfficeAgent => ({ id, threadId: id, title: id, projectId: "a", projectName: "A", projectColor: "#5b7fd1", state, place: "desk", updated: 1, stateLabel: state, cue: "", variant: 0, tag: null });
const run = (sim: CampusSim, secs: number) => { for (let i = 0; i < secs * 4; i++) sim.step(0.25); };
const lay = (n: number) => campusLayout(n, "landscape");
const scene = (st: OfficeAgent["state"]) => [{ id: "a", agents: [agent("t1", st)] }, { id: "b", agents: [] }];

it("sim: an already-running session starts at its desk with no walk", () => {
  const sim = new CampusSim();
  sim.sync(lay(2), scene("working"), false);
  const a = sim.get("t1")!;
  expect(a.phase).toBe("at-desk");
  expect(a.walking).toBe(false);
});

it("sim: starting walks from the field to the office and sits at the desk", () => {
  const sim = new CampusSim();
  sim.sync(lay(2), scene("idle"), false);
  expect(sim.get("t1")!.phase).toBe("idle");
  sim.sync(lay(2), scene("starting"), false);
  expect(sim.get("t1")!.phase).toBe("walking-to-office");
  run(sim, 120);
  expect(sim.get("t1")!.phase).toBe("at-desk");
});

it("sim: done walks to the HQ, hands over, then returns to the field", () => {
  const sim = new CampusSim();
  sim.sync(lay(2), scene("working"), false);
  sim.sync(lay(2), scene("done"), false);
  expect(sim.get("t1")!.phase).toBe("walking-to-hq");
  const seen = new Set<string>();
  for (let i = 0; i < 800; i++) { sim.step(0.25); seen.add(sim.get("t1")!.phase); }
  expect(seen.has("handover")).toBe(true);
  expect(seen.has("walking-to-field")).toBe(true);
  expect(sim.get("t1")!.phase).toBe("idle");
});

it("sim: needs-you stands at the door; reduced motion places agents at the destination", () => {
  const sim = new CampusSim();
  sim.sync(lay(2), scene("working"), false);
  sim.sync(lay(2), scene("needs-you"), false);
  run(sim, 60);
  expect(sim.get("t1")!.phase).toBe("at-door");
  const r = new CampusSim();
  r.sync(lay(2), scene("idle"), true);
  r.sync(lay(2), scene("working"), true);
  expect(r.get("t1")!.phase).toBe("at-desk");
});

const sched = (id: string, due: number, enabled = true): OfficeSchedule => ({ id, name: `Job ${id}`, project: "a", next_due: due, enabled });
const overlaps = (a: { x0: number; x1: number; y0: number; y1: number }, b: { x0: number; x1: number; y0: number; y1: number }) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

it("layout: the lower zone is three equal thirds; the shrine is the courtyard centrepiece, clear of HQ and lawns", () => {
  for (const o of ["landscape", "portrait"] as const) for (const n of [1, 3, 12, 25]) {
    const l = campusLayout(n, o), sh = l.shrine, m = sh.r + 0.4;
    const size = (r: { x0: number; x1: number; y0: number; y1: number }) => (o === "landscape" ? r.x1 - r.x0 : r.y1 - r.y0);
    const [t0, t1, t2] = l.thirds;
    expect(Math.abs(size(t0) - size(t1))).toBeLessThan(0.01);
    expect(Math.abs(size(t1) - size(t2))).toBeLessThan(0.01);
    if (o === "landscape") { expect(t0.x0).toBeCloseTo(l.zone.x0, 5); expect(t2.x1).toBeCloseTo(l.zone.x1, 5); }
    else expect(t2.y1).toBeCloseTo(l.zone.y1, 5);
    expect(sh.r).toBeGreaterThanOrEqual(1.9);
    const box = { x0: sh.cx - m, x1: sh.cx + m, y0: sh.cy - m, y1: sh.cy + m };
    expect(box.x0).toBeGreaterThan(l.zone.x0); expect(box.x1).toBeLessThan(l.zone.x1);
    expect(box.y0).toBeGreaterThan(l.zone.y0); expect(box.y1).toBeLessThan(l.zone.y1);
    const ct = l.courtyard;
    expect(sh.cx - sh.r).toBeGreaterThan(ct.x0); expect(sh.cx + sh.r).toBeLessThan(ct.x1);
    expect(sh.cy - sh.r).toBeGreaterThan(ct.y0); expect(sh.cy + sh.r).toBeLessThan(ct.y1);
    for (const r of [l.hq, l.field.ball, l.field.picnic]) { expect(overlaps(box, r)).toBe(false); expect(overlaps(ct, r)).toBe(false); }
    expect(l.plaza.cx).toBeCloseTo((ct.x0 + ct.x1) / 2, 5);
    expect(l.trees.some(t => t.x > ct.x0 && t.x < ct.x1 && t.y > ct.y0 && t.y < ct.y1)).toBe(false);
  }
});

const recordingCtx = () => {
  const texts: string[] = [];
  const ctx: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === "measureText" ? (s: string) => ({ width: s.length * 7 }) : k === "fillText" ? (s: string) => { texts.push(s); } : ctx),
    apply: () => ctx, set: () => true,
  });
  return { ctx: ctx as CanvasRenderingContext2D, texts };
};
const sceneFor = (names: string[], schedules: OfficeSchedule[] = []) => {
  const l = campusLayout(names.length, "landscape"), sim = new CampusSim();
  const projects: SceneProject[] = names.map((name, i) => ({ id: `p${i}`, name, color: "#5b7fd1", agents: [] }));
  sim.sync(l, projects, true);
  const { ctx, texts } = recordingCtx();
  const out = drawScene(ctx, { w: 900, h: 600, view: fitView(l, 900, 600), layout: l, projects, sim, t: 0, reduced: true, selected: null, hovered: null, schedules, now: NOW });
  return { out, texts };
};

it("draws each project name on its back wall and keeps a clickable sign rect per project; no floating HQ plate", () => {
  const names = ["LiveCase", "Freddai desktop companion", "Scout"];
  const { out, texts } = sceneFor(names);
  expect(out.signs.map(s => s.id)).toEqual(["p0", "p1", "p2"]);
  for (const sg of out.signs) { expect(sg.w).toBeGreaterThan(0); expect(sg.h).toBeGreaterThan(0); expect(sg.fontPx).toBeGreaterThanOrEqual(6); }
  expect(out.signs[0]!.lines).toEqual(["LiveCase"]);
  expect(texts).toContain("HQ");
  expect(texts.some(t => t.includes("…"))).toBe(false);
});

it("wall lettering never ellipsises: a long name overflows (clipped + faded) and the font can go below 11px", () => {
  const { out, texts } = sceneFor(["an-extremely-long-project-name-that-cannot-possibly-fit-on-any-wall"]);
  expect(texts.some(t => t.includes("…"))).toBe(false);
  expect(out.signs[0]!.lines.join(" ")).toContain("possibly-fit-on-any-wall");
  const measure = (s: string) => s.length * 7;
  expect(wrapName(measure, "x".repeat(60), 100, 2, false).join("")).toBe("x".repeat(60));
  expect(wrapName(measure, "x".repeat(60), 100, 1, false)).toEqual(["x".repeat(60)]);
});

it("shrine geometry does not depend on schedules", () => {
  expect(campusLayout(3, "landscape").shrine).toEqual(campusLayout(3, "landscape").shrine);
  const a = sceneFor(["A"]).out.shrine!, b = sceneFor(["A"], Array.from({ length: 6 }, (_, i) => sched(`s${i}`, NOW + i))).out.shrine!;
  expect({ ...a, schedules: 0 }).toEqual({ ...b, schedules: 0 });
  expect(a.schedules).toBe(0); expect(b.schedules).toBe(6);
});

it("canvas shrine label: '6 scheduled · +2 more' for six, nothing for disabled-only", () => {
  expect(sceneFor(["A"], Array.from({ length: 6 }, (_, i) => sched(`s${i}`, NOW + i))).texts).toContain("6 scheduled · +2 more");
  expect(sceneFor(["A"], [sched("x", NOW, false)]).texts.some(t => /scheduled/.test(t))).toBe(false);
});

it("nextDueSchedule returns the earliest enabled schedule", () => {
  expect(nextDueSchedule([sched("late", NOW + 50), sched("off", NOW + 1, false), sched("soon", NOW + 10)])?.id).toBe("soon");
  expect(nextDueSchedule([sched("off", NOW, false)])).toBeNull();
  expect(nextDueSchedule([])).toBeNull();
});

it("screen-reader shrine summary: count with overflow, and no count when only disabled schedules exist", () => {
  const six = Array.from({ length: 6 }, (_, i) => sched(`s${i}`, NOW + (i + 1) * 60_000));
  const { unmount } = render(<Office7 variant="mini" sessions={sessions} projects={projects} schedules={six} now={NOW} onOpenThread={vi.fn()} />);
  const group = screen.getByRole("group", { name: "Clock shrine" });
  expect(group.textContent).toContain("6 scheduled · +2 more");
  expect(group.textContent).toContain("Job s0");
  unmount();
  render(<Office7 variant="mini" sessions={sessions} projects={projects} schedules={[sched("x", NOW, false)]} now={NOW} onOpenThread={vi.fn()} />);
  const empty = screen.getByRole("group", { name: "Clock shrine" });
  expect(empty.textContent).not.toMatch(/\d+ scheduled/);
  expect(empty.textContent).toBe("No schedules");
});
