import { useEffect, useState } from "react";
import { DropdownMenuItem, DropdownMenuShortcut } from "@freddai/ui/components/dropdown-menu";
import { DEFAULT_SHORTCUT, bugWalk, prettyShortcut, useBugWalk, type BugWalkStore } from "./bugWalk";

/** "More actions" menu entry. The menu content mounts when opened, so the shortcut is read fresh each time. */
export function BugWalkMenuItem({ disabled, store = bugWalk }: { disabled?: boolean; store?: BugWalkStore }) {
  const [shortcut, setShortcut] = useState<string | null>(null);
  const recording = useBugWalk(store).walk?.phase === "recording";
  useEffect(() => {
    let live = true;
    store.settings.get().then(s => { if (live) setShortcut(s?.enabled ? s.shortcut : ""); }).catch(() => { if (live) setShortcut(DEFAULT_SHORTCUT); });
    return () => { live = false; };
  }, [store]);
  return <DropdownMenuItem disabled={disabled} onSelect={() => void (recording ? store.stop() : store.start())}>{recording ? "Stop bug walk" : "Bug walk"}{!!shortcut && <DropdownMenuShortcut>{prettyShortcut(shortcut)}</DropdownMenuShortcut>}</DropdownMenuItem>;
}
