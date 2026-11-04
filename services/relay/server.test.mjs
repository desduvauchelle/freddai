import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { createRelay } from './server.mjs';
test('mailboxes authenticate, isolate devices, preserve retries and only carry ciphertext', async () => {
  const server = createRelay(); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const token = randomBytes(32).toString('hex'), mailbox = createHash('sha256').update(token).digest('hex');
  const base = `http://127.0.0.1:${server.address().port}/v1/mailboxes/${mailbox}`;
  const call = (path, method = 'GET', body, auth = token) => fetch(base + path, { method, headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const id = randomBytes(32).toString('hex'), envelope = { nonce: randomBytes(12).toString('hex'), ciphertext: randomBytes(32).toString('hex') };
  try {
    assert.equal((await call('/requests', 'GET', undefined, randomBytes(32).toString('hex'))).status, 401);
    assert.equal((await call(`/requests/${id}`, 'POST', { id, prompt: 'plaintext' })).status, 400);
    assert.equal((await call(`/requests/${id}`, 'POST', { id, envelope, extra: 'discard' })).status, 200);
    assert.deepEqual(await (await call('/requests')).json(), [{ id, envelope }]);
    assert.equal((await call(`/responses/${id}`)).status, 202);
    assert.equal((await call(`/responses/${id}`, 'POST', { id, envelope })).status, 200);
    assert.deepEqual(await (await call('/requests')).json(), []);
    assert.equal((await call(`/requests/${id}`, 'POST', { id, envelope })).status, 200);
    assert.deepEqual(await (await call('/requests')).json(), []);
    assert.deepEqual(await (await call(`/responses/${id}`)).json(), { id, envelope });
    assert.equal((await call(`/responses/${randomBytes(32).toString('hex')}`, 'POST', { id, envelope })).status, 404);
  } finally { await new Promise(r => server.close(r)); }
});
