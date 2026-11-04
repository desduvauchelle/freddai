import { invoke } from "@tauri-apps/api/core";
import type { GitChange } from "./git-history";

export type GitStatusSummary = {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  files: number;
};
export type BranchList = { current: string; branches: string[] };
export type PrStatus = { available: boolean; reason: string };

/** Every call rejects with the git/gh CLI's stderr, verbatim. */
export type GitClient = {
  status(path: string): Promise<GitStatusSummary>;
  diffFile(path: string, change: Pick<GitChange, "path" | "group">): Promise<string>;
  stage(path: string, files?: string[]): Promise<void>;
  unstage(path: string, files?: string[]): Promise<void>;
  discard(path: string, change: Pick<GitChange, "path" | "group" | "code">): Promise<void>;
  commit(path: string, message: string, all?: boolean): Promise<string>;
  push(path: string): Promise<string>;
  pull(path: string): Promise<string>;
  branches(path: string): Promise<BranchList>;
  switchBranch(path: string, name: string, create: boolean): Promise<void>;
  prStatus(path: string): Promise<PrStatus>;
  createPr(path: string, title: string, body: string): Promise<string>;
};

export const tauriGitClient: GitClient = {
  status: path => invoke("git_status", { path }),
  diffFile: (path, c) => invoke("git_diff_file", { path, file: c.path, group: c.group }),
  stage: (path, files) => invoke("git_stage", { path, files: files ?? null }),
  unstage: (path, files) => invoke("git_unstage", { path, files: files ?? null }),
  discard: (path, c) => invoke("git_discard", { path, file: c.path, group: c.group, code: c.code }),
  commit: (path, message, all) => invoke("git_commit", { path, message, all: all ?? false }),
  push: path => invoke("git_push", { path }),
  pull: path => invoke("git_pull", { path }),
  branches: path => invoke("git_branches", { path }),
  switchBranch: (path, name, create) => invoke("git_switch_branch", { path, name, create }),
  prStatus: path => invoke("git_pr_status", { path }),
  createPr: (path, title, body) => invoke("git_create_pr", { path, title, body }),
};

/** The Save & push button shows only when there is something to commit or push. */
export function shipVisible(s: GitStatusSummary | null) {
  return !!s && (s.files > 0 || s.ahead > 0);
}

export function shipTooltip(s: GitStatusSummary) {
  const parts = [];
  if (s.files > 0) parts.push(`${s.files} ${s.files === 1 ? "file" : "files"} changed`);
  if (s.ahead > 0) parts.push(`${s.ahead} ${s.ahead === 1 ? "commit" : "commits"} to push`);
  return ["Commit & push with an agent", ...parts].join(" · ");
}

/** Classify a diff line for light syntax coloring. */
export function diffLineKind(line: string): "add" | "del" | "hunk" | "meta" | "ctx" {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("new file") || line.startsWith("deleted file")) return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "ctx";
}

export function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
