// Component and store contracts shared by every Scout screen.
// Owned by the orchestrator; screen agents import from here and must not redefine these.
// Data types come from ./api.ts (mirrors crates/scout-core, see docs/scout.md).
import type { Database } from "@freddai/shared/agent/types";
import type {
  Item,
  ItemLane,
  Project,
  Rule,
  ScoutState,
  Settings,
  Source,
  Workspace,
} from "./api";

/** Mutation helpers exposed by useScout(). Each resolves after the store has
 *  applied the ScoutState returned by the Rust command. Errors are stored in
 *  the store's `error` field (shown by the shell) AND rethrown, so callers may
 *  also react locally. Never swallow them. */
export type ScoutActions = {
  workspaceSave: (workspace: Workspace) => Promise<void>;
  workspaceDelete: (id: string) => Promise<void>;
  workspaceReorder: (ids: string[]) => Promise<void>;
  projectSave: (project: Project) => Promise<void>;
  projectDelete: (id: string) => Promise<void>;
  projectMove: (id: string, workspace: string, index: number) => Promise<void>;
  itemSave: (item: Item) => Promise<void>;
  itemDelete: (id: string) => Promise<void>;
  itemMove: (id: string, lane: ItemLane, index: number) => Promise<void>;
  ruleSave: (rule: Rule) => Promise<void>;
  ruleDelete: (id: string) => Promise<void>;
  sourceSave: (source: Source) => Promise<void>;
  sourceDelete: (id: string) => Promise<void>;
  settingsSave: (settings: Settings) => Promise<void>;
  importFreddai: () => Promise<void>;
  sampleData: (load: boolean) => Promise<void>;
  refresh: () => Promise<void>;
};

/** What the shell gives every screen. `db` is the Freddai snapshot (accounts,
 *  projects, sessions) or null while loading / when Freddai IPC failed. */
export type ScreenBase = {
  state: ScoutState;
  db: Database | null;
  actions: ScoutActions;
};

export type SettingsTab = "agents" | "workspaces" | "rules" | "account";

/** Where the user is. The shell owns this; screens receive callbacks. */
export type ScoutView =
  | { kind: "home" }
  | { kind: "project"; projectId: string }
  | { kind: "item"; itemId: string }
  | { kind: "settings"; tab: SettingsTab }
  | { kind: "onboarding"; step: number };

/** Context handed to the side chat so it always knows the page (Figma dev note). */
export type ChatContext = {
  view: ScoutView;
  projectId?: string;
  itemId?: string;
};

// ---- Screen props (one component per folder, exported from the folder's index.ts) ----

/** packages/scout/src/home/index.ts → HomeBoard (Figma 51:46, 72:1585, 76:1588, 60:1379) */
export type HomeBoardProps = ScreenBase & {
  workspaceFilter: string | null; // workspace id, null = all
  search: string;
  onOpenProject: (projectId: string) => void;
  onOpenItem: (itemId: string) => void;
  onNewItem: (projectId?: string) => void;
};

/** packages/scout/src/project/index.ts → ProjectPanel (Figma 55:46) and NewItemDialog (64:1576) */
export type ProjectPanelProps = ScreenBase & {
  projectId: string;
  onClose: () => void;
  onOpenItem: (itemId: string) => void;
  onNewItem: (projectId: string) => void;
};
export type NewItemDialogProps = ScreenBase & {
  open: boolean;
  projectId: string | null; // preselected project, null = user picks
  onClose: () => void;
  onCreated: (itemId: string) => void;
};

/** packages/scout/src/item/index.ts → ItemThread (Figma 55:800, 58:5569, 58:6364, 68:1582, 55:1492) */
export type ItemThreadProps = ScreenBase & {
  itemId: string;
  onClose: () => void;
  onOpenProject: (projectId: string) => void;
};

/** packages/scout/src/chat/index.ts → ChatPanel (Figma 51:630 right rail) */
export type ChatPanelProps = ScreenBase & {
  context: ChatContext;
  onClose: () => void;
  onOpenItem: (itemId: string) => void;
};

/** packages/scout/src/settings/index.ts → SettingsView (Figma 56:46, 56:546) */
export type SettingsViewProps = ScreenBase & {
  tab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
  onBack: () => void;
};

/** packages/scout/src/onboarding/index.ts → Onboarding (Figma 47:46, 50:125, 47:788, 58:437, 49:46, 49:451) */
export type OnboardingProps = ScreenBase & {
  step: number; // 1..6
  onStep: (step: number) => void;
  onDone: () => void; // shell saves settings.onboarding_done = true and goes home
  onSkip: () => void;
};
