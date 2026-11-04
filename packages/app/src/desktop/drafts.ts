/** Reply drafts live outside DesktopApp state so a keystroke re-renders only the composer
 * subscribed to that thread's draft, not the whole workspace. Drafts are in memory only
 * (they were never persisted) and belong to a thread, so each open pane keeps its own. */
import { useSyncExternalStore } from "react";

let drafts: Record<string, string> = {};
const listeners = new Map<string, Set<() => void>>();

function emit(ids: Iterable<string>) {
  for (const id of ids) listeners.get(id)?.forEach(listener => listener());
}
export function getDraft(id: string): string { return drafts[id] ?? ""; }
export function setDraft(id: string, value: string) {
  if (getDraft(id) === value) return;
  if (value === "") { const { [id]: _removed, ...rest } = drafts; drafts = rest; } else drafts = { ...drafts, [id]: value };
  emit([id]);
}
export function updateDraft(id: string, update: (previous: string) => string) { setDraft(id, update(getDraft(id))); }
/** Drops every draft whose thread is no longer open in a pane, as switching threads always did. */
export function pruneDrafts(keep: readonly string[]) {
  const dropped = Object.keys(drafts).filter(id => !keep.includes(id));
  if (!dropped.length) return;
  drafts = Object.fromEntries(Object.entries(drafts).filter(([id]) => keep.includes(id)));
  emit(dropped);
}

// Drafts are memory-only, so an app restart (updater) would lose them. Before restarting they are written to
// localStorage once; the next launch reads and deletes that copy and re-applies it as threads reopen.
const RESTART_KEY = "freddai.drafts-before-restart";
export const NEW_THREAD_DRAFT = "__new__";
let restored: Record<string, string> = readRestartDrafts();
function readRestartDrafts(): Record<string, string> {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(RESTART_KEY);
    if (raw === null) return {};
    localStorage.removeItem(RESTART_KEY);
    const parsed = JSON.parse(raw);
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === "string" && v !== "")) as Record<string, string>;
  } catch (e) { console.error("Couldn't read saved drafts", e); return {}; }
}
/** Persists thread drafts plus the new-thread draft ahead of a restart. Throws if storage fails, so the caller can stop. */
export function saveDraftsForRestart(newThreadDraft: string) {
  const all = { ...drafts, ...(newThreadDraft ? { [NEW_THREAD_DRAFT]: newThreadDraft } : {}) };
  if (Object.keys(all).length) localStorage.setItem(RESTART_KEY, JSON.stringify(all)); else localStorage.removeItem(RESTART_KEY);
}
/** Re-applies saved drafts for threads that are open now (each only once); returns the new-thread draft if one was saved. */
export function restoreDrafts(openIds: readonly string[]): string | null {
  let fresh: string | null = null;
  for (const [id, value] of Object.entries(restored)) {
    if (id === NEW_THREAD_DRAFT) { fresh = value; delete restored[id]; }
    else if (openIds.includes(id)) { if (!getDraft(id)) setDraft(id, value); delete restored[id]; }
  }
  return fresh;
}
export function resetDrafts() { const ids = Object.keys(drafts); drafts = {}; emit(ids); }

function subscribeTo(id: string) {
  return (listener: () => void) => {
    let set = listeners.get(id);
    if (!set) listeners.set(id, set = new Set());
    set.add(listener);
    return () => { set.delete(listener); if (!set.size) listeners.delete(id); };
  };
}
const subscriptions = new Map<string, ReturnType<typeof subscribeTo>>();
function subscription(id: string) {
  let subscribe = subscriptions.get(id);
  if (!subscribe) subscriptions.set(id, subscribe = subscribeTo(id));
  return subscribe;
}
/** The draft text for one thread; re-renders only when that thread's draft changes. */
export function useDraft(id: string): string {
  return useSyncExternalStore(subscription(id), () => getDraft(id), () => "");
}
/** Whether the thread has sendable (non-blank) text; re-renders only when that boolean flips. */
export function useHasDraftText(id: string): boolean {
  return useSyncExternalStore(subscription(id), () => getDraft(id).trim() !== "", () => false);
}
