import { useEffect, useRef, useState } from "react";
import { Square } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { bugWalk, elapsedSeconds, formatClock, useBugWalk, type BugWalkStore } from "./bugWalk";
import "./bug-walk.css";

/** Content of the `bug-walk-pill` window: red dot, clock, mic level and Stop. Seeded from the window URL because it opens after recording began. */
export function RecordingPill({ store = bugWalk, search = window.location.search, onClose = () => { void getCurrentWindow().close(); } }: { store?: BugWalkStore; search?: string; onClose?: () => void }) {
  const { walk } = useBugWalk(store);
  const [now, setNow] = useState(Date.now());
  const seeded = useRef(false);
  if (!seeded.current) {
    seeded.current = true;
    const q = new URLSearchParams(search), id = q.get("id");
    if (id && !store.getSnapshot().walk) store.seed({ id, startedAt: Number(q.get("started")) || Date.now() });
  }
  useEffect(() => {
    let off = () => {};
    let gone = false;
    void store.attach({ hotkey: false }).then(unlisten => { if (gone) unlisten(); else off = unlisten; });
    return () => { gone = true; off(); };
  }, [store]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, []);
  const recording = walk?.phase === "recording";
  useEffect(() => { if (seeded.current && !recording) onClose(); }, [recording]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); void store.stop(); } };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [store]);
  if (!walk) return null;
  const level = Math.min(1, Math.max(0, walk.level));
  return <div className="bug-walk-pill" role="status" aria-label="Bug walk recording">
    <span className="bug-walk-dot" aria-hidden="true" />
    <time className="bug-walk-clock">{formatClock(elapsedSeconds(walk, now))}</time>
    <span className="bug-walk-meter" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={1} aria-valuenow={level}><span style={{ transform: `scaleX(${level})` }} /></span>
    <button type="button" className="bug-walk-stop" onClick={() => void store.stop()} title="Stop (Esc)"><Square size={11} aria-hidden="true" />Stop</button>
  </div>;
}
