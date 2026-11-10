import { useState } from "react";
import { ArrowUpRight, Check, CircleAlert, Pencil, X } from "lucide-react";
import { commanderApi, type Proposal } from "./api";
import { formatProposalResult } from "./formatResult";

const promptOf = (p: Proposal) => typeof p.arguments?.prompt === "string" ? p.arguments.prompt : "";

/** One Commander proposal. Pending: Yes / No (+ Edit for the task prompt). Decided: result or a loud, red error, plus a link to the started thread. */
export function ApprovalCard({ proposal, projectName, projectColor, onDecided, onOpenThread }: {
  proposal: Proposal; projectName?: string; projectColor?: string;
  onDecided?: (p: Proposal) => void; onOpenThread?: (id: string) => void;
}) {
  const [current, setCurrent] = useState(proposal);
  const [editing, setEditing] = useState(false), [prompt, setPrompt] = useState(promptOf(proposal));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const shown = proposal.status !== "pending" ? proposal : current;
  const hasPrompt = typeof proposal.arguments?.prompt === "string";

  async function respond(approve: boolean) {
    setBusy(true); setError("");
    try {
      const edited = approve && editing && prompt !== promptOf(proposal) ? prompt : undefined;
      const result = await commanderApi.proposalRespond(proposal.id, approve, edited);
      setCurrent(result); setEditing(false); onDecided?.(result);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const pending = shown.status === "pending";
  const failure = shown.error || (shown.status === "failed" ? "The action failed." : "");
  return <article className="commander-card" data-status={shown.status} aria-label={`Proposal: ${shown.summary}`}>
    <p className="commander-card-summary">{shown.summary}</p>
    <div className="commander-card-meta">
      {(projectName || shown.project) && <span className="commander-chip"><i style={{ background: projectColor ?? "var(--muted-foreground)" }} aria-hidden="true" />{projectName ?? shown.project}</span>}
      <span className="commander-chip" data-muted>{shown.tool.replace(/^freddai_/, "").replace(/_/g, " ")}</span>
    </div>
    {hasPrompt && (editing
      ? <textarea className="commander-card-prompt" aria-label="Task prompt" rows={4} value={prompt} disabled={busy} onChange={e => setPrompt(e.target.value)} />
      : <blockquote className="commander-card-quote">{prompt}</blockquote>)}
    {pending && <div className="commander-card-actions">
      <button type="button" className="commander-btn" data-variant="yes" disabled={busy} onClick={() => void respond(true)}><Check size={14} aria-hidden="true" />Yes</button>
      <button type="button" className="commander-btn" data-variant="no" disabled={busy} onClick={() => void respond(false)}><X size={14} aria-hidden="true" />No</button>
      {hasPrompt && <button type="button" className="commander-btn" data-variant="ghost" disabled={busy} aria-pressed={editing} onClick={() => setEditing(v => !v)}><Pencil size={13} aria-hidden="true" />{editing ? "Done editing" : "Edit"}</button>}
    </div>}
    {error && <p className="commander-error" role="alert"><CircleAlert size={13} aria-hidden="true" />{error}</p>}
    {!pending && <div className="commander-card-result" data-status={shown.status}>
      {shown.status === "approved" && <p role="status"><Check size={13} aria-hidden="true" />{formatProposalResult(shown.result)}</p>}
      {shown.status === "declined" && <p role="status"><X size={13} aria-hidden="true" />Declined.</p>}
      {shown.status === "failed" && <p className="commander-error" role="alert"><CircleAlert size={13} aria-hidden="true" />{failure}</p>}
      {shown.thread && onOpenThread && <button type="button" className="commander-link" onClick={() => onOpenThread(shown.thread!)}>Open thread<ArrowUpRight size={12} aria-hidden="true" /></button>}
    </div>}
  </article>;
}
