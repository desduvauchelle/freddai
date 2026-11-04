export type GitChange = {
  path: string;
  orig_path: string | null;
  group: "staged" | "unstaged" | "untracked" | "conflicted";
  status: string;
  code: string;
};
export type GitCommit = { hash: string; parents: string[]; refs: string[]; subject: string; author: string; date: string };
export type GitHistory = {
  branch: string;
  detached: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  changes: GitChange[];
  counts: { staged: number; unstaged: number; untracked: number; conflicted: number; files: number };
  commits: GitCommit[];
};
/** What the main pane shows when it is not a thread. */
export type PaneSelection = { kind: "git"; projectId: string } | null;

export const gitGroups: { group: GitChange["group"]; label: string }[] = [
  { group: "conflicted", label: "Conflicts" },
  { group: "staged", label: "Staged" },
  { group: "unstaged", label: "Unstaged" },
  { group: "untracked", label: "Untracked" },
];

export function groupChanges(changes: GitChange[]) {
  return gitGroups
    .map(({ group, label }) => ({ group, label, items: changes.filter(c => c.group === group) }))
    .filter(g => g.items.length);
}

export function aheadBehindLabel(h: Pick<GitHistory, "upstream" | "ahead" | "behind">) {
  if (!h.upstream) return "No upstream";
  if (!h.ahead && !h.behind) return `Up to date with ${h.upstream}`;
  return [h.ahead && `${h.ahead} ahead`, h.behind && `${h.behind} behind`].filter(Boolean).join(", ") + ` of ${h.upstream}`;
}

export function commitDate(iso: string, now = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const mins = Math.round((now - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}h ago`;
  if (mins < 60 * 24 * 14) return `${Math.floor(mins / 1440)}d ago`;
  return new Date(t).toLocaleDateString();
}

export const graphColors = ["#40a9ff", "#e16bca", "#6dce87", "#e8b456", "#a78bfa", "#4fd1c5"];

/** Route each topologically ordered commit to its parents, preserving occupied lanes. */
export function layoutGraph(commits: GitCommit[]) {
  let lanes: { hash: string; color: number }[] = [];
  let nextColor = 0;
  return commits.map(commit => {
    let lane = lanes.findIndex(l => l.hash === commit.hash);
    const incoming = lane >= 0;
    if (lane < 0) { lane = lanes.length; lanes.push({ hash: commit.hash, color: nextColor++ }); }
    const before = lanes.map(l => ({ ...l }));
    const color = before[lane].color;
    lanes.splice(lane, 1);
    commit.parents.forEach((hash, index) => {
      if (!lanes.some(l => l.hash === hash)) lanes.splice(Math.min(lane + index, lanes.length), 0, { hash, color: index ? nextColor++ : color });
    });
    const edges = before.flatMap((l, from) => {
      const targets = from === lane ? commit.parents : [l.hash];
      return targets.map(hash => ({ from, to: lanes.findIndex(l => l.hash === hash), color: from === lane ? lanes.find(l => l.hash === hash)!.color : l.color }));
    });
    return { commit, lane, incoming, color, edges, width: Math.max(before.length, lanes.length, 1) };
  });
}
