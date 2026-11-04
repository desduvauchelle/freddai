import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Execute the actual handler with an isolated IPC boundary, never a provider or account store.
const source = readFileSync(new URL('../src/desktop/DesktopApp.tsx', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('  async function send('), source.indexOf('  async function queueActionFor('));
const js = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function harness(active = false) {
  let finish, fail;
  const state = { replies: { t: 'Submitted' }, attachments: { t: [{ id: 'attachment' }] }, outgoing: [], calls: [] };
  const apply = key => value => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
  const context = {
    db: { accounts: [{ id: 'synthetic-adapter', provider: 'codex' }], queues: [] },
    native: true, working: false, staging: 0, replyAttachments: state.attachments,
    // Draft text lives in the external store (drafts.ts); model it with the same get/set/update contract.
    getDraft: id => state.replies[id] ?? '', setThreadDraft: (id, value) => { state.replies[id] = value; }, updateDraft: (id, update) => { state.replies[id] = update(state.replies[id] ?? ''); },
    action: async fn => fn(), replyRequest: () => 'request-1', replyRequests: { current: { t: 'request-1' } },
    setOutgoing: apply('outgoing'), setReplyAttachments: apply('attachments'),
    busy: () => active, effectivePermissionMode: () => 'ask', replyPermissions: {}, savedPermissionMode: () => 'ask',
    replySelectionFor: () => ({ model: '', effort: 'default' }), refresh: async () => {},
    invoke: (command, input) => { state.calls.push({ command, input }); return new Promise((resolve, reject) => { finish = resolve; fail = reject; }); },
  };
  const task = { id: 't', project: 'p', account: 'synthetic-adapter', status: 'done', messages: [] };
  const send = new Function(...Object.keys(context), `${js}; return send;`)(...Object.values(context));
  return { state, context, run: queue => send(task, undefined, queue), finish: () => finish(), fail: () => fail(new Error('Synthetic send failure')) };
}

test('desktop handler clears composer and previews prompt/attachments before delayed IPC acknowledgement', async () => {
  const h = harness();
  const pending = h.run(false);
  assert.equal(h.state.replies.t, '');
  assert.deepEqual(h.state.attachments.t, []);
  assert.equal(h.state.outgoing[0].message.text, 'Submitted');
  assert.equal(h.state.outgoing[0].message.attachments[0].id, 'attachment');
  assert.equal(h.state.outgoing[0].message.delivery, 'Sending…');
  h.state.replies.t = 'Next draft';
  h.finish(); await pending;
  assert.equal(h.state.replies.t, 'Next draft');
  assert.equal(h.state.outgoing[0].message.delivery, 'Sent · syncing…');
  assert.equal(h.state.calls[0].input.options.request_id, 'request-1');
});
test('desktop handler restores rejected text/attachments without losing newer edits or the retry ID', async () => {
  const h = harness(true);
  const pending = h.run(false);
  assert.equal(h.state.calls[0].command, 'queue_message');
  h.state.replies.t = 'Next draft';
  h.state.attachments.t = [{ id: 'new-file' }];
  h.fail(); await assert.rejects(pending, /Synthetic send failure/);
  assert.equal(h.state.replies.t, 'Submitted\nNext draft');
  assert.deepEqual(h.state.attachments.t.map(a => a.id), ['attachment', 'new-file']);
  assert.equal(h.state.outgoing.length, 0);
  assert.equal(h.context.replyRequests.current.t, 'request-1');
});

test('Command-Enter steers an active turn while Enter queues it', async () => {
  for (const steer of [false, true]) {
    const h = harness(true);
    const pending = h.run(steer);
    assert.equal(h.state.calls[0].command, steer ? 'steer_message' : 'queue_message');
    h.finish(); await pending;
  }
});
test('Command-Enter sends normally when idle', async () => {
  const h = harness(); const pending = h.run(true);
  assert.equal(h.state.calls[0].command, 'launch');
  h.finish(); await pending;
});
