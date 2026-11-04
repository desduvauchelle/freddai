// xterm.js <-> PTY bridge. Sessions live at module level so they survive thread switches (keyed by cwd)
// and are NOT restored after an app restart (the shells are killed when the app exits).
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { terminalPanel } from "./terminal-panel-state";

export type TermTab = {
  key: string; cwd: string; title: string; ptyId: number | null; started: boolean;
  exited: boolean; term: Terminal; fit: FitAddon; host: HTMLDivElement; opened: boolean; queued: string[];
};
type Snapshot = { tabs: Record<string, TermTab[]>; active: Record<string, string> };

let snapshot: Snapshot = { tabs: {}, active: {} };
const listeners = new Set<() => void>();
const byPty = new Map<number, TermTab>();
const earlyOutput = new Map<number, string[]>();
const earlyExit = new Map<number, number | null>();
let counter = 0, listening: Promise<void> | null = null, watcher = false;

const emit = (next: Snapshot) => { snapshot = next; listeners.forEach(l => l()); };
export const terminalSessions = {
  subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
  getSnapshot: () => snapshot,
};

function themeFromApp() {
  const style = getComputedStyle(document.querySelector(".dev-app") ?? document.documentElement);
  const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const background = v("--background", "#18191c"), foreground = v("--foreground", "#dedee3");
  return { background, foreground, cursor: v("--primary", foreground), cursorAccent: background, selectionBackground: v("--accent", "#2d2e35"), black: background, brightBlack: v("--muted-foreground", "#93949f") };
}

function applyThemes() { for (const tabs of Object.values(snapshot.tabs)) for (const t of tabs) t.term.options.theme = themeFromApp(); }
function watchTheme() {
  if (watcher) return;
  watcher = true;
  new MutationObserver(applyThemes).observe(document.documentElement, { attributes: true, attributeFilter: ["data-freddai-theme", "data-freddai-appearance", "class"] });
}

function fail(tab: TermTab, what: string, e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  console.error(`terminal: ${what}`, { cwd: tab.cwd, error: message });
  tab.term.write(`\r\n\x1b[31m[terminal] ${what}: ${message}\x1b[0m\r\n`);
}

function markExited(tab: TermTab, code: number | null) {
  tab.exited = true;
  tab.term.write(`\r\n\x1b[2m[process exited${code == null ? "" : ` with code ${code}`}]\x1b[0m\r\n`);
  emit({ ...snapshot });
}

function ensureListeners() {
  listening ??= (async () => {
    await listen<{ id: number; data: string }>("terminal-output", ({ payload }) => {
      const tab = byPty.get(payload.id);
      if (tab) tab.term.write(payload.data);
      else earlyOutput.set(payload.id, [...(earlyOutput.get(payload.id) ?? []), payload.data]);
    });
    await listen<{ id: number; code: number | null }>("terminal-exit", ({ payload }) => {
      const tab = byPty.get(payload.id);
      if (tab) markExited(tab, payload.code); else earlyExit.set(payload.id, payload.code);
    });
  })().catch(e => { listening = null; console.error("terminal: cannot listen for terminal events", e); throw e; });
  return listening;
}

export function sendToTab(tab: TermTab, data: string) {
  if (tab.exited) return;
  if (tab.ptyId == null) { tab.queued.push(data); return; }
  invoke("terminal_write", { id: tab.ptyId, data }).catch(e => fail(tab, "write failed", e));
}

async function start(tab: TermTab) {
  if (tab.started) return;
  tab.started = true;
  try {
    await ensureListeners();
    const id = await invoke<number>("terminal_open", { cwd: tab.cwd, cols: tab.term.cols, rows: tab.term.rows });
    tab.ptyId = id; byPty.set(id, tab);
    for (const d of earlyOutput.get(id) ?? []) tab.term.write(d);
    earlyOutput.delete(id);
    if (earlyExit.has(id)) { markExited(tab, earlyExit.get(id) ?? null); earlyExit.delete(id); }
    for (const d of tab.queued.splice(0)) sendToTab(tab, d);
  } catch (e) {
    tab.exited = true;
    fail(tab, "could not start a shell", e);
    emit({ ...snapshot });
  }
}

export function newTab(cwd: string): TermTab {
  watchTheme();
  const term = new Terminal({ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, cursorBlink: true, scrollback: 5000, allowProposedApi: false, theme: themeFromApp() });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const host = document.createElement("div");
  host.className = "terminal-host";
  const tab: TermTab = { key: `t${++counter}`, cwd, title: `Terminal ${counter}`, ptyId: null, started: false, exited: false, term, fit, host, opened: false, queued: [] };
  // Ctrl+` belongs to the app (panel toggle), not the shell.
  term.attachCustomKeyEventHandler(e => !(e.ctrlKey && e.key === "`"));
  term.onData(d => sendToTab(tab, d));
  term.onResize(({ cols, rows }) => { if (tab.ptyId != null) invoke("terminal_resize", { id: tab.ptyId, cols, rows }).catch(e => fail(tab, "resize failed", e)); });
  emit({ tabs: { ...snapshot.tabs, [cwd]: [...(snapshot.tabs[cwd] ?? []), tab] }, active: { ...snapshot.active, [cwd]: tab.key } });
  return tab;
}

/** Mount a tab's terminal into `container` (moving it if it was shown elsewhere) and start its shell on first show. */
export function attachTab(tab: TermTab, container: HTMLElement) {
  if (tab.host.parentElement !== container) container.replaceChildren(tab.host);
  if (!tab.opened) { tab.term.open(tab.host); tab.opened = true; }
  refit(tab);
  void start(tab);
}

export function refit(tab: TermTab) {
  if (!tab.opened || !tab.host.clientWidth || !tab.host.clientHeight) return;
  try { tab.fit.fit(); } catch (e) { console.warn("terminal: fit failed", e); }
}

export function selectTab(cwd: string, key: string) { emit({ ...snapshot, active: { ...snapshot.active, [cwd]: key } }); }

export function closeTab(tab: TermTab) {
  if (tab.ptyId != null) { byPty.delete(tab.ptyId); invoke("terminal_close", { id: tab.ptyId }).catch(e => console.error("terminal: close failed", e)); }
  tab.term.dispose();
  const rest = (snapshot.tabs[tab.cwd] ?? []).filter(t => t !== tab);
  const tabs = { ...snapshot.tabs };
  if (rest.length) tabs[tab.cwd] = rest; else delete tabs[tab.cwd];
  const active = { ...snapshot.active };
  if (rest.length) { if (active[tab.cwd] === tab.key) active[tab.cwd] = rest[rest.length - 1].key; } else delete active[tab.cwd];
  emit({ tabs, active });
  if (!Object.keys(tabs).length) terminalPanel.setOpen(false);
}

/** Run a command line in the active terminal for `cwd` (creating one if needed) and show the panel. */
export function runInTerminal(cwd: string, command: string) {
  terminalPanel.setOpen(true);
  const tabs = snapshot.tabs[cwd] ?? [];
  const tab = tabs.find(t => t.key === snapshot.active[cwd] && !t.exited) ?? tabs.find(t => !t.exited) ?? newTab(cwd);
  selectTab(cwd, tab.key);
  sendToTab(tab, `${command}\r`);
}
