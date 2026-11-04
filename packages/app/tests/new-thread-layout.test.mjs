import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Evaluate the actual JSX visibility gate, without mounting provider/account services.
const source = readFileSync(new URL('../src/desktop/DesktopApp.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('DesktopApp.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let gate;
function visit(node) {
  if (ts.isJsxExpression(node) && node.expression && node.getText(ast).includes('conversation(side)')) {
    const expression = node.expression;
    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
      gate = expression.left.getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(gate, 'conversation panel visibility gate exists');
const visible = new Function('task', 'splitActive', 'dialog', 'pane', `return Boolean(${gate});`);

test('New Thread hides the previous conversation in single and split views', () => {
  for (const split of [false, true])
    assert.equal(visible({ id: 'previous' }, split, 'new', null), false);
});

test('closing New Thread restores the selected conversation and explicit split view', () => {
  assert.equal(visible({ id: 'previous' }, false, null, null), true);
  assert.equal(visible(null, true, null, null), true);
  assert.equal(visible(null, false, null, null), false);
  assert.equal(visible({ id: 'previous' }, true, null, { kind: 'git' }), false);
});

// Evaluate the real "nothing open" rule that opens the draft pane beside the list.
const autoOpen = source.match(/if \(([^\n]+)\) openNewThread\(false\);/)?.[1];
assert.ok(autoOpen, 'auto-open new-thread rule exists');
const opens = new Function('narrow', 'selected', 'dialog', 'pane', 'threadDialog', 'launching', `return Boolean(${autoOpen});`);

test('wide window with no selection opens the new-thread draft pane', () => {
  assert.equal(opens(false, '', null, null, null, null), true);
});

test('mobile width with no selection stays list-only', () => {
  assert.equal(opens(true, '', null, null, null, null), false);
});

test('selected thread, git pane, other dialogs, and launches are left alone', () => {
  assert.equal(opens(false, 'thread', null, null, null, null), false);
  assert.equal(opens(false, '', null, { kind: 'git' }, null, null), false);
  assert.equal(opens(false, '', 'settings', null, null, null), false);
  assert.equal(opens(false, '', null, null, null, { id: 'pending-launch' }), false);
});

test('the single-pane breakpoint is phone-width, not tablet-width', () => {
  assert.match(source, /matchMedia\("\(max-width: 720px\)"\)/);
});
