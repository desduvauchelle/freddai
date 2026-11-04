// Open/closed + height of the integrated terminal panel. Pure and storage-backed so it can be tested without xterm.
export const TERMINAL_PANEL_KEY = "freddai.terminal-panel";
export const MIN_TERMINAL_HEIGHT = 120;
export const DEFAULT_TERMINAL_HEIGHT = 260;
export type TerminalPanelState = { open: boolean; height: number };

export function clampTerminalHeight(height: number, max = typeof window === "undefined" ? 800 : Math.floor(window.innerHeight * 0.8)) {
  if (!Number.isFinite(height)) return DEFAULT_TERMINAL_HEIGHT;
  return Math.round(Math.min(Math.max(height, MIN_TERMINAL_HEIGHT), Math.max(max, MIN_TERMINAL_HEIGHT)));
}

export function readTerminalPanel(storage: Pick<Storage, "getItem"> | undefined): TerminalPanelState {
  try {
    const raw = storage?.getItem(TERMINAL_PANEL_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return { open: parsed.open === true, height: clampTerminalHeight(typeof parsed.height === "number" ? parsed.height : DEFAULT_TERMINAL_HEIGHT) };
  } catch (e) {
    console.warn("terminal-panel: ignoring unreadable saved state", e);
    return { open: false, height: DEFAULT_TERMINAL_HEIGHT };
  }
}

export function createTerminalPanelStore(storage: Pick<Storage, "getItem" | "setItem"> | undefined) {
  let state = readTerminalPanel(storage);
  const listeners = new Set<() => void>();
  const set = (next: TerminalPanelState) => {
    state = next;
    try { storage?.setItem(TERMINAL_PANEL_KEY, JSON.stringify(next)); } catch (e) { console.warn("terminal-panel: cannot save state", e); }
    listeners.forEach(l => l());
  };
  return {
    getSnapshot: () => state,
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
    toggle: () => set({ ...state, open: !state.open }),
    setOpen: (open: boolean) => { if (open !== state.open) set({ ...state, open }); },
    setHeight: (height: number) => set({ ...state, height: clampTerminalHeight(height) }),
  };
}

export const terminalPanel = createTerminalPanelStore(typeof localStorage === "undefined" ? undefined : localStorage);
