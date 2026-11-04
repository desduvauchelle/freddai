import { test } from 'node:test';
import assert from 'node:assert/strict';
import { savedPermissionMode } from '../src/desktop/permission-mode.ts';
test('legacy threads display the host approval default instead of claiming full access', () => {
  assert.equal(savedPermissionMode(), 'ask');
  assert.equal(savedPermissionMode(null), 'ask');
  assert.equal(savedPermissionMode('ask'), 'ask');
  assert.equal(savedPermissionMode('bypass'), 'bypass');
});
