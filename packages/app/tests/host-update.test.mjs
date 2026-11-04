import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostUpdateNotice, shouldSurfacePollError, HOST_UPDATE_NOTICE } from '../src/desktop/host-update.ts';

test('notice only while the host update is pending', () => {
  assert.equal(hostUpdateNotice({ host_update_pending: true }), HOST_UPDATE_NOTICE);
  assert.equal(hostUpdateNotice({ host_update_pending: false }), null);
  assert.equal(hostUpdateNotice({}), null);
  assert.equal(hostUpdateNotice(null), null);
});

test('transient poll failures during a host restart stay silent', () => {
  assert.equal(shouldSurfacePollError(1), false);
  assert.equal(shouldSurfacePollError(2), false);
  assert.equal(shouldSurfacePollError(3), true);
});
