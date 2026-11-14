import { useState } from "react";
import { Link2 } from "lucide-react";
import type { Database } from "@freddai/shared/agent/types";
import { DarkButton } from "../ui";
import { FreddaiStatusNote } from "../freddaiLink";
import "./chat.css";

/** Replaces the composer when there is no Freddai project to launch in. Never falls back silently. */
export function FreddaiLinkNotice({ db, message, onLink }: { db: Database | null; message: string; onLink?: (freddaiProject: string) => Promise<void> }) {
  const [choice, setChoice] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projects = db?.projects ?? [];
  async function link() {
    if (!choice || !onLink) return;
    setSaving(true); setError(null);
    try { await onLink(choice); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  }
  return <section className="sc-link-notice" aria-label="Link a Freddai project">
    <p className="sc-link-notice__title"><Link2 size={14} aria-hidden /> {message}</p>
    <FreddaiStatusNote db={db} />
    {db && onLink && (projects.length
      ? <div className="sc-link-notice__row">
          <select aria-label="Freddai project" value={choice} onChange={e => setChoice(e.target.value)} disabled={saving}>
            <option value="">Choose a Freddai project…</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <DarkButton disabled={!choice || saving} onClick={() => void link()}>{saving ? "Linking…" : "Link a Freddai project"}</DarkButton>
        </div>
      : <p className="sc-muted">Freddai has no projects yet. Add one in Freddai first.</p>)}
    {error && <p className="sc-chat-error" role="alert">{error}</p>}
  </section>;
}
