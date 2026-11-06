/** Composer text is saved locally by thread or new-thread project context.
 * Subscriptions keep reply keystrokes from re-rendering the workspace. */
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "freddai.composer-drafts";
function readDrafts(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === "string" && value !== "")) as Record<string, string>;
  } catch { return {}; }
}
let drafts: Record<string, string> = readDrafts();
export function newThreadDraftKey(project: string): string { return `new-thread:${project}`; }
function persistDrafts(id?: string) {
  try {
    // Detached thread windows share storage. Preserve contexts edited by another window.
    const saved = id === undefined ? drafts : { ...readDrafts() };
    if (id !== undefined) {
      if (drafts[id]) saved[id] = drafts[id]; else delete saved[id];
    }
    if (Object.keys(saved).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    else localStorage.removeItem(STORAGE_KEY);
  } catch (error) { console.error("Couldn't save composer drafts", error); }
}
const listeners = new Map<string, Set<() => void>>();

function emit(ids: Iterable<string>) {
  for (const id of ids) listeners.get(id)?.forEach(listener => listener());
}
if (typeof window !== "undefined") window.addEventListener("storage", event => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  const previous = drafts;
  drafts = readDrafts();
  emit(new Set([...Object.keys(previous), ...Object.keys(drafts)]));
});
export function getDraft(id: string): string { return drafts[id] ?? ""; }
export function setDraft(id: string, value: string) {
  delete restored[id];
  if (getDraft(id) === value) return;
  if (value === "") { const { [id]: _removed, ...rest } = drafts; drafts = rest; } else drafts = { ...drafts, [id]: value };
  persistDrafts(id);
  emit([id]);
}
export function updateDraft(id: string, update: (previous: string) => string) { setDraft(id, update(getDraft(id))); }
// Keep compatibility with drafts saved by older builds and an explicit updater snapshot.
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
  const all = { ...restored, ...drafts, ...(newThreadDraft ? { [NEW_THREAD_DRAFT]: newThreadDraft } : {}) };
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
export function resetDrafts() { const ids = Object.keys(drafts); drafts = {}; persistDrafts(); emit(ids); }

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
