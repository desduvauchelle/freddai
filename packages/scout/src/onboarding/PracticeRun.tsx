import { useState } from "react";
import { Check } from "lucide-react";
import { uuid, type Item } from "../api";
import type { ScreenBase } from "../contracts";
import { InlineError, useRun } from "../settings";
import { DarkButton } from "../ui";

const KINDS: { kind: Item["kind"]; label: string }[] = [
  { kind: "task", label: "Task" }, { kind: "email", label: "Email" }, { kind: "meeting", label: "Meeting" },
  { kind: "note", label: "Note" }, { kind: "contact", label: "Contact" }, { kind: "code", label: "Code" },
];

export function PracticeRun({ state, actions }: Pick<ScreenBase, "state" | "actions">) {
  const { run, error, clearError, busy } = useRun();
  const projects = [...state.projects].sort((a, b) => a.name.localeCompare(b.name));
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Item["kind"]>("task");
  const [project, setProject] = useState(projects[0]?.id ?? "");
  const [created, setCreated] = useState<{ title: string; project: string } | null>(null);
  const chosen = project || projects[0]?.id || "";
  const submit = async () => {
    const text = title.trim();
    if (!text || !chosen) return;
    const now = new Date().toISOString();
    const ok = await run(() => actions.itemSave({
      id: uuid(), project: chosen, kind, title: text, subtitle: null, lane: "focus", status: "none", source: null,
      origin: "user", thread: null, order: state.items.filter(i => i.project === chosen && i.lane === "focus").length,
      created: now, updated: now, done_at: null,
    }));
    if (ok) {
      setCreated({ title: text, project: state.projects.find(p => p.id === chosen)?.name ?? "" });
      setTitle("");
    }
  };
  return <section className="st-panel ob-practice" aria-label="Practice run">
    <h3>Try it: create your first item</h3>
    <p className="st-muted">Something on your plate right now. It lands in Focus in the project you pick.</p>
    {projects.length === 0
      ? <p className="st-note">You need a project first. Go back to step 2 to add or import one.</p>
      : <form className="ob-practice__form" onSubmit={e => { e.preventDefault(); void submit(); }}>
        <label className="st-field"><span className="st-field__label">What is it?</span>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Reply to Jordan about the invoice" /></label>
        <div className="ob-practice__row">
          <label className="st-field"><span className="st-field__label">Kind</span>
            <select value={kind} onChange={e => setKind(e.target.value as Item["kind"])}>
              {KINDS.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </select></label>
          <label className="st-field"><span className="st-field__label">Project</span>
            <select value={chosen} onChange={e => setProject(e.target.value)}>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
        </div>
        <DarkButton type="submit" disabled={!title.trim() || busy}>Create item</DarkButton>
      </form>}
    <InlineError error={error} onDismiss={clearError} />
    {created && <p className="ob-success" role="status"><Check size={14} /> Created “{created.title}” in {created.project}.</p>}
  </section>;
}
