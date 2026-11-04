import { test } from "node:test";
import assert from "node:assert/strict";
import { usageLabels } from "../src/desktop/conversation-usage.ts";
test("context and cache labels distinguish zero, missing, and last-request usage", () => {
  assert.equal(usageLabels().percent, null);
  assert.equal(usageLabels().cache, null);
  const u = {context_tokens: 400, context_window: 1000, input_tokens: 350, cached_input_tokens: 300};
  assert.equal(usageLabels(u).context, "Context 40%");
  assert.equal(usageLabels(u).cache, null);
  assert.equal(usageLabels({...u, cached_input_tokens: 0}).cache, null);
  assert.equal(usageLabels({...u, context_tokens: 0}).context, "Context 0%");
  assert.equal(usageLabels({...u, context_window: 0}).percent, null);
  assert.equal(usageLabels({...u, context_tokens: 1500}).percent, 100);
  assert.equal(usageLabels({...u, context_window: null}).context, null);
});

test("missing and invalid fields stay hidden independently while valid zeros remain visible", () => {
  assert.deepEqual(usageLabels(), { percent: null, context: null, cache: null });
  assert.deepEqual(usageLabels({ context_tokens: 0, context_window: 100, cached_input_tokens: null }), { percent: 0, context: "Context 0%", cache: null });
  assert.deepEqual(usageLabels({ context_tokens: null, context_window: null, cached_input_tokens: 0 }), { percent: null, context: null, cache: null });
  for (const value of [-1, NaN, Infinity]) {
    assert.deepEqual(usageLabels({ context_tokens: value, context_window: 100, cached_input_tokens: value }), { percent: null, context: null, cache: null });
  }
});
