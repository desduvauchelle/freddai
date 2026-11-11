import { describe, expect, it } from "vitest";
import { dropOutcome, moveProjectToWorkspace, withEmptyGroups } from "./workspace-order";

const ws = (id: string, projects: string[]) => ({ id, name: id, color: "#000", projects });
const base = [ws("a", ["x", "y"]), ws("b", ["z", "w"])];

it("moves a project out of its source and next to the target project", () => {
  expect(moveProjectToWorkspace(base, "x", "b", { targetProjectId: "z", after: true }).map(w => w.projects)).toEqual([["y"], ["z", "x", "w"]]);
  expect(moveProjectToWorkspace(base, "x", "b", { targetProjectId: "z", after: false }).map(w => w.projects)).toEqual([["y"], ["x", "z", "w"]]);
});
it("appends without a position, reorders inside one workspace, and removes everywhere for null", () => {
  expect(moveProjectToWorkspace(base, "x", "b").map(w => w.projects)).toEqual([["y"], ["z", "w", "x"]]);
  expect(moveProjectToWorkspace(base, "x", "a", { targetProjectId: "y", after: true })[0].projects).toEqual(["y", "x"]);
  expect(moveProjectToWorkspace(base, "x", null).map(w => w.projects)).toEqual([["y"], ["z", "w"]]);
});
it("derives the drop neighbour and whether the container changed", () => {
  expect(dropOutcome({ id: "x", from: "a", to: "b", list: ["z", "x", "w"] })).toEqual({ crossed: true, position: { targetProjectId: "z", after: true } });
  expect(dropOutcome({ id: "x", from: "a", to: "a", list: ["x", "y"] })).toEqual({ crossed: false, position: { targetProjectId: "y", after: false } });
  expect(dropOutcome({ id: "x", from: "a", to: "b", list: ["x"] }).position).toBeUndefined();
});

describe("withEmptyGroups", () => {
  it("adds empty workspaces and other without touching existing lists", () => {
    const base = { "workspace:a": ["p1"] };
    expect(withEmptyGroups(base, ["workspace:a", "workspace:b"], true)).toEqual({ "workspace:a": ["p1"], "workspace:b": [], other: [] });
    expect(base).toEqual({ "workspace:a": ["p1"] });
    expect(withEmptyGroups({}, [], false)).toEqual({});
  });
});
