/** The recording pill lives in its own always-on-top Tauri window so it stays visible while the user walks through another app. */
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { BugWalk, BugWalkRegion } from "./bugWalk";

export const PILL_LABEL = "bug-walk-pill";
export const PILL_SIZE = { width: 268, height: 40 };
const GAP = 8;

/** Region coordinates are global logical points, top-left origin. Prefer just above the region's top-right; fall back to below when there is no room. */
export function pillPosition(region: BugWalkRegion, size = PILL_SIZE): { x: number; y: number } {
  const x = Math.max(0, Math.round(region.x + region.width - size.width));
  const above = region.y - size.height - GAP;
  return { x, y: Math.round(above >= 0 ? above : region.y + region.height + GAP) };
}
export function pillUrl(walk: Pick<BugWalk, "id" | "startedAt">): string {
  const q = new URLSearchParams({ "bug-walk-pill": "1", id: walk.id, started: String(walk.startedAt ?? Date.now()) });
  return `index.html?${q}`;
}
export const isPillWindow = (search = window.location.search) => new URLSearchParams(search).get("bug-walk-pill") === "1";

export async function openPill(walk: Pick<BugWalk, "id" | "startedAt" | "region">): Promise<void> {
  if (!walk.region) return;
  const existing = await WebviewWindow.getByLabel(PILL_LABEL);
  if (existing) return;
  const pos = pillPosition(walk.region);
  const win = new WebviewWindow(PILL_LABEL, {
    url: pillUrl(walk), title: "Bug walk", x: pos.x, y: pos.y, width: PILL_SIZE.width, height: PILL_SIZE.height,
    decorations: false, transparent: true, alwaysOnTop: true, focus: false, focusable: true, resizable: false, shadow: false, skipTaskbar: true, visibleOnAllWorkspaces: true,
  });
  // `tauri://created` can fire before our listener is registered, so a timeout falls back to asking whether the window exists.
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { void WebviewWindow.getByLabel(PILL_LABEL).then(w => w ? resolve() : reject(new Error("pill window was not created within 5 seconds")), reject); }, 5000);
    void win.once("tauri://created", () => { clearTimeout(timer); resolve(); });
    void win.once("tauri://error", e => { clearTimeout(timer); reject(new Error(String((e as { payload?: unknown }).payload))); });
  });
}
export async function closePill(): Promise<void> {
  const win = await WebviewWindow.getByLabel(PILL_LABEL);
  await win?.close();
}
