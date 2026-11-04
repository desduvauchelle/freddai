import { test } from "node:test";
import assert from "node:assert/strict";
import { commandFor, shortcuts } from "../src/desktop/shortcuts.ts";
import { compareThreadRecency, resolveAccount } from "../src/desktop/types.ts";
const event = (key, extra = {}) => ({
  key,
  code: "",
  metaKey: true,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  isComposing: false,
  repeat: false,
  ...extra,
});
test("documented shortcuts resolve, including aliases", () => {
  for (const s of shortcuts) {
    assert.equal(commandFor(event(s.key, { shiftKey: !!s.shift })), s.id);
    if (s.alternate) assert.equal(commandFor(event(s.alternate)), s.id);
  }
});
test("stop works on shifted period keyboards", () =>
  assert.equal(
    commandFor(event(">", { code: "Period", shiftKey: true })),
    "stop",
  ));
test("typing, composition, repeats, and conflicting modifiers do not trigger commands", () => {
  for (const extra of [
    { metaKey: false },
    { isComposing: true },
    { repeat: true },
    { altKey: true },
    { shiftKey: true },
  ])
    assert.equal(commandFor(event("n", extra)), undefined);
});
test("Control equivalent is supported", () =>
  assert.equal(
    commandFor(event("n", { metaKey: false, ctrlKey: true })),
    "new",
  ));
test("project defaults and remembered routes agree with host precedence", () => {
  const db = {
    preferences: {
      prefer_last: true,
      last: "global-last",
      fallback: "fallback",
    },
  };
  assert.equal(
    resolveAccount(db, { policy: "fixed", account: "pinned" }),
    "pinned",
  );
  assert.equal(
    resolveAccount(db, { policy: "last", last: "project-last" }),
    "project-last",
  );
  assert.equal(resolveAccount(db, { policy: "inherit" }), "global-last");
  assert.equal(resolveAccount(db, { policy: "fixed", account: null }), "");
  db.preferences.prefer_last = false;
  assert.equal(resolveAccount(db, { policy: "inherit" }), "fallback");
});

test("default labels identify provider and named account or give an actionable empty state", async () => {
  const { accountLabel } = await import("../src/desktop/types.ts");
  assert.equal(accountLabel({ accounts: [] }, ""), "No account configured");
  assert.equal(
    accountLabel(
      {
        accounts: [
          { id: "work", name: "Work subscription", provider: "codex" },
        ],
      },
      "work",
    ),
    "Codex · Work subscription",
  );
  assert.equal(
    accountLabel(
      { accounts: [{ id: "personal", name: "Personal", provider: "claude" }] },
      "personal",
    ),
    "Claude Code · Personal",
  );
});

test("mascot prioritizes actual pending requests over a running status", async () => {
  const { mascotState } = await import("../src/desktop/mascot-state.ts");
  assert.deepEqual(mascotState({ status: "running", pending: { id: 1 } }, []), { mood: 4, label: "Needs your input" });
});
test("mascot follows the selected thread and ignores old finished work when no thread is selected", async () => {
  const { mascotState } = await import("../src/desktop/mascot-state.ts");
  const failed = { status: "failed", pending: null };
  const running = { status: "running", pending: null };
  const waiting = { status: "waiting", pending: null };
  assert.equal(mascotState(failed, [waiting, running]).mood, 8);
  assert.equal(mascotState(undefined, [failed, running, waiting]).mood, 4);
  assert.equal(mascotState(undefined, [failed, running]).mood, 2);
  assert.equal(mascotState(undefined, [failed, { status: "done" }]).mood, 0);
  assert.equal(mascotState({ status: "archived", pending: null }, [running]).mood, 0);
});


test("banked reset expiry distinguishes dates, elapsed dates, no expiry and missing metadata", async () => {
  const { resetExpiry, availableResets } = await import("../src/desktop/reset-credits.ts");
  const now = 1800000000000;
  const dated = { id: "dated", title: null, status: "available", expires_at: 1800000100, expiry_known: true };
  assert.match(resetExpiry(dated, now), /^Expires /);
  assert.match(resetExpiry(dated, now + 100000), /^Expired /);
  assert.equal(resetExpiry({ ...dated, expires_at: null }, now), "Does not expire");
  assert.equal(resetExpiry({ ...dated, expires_at: null, expiry_known: false }, now), "Expiry date unavailable");
  const rows = availableResets({ available_count: 6, credits: [
    { ...dated, id: "used", status: "redeemed" },
    { ...dated, id: "no-date", expires_at: null },
    dated,
  ] });
  assert.deepEqual(rows.map(r => r.id), ["dated", "no-date"]);
  assert.deepEqual(availableResets({ available_count: 6, credits: null }), []);
});


test("effort choices follow the provider and selected Codex model metadata", async () => {
  const { effortChoices } = await import("../src/desktop/agent-selection.ts");
  const models = [
    { model: "fast", isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: "low" }] },
    { model: "deep", supportedReasoningEfforts: [{ reasoningEffort: "high" }, { reasoningEffort: "xhigh" }] },
  ];
  assert.deepEqual(effortChoices("codex", "", models), ["low"]);
  assert.deepEqual(effortChoices("codex", "deep", models), ["high", "xhigh"]);
  assert.ok(effortChoices("claude", "opus", []).includes("max"));
  assert.deepEqual(effortChoices("gemini", "", models), []);
  assert.deepEqual(effortChoices("grok", "", models), []);
});


test("reset result messages distinguish consumption from non-consumption", async () => {
  const { resetOutcome } = await import("../src/desktop/reset-credits.ts");
  assert.match(resetOutcome("reset"), /^Reset used/);
  assert.match(resetOutcome("alreadyRedeemed"), /already used/);
  assert.match(resetOutcome("nothingToReset"), /No reset was used/);
  assert.match(resetOutcome("noCredit"), /no longer available/);
  assert.match(resetOutcome("unknown"), /outcome unavailable/);
});


test("thread menu gates running, pending, archived and deleted actions", async () => {
  const { threadCapabilities, threadVisibility } = await import("../src/desktop/types.ts");
  const thread = { status: "done", provider_id: "saved", pending: null };
  assert.equal(threadCapabilities(thread, true).resume, true);
  assert.equal(threadCapabilities(thread, false).resume, false);
  const waiting = threadCapabilities({ ...thread, status: "waiting", pending: { id: 1 } }, true);
  assert.equal(waiting.stop, true);
  assert.equal(waiting.review, true);
  assert.equal(waiting.change, false);
  assert.equal(waiting.delete, true);
  for (const status of ["starting", "running", "failed"]) assert.equal(threadCapabilities({ ...thread, status }, false).delete, true);
  assert.equal(threadCapabilities({ ...thread, deleted_at: 10 }, true).delete, false);
  assert.equal(waiting.resume, false);
  assert.equal(threadCapabilities({ ...thread, archived: true }, true).resume, false);
  assert.equal(threadCapabilities({ ...thread, status: "archived" }, true).resume, false);
  assert.equal(threadCapabilities({ ...thread, deleted_at: 10 }, true).restore, true);
  assert.equal(threadVisibility(thread, "all"), true);
  assert.equal(threadVisibility({ ...thread, archived: true }, "all"), false);
  assert.equal(threadVisibility({ ...thread, archived: true }, "archived"), true);
  assert.equal(threadVisibility({ ...thread, archived: true, deleted_at: 10 }, "archived"), false);
  assert.equal(threadVisibility({ ...thread, archived: true, deleted_at: 10 }, "deleted"), true);
  assert.equal(threadVisibility(thread, "deleted"), false);
});

test("Antigravity labels are distinct from preserved legacy Gemini accounts", async () => {
  const { providerName, accountLabel } = await import("../src/desktop/types.ts");
  assert.equal(providerName("antigravity"), "Antigravity CLI");
  assert.equal(providerName("gemini"), "Gemini CLI (legacy)");
  assert.equal(accountLabel({ accounts: [{ id: "agy", provider: "antigravity", name: "Current CLI" }] }, "agy"), "Antigravity CLI · Current CLI");
});

test("completed replies need reading before moving to finished", async () => {
  const { threadListStatus } = await import("../src/desktop/types.ts");
  const thread = { id: "reply", status: "done", updated: 20 };
  assert.equal(threadListStatus(thread, {}), "unread");
  assert.equal(threadListStatus(thread, { reply: 20 }), "done");
  assert.equal(threadListStatus({ ...thread, updated: 21 }, { reply: 20 }), "unread");
  for (const status of ["running", "starting", "waiting", "failed", "interrupted"])
    assert.equal(threadListStatus({ ...thread, status }, { reply: 20 }), status);
});

test("read completed thread stays selected then leaves the active list, retaining finished access", async () => {
  const { threadInActiveList, threadListStatus } = await import("../src/desktop/types.ts");
  const thread = { id: "reply", status: "done", updated: 20 };
  assert.equal(threadInActiveList(thread, {}, "other", true, "all"), true);
  assert.equal(threadInActiveList(thread, { reply: 20 }, "reply", true, "all"), true);
  assert.equal(threadInActiveList(thread, { reply: 20 }, "other", true, "all"), false);
  assert.equal(threadInActiveList(thread, { reply: 20 }, "other", true, "done"), true);
  assert.equal(threadInActiveList(thread, { reply: 20 }, "other", false, "all"), true);
  assert.equal(threadListStatus({ ...thread, updated: 0 }, {}), "unread");
});

test("threadIsLive status rule: running, pending, queued, unread, unviewed failed, selected", async () => {
  const { threadIsLive } = await import("../src/desktop/types.ts");
  const base = { id: "t", status: "done", updated: 20 };
  const read = { t: 20 };
  assert.equal(threadIsLive(base, read, "other"), false, "read done is older");
  assert.equal(threadIsLive(base, {}, "other"), true, "unread");
  assert.equal(threadIsLive(base, read, "t"), true, "selected pinned");
  for (const status of ["starting", "running", "waiting"]) assert.equal(threadIsLive({ ...base, status }, read, "other"), true, status);
  assert.equal(threadIsLive({ ...base, pending: { id: 1 } }, read, "other"), true, "needs user");
  assert.equal(threadIsLive(base, read, "other", 2), true, "queued");
  assert.equal(threadIsLive({ ...base, status: "failed" }, {}, "other"), true, "failed unviewed");
  assert.equal(threadIsLive({ ...base, status: "failed" }, read, "other"), false, "failed viewed");
  assert.equal(threadIsLive({ ...base, status: "interrupted" }, read, "other"), false);
});


test("new-thread selection modes override projects only when requested", () => {
  const db = { preferences: { prefer_last: true, last: "old", fallback: "default", last_selected: "chosen", new_thread_policy: "last_selected" } };
  const project = { policy: "fixed", account: "project" };
  assert.equal(resolveAccount(db, project), "chosen");
  db.preferences.last_selected = null;
  assert.equal(resolveAccount(db, project), "project");
  assert.equal(resolveAccount(db, { policy: "last", last: "project-last" }), "project-last");
  assert.equal(resolveAccount(db, { policy: "last", last: null }), "default");
  db.preferences.last_selected = "chosen";
  db.preferences.new_thread_policy = "project";
  assert.equal(resolveAccount(db, project), "project");
  assert.equal(resolveAccount(db, { policy: "inherit" }), "default");
  assert.equal(resolveAccount(db, { policy: "fixed", account: "removed" }), "removed");
  db.preferences.new_thread_policy = "default";
  assert.equal(resolveAccount(db, project), "default");
  db.preferences.fallback = null;
  assert.equal(resolveAccount(db, project), "");
});

test("thread ordering follows user sends, independent of output and status updates", () => {
  const older = { id: "a", updated: 900, last_user_message_at: 100 };
  const newer = { id: "b", updated: 200, last_user_message_at: 200 };
  const order = rows => [...rows].sort(compareThreadRecency).map(t => t.id);
  assert.deepEqual(order([older, newer]), ["b", "a"]);
  assert.deepEqual(order([{ ...older, updated: 9999, status: "done" }, newer]), ["b", "a"]);
  assert.deepEqual(order([{ ...older, last_user_message_at: 300 }, newer]), ["a", "b"]);
  assert.deepEqual(order([{ id: "z", updated: 500 }, { id: "c", updated: 500 }]), ["c", "z"]);
});

test("deselected read thread drops out of the active list; unread and running stay", async () => {
  const { threadInActiveList } = await import("../src/desktop/types.ts");
  const previous = { id: "previous", status: "done", updated: 12 };
  assert.equal(threadInActiveList(previous, { previous: 12 }, "previous", true, "all"), true);
  assert.equal(threadInActiveList(previous, { previous: 12 }, "new", true, "all"), false);
  assert.equal(threadInActiveList(previous, {}, "new", true, "all"), true);
  assert.equal(threadInActiveList({ ...previous, status: "running" }, { previous: 12 }, "new", true, "all"), true);
});

test("day buckets: today has no header, yesterday, then short dates with year only when not current", async () => {
  const { dayBucketLabel, groupThreadsByDay } = await import("../src/desktop/types.ts");
  const now = new Date(2026, 10, 3, 15, 0).getTime();
  const at = (m, d, h = 12, y = 2026) => new Date(y, m, d, h).getTime();
  assert.equal(dayBucketLabel(at(10, 3, 0), now), "");
  assert.equal(dayBucketLabel(at(10, 3, 23), now), "");
  assert.equal(dayBucketLabel(at(10, 2, 23), now), "Yesterday");
  assert.equal(dayBucketLabel(at(10, 2, 0), now), "Yesterday");
  assert.equal(dayBucketLabel(at(9, 27), now), "Tue, Oct 27");
  assert.equal(dayBucketLabel(at(11, 30, 12, 2025), now), "Tue, Dec 30, 2025");
  const rows = [
    { id: "a", updated: 1, last_user_message_at: at(10, 3, 9) },
    { id: "b", updated: 1, last_user_message_at: at(10, 2, 9) },
    { id: "c", updated: 1, last_user_message_at: at(10, 2, 8) },
    { id: "d", updated: at(9, 27) },
  ];
  assert.deepEqual(groupThreadsByDay(rows, now).map(g => [g.label, g.threads.map(t => t.id)]),
    [["", ["a"]], ["Yesterday", ["b", "c"]], ["Tue, Oct 27", ["d"]]]);
});

test("archive stays available for failed and active threads without an account", async () => {
  const { threadCapabilities } = await import("../src/desktop/types.ts");
  for (const status of ["failed", "starting", "running", "waiting"]) {
    assert.equal(threadCapabilities({ status }, false).archive, true);
  }
});

test("each pane's header mood comes from its own thread, not the focused one", async () => {
  const { mascotState } = await import("../src/desktop/mascot-state.ts");
  const left = { id: "a", status: "running", pending: null }, right = { id: "b", status: "done", pending: null };
  assert.equal(mascotState(left, [left, right]).mood, 2);
  assert.equal(mascotState(right, [left, right]).mood, 6);
});
test("header mascot sizes and priorities", async () => {
  const { MASCOT_SIZES, MASCOT_PRIORITY, moodChip } = await import("../src/desktop/mascot-state.ts");
  assert.deepEqual(MASCOT_SIZES, { header: 38, hero: 148, approval: 36 });
  assert.ok(MASCOT_PRIORITY.header > MASCOT_PRIORITY.approval && MASCOT_PRIORITY.hero > MASCOT_PRIORITY.approval);
  assert.equal(moodChip(0), null);
  assert.equal(moodChip(2), "Working…");
  assert.equal(moodChip(4), "Waiting for you");
});
test("mascot mood mapping: running, waiting, unread, done+read, interrupted, failed, idle", async () => {
  const { mascotState } = await import("../src/desktop/mascot-state.ts");
  const mood = (t, read) => mascotState(t, [t], read).mood;
  assert.equal(mood({ id: "a", status: "running", updated: 5 }, {}), 2);
  assert.equal(mood({ id: "a", status: "starting", updated: 5 }, {}), 2);
  assert.equal(mood({ id: "a", status: "waiting", updated: 5 }, {}), 4);
  assert.equal(mood({ id: "a", status: "done", updated: 5 }, { a: 4 }), 4);
  assert.equal(mascotState({ id: "a", status: "done", updated: 5 }, [], {}).label, "Waiting for you");
  assert.equal(mood({ id: "a", status: "done", updated: 5 }, { a: 5 }), 6);
  assert.equal(mood({ id: "a", status: "done", updated: 5 }), 6);
  assert.equal(mood({ id: "a", status: "interrupted", updated: 5 }, {}), 7);
  assert.equal(mood({ id: "a", status: "failed", updated: 5 }, {}), 8);
  assert.equal(mood({ id: "a", status: "archived", updated: 5 }, {}), 0);
});
