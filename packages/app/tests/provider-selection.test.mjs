import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/desktop/DesktopApp.tsx', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('  function selectNewAccount('), source.indexOf('  function newThread()'));
const js = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
test('agent selection stays immediate while preference writes are pending and serializes rapid changes', async () => {
  const state = { selected: '', working: false, calls: [], errors: [] };
  const releases = [];
  const context = {
    native: true, db: { preferences: {} },
    accountSelectionSave: { current: Promise.resolve() },
    setAccountId: value => { state.selected = value; },
    setError: error => state.errors.push(error),
    action: async fn => { state.working = true; try { await fn(); } finally { state.working = false; } },
    refresh: async () => {},
    invoke: async (command, input) => { state.calls.push({ command, input }); await new Promise(resolve => releases.push(resolve)); },
  };
  const select = new Function(...Object.keys(context), `${js}; return selectNewAccount;`)(...Object.values(context));
  select('adapter-a');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.selected, 'adapter-a');
  assert.equal(state.working, false, 'choosing an agent must not acquire the send lock');
  select('adapter-b');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.selected, 'adapter-b');
  assert.equal(state.calls.length, 1);
  releases.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.calls[1].input.preferences.last_selected, 'adapter-b');
  releases.shift()();
  await context.accountSelectionSave.current;
});
