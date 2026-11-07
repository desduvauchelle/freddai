import { useEffect, useState } from "react";
import { commanderApi } from "./api";

/** Editable project objective (Settings → Projects). Saves via `project_objective_set`; failures are shown, never swallowed. */
export function ProjectObjective({ projectId, objective, disabled = false, onSaved }: {
  projectId: string; objective: string | null | undefined; disabled?: boolean; onSaved?: () => void | Promise<void>;
}) {
  const [value, setValue] = useState(objective ?? ""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  useEffect(() => { setValue(objective ?? ""); setSaved(false); }, [projectId, objective]);
  const dirty = value.trim() !== (objective ?? "").trim();
  async function save() {
    setBusy(true); setError(""); setSaved(false);
    try { await commanderApi.objectiveSet(projectId, value.trim() || null); setSaved(true); await onSaved?.(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <div className="project-objective">
    <label>Objective
      <textarea aria-label="Objective" rows={3} value={value} disabled={disabled || busy} placeholder="What this project is, who it's for, and its current goal. Commander uses this to route work."
        onChange={e => { setValue(e.target.value); setSaved(false); }} />
    </label>
    <div className="commander-card-actions">
      <button type="button" className="commander-btn" data-variant="yes" disabled={disabled || busy || !dirty} onClick={() => void save()}>{busy ? "Saving…" : "Save objective"}</button>
      {saved && <span role="status" className="commander-muted">Saved</span>}
    </div>
    {error && <p className="commander-error" role="alert">Couldn't save the objective: {error}</p>}
  </div>;
}
