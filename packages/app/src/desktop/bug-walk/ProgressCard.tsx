import { useEffect } from "react";
import { Check, CircleAlert, Loader2, Circle, X } from "lucide-react";
import { Button } from "@freddai/ui/components/button";
import { isAuthError } from "../reconnect";
import { ReconnectButton } from "../ReconnectButton";
import { checkAccountAuth, useAccountAuth } from "../accountAuth";
import { agentDisplayName } from "../types";
import { PHASE_LABELS, PIPELINE_PHASES, bugWalk, type BugWalk, type BugWalkStore } from "./bugWalk";
import "./bug-walk.css";

export const DONE_DISMISS_MS = 10_000;

/** Progress for a sent walk: transcribing → analyzing → grabbing frames → starting thread, then Open thread, or a loud error with a fallback. */
export function ProgressCard({ walk, store = bugWalk, onOpenThread, dismissAfterMs = DONE_DISMISS_MS, accounts = [] }: { accounts?: { id: string; name: string; provider: string }[]; walk: BugWalk; store?: BugWalkStore; onOpenThread?: (sessionId: string) => void; dismissAfterMs?: number }) {
  const done = walk.phase === "done";
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => store.dismiss(), dismissAfterMs);
    return () => clearTimeout(t);
  }, [done, store, dismissAfterMs]);
  const usedId = walk.sendOpts?.account ?? "";
  const authFailure = walk.phase === "error" && isAuthError(walk.error) && accounts.some(a => a.id === usedId);
  const auth = useAccountAuth(usedId);
  useEffect(() => { if (authFailure) void checkAccountAuth(usedId); }, [authFailure, usedId]);
  if (walk.phase === "error") {
    const used = walk.sendOpts && accounts.find(a => a.id === walk.sendOpts!.account);
    // The shared auth state wins over the old error text: once the account validates, no Reconnect is offered.
    const expired = isAuthError(walk.error) && auth.status !== "valid";
    return <section className="bug-walk-card" data-state="error" role="alert" aria-label="Bug walk failed">
      <header><CircleAlert size={15} aria-hidden="true" /><strong>Bug walk failed</strong></header>
      {expired && used && <p className="bug-walk-error" role="status">{agentDisplayName(used)} sign-in expired.</p>}
      <p className="bug-walk-error">{walk.error}</p>
      {walk.transcript && <details className="bug-walk-transcript"><summary>Raw transcript</summary><pre>{walk.transcript}</pre></details>}
      <div className="bug-walk-actions">
        <Button type="button" variant="ghost" size="sm" onClick={() => void store.cancel()}>Discard</Button>
        {expired && used && <ReconnectButton account={used.id} provider={used.provider} />}
        {walk.sendOpts && <Button type="button" size="sm" onClick={() => void store.sendTranscript()}>Send transcript as is</Button>}
      </div>
    </section>;
  }
  if (done) {
    const ids = walk.sessionIds ?? (walk.sessionId ? [walk.sessionId] : []);
    const multi = ids.length > 1;
    const first = ids[0] ?? walk.sessionId;
    return <section className="bug-walk-card" data-state="done" role="status" aria-label="Bug walk sent">
      <header><Check size={15} aria-hidden="true" /><strong>Bug walk sent</strong>
        <button type="button" className="bug-walk-close" aria-label="Dismiss" onClick={() => store.dismiss()}><X size={13} aria-hidden="true" /></button></header>
      <div className="bug-walk-actions">
        {multi && <span className="bug-walk-count">{ids.length} threads started</span>}
        {first && <Button type="button" size="sm" onClick={() => { onOpenThread?.(first); store.dismiss(); }}>{multi ? "Open first thread" : "Open thread"}</Button>}
      </div>
    </section>;
  }
  const active = PIPELINE_PHASES.indexOf(walk.phase);
  return <section className="bug-walk-card" data-state="working" role="status" aria-label="Bug walk progress">
    <header><Loader2 size={15} className="bug-walk-spin" aria-hidden="true" /><strong>Processing bug walk</strong></header>
    <ol className="bug-walk-steps">
      {PIPELINE_PHASES.map((phase, i) => <li key={phase} data-step={i < active ? "done" : i === active ? "active" : "todo"} aria-current={i === active ? "step" : undefined}>
        {i < active ? <Check size={12} aria-hidden="true" /> : i === active ? <Loader2 size={12} className="bug-walk-spin" aria-hidden="true" /> : <Circle size={12} aria-hidden="true" />}
        {phase === "launching" && i === active && (walk.total ?? 0) > 1 ? `Starting thread ${Math.min((walk.launched ?? 0) + 1, walk.total!)}/${walk.total}` : PHASE_LABELS[phase]}
      </li>)}
    </ol>
  </section>;
}
