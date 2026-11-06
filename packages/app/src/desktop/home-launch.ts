import type { AgentSelection } from "./agent-selection";
import { effectivePermissionMode } from "./PermissionSelect";
import { agentDisplayName, resolveAccount, type Database, type PermissionMode } from "./types";

/** What a Home tile will launch. One resolution shared by the tile's agent chip and `createHomeThread`, so they cannot disagree. */
export type HomeLaunchPlan =
  | { ok: true; project: string; account: string; provider: string; accountName: string; permission_mode: PermissionMode; worktree: boolean; model: string | null; effort: string | null; label: string }
  | { ok: false; reason: string };

export function resolveHomeLaunch(db: Database, projectId: string, permissionMode: PermissionMode, selections: Record<string, AgentSelection> = {}): HomeLaunchPlan {
  const project = db.projects.find(p => p.id === projectId);
  if (!project) return { ok: false, reason: "Project not found." };
  if (!db.accounts.length) return { ok: false, reason: "Connect an agent account to start." };
  // The project's own default first; when it has none (or it no longer exists) the global default applies.
  const account = db.accounts.find(a => a.id === resolveAccount(db, project)) ?? db.accounts.find(a => a.id === resolveAccount(db));
  if (!account) return { ok: false, reason: "No default account configured for this project." };
  // Home selections are scoped to the resolved account, including project overrides.
  const selection = selections[account.id];
  const model = selection?.model.trim() || null;
  const effort = selection?.effort && selection.effort !== "default" && ["codex", "claude"].includes(account.provider) ? selection.effort : null;
  return {
    ok: true, project: project.id, account: account.id, provider: account.provider, accountName: account.name,
    permission_mode: effectivePermissionMode(account.provider, permissionMode), worktree: db.preferences.use_worktree ?? false, model, effort,
    label: [agentDisplayName(account), model ?? "default model", effort ?? "default effort"].join(" · "),
  };
}
