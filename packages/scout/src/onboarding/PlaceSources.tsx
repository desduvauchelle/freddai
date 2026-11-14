import { useState, type DragEvent } from "react";
import { GripVertical, Hash } from "lucide-react";
import { uuid, type Project, type Rule, type Source } from "../api";
import type { ScreenBase } from "../contracts";
import { InlineError, SourceKindIcon, sourceName, useRun } from "../settings";
import { cx } from "../ui";

/** Assignments are stored as plain rules (no new model field):
 *  name "Route <source>", when "something arrives from <source>", then "add it to <project>", project = id. */
export const routeWhen = (source: Source) => `something arrives from ${sourceName(source)}`;
export const routeRuleFor = (rules: Rule[], source: Source) =>
  rules.find(r => r.name.startsWith("Route ") && r.when_text === routeWhen(source));

const DRAG_TYPE = "application/x-scout-source";

function SourceChip({ source }: { source: Source }) {
  return <span className="ob-chip" draggable
    onDragStart={e => { e.dataTransfer.setData(DRAG_TYPE, source.id); e.dataTransfer.setData("text/plain", source.id); e.dataTransfer.effectAllowed = "move"; }}>
    <GripVertical size={12} className="st-faint" aria-hidden />
    <SourceKindIcon kind={source.kind} size={13} />
    <b>{source.label}</b>
    <span className="st-muted">{source.detail}</span>
  </span>;
}

export function PlaceSources({ state, actions }: Pick<ScreenBase, "state" | "actions">) {
  const { run, error, clearError } = useRun();
  const [over, setOver] = useState<string | null>(null);
  const projects = [...state.projects].sort((a, b) => a.order - b.order);
  const workspaces = [...state.workspaces].sort((a, b) => a.order - b.order);
  const projectOf = (source: Source) => routeRuleFor(state.rules, source)?.project ?? null;

  const assign = (source: Source, projectId: string | null) => {
    const existing = routeRuleFor(state.rules, source);
    if (!projectId) {
      if (existing) void run(() => actions.ruleDelete(existing.id));
      return;
    }
    const project = state.projects.find(p => p.id === projectId);
    if (!project) return;
    const rule: Rule = {
      id: existing?.id ?? uuid(),
      name: `Route ${sourceName(source)}`,
      when_text: routeWhen(source),
      then_text: `add it to ${project.name}`,
      enabled: true,
      project: project.id,
      order: existing?.order ?? state.rules.length,
    };
    void run(() => actions.ruleSave(rule));
  };

  const dropProps = (project: Project) => ({
    onDragOver: (e: DragEvent) => { e.preventDefault(); setOver(project.id); },
    onDragLeave: () => setOver(o => (o === project.id ? null : o)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOver(null);
      const id = e.dataTransfer.getData(DRAG_TYPE) || e.dataTransfer.getData("text/plain");
      const source = state.sources.find(s => s.id === id);
      if (source) assign(source, project.id);
    },
  });

  const unplaced = state.sources.filter(s => !projectOf(s));
  return <div className="ob-place">
    <p className="st-note">Each placement is saved as a rule: “Route &lt;source&gt;: when something arrives from it, add it to the project.” You can edit these in Rules.</p>
    <InlineError error={error} onDismiss={clearError} />
    {state.sources.length === 0 && <p className="st-note">No sources yet. Go back to step 1 to add some, or skip this step.</p>}
    {state.projects.length === 0 && <p className="st-note">No projects yet. Go back to step 2 to add or import some.</p>}
    <div className="ob-place__grid">
      <section className="ob-place__left" aria-label="Sources">
        <h3 className="ob-eyebrow">Sources</h3>
        <ul className="ob-source-list">
          {state.sources.map(s => <li key={s.id} className={cx("ob-source", !projectOf(s) && "is-unplaced")}>
            <SourceChip source={s} />
            <select aria-label={`Project for ${sourceName(s)}`} value={projectOf(s) ?? ""} onChange={e => assign(s, e.target.value || null)}>
              <option value="">Not placed yet</option>
              {workspaces.map(w => <optgroup key={w.id} label={w.name}>
                {projects.filter(p => p.workspace === w.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </optgroup>)}
            </select>
          </li>)}
        </ul>
        {state.sources.length > 0 && <p className="st-muted">Not placed yet · {unplaced.length}</p>}
      </section>
      <section className="ob-place__right" aria-label="Workspaces and projects">
        {workspaces.map(w => <div key={w.id} className="st-wscard">
          <header className="st-wscard__head"><span className="st-dot" style={{ background: w.color }} aria-hidden /><b>{w.name}</b></header>
          <div className="st-eyebrow">Projects</div>
          {projects.filter(p => p.workspace === w.id).map(p => {
            const placed = state.sources.filter(s => projectOf(s) === p.id);
            return <div key={p.id} className={cx("ob-drop", over === p.id && "is-over")} data-testid={`drop-${p.id}`} {...dropProps(p)}>
              <div className="ob-drop__name"><Hash size={13} className="st-faint" aria-hidden />{p.name}</div>
              {placed.length ? <div className="ob-drop__chips">{placed.map(s => <SourceChip key={s.id} source={s} />)}</div>
                : <div className="st-muted">{over === p.id ? "Drop on this project" : "Drop a source here"}</div>}
            </div>;
          })}
        </div>)}
      </section>
    </div>
  </div>;
}
