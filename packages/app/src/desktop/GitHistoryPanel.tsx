import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@freddai/ui/components/button";
import { GitBranch, RefreshCw, X } from "lucide-react";
import type { Project } from "./types";
import { aheadBehindLabel, commitDate, groupChanges, layoutGraph, graphColors, type GitHistory } from "./git-history";

export function GitHistoryPanel({ project, native, onClose }: { project: Project | undefined; native: boolean; onClose: () => void }) {
  const [data, setData] = useState<GitHistory | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [branch, setBranch] = useState("");
  const [search, setSearch] = useState("");
  const path = project?.path;
  const refs = [...new Set(data?.commits.flatMap(c => c.refs).filter(r => r !== "HEAD" && !r.startsWith("tag: ")) ?? [])];
  const reachable = new Set<string>();
  if (branch && data) {
    const byHash = new Map(data.commits.map(c => [c.hash, c]));
    const visit = (hash: string) => {
      if (reachable.has(hash)) return;
      reachable.add(hash);
      byHash.get(hash)?.parents.forEach(visit);
    };
    data.commits.filter(c => c.refs.includes(branch)).forEach(c => visit(c.hash));
  }
  const rows = layoutGraph(data?.commits.filter(c => !branch || reachable.has(c.hash)) ?? []);
  const graphWidth = Math.max(64, ...rows.map(r => r.width * 16 + 20));
  const load = useCallback(async () => {
    if (!native || !path) { setError(!native ? "Git history is only available in the desktop app." : "This project has no folder path."); return; }
    setLoading(true);
    try {
      setData(await invoke<GitHistory>("git_history", { path }));
      setError("");
    } catch (e) {
      setData(null);
      setError(String(e));
    } finally { setLoading(false); }
  }, [native, path]);
  useEffect(() => { setData(null); setBranch(""); setSearch(""); void load(); }, [load]);
  return (
    <section className="thread-detail git-history" aria-label="Git history" aria-busy={loading}>
      <div className="pane-title">
        <span className="pane-project">
          <span className="pane-project-dot" aria-hidden="true" style={{ background: project?.color }} />
          <strong>{project?.name ?? "Project"}</strong>
        </span>
        {data && <span className="git-branch"><GitBranch size={13} aria-hidden="true" /> {data.branch}</span>}
        {data && <span className="git-sync">{aheadBehindLabel(data)}</span>}
        <Button variant="ghost" size="icon" className="ml-auto" aria-label="Refresh git history" title="Refresh" disabled={loading} onClick={() => void load()}>
          <RefreshCw size={14} className={loading ? "git-spin" : undefined} />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Close git history" title="Close" onClick={onClose}><X size={14} /></Button>
      </div>
      <div className="git-body">
        {error && <div role="alert" className="git-error"><strong>Git failed</strong><pre>{error}</pre></div>}
        {data && <>
          <div className="git-toolbar">
            <label>Branches <select aria-label="Filter branches" value={branch} onChange={e => setBranch(e.target.value)}><option value="">Show all</option>{refs.map(ref => <option key={ref}>{ref}</option>)}</select></label>
            <input aria-label="Search commits" placeholder="Search commits…" value={search} onChange={e => setSearch(e.target.value)} />
            <span>{rows.length} commits</span>
          </div>
          <details className="git-working-tree">
          <summary>Uncommitted changes ({data.counts.files})</summary>
          {!data.changes.length && <p className="git-empty">Working tree clean.</p>}
          {groupChanges(data.changes).map(g => (
            <div key={g.group} className="git-group">
              <div className="git-group-label">{g.label} ({g.items.length})</div>
              <ul>{g.items.map(c => (
                <li key={g.group + c.path} className="git-file">
                  <span className={`git-badge git-badge-${c.group}`} title={c.status}>{c.code}</span>
                  <span className="git-path" title={c.path}>{c.orig_path ? `${c.orig_path} → ${c.path}` : c.path}</span>
                </li>
              ))}</ul>
            </div>
          ))}
          </details>
          <div className="git-table" role="table" aria-label="Commit graph" style={{ minWidth: graphWidth + 660 }}>
            <div className="git-table-row git-table-head" role="row" style={{ gridTemplateColumns: `${graphWidth}px minmax(240px, 1fr) 110px 130px 76px` }}>
              {["Graph", "Description", "Date", "Author", "Commit"].map(label => <span role="columnheader" key={label}>{label}</span>)}
            </div>
            {rows.map(({ commit: c, lane, incoming, color, edges }) => {
              const matches = !search || `${c.subject} ${c.author} ${c.hash} ${c.refs.join(" ")}`.toLowerCase().includes(search.toLowerCase());
              return <div key={c.hash} role="row" className={`git-table-row${matches ? "" : " git-search-dim"}`} style={{ gridTemplateColumns: `${graphWidth}px minmax(240px, 1fr) 110px 130px 76px` }}>
                <span role="cell" className="git-graph-cell"><svg width={graphWidth} height="28" aria-hidden="true">
                  {edges.map((edge, i) => <path key={i} d={`M ${12 + edge.from * 16} ${edge.from === lane ? 14 : 0} C ${12 + edge.from * 16} 24, ${12 + edge.to * 16} 18, ${12 + edge.to * 16} 28`} fill="none" stroke={graphColors[edge.color % graphColors.length]} strokeWidth="1.5" />)}
                  {incoming && <path d={`M ${12 + lane * 16} 0 V 14`} stroke={graphColors[color % graphColors.length]} strokeWidth="1.5" />}
                  <circle cx={12 + lane * 16} cy="14" r={c.parents.length > 1 ? 4 : 3} fill={graphColors[color % graphColors.length]} />
                </svg></span>
                <span role="cell" className="git-description" title={c.subject}>
                  {c.refs.map(ref => <span className="git-ref" key={ref} style={{ borderColor: graphColors[color % graphColors.length] }}><GitBranch size={10} />{ref}</span>)}
                  <span className="git-subject">{c.subject}</span>
                </span>
                <span role="cell" className="git-table-meta" title={c.date}>{commitDate(c.date)}</span>
                <span role="cell" className="git-table-meta" title={c.author}>{c.author}</span>
                <code role="cell" title={c.hash}>{c.hash.slice(0, 8)}</code>
              </div>;
            })}
          </div>
          {!data.commits.length && <p className="git-empty">No commits yet.</p>}
        </>}
      </div>
    </section>
  );
}
