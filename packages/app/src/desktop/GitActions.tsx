import { useEffect, useState } from "react";
import { Button } from "@freddai/ui/components/button";
import { Loader2 } from "lucide-react";
import type { GitChange, GitHistory } from "./git-history";
import { diffLineKind, errorText, type BranchList, type GitClient, type PrStatus } from "./git-actions";

/** Runs a git action, reporting its CLI error text verbatim and refreshing on both outcomes. */
function useAction(onChanged: () => void | Promise<void>) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const run = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label); setError(""); setInfo("");
    try { const out = await fn(); if (out) setInfo(out); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(""); await onChanged(); }
  };
  return { busy, error, info, run, setError };
}
const ErrorBox = ({ error }: { error: string }) => error ? <div role="alert" className="git-error git-action-error"><strong>Git failed</strong><pre>{error}</pre></div> : null;

type Common = { client: GitClient; path: string; onChanged: () => void | Promise<void> };

export function GitActions({ client, path, data, onChanged }: Common & { data: GitHistory }) {
  const { busy, error, info, run } = useAction(onChanged);
  const [branches, setBranches] = useState<BranchList | null>(null);
  const [newBranch, setNewBranch] = useState("");
  const [pr, setPr] = useState<PrStatus | null>(null);
  const [prOpen, setPrOpen] = useState(false);
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  useEffect(() => {
    let live = true;
    client.branches(path).then(b => live && setBranches(b)).catch(() => live && setBranches(null));
    client.prStatus(path).then(p => live && setPr(p)).catch(e => live && setPr({ available: false, reason: errorText(e) }));
    return () => { live = false; };
  }, [client, path, data.branch]);
  const dirty = data.counts.files > 0;
  return <div className="git-actions" aria-label="Git actions">
    <div className="git-actions-row">
      <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void run("pull", async () => (await client.pull(path)) || "Already up to date.")}>{busy === "pull" ? "Pulling…" : "Pull (ff-only)"}</Button>
      <Button size="sm" variant="outline" disabled={!!busy || data.detached} onClick={() => void run("push", () => client.push(path))}>{busy === "push" ? "Pushing…" : data.upstream ? "Push" : "Push & set upstream"}</Button>
      <label>Branch <select aria-label="Switch branch" value={branches?.current ?? ""} disabled={!!busy || !branches} onChange={e => void run("switch", async () => { await client.switchBranch(path, e.target.value, false); })}>
        {branches && !branches.branches.includes(branches.current) && <option value={branches.current}>{branches.current || "(detached)"}</option>}
        {branches?.branches.map(b => <option key={b}>{b}</option>)}
      </select></label>
      <input aria-label="New branch name" placeholder="new-branch" value={newBranch} onChange={e => setNewBranch(e.target.value)} />
      <Button size="sm" variant="outline" disabled={!!busy || !newBranch.trim()} onClick={() => void run("create", async () => { await client.switchBranch(path, newBranch.trim(), true); setNewBranch(""); })}>Create branch</Button>
      <Button size="sm" variant="outline" disabled={!!busy || !pr?.available} title={pr && !pr.available ? pr.reason : "Open a pull request with the GitHub CLI"} onClick={() => setPrOpen(o => !o)}>Create PR</Button>
      {busy && <Loader2 size={13} className="git-spin" aria-label="Working" />}
    </div>
    {pr && !pr.available && <p className="git-empty" role="note">Create PR unavailable: {pr.reason}</p>}
    {dirty && data.behind > 0 && <p className="git-empty">Behind {data.upstream}; commit or stash before pulling if it fails.</p>}
    {prOpen && <div className="git-pr-form">
      <input aria-label="Pull request title" placeholder="Title" value={prTitle} onChange={e => setPrTitle(e.target.value)} />
      <textarea aria-label="Pull request description" rows={3} placeholder="Description" value={prBody} onChange={e => setPrBody(e.target.value)} />
      <Button size="sm" disabled={!!busy || !prTitle.trim()} onClick={() => void run("pr", async () => { const url = await client.createPr(path, prTitle, prBody); setPrOpen(false); setPrTitle(""); setPrBody(""); return `Pull request: ${url}`; })}>{busy === "pr" ? "Creating…" : "Create pull request"}</Button>
    </div>}
    {info && <p role="status" className="git-info">{info}</p>}
    <ErrorBox error={error} />
  </div>;
}

export function GitCommitBox({ client, path, data, onChanged }: Common & { data: GitHistory }) {
  const { busy, error, info, run } = useAction(onChanged);
  const [message, setMessage] = useState("");
  const { staged, unstaged, untracked, conflicted } = data.counts;
  return <div className="git-commit-box">
    <div className="git-actions-row">
      <Button size="sm" variant="outline" disabled={!!busy || !(unstaged + untracked + conflicted)} onClick={() => void run("stage", () => client.stage(path))}>Stage all</Button>
      <Button size="sm" variant="outline" disabled={!!busy || !staged} onClick={() => void run("unstage", () => client.unstage(path))}>Unstage all</Button>
    </div>
    <textarea aria-label="Commit message" rows={3} placeholder={staged ? `Commit message (${staged} staged)` : "Stage files to commit"} value={message} onChange={e => setMessage(e.target.value)} />
    <Button size="sm" disabled={!!busy || !staged || !message.trim()} onClick={() => void run("commit", async () => { const h = await client.commit(path, message); setMessage(""); return `Committed ${h}`; })}>{busy === "commit" ? "Committing…" : "Commit"}</Button>
    {info && <p role="status" className="git-info">{info}</p>}
    <ErrorBox error={error} />
  </div>;
}

export function GitFileActions({ client, path, change, diffOpen, onToggleDiff, onChanged }: Common & { change: GitChange; diffOpen: boolean; onToggleDiff: () => void }) {
  const { busy, error, run } = useAction(onChanged);
  const [confirm, setConfirm] = useState(false);
  const [diff, setDiff] = useState<{ text: string } | { error: string } | null>(null);
  useEffect(() => {
    if (!diffOpen) return;
    let live = true;
    setDiff(null);
    client.diffFile(path, change).then(text => live && setDiff({ text })).catch(e => live && setDiff({ error: errorText(e) }));
    return () => { live = false; };
  }, [diffOpen, client, path, change.path, change.group]);
  const staged = change.group === "staged";
  const label = (v: string) => `${v} ${change.path}`;
  return <>
    <span className="git-file-actions">
      <button type="button" className="git-mini" aria-label={label("Diff")} aria-pressed={diffOpen} onClick={onToggleDiff}>Diff</button>
      {change.group !== "conflicted" && <button type="button" className="git-mini" disabled={!!busy} aria-label={label(staged ? "Unstage" : "Stage")}
        onClick={() => void run("toggle", () => (staged ? client.unstage(path, [change.path]) : client.stage(path, [change.path])))}>{staged ? "Unstage" : "Stage"}</button>}
      {!confirm && <button type="button" className="git-mini git-mini-danger" disabled={!!busy} aria-label={label("Discard")} onClick={() => setConfirm(true)}>Discard</button>}
      {confirm && <span className="git-confirm" role="group" aria-label={`Confirm discard ${change.path}`}>
        <span>Discard {change.group === "untracked" ? "and delete" : "changes to"} {change.path}? This cannot be undone.</span>
        <button type="button" className="git-mini git-mini-danger" aria-label={label("Confirm discard")} onClick={() => { setConfirm(false); void run("discard", () => client.discard(path, change)); }}>Discard</button>
        <button type="button" className="git-mini" onClick={() => setConfirm(false)}>Keep</button>
      </span>}
    </span>
    {error && <div className="git-file-row-full"><ErrorBox error={error} /></div>}
    {diffOpen && <div className="git-file-row-full">
      {!diff && <p className="git-empty"><Loader2 size={12} className="git-spin" /> Loading diff…</p>}
      {diff && "error" in diff && <ErrorBox error={diff.error} />}
      {diff && "text" in diff && (diff.text.trim() ? <pre className="git-diff" aria-label={`Diff of ${change.path}`}>{diff.text.split("\n").map((line, i) => <span key={i} className={`git-diff-${diffLineKind(line)}`}>{line}{"\n"}</span>)}</pre> : <p className="git-empty">No textual differences (binary or mode-only change).</p>)}
    </div>}
  </>;
}
