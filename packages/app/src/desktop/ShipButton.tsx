import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@freddai/ui/components/button";
import { Rocket, TriangleAlert } from "lucide-react";
import { errorText, shipTooltip, shipVisible, type GitClient, type GitStatusSummary } from "./git-actions";

const DEBOUNCE_MS = 1500;
const POLL_MS = 60_000;

/** The prompt the "Commit & push" agent thread starts with. Its first line becomes the thread title. */
export const SHIP_PROMPT = `Commit & push

Commit all current changes in this repo with a clear, descriptive commit message (split into logical commits if the changes are unrelated), then push to the remote. Before pushing, check that nothing is broken: run the project's relevant build/lint/tests if they exist. If a push fails (e.g. needs a rebase), resolve it safely without force-pushing, and report what you did.`;

/**
 * Icon button in a project's header for its root repository. Enabled only when the tree is dirty or commits are
 * unpushed. `activity` changes whenever a thread finishes a turn and triggers a debounced status refresh.
 * Clicking starts an agent thread (via `onShip`) that commits and pushes; failures are shown, never swallowed.
 */
export function ShipButton({ projectId, projectName, path, client, activity, onShip }: {
  projectId: string; projectName: string; path: string; client: Pick<GitClient, "status">; activity?: string;
  /** Starts the commit & push thread in the project. Must reject (not swallow) when it cannot. */
  onShip: (projectId: string) => Promise<unknown>;
}) {
  const [status, setStatus] = useState<GitStatusSummary | null>(null);
  const [statusError, setStatusError] = useState("");
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState("");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const refresh = useCallback(async () => {
    try {
      const s = await client.status(path);
      if (!alive.current) return;
      setStatus(s);
      setStatusError("");
    } catch (e) {
      if (!alive.current) return;
      const text = errorText(e);
      setStatus(null);
      // A project folder that simply is not a repository has nothing to ship; any other failure is shown.
      setStatusError(/not a git repository/i.test(text) ? "" : text);
    }
  }, [client, path]);

  // Debounced refresh on mount and whenever a thread in the project changes state.
  useEffect(() => {
    const t = setTimeout(() => void refresh(), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [refresh, activity]);
  useEffect(() => {
    const t = setInterval(() => { if (typeof document === "undefined" || !document.hidden) void refresh(); }, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const ship = async () => {
    if (launching) return;
    setLaunching(true); setLaunchError("");
    try { await onShip(projectId); }
    catch (e) {
      const text = errorText(e);
      console.error(`ship: could not start the commit & push thread for ${projectName}: ${text}`, e);
      setLaunchError(text);
    } finally { if (alive.current) setLaunching(false); }
  };

  if (statusError) {
    return <div className="project-ship-wrap"><span className="ship-status-error" role="alert" title={`Git status failed: ${statusError}`}><TriangleAlert size={13} aria-hidden="true" /><span className="ship-visually-hidden">Git status failed: {statusError}</span></span></div>;
  }
  if (!status) return null;
  const enabled = shipVisible(status);
  const tip = enabled ? shipTooltip(status) : "Everything is already committed and pushed";
  return (
    <div className="project-ship-wrap" data-project-ship={projectId}>
      {launchError && <span className="ship-status-error" role="alert" title={`Could not start Commit & push: ${launchError}`}><TriangleAlert size={13} aria-hidden="true" /><span className="ship-visually-hidden">Could not start Commit & push: {launchError}</span></span>}
      <Button type="button" variant="ghost" size="icon" className="project-settings-button project-ship-button"
        aria-disabled={!enabled || undefined} aria-busy={launching || undefined} aria-label={tip} title={tip}
        onClick={() => { if (enabled) void ship(); }}>
        <Rocket size={13} aria-hidden="true" />
        {enabled && status.ahead > 0 && <span className="ship-dot" aria-hidden="true" />}
      </Button>
    </div>
  );
}
