import { vi } from "vitest";
import type { Database } from "@freddai/shared/agent/types";
import type { ScoutState } from "../api";
import type { ScoutActions } from "../contracts";

export function makeState(): ScoutState {
  return {
    revision: 1,
    workspaces: [{ id: "w1", name: "LiveCase", color: "#3b6cf6", order: 0, collapsed: false }],
    projects: [
      { id: "p1", workspace: "w1", name: "Sales", color: "#3b6cf6", order: 0, pinned: false, hidden: false, freddai_project: null },
      { id: "p2", workspace: "w1", name: "Support", color: "#3b6cf6", order: 1, pinned: false, hidden: false, freddai_project: null },
    ],
    items: [],
    rules: [],
    sources: [
      { id: "s1", account: "a1", kind: "gmail", label: "Gmail", detail: "you@livecase.example", access: "direct", enabled: true, status: "not_connected" },
    ],
    settings: { onboarding_done: false, onboarding_step: 1, sample_data: false },
  };
}

export function makeDb(): Database {
  return {
    accounts: [{ id: "a1", name: "Work", provider: "claude", color: "#d97757" }],
    projects: [],
    sessions: [],
    preferences: { prefer_last: false, fallback: null, last: null },
  } as unknown as Database;
}

export function makeActions(): ScoutActions {
  const ok = () => vi.fn(async () => {});
  return {
    workspaceSave: ok(), workspaceDelete: ok(), workspaceReorder: ok(),
    projectSave: ok(), projectDelete: ok(), projectMove: ok(),
    itemSave: ok(), itemDelete: ok(), itemMove: ok(),
    ruleSave: ok(), ruleDelete: ok(), sourceSave: ok(), sourceDelete: ok(),
    settingsSave: ok(), importFreddai: ok(), sampleData: ok(), refresh: ok(),
  };
}
