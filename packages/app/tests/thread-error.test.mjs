import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/desktop/ThreadError.tsx', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const exports = {};
// Inspect the actual rendered element tree and invoke its actual recovery handler.
const jsx = (type, props) => ({ type, props });
new Function('require', 'exports', js)(name => name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : { Button: 'button' }, exports);
function elements(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...[tree.props.children].flat().flatMap(elements)];
}
test('persisted timeout explains unknown sign-in and provides a working Accounts action', () => {
  let opened = false;
  const tree = exports.ThreadError({ error: 'Sign-in check timed out', onOpenAccounts: () => { opened = true; } });
  assert.equal(tree.props.role, 'alert');
  const nodes = elements(tree);
  assert.match(nodes.find(n => n.type === 'p').props.children, /status is unknown/);
  const button = nodes.find(n => n.type === 'button');
  assert.equal(button.props.children, 'Open Accounts');
  button.props.onClick();
  assert.equal(opened, true);
});
test('new provider timeout and required sign-in offer recovery; unrelated errors retain their text', () => {
  for (const error of ['Claude Code sign-in check timed out. Open Accounts.', 'Sign in to this account in Accounts, then create or resume a thread.']) {
    assert.ok(elements(exports.ThreadError({ error, onOpenAccounts() {} })).some(n => n.type === 'button'));
  }
  const nodes = elements(exports.ThreadError({ error: 'Disk is full', onOpenAccounts() {} }));
  assert.equal(nodes.find(n => n.type === 'p').props.children, 'Disk is full');
  assert.ok(!nodes.some(n => n.type === 'button'));
});
