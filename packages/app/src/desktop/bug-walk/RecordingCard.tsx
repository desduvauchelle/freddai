import { useEffect, useState } from "react";
import { Square } from "lucide-react";
import { Button } from "@freddai/ui/components/button";
import { bugWalk, elapsedSeconds, formatClock, type BugWalk, type BugWalkStore } from "./bugWalk";
import "./bug-walk.css";

/** Always-visible recording controls in the main window's dock, independent of the floating pill window. */
export function RecordingCard({ walk, store = bugWalk }: { walk: BugWalk; store?: BugWalkStore }) {
  const [now, setNow] = useState(Date.now());
  const [confirming, setConfirming] = useState(false);
  const recording = walk.phase === "recording";
  useEffect(() => {
    if (!recording) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [recording]);
  if (!recording) {
    return <section className="bug-walk-card" data-state="selecting" role="status" aria-label="Bug walk region selection">
      <header><strong>Drag a region on screen… (Esc to cancel)</strong></header>
    </section>;
  }
  const level = Math.min(1, Math.max(0, walk.level));
  return <section className="bug-walk-card" data-state="recording" role="status" aria-label="Bug walk recording">
    <header><span className="bug-walk-dot" aria-hidden="true" /><strong>Recording bug walk</strong></header>
    {walk.error && <p className="bug-walk-error" role="alert">{walk.error}</p>}
    <div className="bug-walk-rec-row">
      <time className="bug-walk-clock">{formatClock(elapsedSeconds(walk, now))}</time>
      <span className="bug-walk-meter" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={1} aria-valuenow={level}><span style={{ transform: `scaleX(${level})` }} /></span>
      <button type="button" className="bug-walk-stop bug-walk-stop-lg" onClick={() => void store.stop()}><Square size={12} aria-hidden="true" />Stop</button>
    </div>
    {confirming
      ? <div className="bug-walk-confirm" role="group" aria-label="Discard recording"><span>Discard recording?</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>No</Button>
        <Button type="button" size="sm" onClick={() => void store.cancel()}>Yes</Button></div>
      : <div className="bug-walk-actions"><Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(true)}>Cancel</Button></div>}
  </section>;
}
