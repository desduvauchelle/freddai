import { useEffect, useRef, useSyncExternalStore } from "react";
import { Plus, X } from "lucide-react";
import { terminalPanel, MIN_TERMINAL_HEIGHT } from "./terminal-panel-state";
import { attachTab, closeTab, newTab, refit, selectTab, terminalSessions } from "./terminal-sessions";

/** Bottom terminal panel for one working folder. Tabs persist (per cwd) while the panel is hidden or the thread changes. */
export function TerminalPanel({ cwd }: { cwd: string }) {
  const { height } = useSyncExternalStore(terminalPanel.subscribe, terminalPanel.getSnapshot);
  const sessions = useSyncExternalStore(terminalSessions.subscribe, terminalSessions.getSnapshot);
  const tabs = sessions.tabs[cwd] ?? [];
  const active = tabs.find(t => t.key === sessions.active[cwd]) ?? tabs[0];
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!tabs.length) newTab(cwd); }, [cwd, tabs.length]);
  useEffect(() => {
    const el = body.current;
    if (!el || !active) return;
    attachTab(active, el);
    const observer = new ResizeObserver(() => refit(active));
    observer.observe(el);
    active.term.focus();
    return () => observer.disconnect();
  }, [active, height]);

  function drag(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const startY = e.clientY, startHeight = height;
    const move = (ev: PointerEvent) => terminalPanel.setHeight(startHeight + startY - ev.clientY);
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <section className="terminal-panel" style={{ height }} aria-label="Terminal">
      <div
        className="terminal-resizer" role="separator" aria-orientation="horizontal" aria-label="Resize terminal"
        aria-valuenow={height} aria-valuemin={MIN_TERMINAL_HEIGHT} tabIndex={0} onPointerDown={drag}
        onKeyDown={e => { if (e.key === "ArrowUp") { e.preventDefault(); terminalPanel.setHeight(height + 24); } else if (e.key === "ArrowDown") { e.preventDefault(); terminalPanel.setHeight(height - 24); } }}
      />
      <div className="terminal-tabs" role="tablist">
        {tabs.map(t => (
          <div key={t.key} className="terminal-tab" data-active={t === active ? "true" : undefined} data-exited={t.exited ? "true" : undefined}>
            <button type="button" role="tab" aria-selected={t === active} onClick={() => selectTab(cwd, t.key)}>{t.title}{t.exited ? " (exited)" : ""}</button>
            <button type="button" aria-label={`Close ${t.title}`} title="Close terminal" onClick={() => closeTab(t)}><X size={12} /></button>
          </div>
        ))}
        <button type="button" className="terminal-new" aria-label="New terminal" title="New terminal" onClick={() => newTab(cwd)}><Plus size={14} /></button>
        <span className="terminal-cwd" title={cwd}>{cwd}</span>
      </div>
      <div className="terminal-body" ref={body} />
    </section>
  );
}
