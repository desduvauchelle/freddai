import type { Attachment } from "./types";

export type ScreenGrabDestination = "current" | "new";

/** Add staged files to a composer's attachments, skipping content already attached (same rule as the file picker and drag-drop). */
export function mergeAttachments(old: Attachment[], files: Attachment[]): Attachment[] {
  return [...old, ...files.filter(f => !old.some(o => o.sha256 === f.sha256))];
}

export type ScreenGrabDeps = {
  /** Tauri `invoke`. `capture_screenshot` returns the staged attachments, or null when the user pressed Esc. */
  invoke: <T>(command: string) => Promise<T>;
  /** Thread whose composer was focused when the user chose "Attach to current thread". */
  currentThread: string;
  /** Composer targets that still exist after the capture ("new" or open thread ids). */
  isLive: (target: string) => boolean;
  /** Open the new-thread composer in the current project context. */
  openNewThread: () => void;
  /** Same attachment state the picker and drag-drop write to; target is "new" or a thread id. */
  addAttachments: (target: string, files: Attachment[]) => void;
  focusComposer: (target: string) => void;
  showError: (message: string) => void;
  showNotice: (message: string) => void;
  logEvent?: (name: string, detail: unknown) => void;
};

/** Run one interactive capture and route the result. Returns what happened so callers and tests can assert on it. */
export async function runScreenGrab(destination: ScreenGrabDestination, deps: ScreenGrabDeps): Promise<"cancelled" | "attached" | "error"> {
  const log = deps.logEvent ?? ((name, detail) => console.error(name, detail));
  if (destination === "current" && !deps.currentThread) return "cancelled";
  let files: Attachment[] | null;
  try {
    files = await deps.invoke<Attachment[] | null>("capture_screenshot");
  } catch (e) {
    const message = String(e);
    log("screen_grab.failed", message);
    deps.showError(`Screen grab failed: ${message}`);
    return "error";
  }
  if (!files || !files.length) return "cancelled";
  const target = destination === "new" ? "new" : deps.currentThread;
  if (destination === "new") deps.openNewThread();
  else if (!deps.isLive(target)) {
    deps.showNotice("The screen grab was saved. Attach again in the intended conversation.");
    return "cancelled";
  }
  deps.addAttachments(target, files);
  deps.focusComposer(target);
  return "attached";
}
