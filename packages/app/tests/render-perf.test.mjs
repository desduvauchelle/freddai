import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileSnapshot } from '../src/desktop/reconcileSnapshot.ts';
import { splitMarkdownBlocks } from '../src/conversation/markdown-blocks.ts';
import { getDraft, setDraft, updateDraft, pruneDrafts, resetDrafts } from '../src/desktop/drafts.ts';

const snapshot = () => ({
  accounts: [{ id: 'a1', name: 'Work' }],
  projects: [{ id: 'p1', name: 'One', color: '#fff' }, { id: 'p2', name: 'Two', color: '#000' }],
  preferences: { use_worktree: false },
  sessions: [
    { id: 's1', title: 'First', updated: 1, messages: [{ id: 'm1', role: 'user', text: 'hi' }, { id: 'm2', role: 'assistant', text: 'hello' }] },
    { id: 's2', title: 'Second', updated: 2, messages: [{ id: 'm3', role: 'user', text: 'yo' }] },
  ],
});

test('reconcileSnapshot returns prev when the snapshots are deep-equal', () => {
  const prev = snapshot();
  assert.equal(reconcileSnapshot(prev, snapshot()), prev);
});
test('a changed message gives its session a new ref and leaves other sessions untouched', () => {
  const prev = snapshot(), next = snapshot();
  next.sessions[0].messages[1] = { id: 'm2', role: 'assistant', text: 'hello there' };
  const merged = reconcileSnapshot(prev, next);
  assert.notEqual(merged, prev);
  assert.notEqual(merged.sessions, prev.sessions);
  assert.notEqual(merged.sessions[0], prev.sessions[0]);
  assert.equal(merged.sessions[0].messages[0], prev.sessions[0].messages[0]);
  assert.notEqual(merged.sessions[0].messages[1], prev.sessions[0].messages[1]);
  assert.equal(merged.sessions[1], prev.sessions[1]);
  assert.equal(merged.projects, prev.projects);
  assert.equal(merged.accounts, prev.accounts);
  assert.deepEqual(merged, next);
});
test('appended messages and reordered sessions reuse matching items by id', () => {
  const prev = snapshot(), next = snapshot();
  next.sessions.reverse();
  next.sessions[1].messages.push({ id: 'm9', role: 'user', text: 'more' });
  const merged = reconcileSnapshot(prev, next);
  assert.equal(merged.sessions[0], prev.sessions[1]);
  assert.notEqual(merged.sessions[1], prev.sessions[0]);
  assert.equal(merged.sessions[1].messages[0], prev.sessions[0].messages[0]);
  assert.deepEqual(merged, next);
});
test('removed items and changed scalars still produce the next value', () => {
  const prev = snapshot(), next = snapshot();
  next.projects.pop(); next.preferences = { use_worktree: true };
  const merged = reconcileSnapshot(prev, next);
  assert.deepEqual(merged, next);
  assert.equal(merged.projects[0], prev.projects[0]);
  assert.equal(merged.accounts, prev.accounts);
});

test('paragraphs split at blank lines', () => {
  assert.deepEqual(splitMarkdownBlocks('one\n\ntwo\n\n\nthree'), ['one', 'two', 'three']);
});
test('blank lines inside fenced code stay in one block', () => {
  const text = 'intro\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\n~~~\nx\n\ny\n~~~\n\nafter';
  assert.deepEqual(splitMarkdownBlocks(text), ['intro', '```js\nconst a = 1;\n\nconst b = 2;\n```', '~~~\nx\n\ny\n~~~', 'after']);
});
test('an unterminated fence (streaming) keeps the rest as one block', () => {
  assert.deepEqual(splitMarkdownBlocks('intro\n\n```py\na\n\nb'), ['intro', '```py\na\n\nb']);
});
test('reference definitions, footnotes and raw HTML fall back to one block', () => {
  for (const text of ['see [x]\n\n[x]: https://example.com', 'note[^1]\n\n[^1]: text', 'a\n\n<details>\n\nb\n\n</details>']) {
    assert.deepEqual(splitMarkdownBlocks(text), [text]);
  }
});
test('loose lists and indented list continuations are not split', () => {
  const list = '- a\n\n- b\n\n  continued\n\n- c';
  assert.deepEqual(splitMarkdownBlocks(`intro\n\n${list}\n\noutro`), ['intro', list, 'outro']);
});

test('draft store: set, update, prune and isolation between threads', () => {
  resetDrafts();
  setDraft('a', 'hello'); setDraft('b', 'world');
  assert.equal(getDraft('a'), 'hello'); assert.equal(getDraft('b'), 'world'); assert.equal(getDraft('c'), '');
  updateDraft('a', previous => `restored\n${previous}`);
  assert.equal(getDraft('a'), 'restored\nhello');
  setDraft('a', ''); assert.equal(getDraft('a'), '');
  pruneDrafts(['a']); assert.equal(getDraft('b'), '');
  resetDrafts();
});
