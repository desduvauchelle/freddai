import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { createRoot } from "react-dom/client";
import "@freddai/ui/styles.css";
import { empty } from "../../src/desktop/types";
// No connected accounts, credentials or provider turns; commands never reach a host.
Object.assign(window, { isTauri: true, threadWindowCommands: [] });
mockWindows("thread-fixture");
mockIPC((command) => {
  (window as unknown as { threadWindowCommands: string[] }).threadWindowCommands.push(command);
  if (command === "snapshot_since") return { ...empty, revision: 1, hostId: "fixture", full: true, sessions: [{
    id: "focus", title: "Focused conversation", project: "", account: "", status: "done", updated: 1,
    provider_id: null, messages: [{ id: "message", role: "user", text: "Only this conversation belongs in this window." }], pending: null, error: null,
  }] };
  if (command === "updater_state") return { state: "idle" };
  if (command === "voice_status") return { ready: false };
  return null;
}, { shouldMockEvents: true });
const { DesktopApp } = await import("../../src/desktop/DesktopApp");
createRoot(document.getElementById("root")!).render(<DesktopApp />);
