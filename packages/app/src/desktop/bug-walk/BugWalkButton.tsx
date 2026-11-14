import { AppWindow, SquareDashed, Video } from "lucide-react";
import { Button } from "@freddai/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@freddai/ui/components/dropdown-menu";
import { bugWalk, useBugWalk, type BugWalkMode, type BugWalkOrigin, type BugWalkStore } from "./bugWalk";

export const BUG_WALK_MODES: { mode: BugWalkMode; label: string; hint: string }[] = [
  { mode: "zone", label: "Zone", hint: "Drag a region of the screen" },
  { mode: "app", label: "App", hint: "Click an app window to record it" },
];

/** Entry point for dashboard header and composer toolbars. Opens a Zone / App choice, then starts a walk; from a thread composer pass `origin.thread`. */
export function BugWalkButton({ origin, className, store = bugWalk, label = "Bug walk", labelled = false }: { origin?: BugWalkOrigin; className?: string; store?: BugWalkStore; label?: string; labelled?: boolean }) {
  const { walk } = useBugWalk(store);
  const active = !!walk && walk.phase !== "done" && walk.phase !== "cancelled";
  const button = <Button type="button" variant="ghost" size={labelled ? "sm" : "icon"} className={`bug-walk-button${className ? ` ${className}` : ""}`} aria-label={label} title={`${label} — record the screen and your voice`}
    disabled={active}><Video size={labelled ? 14 : 16} aria-hidden="true" />{labelled && label}</Button>;
  if (active) return button;
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="bug-walk-mode-menu">
      {BUG_WALK_MODES.map(m => <DropdownMenuItem key={m.mode} onSelect={() => void store.start(origin, m.mode)}>
        {m.mode === "zone" ? <SquareDashed aria-hidden="true" /> : <AppWindow aria-hidden="true" />}
        <span className="bug-walk-mode-text"><strong>{m.label}</strong><span>{m.hint}</span></span>
      </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
