import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { OfficeAgent } from "../office/officeModel";
import { drawScene, type SceneOut, type SceneProject, type SceneSchedule } from "./draw";
import { applyCamera, chooseLayout, clampCamera, fitView, pickOrientation, PLATE_TOP_PX, projectedBounds, zoomCameraAt, type Camera, type CampusLayout, type Orientation } from "./layout";
import { CampusSim } from "./sim";

export type CampusTip = { x: number; y: number; agent?: OfficeAgent; project?: SceneProject; shrine?: boolean };
const DRAG_PX = 5;
const HOME: Camera = { zoom: 1, panX: 0, panY: 0 };
const PAD = 8;

type Opts = {
  mode: "mini" | "full";
  projects: readonly SceneProject[];
  reduced: boolean;
  selected: string | null;
  /** Scheduled work shown at the clock shrine. */
  schedules?: readonly SceneSchedule[];
  /** Wall-clock ms for the shrine's clock. */
  now?: number;
  onAgent: (a: OfficeAgent) => void;
  onBuilding: (id: string) => void;
  onBackground?: () => void;
};

export function useCampus({ mode, projects, reduced, selected, schedules, now: clock, onAgent, onBuilding, onBackground }: Opts) {
  const full = mode === "full";
  const stageRef = useRef<HTMLDivElement>(null), canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [vh, setVh] = useState(() => (typeof window === "undefined" ? 800 : window.innerHeight));
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [hovered, setHovered] = useState<string | null>(null);
  const [tip, setTip] = useState<CampusTip | null>(null);
  const [dpr, setDpr] = useState(() => Math.min(3, (typeof window !== "undefined" && window.devicePixelRatio) || 1));
  const cam = useRef<Camera>(HOME);
  const outRef = useRef<SceneOut>({ agents: [], buildings: [], signs: [] });
  const dirty = useRef(true), visible = useRef(true), lastNow = useRef(typeof performance !== "undefined" ? performance.now() : 0);
  const t0 = useRef(typeof performance !== "undefined" ? performance.now() : 0);

  // Measure the container; viewport height is tracked separately for the mini card (its own height is derived).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const take = (w: number, h: number) => setSize(p => (Math.abs(p.w - w) < 0.5 && (!full ? true : Math.abs(p.h - h) < 0.5) ? p : { w, h }));
    const r = el.getBoundingClientRect();
    if (r.width) take(r.width, r.height);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(entries => { const e = entries[0]; if (e) take(e.contentRect.width, e.contentRect.height); });
    ro?.observe(el);
    const onWin = () => { setVh(window.innerHeight); setDpr(Math.min(3, window.devicePixelRatio || 1)); };
    window.addEventListener("resize", onWin); window.addEventListener("orientationchange", onWin);
    return () => { ro?.disconnect(); window.removeEventListener("resize", onWin); window.removeEventListener("orientationchange", onWin); };
  }, [full]);

  const maxH = Math.max(260, vh * (orientation === "portrait" ? 1 : 0.62));
  const refH = full ? size.h : maxH;
  useEffect(() => { setOrientation(prev => pickOrientation(size.w, refH, prev)); }, [size.w, refH]);

  // Whole campus always fits: pick the grid shape that renders largest in the container (mini: its height cap), then size the mini stage to the content.
  const { layout, S: fitS } = useMemo(() => chooseLayout(projects.length, orientation, size.w, refH, PAD), [projects.length, orientation, size.w, refH]);
  const stageH = full ? size.h : size.w > 0 ? Math.round(Math.min(maxH, Math.max(160, projectedBounds(layout).h * fitS + PLATE_TOP_PX + PAD * 2))) : 320;
  const w = size.w, h = stageH;
  const sim = useRef<CampusSim>(null as unknown as CampusSim);
  if (!sim.current) sim.current = new CampusSim();

  // Re-frame when the layout reshapes (rotation / orientation switch).
  const lastShape = useRef("");
  useEffect(() => {
    const key = `${layout.orientation}:${layout.cols}x${layout.rows}`;
    if (lastShape.current !== key) { lastShape.current = key; cam.current = HOME; }
    dirty.current = true;
  }, [layout]);

  const live = useRef({ projects, layout, w, h, dpr, reduced, selected, hovered, schedules, clock });
  live.current = { projects, layout, w, h, dpr, reduced, selected, hovered, schedules, clock };

  const draw = useCallback(() => {
    const cv = canvasRef.current, L = live.current;
    if (!cv || !L.w || !L.h) return;
    const px = Math.round(L.w * L.dpr), py = Math.round(L.h * L.dpr);
    if (cv.width !== px || cv.height !== py) { cv.width = px; cv.height = py; }
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    const base = fitView(L.layout, L.w, L.h, PAD);
    cam.current = clampCamera(base, cam.current, L.w, L.h, L.layout);
    const view = applyCamera(base, cam.current, L.w, L.h);
    const now = typeof performance === "undefined" ? 0 : performance.now();
    const t = L.reduced ? 0 : (now - t0.current) / 1000;
    const sm = sim.current;
    sm.sync(L.layout, L.projects, L.reduced);
    if (!L.reduced) { sm.step((now - lastNow.current) / 1000); }
    lastNow.current = now;
    outRef.current = drawScene(ctx, { w: L.w, h: L.h, view, layout: L.layout, projects: L.projects, sim: sm, t, reduced: L.reduced, selected: L.selected, hovered: L.hovered, schedules: L.schedules, now: L.clock });
    dirty.current = false;
  }, [full]);

  // Render loop: paused while hidden / off-screen; reduced motion renders only when something changed.
  useEffect(() => {
    let raf = 0, running = false;
    const stop = () => { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; };
    const frame = () => {
      raf = 0;
      if (!running) return;
      if (!reduced || dirty.current) draw();
      raf = requestAnimationFrame(frame);
    };
    const start = () => { if (running || document.hidden || !visible.current) return; running = true; raf = requestAnimationFrame(frame); };
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVis);
    const io = typeof IntersectionObserver === "undefined" || !stageRef.current ? null : new IntersectionObserver(es => { visible.current = es.some(e => e.isIntersecting); if (visible.current) { dirty.current = true; start(); } else stop(); });
    if (io && stageRef.current) io.observe(stageRef.current);
    draw(); start();
    return () => { stop(); io?.disconnect(); document.removeEventListener("visibilitychange", onVis); };
  }, [draw, reduced]);

  useEffect(() => { dirty.current = true; draw(); }, [projects, layout, w, h, dpr, selected, hovered, schedules, clock, draw]);

  /* ---- interaction ---- */
  const base = () => fitView(live.current.layout, live.current.w, live.current.h, PAD);
  const zoomBy = useCallback((f: number, px?: number, py?: number) => {
    const L = live.current;
    cam.current = zoomCameraAt(base(), cam.current, L.w, L.h, f, px ?? L.w / 2, py ?? L.h / 2);
    dirty.current = true; draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draw, full]);
  const fit = useCallback(() => { cam.current = HOME; dirty.current = true; draw(); }, [draw]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !full) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), e.clientX - r.left, e.clientY - r.top);
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
  }, [full, zoomBy]);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: false, pinch: 0 });

  const local = (e: { clientX: number; clientY: number }) => { const r = canvasRef.current?.getBoundingClientRect(); return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }; };
  const hit = useCallback((x: number, y: number): { agent?: OfficeAgent; projectId?: string; shrine?: boolean } => {
    const o = outRef.current;
    let best: { d: number; a: OfficeAgent } | null = null;
    for (const a of o.agents) { const d = Math.hypot(a.x - x, a.y - y); if (d <= a.r && (!best || d < best.d)) best = { d, a: a.agent }; }
    if (best) return { agent: best.a };
    const sh = o.shrine;
    if (sh && x >= sh.x && x <= sh.x + sh.w && y >= sh.y && y <= sh.y + sh.h) return { shrine: true };
    for (const s of o.signs) if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return { projectId: s.id };
    for (let i = o.buildings.length - 1; i >= 0; i--) { const b = o.buildings[i]!; if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return { projectId: b.id }; }
    return {};
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    pointers.current.set(e.pointerId, local(e));
    gesture.current = { moved: false, pinch: 0 };
    if (full) try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* synthetic events */ }
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = local(e), prev = pointers.current.get(e.pointerId);
    if (prev && full) {
      pointers.current.set(e.pointerId, p);
      const pts = [...pointers.current.values()];
      if (pts.length >= 2) {
        const a = pts[0]!, b = pts[1]!, d = Math.hypot(a.x - b.x, a.y - b.y);
        if (gesture.current.pinch) zoomBy(d / gesture.current.pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
        gesture.current.pinch = d; gesture.current.moved = true; return;
      }
      const dx = p.x - prev.x, dy = p.y - prev.y;
      if (dx || dy) {
        gesture.current.moved = true;
        cam.current = { ...cam.current, panX: cam.current.panX + dx, panY: cam.current.panY + dy };
        dirty.current = true; draw();
      }
      setTip(null);
      return;
    }
    const h2 = hit(p.x, p.y);
    const r = stageRef.current?.getBoundingClientRect();
    const tx = e.clientX - (r?.left ?? 0) + 12, ty = e.clientY - (r?.top ?? 0) + 14;
    if (h2.agent) { setTip({ x: tx, y: ty, agent: h2.agent }); setHovered(null); }
    else if (h2.projectId) { setTip({ x: tx, y: ty, project: live.current.projects.find(q => q.id === h2.projectId) }); setHovered(h2.projectId); }
    else if (h2.shrine) { setTip({ x: tx, y: ty, shrine: true }); setHovered(null); }
    else { setTip(null); setHovered(null); }
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => { pointers.current.delete(e.pointerId); gesture.current.pinch = 0; };

  const startPt = useRef<{ x: number; y: number } | null>(null);
  const handlers = {
    onPointerDown: (e: ReactPointerEvent<HTMLCanvasElement>) => { startPt.current = { x: e.clientX, y: e.clientY }; onPointerDown(e); },
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onPointerLeave: () => { setTip(null); setHovered(null); },
    onClick: (e: React.MouseEvent<HTMLCanvasElement>) => {
      const s = startPt.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > DRAG_PX) return;
      const p = local(e), h2 = hit(p.x, p.y);
      if (h2.agent) onAgent(h2.agent);
      else if (h2.projectId) onBuilding(h2.projectId);
      else onBackground?.();
    },
  };

  return { stageRef, canvasRef, size: { w, h }, orientation, layout, tip, handlers, zoomIn: () => zoomBy(1.25), zoomOut: () => zoomBy(0.8), fit };
}
