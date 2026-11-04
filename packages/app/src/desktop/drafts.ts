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
