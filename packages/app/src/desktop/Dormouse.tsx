import "./dormouse.css";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { Pause, Play } from "lucide-react";
import { Alignment, Fit, Layout, RuntimeLoader, useRive, useViewModelInstanceNumber, useViewModelInstanceTrigger } from "@rive-app/react-canvas";
import wasmUrl from "@rive-app/canvas/rive.wasm?url";
import fallbackWasmUrl from "@rive-app/canvas/rive_fallback.wasm?url";
import mascotUrl from "../../../../assets/brand/dormouse/freddai-dormouse.riv?url";
import staticUrl from "../../../../assets/brand/dormouse/dormouse-v3.svg?url";

// Every asset is bundled locally, including both WASM variants. No CDN requests.
RuntimeLoader.setWasmUrl(wasmUrl);
RuntimeLoader.setWasmFallbackUrl(fallbackWasmUrl);
RuntimeLoader.setWasmThreadsUrl(null);

// App-wide gaze: one window-level pointer listener (rAF-throttled) steers every animated instance toward the cursor.
// Offset from an instance's centre is divided by GAZE_RANGE px and clamped to -1..1; leaving the window recentres.
const GAZE_RANGE = 400;
const gazers = new Map<HTMLElement, (x: number, y: number) => void>();
let gazeFrame = 0, gazePoint: { x: number; y: number } | null = null, gazeBound = false;
const clamp = (n: number) => Math.max(-1, Math.min(1, n));
function applyGaze() {
  gazeFrame = 0;
  for (const [el, set] of gazers) {
    if (!gazePoint) { set(0, 0); continue; }
    const box = el.getBoundingClientRect();
    set(clamp((gazePoint.x - (box.left + box.width / 2)) / GAZE_RANGE), clamp((gazePoint.y - (box.top + box.height / 2)) / GAZE_RANGE));
  }
}
function scheduleGaze(point: { x: number; y: number } | null) {
  gazePoint = point;
  if (!gazeFrame) gazeFrame = requestAnimationFrame(applyGaze);
}
const onGazeMove = (event: PointerEvent) => scheduleGaze({ x: event.clientX, y: event.clientY });
const onGazeRest = () => scheduleGaze(null);
const onGazeOut = (event: MouseEvent) => { if (!event.relatedTarget) onGazeRest(); };
function bindGaze() {
  if (gazeBound) return;
  gazeBound = true;
  window.addEventListener("pointermove", onGazeMove, { passive: true });
  window.addEventListener("blur", onGazeRest);
  document.documentElement.addEventListener("mouseleave", onGazeRest);
  document.addEventListener("mouseout", onGazeOut);
}
function unbindGaze() {
  if (!gazeBound || gazers.size) return;
  gazeBound = false;
  window.removeEventListener("pointermove", onGazeMove);
  window.removeEventListener("blur", onGazeRest);
  document.documentElement.removeEventListener("mouseleave", onGazeRest);
  document.removeEventListener("mouseout", onGazeOut);
}

function AnimatedDormouse({ mood, label, onError }: { mood: number; label: string; onError: () => void }) {
  const { rive, RiveComponent } = useRive({
    src: mascotUrl,
    artboard: "Freddai",
    stateMachine: "Main",
    autoBind: true,
    autoplay: true,
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
    onLoadError: onError,
  });
  const instance = rive?.viewModelInstance;
  const { setValue: setMood } = useViewModelInstanceNumber("mood", instance);
  const { setValue: setLookX } = useViewModelInstanceNumber("lookX", instance);
  const { setValue: setLookY } = useViewModelInstanceNumber("lookY", instance);
  const { trigger: poke } = useViewModelInstanceTrigger("poke", instance);
  const root = useRef<HTMLButtonElement>(null);
  useEffect(() => { setMood?.(mood); }, [mood, setMood]);
  useEffect(() => {
    if (rive && !instance) onError();
  }, [rive, instance, onError]);
  useEffect(() => {
    const el = root.current;
    if (!el || !setLookX || !setLookY) return;
    gazers.set(el, (x, y) => { setLookX(x); setLookY(y); });
    bindGaze();
    return () => { gazers.delete(el); unbindGaze(); };
  }, [setLookX, setLookY]);
  return <button ref={root} className="dormouse-circle" type="button" aria-label={`Freddai: ${label}. Say hello to the dormouse`} title={`${label} · Say hello`}
    onClick={() => poke?.()}>
    <span className="dormouse-art" aria-hidden="true"><RiveComponent /></span>
  </button>;
}

// The pause toggle is global: every instance shares one localStorage flag and re-renders together
// (same-window via a custom event, other windows via the storage event).
const PAUSE_KEY = "freddai.mascotPaused", PAUSE_EVENT = "freddai:mascot-paused";
const readPaused = () => { try { return localStorage.getItem(PAUSE_KEY) === "true"; } catch { return false; } };
const subscribePaused = (notify: () => void) => {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === PAUSE_KEY) notify(); };
  window.addEventListener(PAUSE_EVENT, notify);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(PAUSE_EVENT, notify); window.removeEventListener("storage", onStorage); };
};
function togglePaused() {
  try { localStorage.setItem(PAUSE_KEY, String(!readPaused())); } catch { /* storage unavailable: nothing to persist */ }
  window.dispatchEvent(new Event(PAUSE_EVENT));
}

// At most MAX_ANIMATED instances run Rive. Higher priority wins a slot (ties: earliest mounted); the rest render static art.
const MAX_ANIMATED = 3;
let nextSlotId = 0;
let slots: { id: number; priority: number }[] = [];
const slotListeners = new Set<() => void>();
const emitSlots = () => slotListeners.forEach(listener => listener());
const hasSlot = (id: number) => [...slots].sort((a, b) => b.priority - a.priority || a.id - b.id).slice(0, MAX_ANIMATED).some(slot => slot.id === id);
function useAnimationSlot(priority: number) {
  const [id] = useState(() => nextSlotId++);
  useEffect(() => {
    slots = [...slots.filter(slot => slot.id !== id), { id, priority }];
    emitSlots();
    return () => { slots = slots.filter(slot => slot.id !== id); emitSlots(); };
  }, [id, priority]);
  return useSyncExternalStore(
    notify => { slotListeners.add(notify); return () => { slotListeners.delete(notify); }; },
    () => hasSlot(id),
  );
}

type DormouseProps = {
  mood: number; label: string;
  /** Legacy 28px-style badge (no caption). Prefer `size`. */
  compact?: boolean;
  /** Diameter in px. Omit for the legacy captioned 68px circle. */
  size?: number;
  /** Show the pause/play control on hover or focus. Default true. */
  pauseControl?: boolean;
  className?: string;
  /** Rive slot priority; higher wins when more than 3 instances are mounted. Default 1. */
  priority?: number;
};

export function Dormouse({ mood, label, compact = false, size, pauseControl = true, className, priority = 1 }: DormouseProps) {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const paused = useSyncExternalStore(subscribePaused, readPaused);
  const [failed, setFailed] = useState(false);
  const slot = useAnimationSlot(priority);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  const sized = size !== undefined, small = compact || sized;
  const isStatic = reduced || paused || failed || !slot;
  const classes = ["dormouse-companion", compact ? "dormouse-compact" : "", sized ? "dormouse-sized" : "", sized && size < 48 ? "dormouse-small" : "", className ?? ""].filter(Boolean).join(" ");
  return <div className={classes} style={sized ? { "--dm-size": `${size}px` } as CSSProperties : undefined} title={small ? label : undefined} data-mascot-state={mood}
    data-mascot-mode={failed ? "fallback" : isStatic ? "static" : "animated"}>
    {isStatic
      ? <div className="dormouse-circle" role="img" aria-label={`Freddai dormouse: ${label}`}><img className="dormouse-static" src={staticUrl} alt="" /></div>
      : <AnimatedDormouse mood={mood} label={label} onError={() => setFailed(true)} />}
    {pauseControl && !reduced && !failed && <button type="button" className="dormouse-motion" aria-label={paused ? "Play mascot animations" : "Pause mascot animations"} aria-pressed={paused}
      onClick={togglePaused}>
      {paused ? <Play size={10} /> : <Pause size={10} />}
    </button>}
    {!small && <span className="dormouse-caption">{label}</span>}
  </div>;
}
