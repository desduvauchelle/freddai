import { describe, expect, it } from "vitest";
import {
  blockedReason, buildRequests, candidateKey, filterCandidates, foldersNeedingProject, groupByFolder, pruneSelection,
  summarizeOutcomes, toggleGroup, toggleOne, type ImportCandidate,
} from "./import-sessions";

const c = (id: string, over: Partial<ImportCandidate> = {}): ImportCandidate => ({
  provider: "claude", session_id: id, cwd: "/work/app", title: `Title ${id}`, updated: 100, message_count: 3,
  git_branch: null, bytes: 10, account: "acct", project: "p1", cwd_exists: true, ...over,
});

describe("import session selection", () => {
  const list = [
    c("a", { updated: 100 }),
    c("b", { updated: 300, cwd: "/work/api", project: null, git_branch: "feat/x" }),
    c("c", { updated: 200, cwd: "/work/app" }),
    c("d", { updated: 50, provider: "codex", account: null }),
    c("e", { updated: 40, cwd_exists: false }),
  ];
  it("groups by folder with newest groups and sessions first", () => {
    const groups = groupByFolder(list);
    expect(groups.map(g => g.cwd)).toEqual(["/work/api", "/work/app"]);
    expect(groups[1].items.map(i => i.session_id)).toEqual(["c", "a", "d", "e"]);
    expect(groups[0]).toMatchObject({ name: "api", project: null });
  });
  it("searches title, folder and branch, and filters to existing projects", () => {
    expect(filterCandidates(list, { query: "feat/x", onlyExistingProjects: false }).map(i => i.session_id)).toEqual(["b"]);
    expect(filterCandidates(list, { query: "", onlyExistingProjects: true }).map(i => i.session_id)).toEqual(["a", "c", "d", "e"]);
    expect(filterCandidates(list, { query: "title c", onlyExistingProjects: true }).map(i => i.session_id)).toEqual(["c"]);
  });
  it("explains why a session is blocked and never selects it", () => {
    expect(blockedReason(list[3])).toMatch(/Connect the existing sign-in/);
    expect(blockedReason(list[4])).toMatch(/no longer exists/);
    expect(blockedReason(list[0])).toBeNull();
    expect(toggleOne(new Set(), list[3]).size).toBe(0);
  });
  it("toggles one session and whole groups", () => {
    let sel = toggleOne(new Set<string>(), list[0]);
    expect([...sel]).toEqual(["claude:a"]);
    sel = toggleGroup(sel, groupByFolder(list)[1].items);
    expect([...sel].sort()).toEqual(["claude:a", "claude:c"]);
    sel = toggleGroup(sel, groupByFolder(list)[1].items);
    expect(sel.size).toBe(0);
    expect(toggleOne(toggleOne(new Set(), list[0]), list[0]).size).toBe(0);
  });
  it("prunes selections that became hidden", () => {
    const sel = new Set(["claude:a", "claude:b", "claude:gone"]);
    expect([...pruneSelection(sel, filterCandidates(list, { query: "", onlyExistingProjects: true }))]).toEqual(["claude:a"]);
  });
  it("asks to create projects only for folders without one", () => {
    const sel = new Set([candidateKey(list[0]), candidateKey(list[1])]);
    expect(foldersNeedingProject(list, sel)).toEqual(["/work/api"]);
    expect(foldersNeedingProject(list, new Set([candidateKey(list[0])]))).toEqual([]);
    expect(buildRequests(list, sel, true)).toEqual([
      { provider: "claude", session_id: "a", account: "acct", create_project: true },
      { provider: "claude", session_id: "b", account: "acct", create_project: true },
    ]);
  });
  it("summarizes outcomes and surfaces every error", () => {
    expect(summarizeOutcomes([
      { session_id: "a", thread: "t", skipped: false, truncated: true, error: null },
      { session_id: "b", thread: "t2", skipped: true, truncated: false, error: null },
      { session_id: "c", thread: null, skipped: false, truncated: false, error: "boom" },
    ])).toEqual({ imported: 1, skipped: 1, truncated: 1, errors: ["c: boom"] });
  });
});
