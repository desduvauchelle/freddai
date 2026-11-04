import { test } from "node:test";
import assert from "node:assert/strict";
import { groupTranscript } from "../src/conversation/transcript.ts";

const message = (id, role) => Object.freeze({ id, role, text: `Content ${id}` });

test("adjacent calls share one group, retaining every original record in order", () => {
  const calls = Object.freeze([message("1", "tool"), message("2", "tool"), message("3", "tool")]);
  const result = groupTranscript(calls);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "tools");
  assert.equal(result[0].id, "1");
  assert.deepEqual(result[0].messages, calls);
  assert.equal(result[0].messages[1], calls[1]);
});

test("user, assistant, and notice messages each break a tool group", () => {
  for (const role of ["user", "assistant", "notice"]) {
    const middle = message("middle", role);
    const result = groupTranscript([message("1", "tool"), middle, message("2", "tool")]);
    assert.deepEqual(result.map(item => item.kind), ["tools", "message", "tools"]);
    assert.equal(result[1].message, middle);
  }
});

test("empty transcripts, single calls, and appended streaming calls retain stable group identity", () => {
  assert.deepEqual(groupTranscript([]), []);
  const first = message("1", "tool");
  const before = groupTranscript([first]);
  const after = groupTranscript([first, message("2", "tool")]);
  assert.equal(before[0].id, after[0].id);
  assert.equal(before[0].messages.length, 1);
  assert.equal(after[0].messages.length, 2);
});
