import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/desktop/DesktopApp.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('DesktopApp.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const panels = [];
function visit(node) {
  if (ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === 'ResizablePanel') panels.push(node);
  ts.forEachChild(node, visit);
}
visit(ast);
const attr = (node, name) => node.attributes.properties.find(p => p.name?.getText(ast) === name)?.initializer?.getText(ast);

test('thread list and every outer detail branch keep stable identities when switching threads', () => {
  const outer = panels.filter(p => attr(p, 'defaultSize') !== '"50%"');
  assert.deepEqual(outer.map(p => attr(p, 'id')), ['"thread-list"', '"thread-detail"', '"thread-detail"', '"thread-detail"']);
});

test('desktop restores a local layout and saves only explicit user resizing', () => {
  assert.match(source, /useDefaultLayout\(\{\s*id: windowThread \? "freddai.thread-window-panes" : "freddai.thread-panes",\s*onlySaveAfterUserInteractions: true/);
  assert.match(source, /ResizablePanelGroup orientation="horizontal" defaultLayout=\{threadPaneLayout.defaultLayout\} onLayoutChanged=\{threadPaneLayout.onLayoutChanged\}/);
});
