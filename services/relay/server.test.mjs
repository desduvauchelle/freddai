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

test('sequential attachment and dictation chunks do not exhaust a mailbox with completed replies', async () => {
  const server = createRelay(); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const token = randomBytes(32).toString('hex'), mailbox = createHash('sha256').update(token).digest('hex');
  const base = `http://127.0.0.1:${server.address().port}/v1/mailboxes/${mailbox}`;
  const call = (path, method = 'GET', body) => fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  try {
    // Native uploads await begin, every 24 KiB chunk, then finish/transcribe.
    // A 1 MiB recording already needs more than 32 request/response pairs.
    for (let chunk = 0; chunk < 46; chunk++) {
      const id = randomBytes(32).toString('hex');
      const request = { id, envelope: { nonce: randomBytes(12).toString('hex'), ciphertext: randomBytes(48 * 1024).toString('hex') } };
      const response = { id, envelope: { nonce: randomBytes(12).toString('hex'), ciphertext: randomBytes(32).toString('hex') } };
      assert.equal((await call(`/requests/${id}`, 'POST', request)).status, 200, `upload step ${chunk} must be accepted`);
      assert.equal((await call(`/responses/${id}`, 'POST', response)).status, 200);
      assert.deepEqual(await (await call(`/responses/${id}`)).json(), response);
      // Preserve an acknowledged response for retries without replaying its mutation.
      assert.equal((await call(`/requests/${id}`, 'POST', request)).status, 200);
      assert.deepEqual(await (await call('/requests')).json(), []);
    }
  } finally { await new Promise(r => server.close(r)); }
});

test('mailbox still rejects more than 32 pending requests', async () => {
  const server = createRelay(); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const token = randomBytes(32).toString('hex'), mailbox = createHash('sha256').update(token).digest('hex');
  const base = `http://127.0.0.1:${server.address().port}/v1/mailboxes/${mailbox}`;
  try {
    for (let pending = 0; pending < 33; pending++) {
      const id = randomBytes(32).toString('hex');
      const response = await fetch(`${base}/requests/${id}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id, envelope: { nonce: randomBytes(12).toString('hex'), ciphertext: randomBytes(32).toString('hex') } }) });
      assert.equal(response.status, pending < 32 ? 200 : 503);
    }
  } finally { await new Promise(r => server.close(r)); }
});

// ---- Preview tunnel ----
import { WebSocket } from 'ws';
const hexId = () => randomBytes(32).toString('hex');
async function tunnelEnv(options) {
  const server = createRelay(options); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const token = hexId(), mailbox = createHash('sha256').update(token).digest('hex'), port = server.address().port;
  const dial = (role, session, auth = token, box = mailbox) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/tunnels/${box}/${session}?role=${role}`, { headers: { Authorization: `Bearer ${auth}` } });
    ws.closed = new Promise(r => ws.on('close', code => r(code))); ws.on('error', () => {});
    ws.opened = new Promise((res, rej) => { ws.on('open', res); ws.on('unexpected-response', (_q, r) => rej(Object.assign(new Error('http'), { status: r.statusCode }))); ws.on('error', rej); });
    return ws;
  };
  const stop = async () => { await new Promise(r => server.close(r)); };
  return { server, token, mailbox, dial, stop };
}
const once = (ws, ev) => new Promise(r => ws.once(ev, (...a) => r(a)));

test('tunnel pairs mac and device and forwards binary verbatim both ways', async () => {
  const env = await tunnelEnv(); const session = hexId();
  try {
    const mac = env.dial('mac', session), device = env.dial('device', session);
    await Promise.all([mac.opened, device.opened]);
    const a = randomBytes(5000), b = Buffer.from([0, 1, 2, 255]);
    const gotMac = once(mac, 'message'); device.send(a);
    const [m, isBin] = await gotMac; assert.ok(isBin); assert.deepEqual(m, a);
    const gotDev = once(device, 'message'); mac.send(b);
    assert.deepEqual((await gotDev)[0], b);
    mac.close(1000); assert.equal(await device.closed, 1000);
  } finally { await env.stop(); }
});

test('tunnel rejects bad token with HTTP 401 before upgrading', async () => {
  const env = await tunnelEnv();
  try {
    const bad = env.dial('mac', hexId(), hexId());
    await assert.rejects(bad.opened, e => e.status === 401);
    const malformed = env.dial('mac', hexId(), 'nope');
    await assert.rejects(malformed.opened, e => e.status === 401);
  } finally { await env.stop(); }
});

test('tunnel closes lone socket with 4408 when peer never arrives', async () => {
  const env = await tunnelEnv({ pairTimeoutMs: 100 });
  try { const mac = env.dial('mac', hexId()); assert.equal(await mac.closed, 4408); } finally { await env.stop(); }
});

test('tunnel closes a duplicate role with 4409 and keeps the original', async () => {
  const env = await tunnelEnv(); const session = hexId();
  try {
    const mac = env.dial('mac', session); await mac.opened;
    const dup = env.dial('mac', session); assert.equal(await dup.closed, 4409);
    const device = env.dial('device', session); await device.opened;
    const got = once(device, 'message'); mac.send(Buffer.from('x')); assert.deepEqual((await got)[0], Buffer.from('x'));
    mac.close(1000); await device.closed;
  } finally { await env.stop(); }
});

test('tunnel rejects text with 4400 and oversize with 4413, closing the peer', async () => {
  const env = await tunnelEnv({ maxMessage: 1024 });
  try {
    let s = hexId(); let mac = env.dial('mac', s), device = env.dial('device', s); await Promise.all([mac.opened, device.opened]);
    mac.send('hello'); assert.equal(await mac.closed, 4400); await device.closed;
    s = hexId(); mac = env.dial('mac', s); device = env.dial('device', s); await Promise.all([mac.opened, device.opened]);
    mac.send(randomBytes(1025)); assert.equal(await mac.closed, 4413); await device.closed;
    s = hexId(); mac = env.dial('mac', s); device = env.dial('device', s); await Promise.all([mac.opened, device.opened]);
    mac.send(randomBytes(1024)); assert.deepEqual((await once(device, 'message'))[0].length, 1024);
    mac.close(); await device.closed;
  } finally { await env.stop(); }
});

test('tunnel propagates close code to the peer and idles out', async () => {
  const env = await tunnelEnv({ idleTimeoutMs: 150 });
  try {
    let s = hexId(); let mac = env.dial('mac', s), device = env.dial('device', s); await Promise.all([mac.opened, device.opened]);
    device.close(4001); assert.equal(await mac.closed, 4001);
    s = hexId(); mac = env.dial('mac', s); device = env.dial('device', s); await Promise.all([mac.opened, device.opened]);
    assert.equal(await mac.closed, 1001); await device.closed;
  } finally { await env.stop(); }
});

test('tunnel caps concurrent sessions per mailbox and frees slots on close', async () => {
  const env = await tunnelEnv({ maxSessionsPerMailbox: 2 });
  try {
    const a = env.dial('mac', hexId()), b = env.dial('mac', hexId()); await Promise.all([a.opened, b.opened]);
    await assert.rejects(env.dial('mac', hexId()).opened, e => e.status === 429);
    a.close(1000); await a.closed; await new Promise(r => setTimeout(r, 50));
    const c = env.dial('mac', hexId()); await c.opened; b.close(); c.close(); await Promise.all([b.closed, c.closed]);
  } finally { await env.stop(); }
});

test('tunnel caps pending sessions globally', async () => {
  const env = await tunnelEnv({ maxPending: 1 });
  try {
    const a = env.dial('mac', hexId()); await a.opened;
    await assert.rejects(env.dial('mac', hexId()).opened, e => e.status === 503);
    a.close(); await a.closed;
  } finally { await env.stop(); }
});
