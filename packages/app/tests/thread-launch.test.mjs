import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Exercise the actual submit handler with an isolated IPC boundary, without accounts or provider turns.
const source = readFileSync(new URL('../src/desktop/DesktopApp.tsx', import.meta.url), 'utf8');
const startSource = source.slice(source.indexOf('  async function start('), source.indexOf('  async function send('));
const js = ts.transpileModule(startSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function harness(launch = async () => 'new-session') {
  const state = { sessions: [], preview: null, closed: false, draft: 'Hello', attachments: [] };
  const context = {
    db: { accounts: [{ id: 'account', provider: 'codex' }] },
    native: true, working: false, staging: 0, newAccount: { provider: 'codex' },
    destination: {}, draft: state.draft, projectId: 'project', effective: 'account',
    permissionMode: 'bypass', worktree: false, model: '', effort: 'default',
    newAttachments: state.attachments, draftRequest: { current: 'request' },
    effectivePermissionMode: () => 'bypass', openAccounts: () => assert.fail('account setup'),
    action: async fn => fn(),
    invoke: async command => { assert.equal(command, 'launch'); return launch(); },
    // Simulate a stale snapshot: the preview must already support the selection.
    refresh: async () => {},
    setSelected: id => assert.ok(state.sessions.some(s => s.id === id), 'selected thread must already exist, without an empty-frame gap'),
    setDialog: value => { if (value === null) { assert.ok(state.sessions.length, 'draft closes only after conversation exists'); state.closed = true; } },
    setDraft: value => { state.draft = value; },
    setNewAttachments: value => { state.attachments = value; },
    setLaunching: value => { state.preview = value; if (value && value.id !== 'pending-launch') state.sessions = [value]; },
  };
  return { state, run: () => new Function(...Object.keys(context), `${js}; return start();`)(...Object.values(context)) };
}

test('launch publishes the session before selecting it or closing the draft pane', async () => {
  const { state, run } = harness();
  await run();
  assert.equal(state.closed, true);
  assert.equal(state.preview.messages[0].text, 'Hello');
  assert.equal(state.draft, '');
});

test('pending launch immediately displays the submitted user message while retaining the pane', async () => {
  let finish;
  const { state, run } = harness(() => new Promise(resolve => { finish = resolve; }));
  const result = run();
  assert.equal(state.closed, false);
  assert.equal(state.preview.status, 'starting');
  assert.equal(state.preview.messages[0].role, 'user');
  assert.equal(state.preview.messages[0].text, 'Hello');
  finish('new-session');
  await result;
});

test('launch rejection removes the pending preview and preserves the editable draft', async () => {
  const { state, run } = harness(async () => { throw new Error('launch rejected'); });
  await assert.rejects(run(), /launch rejected/);
  assert.equal(state.preview, null);
  assert.equal(state.closed, false);
  assert.equal(state.draft, 'Hello');
});
