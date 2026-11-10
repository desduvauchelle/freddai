// Synthetic transport check: never connects to a Mac or invokes a provider.
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
const origin = process.argv[2];
if (!origin?.startsWith('https://')) throw new Error('Pass the HTTPS relay origin');
const secret = randomBytes(32).toString('hex'), key = randomBytes(32), device = randomBytes(32).toString('hex'), id = randomBytes(32).toString('hex');
const base = `${origin}/v1/mailboxes/${createHash('sha256').update(secret).digest('hex')}`;
function seal(direction, value, requestId = id) { const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(Buffer.from(`${direction}:${device}:${requestId}`)); const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]); return { nonce: nonce.toString('hex'), ciphertext: data.toString('hex') }; }
function open(direction, envelope, requestId = id) { const data = Buffer.from(envelope.ciphertext, 'hex'), cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'hex')); cipher.setAAD(Buffer.from(`${direction}:${device}:${requestId}`)); cipher.setAuthTag(data.subarray(-16)); return JSON.parse(Buffer.concat([cipher.update(data.subarray(0, -16)), cipher.final()]).toString()); }
async function call(path, method = 'GET', body, token = secret) { return fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }); }
assert.equal((await fetch(`${origin}/health`)).status, 200);
assert.equal((await call('/requests', 'GET', undefined, randomBytes(32).toString('hex'))).status, 401);
const request = { id, route: '/v1/snapshot', body: {}, expires: Math.floor(Date.now() / 1000) + 90 };
assert.equal((await call(`/requests/${id}`, 'POST', { id, envelope: seal('request', request) })).status, 200);
const requests = await (await call('/requests')).json();
assert.equal(requests.length, 1); assert.deepEqual(open('request', requests[0].envelope), request);
assert.ok(!JSON.stringify(requests).includes('/v1/snapshot'));
const response = { result: { projects: [], threads: [] } };
assert.equal((await call(`/responses/${id}`, 'POST', { id, envelope: seal('response', response) })).status, 200);
const reply = await (await call(`/responses/${id}`)).json(); assert.deepEqual(open('response', reply.envelope), response);
assert.deepEqual(await (await call('/requests')).json(), []);
console.log('HTTPS relay authentication and encrypted request/response round trip passed (synthetic data).');

// Exercise enough sequential chunks to catch completed replies filling pending slots.
for (let step = 0; step < 34; step++) {
  const chunkId = randomBytes(32).toString('hex');
  const chunk = { route: '/v1/composer', body: { operation: 'upload', input: { action: 'chunk', offset: step * 24 * 1024, data: randomBytes(24 * 1024).toString('hex') } } };
  assert.equal((await call(`/requests/${chunkId}`, 'POST', { id: chunkId, envelope: seal('request', chunk, chunkId) })).status, 200, `remote upload step ${step}`);
  const result = { result: true };
  assert.equal((await call(`/responses/${chunkId}`, 'POST', { id: chunkId, envelope: seal('response', result, chunkId) })).status, 200);
  const completed = await (await call(`/responses/${chunkId}`)).json();
  assert.deepEqual(open('response', completed.envelope, chunkId), result);
}
console.log('HTTPS encrypted chunked-upload regression passed beyond 32 completed requests (synthetic data; no Mac/provider invoked).');
