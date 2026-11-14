import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { uuid, type Rule } from "../api";
import type { ScreenBase } from "../contracts";
import { DarkButton, GhostButton } from "../ui";
import { InlineError, Switch, useRun } from "./common";

export const RULE_TEMPLATES: { id: string; name: string; when_text: string; then_text: string }[] = [
  {
    id: "cold-outreach",
    name: "Cold outreach replies",
    when_text: "a cold sales or outreach email arrives",
    then_text: "draft a short polite reply for me to approve, then label it Cold outreach",
  },
  {
    id: "meeting-notes",
    name: "Meeting notes",
    when_text: "a meeting ends",
    then_text: "save the notes and action items to the project and make a task for each action item",
  },
  {
    id: "support-triage",
    name: "Support triage",
    when_text: "a customer reports a problem",
    then_text: "make a task in Support with the steps to reproduce and ask me if it looks urgent",
  },
];

type Draft = { name: string; when_text: string; then_text: string; project: string | null };

function RuleForm({ initial, projects, onSave, onCancel, showTemplates }: {
  initial: Draft;
  projects: ScreenBase["state"]["projects"];
  onSave: (draft: Draft) => void;
  onCancel: () => void;
  showTemplates?: boolean;
}) {
  const [draft, setDraft] = useState(initial);
  const valid = draft.name.trim() && draft.when_text.trim() && draft.then_text.trim();
  return <form className="st-rule st-rule--form" aria-label="Rule editor" onSubmit={e => {
    e.preventDefault();
    if (valid) onSave({ ...draft, name: draft.name.trim(), when_text: draft.when_text.trim(), then_text: draft.then_text.trim() });
  }}>
    {showTemplates && <div className="st-templates" role="group" aria-label="Start from a template">
      <span className="st-muted">Start from</span>
      {RULE_TEMPLATES.map(t => <button key={t.id} type="button" className="st-chip"
        onClick={() => setDraft(d => ({ ...d, name: t.name, when_text: t.when_text, then_text: t.then_text }))}>{t.name}</button>)}
    </div>}
    <label className="st-field"><span className="st-field__label">Name</span>
      <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="Vendor invoices" /></label>
    <label className="st-field"><span className="st-field__label">When</span>
      <textarea rows={2} value={draft.when_text} onChange={e => setDraft(d => ({ ...d, when_text: e.target.value }))} placeholder="a new invoice arrives" /></label>
    <label className="st-field"><span className="st-field__label">Then</span>
      <textarea rows={2} value={draft.then_text} onChange={e => setDraft(d => ({ ...d, then_text: e.target.value }))} placeholder="file it and tell me if it is overdue" /></label>
    <label className="st-field"><span className="st-field__label">Applies to</span>
      <select value={draft.project ?? ""} onChange={e => setDraft(d => ({ ...d, project: e.target.value || null }))}>
        <option value="">All projects</option>
        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
    <div className="st-form__actions">
      <GhostButton onClick={onCancel}>Cancel</GhostButton>
      <button type="submit" className="sc-btn sc-btn--dark" disabled={!valid}>Save rule</button>
    </div>
  </form>;
}

/** Rule cards (Settings › Rules and onboarding step 4). Plain-language rules: "When … / Then …". */
export function RulesEditor({ state, actions }: Pick<ScreenBase, "state" | "actions">) {
  const { run, error, clearError } = useRun();
  const [editing, setEditing] = useState<string | null>(null); // rule id or "new"
  const rules = [...state.rules].sort((a, b) => a.order - b.order);
  const projects = [...state.projects].sort((a, b) => a.name.localeCompare(b.name));
  const save = (rule: Rule) => run(() => actions.ruleSave(rule));
  return <div className="st-rules">
    <div className="st-toolbar">
      <div className="st-toolbar__pills"><span className="st-muted">{rules.length} rule{rules.length === 1 ? "" : "s"}</span></div>
      <div className="st-toolbar__actions">
        <DarkButton icon={<Plus size={14} />} onClick={() => setEditing("new")} disabled={editing === "new"}>New rule</DarkButton>
      </div>
    </div>
    <InlineError error={error} onDismiss={clearError} />
    {editing === "new" && <RuleForm showTemplates projects={projects}
      initial={{ name: "", when_text: "", then_text: "", project: null }}
      onCancel={() => setEditing(null)}
      onSave={d => { setEditing(null); void save({ id: uuid(), ...d, enabled: true, order: rules.length }); }} />}
    {rules.length === 0 && editing !== "new" && <p className="st-note">No rules yet. A rule says what to do when something arrives, in plain words. Start from a template with “New rule”.</p>}
    <ul className="st-rule-list">
      {rules.map(rule => <li key={rule.id}>
        {editing === rule.id
          ? <RuleForm projects={projects} initial={{ name: rule.name, when_text: rule.when_text, then_text: rule.then_text, project: rule.project }}
            onCancel={() => setEditing(null)} onSave={d => { setEditing(null); void save({ ...rule, ...d }); }} />
          : <article className="st-rule" aria-label={rule.name}>
            <div className="st-rule__head">
              <h3 className="st-rule__name">{rule.name}</h3>
              <select className="st-rule__scope" aria-label={`Project for ${rule.name}`} value={rule.project ?? ""}
                onChange={e => void save({ ...rule, project: e.target.value || null })}>
                <option value="">All projects</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <Switch checked={rule.enabled} label={`${rule.name} enabled`} onChange={enabled => void save({ ...rule, enabled })} />
              <button type="button" className="st-icon-btn" aria-label={`Edit ${rule.name}`} onClick={() => setEditing(rule.id)}><Pencil size={14} /></button>
              <button type="button" className="st-icon-btn" aria-label={`Delete ${rule.name}`} onClick={() => void run(() => actions.ruleDelete(rule.id))}><Trash2 size={14} /></button>
            </div>
            <p className="st-rule__line"><span className="st-rule__kw st-rule__kw--when">When</span>{rule.when_text}</p>
            <p className="st-rule__line"><span className="st-rule__kw st-rule__kw--then">Then</span>{rule.then_text}</p>
          </article>}
      </li>)}
    </ul>
  </div>;
}
