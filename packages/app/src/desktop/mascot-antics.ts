import { useSyncExternalStore } from "react";
import { readPaused, subscribePaused } from "./mascot-pause";

export type Antic = { mood: number; name: string; label: string; ms: number };

/** Idle tricks the rig plays at mood numbers 9-14. Mood 0 is idle; every antic returns through 0. */
export const ANTICS: readonly Antic[] = [
  { mood: 9, name: "Hula", label: "Hula break", ms: 9000 },
  { mood: 10, name: "Skate", label: "Shredding", ms: 9000 },
  { mood: 11, name: "Gaming", label: "Gaming", ms: 10000 },
  { mood: 12, name: "Snooze", label: "Snoozing", ms: 14000 },
  { mood: 13, name: "Juggle", label: "Juggling", ms: 8000 },
  { mood: 14, name: "Jam", label: "Jamming", ms: 8000 },
];

export const ANTIC_MIN_WAIT_MS = 25_000, ANTIC_MAX_WAIT_MS = 70_000;

// One scheduler shared by every subscriber, so all idle mice in a window do the same trick together.
let current: Antic | null = null;
let last: Antic | null = null;
let subscribers = 0;
let waitTimer: ReturnType<typeof setTimeout> | undefined;
let holdTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

function pick(): Antic {
  const pool = ANTICS.filter(antic => antic !== last);
  return pool[Math.floor(Math.random() * pool.length)];
}
function clearTimers() {
  clearTimeout(waitTimer); clearTimeout(holdTimer);
  waitTimer = holdTimer = undefined;
}
function scheduleWait() {
  clearTimeout(waitTimer);
  waitTimer = undefined;
  if (!subscribers || current || hidden()) return;
  const wait = ANTIC_MIN_WAIT_MS + Math.random() * (ANTIC_MAX_WAIT_MS - ANTIC_MIN_WAIT_MS);
  waitTimer = setTimeout(() => { waitTimer = undefined; start(pick()); }, wait);
}
function start(antic: Antic) {
  clearTimers();
  current = last = antic;
  emit();
  holdTimer = setTimeout(() => {
    holdTimer = undefined;
    current = null;
    emit();
    scheduleWait();
  }, antic.ms);
}
function onVisibility() {
  if (hidden()) { clearTimeout(waitTimer); waitTimer = undefined; emit(); }
  else { scheduleWait(); emit(); }
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  if (subscribers++ === 0) {
    document.addEventListener("visibilitychange", onVisibility);
    scheduleWait();
  }
  return () => {
    listeners.delete(notify);
    if (--subscribers === 0) {
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimers();
      current = null;
    }
  };
}
const noopSubscribe = () => () => {};

/** Start a trick right now (given mood, or random) and restart the idle wait afterward. */
export function playAntic(mood?: number) {
  const chosen = mood === undefined ? undefined : ANTICS.find(antic => antic.mood === mood);
  start(chosen ?? pick());
}

const reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Current shared antic, or null. Subscribes (and so arms the scheduler) only while `enabled`. */
export function useAntic(enabled: boolean): { mood: number; label: string; name: string } | null {
  const paused = useSyncExternalStore(subscribePaused, readPaused);
  const active = enabled && !paused && !reducedMotion();
  const shown = useSyncExternalStore(active ? subscribe : noopSubscribe, () => (active && !hidden() ? current : null));
  return shown ? { mood: shown.mood, label: shown.label, name: shown.name } : null;
}

/** Test hook: drop all scheduler state. */
export function resetAntics() {
  clearTimers();
  current = last = null;
}
