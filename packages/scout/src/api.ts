// Typed wrappers over the Scout Tauri commands (apps/native/src-tauri/src/scout.rs).
// Types mirror crates/scout-core/src/model.rs; see docs/scout.md "Scout data model".
import { invoke } from "@tauri-apps/api/core";

export type ItemKind = "email" | "meeting" | "task" | "contact" | "note" | "code";
export type ItemLane = "focus" | "backlog" | "done";
export type ItemStatus = "needs_you" | "agent_working" | "ready" | "none";
export type ItemOrigin = "user" | "rule" | "agent" | "import" | "sample";
export type SourceKind =
  | "gmail"
  | "slack"
  | "calendar"
  | "meet"
  | "imessage"
  | "whatsapp"
  | "discord"
  | "custom";
export type SourceAccess = "direct" | "computer_use" | "browser";
export type SourceStatus = "connected" | "needs_sign_in" | "not_connected";

export type Workspace = {
  id: string;
  name: string;
  color: string;
  order: number;
  collapsed: boolean;
};

export type Project = {
  id: string;
  workspace: string;
  name: string;
  color: string;
  order: number;
  pinned: boolean;
  hidden: boolean;
  freddai_project: string | null;
};

export type Item = {
  id: string;
  project: string;
  kind: ItemKind;
  title: string;
  subtitle: string | null;
  lane: ItemLane;
  status: ItemStatus;
  source: string | null;
  origin: ItemOrigin;
  /** Freddai session id once a chat exists. */
  thread: string | null;
  order: number;
  created: string;
  updated: string;
  done_at: string | null;
};

export type Rule = {
  id: string;
  name: string;
  when_text: string;
  then_text: string;
  enabled: boolean;
  project: string | null;
  order: number;
};

export type Source = {
  id: string;
  /** Freddai account id (agent). */
  account: string;
  kind: SourceKind;
  label: string;
  detail: string;
  access: SourceAccess;
  enabled: boolean;
  status: SourceStatus;
};

export type Settings = {
  onboarding_done: boolean;
  onboarding_step: number;
  sample_data: boolean;
};

export type ScoutState = {
  revision: number;
  workspaces: Workspace[];
  projects: Project[];
  items: Item[];
  rules: Rule[];
  sources: Source[];
  settings: Settings;
};

export const ITEM_KINDS: ItemKind[] = ["email", "meeting", "task", "contact", "note", "code"];
export const LANES: ItemLane[] = ["focus", "backlog", "done"];

export function uuid(): string {
  return crypto.randomUUID();
}

export const scoutState = () => invoke<ScoutState>("scout_state");

export const scoutWorkspaceSave = (workspace: Workspace) =>
  invoke<ScoutState>("scout_workspace_save", { workspace });
export const scoutWorkspaceDelete = (id: string) =>
  invoke<ScoutState>("scout_workspace_delete", { id });
export const scoutWorkspaceReorder = (ids: string[]) =>
  invoke<ScoutState>("scout_workspace_reorder", { ids });

export const scoutProjectSave = (project: Project) =>
  invoke<ScoutState>("scout_project_save", { project });
export const scoutProjectDelete = (id: string) =>
  invoke<ScoutState>("scout_project_delete", { id });
export const scoutProjectMove = (id: string, workspace: string, index: number) =>
  invoke<ScoutState>("scout_project_move", { id, workspace, index });

export const scoutItemSave = (item: Item) => invoke<ScoutState>("scout_item_save", { item });
export const scoutItemDelete = (id: string) => invoke<ScoutState>("scout_item_delete", { id });
export const scoutItemMove = (id: string, lane: ItemLane, index: number) =>
  invoke<ScoutState>("scout_item_move", { id, lane, index });

export const scoutRuleSave = (rule: Rule) => invoke<ScoutState>("scout_rule_save", { rule });
export const scoutRuleDelete = (id: string) => invoke<ScoutState>("scout_rule_delete", { id });

export const scoutSourceSave = (source: Source) =>
  invoke<ScoutState>("scout_source_save", { source });
export const scoutSourceDelete = (id: string) =>
  invoke<ScoutState>("scout_source_delete", { id });

export const scoutSettingsSave = (settings: Settings) =>
  invoke<ScoutState>("scout_settings_save", { settings });

export const scoutImportFreddai = () => invoke<ScoutState>("scout_import_freddai");
export const scoutSampleData = (load: boolean) =>
  invoke<ScoutState>("scout_sample_data", { load });

/** Communication connections found on this computer (presence only). Mirrors scout-core `detect`. */
export type DetectedConnection = {
  id: string;
  kind: "email" | "calendar" | "chat" | "meetings";
  provider: string;
  label: string;
  /** Google account email when known, else "". */
  account: string;
  /** "freddai_google_account" | "installed_app" | "agent_mcp:<agent>" */
  found_via: string[];
};
export type DetectionWarning = { signal: string; message: string };
export type Detection = { connections: DetectedConnection[]; warnings: DetectionWarning[] };

export const scoutDetectConnections = () => invoke<Detection>("scout_detect_connections");

/** A connector one agent account already has (claude.ai connector, MCP server, …). */
export type AccountConnector = {
  /** Stable per account: `${via}:${raw_name}`. Stored on the Source as `detail: "detected:<key>"`. */
  key: string;
  /** Normalised provider id (gmail, google_calendar, slack, notion, …) or "other". */
  provider: string;
  /** Human label, e.g. "Gmail", "Google Calendar", or the raw server name for unknown ones. */
  label: string;
  kind: DetectedConnection["kind"] | "files" | "other";
  /** connected = usable now; needs_auth = configured but not signed in; failed = errored; unknown = no status available. */
  status: "connected" | "needs_auth" | "failed" | "unknown";
  /** "claude_ai_connector" | "claude_mcp" | "codex_mcp" | "gemini_mcp" | … */
  via: string;
  /** Server name exactly as the agent CLI reports it. */
  raw_name: string;
};
export type AccountConnectors = {
  /** Freddai account id (same as Source.account). */
  account: string;
  connectors: AccountConnector[];
  /** Set when detection for this account failed or was partial; shown in the UI, never swallowed. */
  warning: string | null;
};
export type AccountDetection = { accounts: AccountConnectors[] };

export const scoutDetectAccountConnectors = () => invoke<AccountDetection>("scout_detect_account_connectors");
