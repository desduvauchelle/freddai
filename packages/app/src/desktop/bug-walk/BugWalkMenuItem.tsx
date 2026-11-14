import { useEffect, useState } from "react";
import { DropdownMenuItem, DropdownMenuShortcut } from "@freddai/ui/components/dropdown-menu";
import { DEFAULT_SHORTCUT, bugWalk, prettyShortcut, useBugWalk, type BugWalkStore } from "./bugWalk";

/** "More actions" menu entries: "Bug walk: zone" and "Bug walk: app" (one "Stop bug walk" while recording).
 * The menu content mounts when opened, so the shortcut is read fresh each time; it shows on the mode the hotkey reuses. */
export function BugWalkMenuItem({ disabled, store = bugWalk }: { disabled?: boolean; store?: BugWalkStore }) {
  const [shortcut, setShortcut] = useState<string | null>(null);
  const recording = useBugWalk(store).walk?.phase === "recording";
  useEffect(() => {
    let live = true;
    store.settings.get().then(s => { if (live) setShortcut(s?.enabled ? s.shortcut : ""); }).catch(() => { if (live) setShortcut(DEFAULT_SHORTCUT); });
    return () => { live = false; };
  }, [store]);
  const keys = !!shortcut && <DropdownMenuShortcut>{prettyShortcut(shortcut)}</DropdownMenuShortcut>;
  if (recording) return <DropdownMenuItem disabled={disabled} onSelect={() => void store.stop()}>Stop bug walk{keys}</DropdownMenuItem>;
  const last = store.getLastMode();
  return <>
    <DropdownMenuItem disabled={disabled} onSelect={() => void store.start(undefined, "zone")}>Bug walk: zone{last === "zone" && keys}</DropdownMenuItem>
    <DropdownMenuItem disabled={disabled} onSelect={() => void store.start(undefined, "app")}>Bug walk: app{last === "app" && keys}</DropdownMenuItem>
  </>;
}
