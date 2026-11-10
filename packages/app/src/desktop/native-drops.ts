import { listen } from "@tauri-apps/api/event";

export type NativeDrop =
  | { type: "enter"; paths: string[]; position: { x: number; y: number } }
  | { type: "over"; position: { x: number; y: number } }
  | { type: "drop"; paths: string[]; position: { x: number; y: number } }
  | { type: "leave" };

// Tauri routes drops to the webview or its parent window depending on whether
// child webviews exist. Native emit filters explicitly accept WebviewWindow in
// both routes; AnyLabel is only expanded by ordinary emit_to, not those filters.
export async function listenNativeDrops(label: string, handler: (event: NativeDrop) => void) {
  const unlisteners: (() => void)[] = [];
  try {
    for (const type of ["enter", "over", "drop", "leave"] as const) {
      unlisteners.push(await listen<Omit<NativeDrop, "type">>(`tauri://drag-${type}`, event => {
        handler({ ...event.payload, type } as NativeDrop);
      }, { target: { kind: "WebviewWindow", label } }));
    }
  } catch (error) {
    unlisteners.forEach(off => off());
    throw error;
  }
  return () => { unlisteners.forEach(off => off()); };
}
