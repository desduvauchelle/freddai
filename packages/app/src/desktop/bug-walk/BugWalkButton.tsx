import { Video } from "lucide-react";
import { Button } from "@freddai/ui/components/button";
import { bugWalk, useBugWalk, type BugWalkOrigin, type BugWalkStore } from "./bugWalk";

/** Entry point for dashboard header and composer toolbars. Starts a walk; from a thread composer pass `origin.thread`. */
export function BugWalkButton({ origin, className, store = bugWalk, label = "Bug walk", labelled = false }: { origin?: BugWalkOrigin; className?: string; store?: BugWalkStore; label?: string; labelled?: boolean }) {
  const { walk } = useBugWalk(store);
  const active = !!walk && walk.phase !== "done" && walk.phase !== "cancelled";
  return <Button type="button" variant="ghost" size={labelled ? "sm" : "icon"} className={`bug-walk-button${className ? ` ${className}` : ""}`} aria-label={label} title={`${label} — record the screen and your voice`}
    disabled={active} onClick={() => void store.start(origin)}><Video size={labelled ? 14 : 16} aria-hidden="true" />{labelled && label}</Button>;
}
