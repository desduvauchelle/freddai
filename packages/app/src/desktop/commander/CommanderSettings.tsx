import { SpeechSettings, type SpeechConnection } from "./SpeechSettings";
import { useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";
import type { Project } from "../types";
import { commanderApi, DEFAULT_COMMANDER_SETTINGS, type CommanderSettings as Settings } from "./api";

export const HEARTBEAT_INTERVALS = [15, 30, 60, 120, 240];
const MODES: { id: Settings["autonomy"]["mode"]; label: string; blurb: string }[] = [
  { id: "propose", label: "Propose", blurb: "Suggests tasks, you approve each" },
  { id: "budgeted", label: "Budgeted", blurb: "Starts tasks on its own within these limits" },
];
const msg = (e: unknown) => e instanceof Error ? e.message : String(e);
const num = (v: string, min: number) => Math.max(min, Math.floor(Number(v)) || min);

/** Autonomy and heartbeat settings for the Commander. Save errors from the backend (which name the failing field) are shown inline. */
export function CommanderSettings({ projects, api = commanderApi, speechConnection }: { projects: readonly Pick<Project, "id" | "name" | "kind">[]; speechConnection?: SpeechConnection; api?: Pick<typeof commanderApi, "getCommanderSettings" | "saveCommanderSettings"> }) {
  const [saved, setSaved] = useState<Settings | null>(null), [draft, setDraft] = useState<Settings>(DEFAULT_COMMANDER_SETTINGS);
  const [loadError, setLoadError] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [done, setDone] = useState(false);
  useEffect(() => {
    let alive = true;
    api.getCommanderSettings().then(s => { if (alive) { setSaved(s); setDraft(s); } }).catch(e => alive && setLoadError(`Couldn't load autonomy settings: ${msg(e)}`));
    return () => { alive = false; };
  }, [api]);
  const { autonomy, heartbeat } = draft;
  const dirty = !!saved && JSON.stringify(saved) !== JSON.stringify(draft);
  const patchA = (p: Partial<Settings["autonomy"]>) => { setDraft(d => ({ ...d, autonomy: { ...d.autonomy, ...p } })); setDone(false); };
  const patchH = (p: Partial<Settings["heartbeat"]>) => { setDraft(d => ({ ...d, heartbeat: { ...d.heartbeat, ...p } })); setDone(false); };
  const selectable = projects.filter(p => p.kind !== "commander");
  const toggle = (id: string) => patchA({ allowedProjectIds: autonomy.allowedProjectIds.includes(id) ? autonomy.allowedProjectIds.filter(x => x !== id) : [...autonomy.allowedProjectIds, id] });
  async function save() {
    setBusy(true); setError(""); setDone(false);
    try { const s = await api.saveCommanderSettings(draft); setSaved(s); setDraft(s); setDone(true); }
    catch (e) { setError(`Couldn't save: ${msg(e)}`); }
    finally { setBusy(false); }
  }
  const intervals = HEARTBEAT_INTERVALS.includes(heartbeat.intervalMinutes) ? HEARTBEAT_INTERVALS : [...HEARTBEAT_INTERVALS, heartbeat.intervalMinutes].sort((a, b) => a - b);
  return <div className="commander-profile commander-settings">
    <SpeechSettings connection={speechConnection} />
    {loadError && <p className="commander-error" role="alert"><CircleAlert size={13} aria-hidden="true" />{loadError}</p>}
    <section aria-labelledby="cs-autonomy">
      <h3 id="cs-autonomy">Autonomy</h3>
      <div className="commander-presets" role="group" aria-label="Autonomy mode">
        {MODES.map(m => <button key={m.id} type="button" className="commander-preset" aria-pressed={autonomy.mode === m.id} onClick={() => patchA({ mode: m.id })}><strong>{m.label}</strong><small>{m.blurb}</small></button>)}
      </div>
      {autonomy.mode === "budgeted" && <div className="commander-budget">
        <label>Max agents at once<input type="number" min={1} aria-label="Max agents at once" value={autonomy.maxConcurrent} onChange={e => patchA({ maxConcurrent: num(e.target.value, 1) })} /></label>
        <label>Daily start cap<input type="number" min={1} aria-label="Daily start cap" value={autonomy.dailyStartCap} onChange={e => patchA({ dailyStartCap: num(e.target.value, 1) })} /></label>
        <fieldset>
          <legend>Projects it may start tasks in</legend>
          {!selectable.length && <p className="commander-muted">No projects yet.</p>}
          {selectable.map(p => <label key={p.id} className="commander-check"><input type="checkbox" checked={autonomy.allowedProjectIds.includes(p.id)} onChange={() => toggle(p.id)} />{p.name}</label>)}
          {!!selectable.length && !autonomy.allowedProjectIds.length && <p className="commander-muted">None selected: it will not start anything on its own.</p>}
        </fieldset>
      </div>}
    </section>
    <section aria-labelledby="cs-heartbeat">
      <h3 id="cs-heartbeat">Heartbeat</h3>
      <p className="commander-muted">Commander checks in on its own at this rhythm, only during active hours.</p>
      <label className="commander-check"><input type="checkbox" checked={heartbeat.enabled} onChange={e => patchH({ enabled: e.target.checked })} />Enable heartbeat</label>
      <div className="commander-budget">
        <label>Every<select aria-label="Heartbeat interval" value={heartbeat.intervalMinutes} disabled={!heartbeat.enabled} onChange={e => patchH({ intervalMinutes: Number(e.target.value) })}>
          {intervals.map(n => <option key={n} value={n}>{n} min</option>)}</select></label>
        <label>Active from<input type="time" aria-label="Active hours start" value={heartbeat.activeStart} disabled={!heartbeat.enabled} onChange={e => patchH({ activeStart: e.target.value })} /></label>
        <label>until<input type="time" aria-label="Active hours end" value={heartbeat.activeEnd} disabled={!heartbeat.enabled} onChange={e => patchH({ activeEnd: e.target.value })} /></label>
      </div>
    </section>
    <div className="commander-card-actions">
      <button type="button" className="commander-btn" data-variant="yes" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "Saving…" : "Save autonomy settings"}</button>
      {dirty && saved && <button type="button" className="commander-btn" data-variant="ghost" onClick={() => { setDraft(saved); setError(""); }}>Discard changes</button>}
      {done && <span role="status" className="commander-muted">Saved</span>}
    </div>
    {error && <p className="commander-error" role="alert"><CircleAlert size={13} aria-hidden="true" />{error}</p>}
  </div>;
}
