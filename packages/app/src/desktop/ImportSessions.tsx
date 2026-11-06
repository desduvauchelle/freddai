import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@freddai/ui/components/button";
import { Input } from "@freddai/ui/components/input";
import { agentDisplayName, type Database } from "./types";
import {
  blockedReason, buildRequests, candidateKey, filterCandidates, foldersNeedingProject, groupByFolder, importable,
  pruneSelection, selectedCandidates, summarizeOutcomes, toggleGroup, toggleOne,
  type ImportCandidate, type ImportOutcome,
} from "./import-sessions";

const when = (ms: number) => new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Lists Claude Code / Codex sessions started outside Freddai and imports the chosen ones as threads. */
export function ImportSessions({ db, native, onImported }: { db: Database; native: boolean; onImported: () => Promise<void> | void }) {
  const [candidates, setCandidates] = useState<ImportCandidate[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [onlyExisting, setOnlyExisting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; errors: string[] } | null>(null);

  const load = useCallback(async () => {
    setCandidates(null); setLoadError("");
    try { setCandidates(await invoke<ImportCandidate[]>("import_candidates")); }
    catch (e) { setLoadError(String(e)); setCandidates([]); }
  }, []);
  useEffect(() => { if (native) void load(); }, [native, load]);

  const visible = useMemo(() => filterCandidates(candidates ?? [], { query, onlyExistingProjects: onlyExisting }), [candidates, query, onlyExisting]);
  const groups = useMemo(() => groupByFolder(visible), [visible]);
  useEffect(() => { setSelected(s => pruneSelection(s, visible)); setConfirming(false); }, [visible]);
  const chosen = selectedCandidates(candidates ?? [], selected);
  const newFolders = foldersNeedingProject(candidates ?? [], selected);
  const accountName = (id: string | null) => db.accounts.find(a => a.id === id)?.name;

  async function run(createProjects: boolean) {
    setBusy(true); setConfirming(false); setResult(null);
    try {
      const outcomes = await invoke<ImportOutcome[]>("import_sessions", { sessions: buildRequests(candidates ?? [], selected, createProjects) });
      const summary = summarizeOutcomes(outcomes);
      setResult({
        text: [`${summary.imported} imported`, summary.skipped && `${summary.skipped} already in Freddai`,
          summary.truncated && `${summary.truncated} long session(s) keep only the most recent messages`].filter(Boolean).join(" · "),
        errors: summary.errors,
      });
      await onImported();
      await load();
      setSelected(new Set());
    } catch (e) { setResult({ text: "Import failed", errors: [String(e)] }); }
    finally { setBusy(false); }
  }

  if (!native) return <p className="capture-help">Importing sessions is available in the Mac app.</p>;
  return <div className="grid gap-3" aria-busy={candidates === null || busy}>
    <p className="capture-help">
      Sessions from Claude Code and Codex that were started in a terminal or another app. Import adds a thread bound to the
      same provider session, so your next message resumes it exactly. Original session files are never changed.
    </p>
    <div className="flex flex-wrap items-center gap-3">
      <Input aria-label="Search sessions" placeholder="Search title, folder or branch…" value={query} onChange={e => setQuery(e.target.value)} className="min-w-48 flex-1" />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyExisting} onChange={e => setOnlyExisting(e.target.checked)} />Only for existing projects</label>
      <Button type="button" variant="outline" size="sm" disabled={busy || candidates === null} onClick={() => void load()}>Rescan</Button>
    </div>
    {loadError && <p role="alert" className="inline-error">Could not scan sessions: {loadError}</p>}
    {candidates === null && <p className="capture-help" role="status">Scanning session folders…</p>}
    {candidates !== null && !loadError && !visible.length && <p className="capture-help">{candidates.length ? "No sessions match." : "No external sessions found to import."}</p>}
    <div className="grid gap-4" role="group" aria-label="Sessions by folder">
      {groups.map(group => {
        const usable = group.items.filter(importable);
        const all = usable.length > 0 && usable.every(c => selected.has(candidateKey(c)));
        return <section key={group.cwd} className="grid gap-1">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={all} disabled={!usable.length || busy} aria-label={`Select all sessions in ${group.name}`} onChange={() => setSelected(s => toggleGroup(s, group.items))} />
            <span>{group.name}</span>
            <span className="font-normal text-muted-foreground" title={group.cwd}>{group.cwd}</span>
            <span className="ml-auto text-xs font-normal text-muted-foreground">{group.project ? "Existing project" : "New project"}</span>
          </label>
          {group.items.map(c => {
            const blocked = blockedReason(c);
            return <label key={candidateKey(c)} className={`ml-6 flex items-start gap-2 text-sm ${blocked ? "opacity-60" : ""}`}>
              <input type="checkbox" className="mt-1" checked={selected.has(candidateKey(c))} disabled={!!blocked || busy} onChange={() => setSelected(s => toggleOne(s, c))} />
              <span className="grid min-w-0 flex-1">
                <span className="truncate">{c.title}</span>
                <span className="text-xs text-muted-foreground">
                  {agentDisplayName({ provider: c.provider, name: accountName(c.account) || "" })} · {when(c.updated)}
                  {c.message_count != null ? ` · ${c.message_count} messages` : ""}{c.git_branch ? ` · ${c.git_branch}` : ""}
                </span>
                {blocked && <span className="text-xs text-destructive">{blocked}</span>}
              </span>
            </label>;
          })}
        </section>;
      })}
    </div>
    {confirming && <div role="alertdialog" aria-label="Create projects" className="grid gap-2 rounded-md border p-3 text-sm">
      <p>{newFolders.length === 1 ? "This folder has no Freddai project yet:" : `${newFolders.length} folders have no Freddai project yet:`}</p>
      <ul className="ml-4 list-disc break-all">{newFolders.map(f => <li key={f}>{f}</li>)}</ul>
      <div className="flex gap-2">
        <Button type="button" disabled={busy} onClick={() => void run(true)}>Create project{newFolders.length === 1 ? "" : "s"} and import</Button>
        <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
      </div>
    </div>}
    {result && <div role="status" className="grid gap-1 text-sm">
      <p>{result.text}</p>
      {result.errors.map(e => <p key={e} role="alert" className="inline-error">{e}</p>)}
    </div>}
    <div className="flex items-center gap-3">
      <Button type="button" disabled={busy || !chosen.length || confirming} onClick={() => newFolders.length ? setConfirming(true) : void run(false)}>
        {busy ? "Importing…" : `Import ${chosen.length || ""} session${chosen.length === 1 ? "" : "s"}`.replace("  ", " ")}
      </Button>
      <span className="text-xs text-muted-foreground">{chosen.length} selected</span>
    </div>
  </div>;
}
