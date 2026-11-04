// Pure selection/grouping logic for the "Import sessions" dialog (UI lives in ImportSessions.tsx).
export type ImportCandidate = {
  provider: "claude" | "codex" | string;
  session_id: string;
  cwd: string | null;
  title: string;
  updated: number;
  message_count: number | null;
  git_branch: string | null;
  bytes: number;
  /** Freddai account whose CLI folder holds the session; null when no account uses that folder. */
  account: string | null;
  /** Existing Freddai project for this folder. */
  project: string | null;
  cwd_exists: boolean;
};
export type ImportOutcome = { session_id: string; thread: string | null; skipped: boolean; truncated: boolean; error: string | null };
export type ImportRequest = { provider: string; session_id: string; account: string; create_project: boolean };
export type ImportGroup = { cwd: string; name: string; project: string | null; items: ImportCandidate[] };

export const candidateKey = (c: Pick<ImportCandidate, "provider" | "session_id">) => `${c.provider}:${c.session_id}`;

/** Why a session cannot be imported right now, or null when it can. Shown to the user, never hidden. */
export function blockedReason(c: ImportCandidate): string | null {
  if (!c.cwd) return "This session does not record its folder.";
  if (!c.cwd_exists) return "The session's folder no longer exists.";
  if (!c.account) return `No Freddai account uses this ${c.provider === "claude" ? "Claude Code" : "Codex"} folder. Connect the existing sign-in in Accounts first.`;
  return null;
}
export const importable = (c: ImportCandidate) => blockedReason(c) === null;

export function filterCandidates(list: ImportCandidate[], opts: { query: string; onlyExistingProjects: boolean }): ImportCandidate[] {
  const q = opts.query.trim().toLowerCase();
  return list.filter(c => {
    if (opts.onlyExistingProjects && !c.project) return false;
    if (!q) return true;
    return [c.title, c.cwd ?? "", c.git_branch ?? "", c.provider].some(s => s.toLowerCase().includes(q));
  });
}

const folderName = (cwd: string) => cwd.replace(/\/+$/, "").split("/").pop() || cwd;

/** Groups by project folder; sessions and groups are newest first. */
export function groupByFolder(list: ImportCandidate[]): ImportGroup[] {
  const groups = new Map<string, ImportGroup>();
  for (const c of [...list].sort((a, b) => b.updated - a.updated || a.session_id.localeCompare(b.session_id))) {
    const cwd = c.cwd ?? "(unknown folder)";
    const group = groups.get(cwd) ?? { cwd, name: folderName(cwd), project: c.project, items: [] };
    group.items.push(c);
    groups.set(cwd, group);
  }
  return [...groups.values()];
}

export function toggleOne(selected: ReadonlySet<string>, c: ImportCandidate): Set<string> {
  const next = new Set(selected);
  const key = candidateKey(c);
  if (!importable(c)) return next;
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
}
/** Selects every importable item of the group, or clears them all when they are already all selected. */
export function toggleGroup(selected: ReadonlySet<string>, items: ImportCandidate[]): Set<string> {
  const next = new Set(selected);
  const usable = items.filter(importable);
  const all = usable.length > 0 && usable.every(c => next.has(candidateKey(c)));
  for (const c of usable) { if (all) next.delete(candidateKey(c)); else next.add(candidateKey(c)); }
  return next;
}
/** Drops selections that are no longer visible/importable (after filtering or a refresh). */
export function pruneSelection(selected: ReadonlySet<string>, visible: ImportCandidate[]): Set<string> {
  const keys = new Set(visible.filter(importable).map(candidateKey));
  return new Set([...selected].filter(k => keys.has(k)));
}
export const selectedCandidates = (list: ImportCandidate[], selected: ReadonlySet<string>) =>
  list.filter(c => selected.has(candidateKey(c)) && importable(c));

/** Folders in the selection that have no Freddai project yet; importing needs the user's confirmation to create them. */
export function foldersNeedingProject(list: ImportCandidate[], selected: ReadonlySet<string>): string[] {
  return [...new Set(selectedCandidates(list, selected).filter(c => !c.project).map(c => c.cwd as string))];
}
export function buildRequests(list: ImportCandidate[], selected: ReadonlySet<string>, createProjects: boolean): ImportRequest[] {
  return selectedCandidates(list, selected).map(c => ({
    provider: c.provider, session_id: c.session_id, account: c.account as string, create_project: createProjects,
  }));
}
export function summarizeOutcomes(outcomes: ImportOutcome[]): { imported: number; skipped: number; truncated: number; errors: string[] } {
  return {
    imported: outcomes.filter(o => !o.error && !o.skipped).length,
    skipped: outcomes.filter(o => o.skipped).length,
    truncated: outcomes.filter(o => o.truncated).length,
    errors: outcomes.filter(o => o.error).map(o => `${o.session_id}: ${o.error}`),
  };
}
