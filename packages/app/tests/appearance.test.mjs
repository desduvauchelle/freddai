import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observeAppearance } from '../src/appearance/system.ts';
function media(dark) {
 const callbacks = new Set();
 return { matches: dark,
  addEventListener(event, callback) { assert.equal(event, 'change'); callbacks.add(callback); },
  removeEventListener(event, callback) { assert.equal(event, 'change'); callbacks.delete(callback); },
  change(value) { this.matches = value; for(const cb of callbacks) cb(); },
  listeners() { return callbacks.size; },
 };
}
test('device appearance applies initially and follows both transition directions', () => {
 const source = media(false), values = [];
 const stop = observeAppearance(source, value => values.push(value));
 assert.deepEqual(values, ['light']);
 source.change(true); source.change(false);
 assert.deepEqual(values, ['light', 'dark', 'light']);
 stop(); assert.equal(source.listeners(), 0);
 source.change(true); assert.deepEqual(values, ['light', 'dark', 'light']);
});
test('dark startup and remount cleanup do not retain duplicate listeners', () => {
 const source = media(true), values = [];
 const stop = observeAppearance(source, value => values.push(value)); stop();
 const stopAgain = observeAppearance(source, value => values.push(value));
 assert.equal(source.listeners(), 1); source.change(false);
 assert.deepEqual(values, ['dark', 'dark', 'light']); stopAgain();
});
