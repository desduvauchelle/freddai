// The pause toggle is global: every instance shares one localStorage flag and re-renders together
// (same-window via a custom event, other windows via the storage event).
const PAUSE_KEY = "freddai.mascotPaused", PAUSE_EVENT = "freddai:mascot-paused";
export const readPaused = () => { try { return localStorage.getItem(PAUSE_KEY) === "true"; } catch { return false; } };
export const subscribePaused = (notify: () => void) => {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === PAUSE_KEY) notify(); };
  window.addEventListener(PAUSE_EVENT, notify);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(PAUSE_EVENT, notify); window.removeEventListener("storage", onStorage); };
};
export function togglePaused() {
  try { localStorage.setItem(PAUSE_KEY, String(!readPaused())); } catch { /* storage unavailable: nothing to persist */ }
  window.dispatchEvent(new Event(PAUSE_EVENT));
}
