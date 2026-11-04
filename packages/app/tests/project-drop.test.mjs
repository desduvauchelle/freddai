import { test } from "node:test";
import assert from "node:assert/strict";
import { projectDropTarget } from "../src/desktop/project-drop.ts";

test("native folder drops are routed by the resized navigation bounds on Retina displays", () => {
  const bounds = { left: 0, right: 420, top: 60, bottom: 800 };
  assert.equal(projectDropTarget({ x: 600, y: 300 }, bounds, 2, false), true);
  assert.equal(projectDropTarget({ x: 840, y: 300 }, bounds, 2, false), false);
  assert.equal(projectDropTarget({ x: 200, y: 100 }, bounds, 2, false), false);
  assert.equal(projectDropTarget({ x: 200, y: 1600 }, bounds, 2, false), false);
  assert.equal(projectDropTarget({ x: 300, y: 300 }, bounds, 1, false), true);
  assert.equal(projectDropTarget({ x: 300, y: 300 }, bounds, 1, true), false);
  assert.equal(projectDropTarget({ x: 300, y: 300 }, undefined, 1, false), false);
});
