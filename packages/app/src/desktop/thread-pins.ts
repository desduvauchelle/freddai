import { useSyncExternalStore } from "react";

const key = "freddai.threadPins";
const event = "freddai-thread-pins";
function subscribe(notify: () => void) {
  const changed = (e: StorageEvent) => { if (e.key === key || e.key === null) notify(); };
  window.addEventListener("storage", changed);
  window.addEventListener(event, notify);
  return () => { window.removeEventListener("storage", changed); window.removeEventListener(event, notify); };
}
export function readThreadPins(raw: string | null): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(raw ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === "boolean"));
  } catch { return {}; }
}
export function useThreadPins() {
  const raw = useSyncExternalStore(subscribe, () => localStorage.getItem(key), () => null);
  return [readThreadPins(raw), (id: string, pinned: boolean) => {
    localStorage.setItem(key, JSON.stringify({ ...readThreadPins(localStorage.getItem(key)), [id]: pinned }));
    window.dispatchEvent(new Event(event));
  }] as const;
}
