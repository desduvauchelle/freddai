// An ephemeral ciphertext mailbox. Run one replica behind an HTTPS reverse proxy.
// Never log request headers, mailbox identifiers, or payloads.
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
const TTL = 120_000, MAX_BYTES = 64 * 1024 * 1024, REQUEST_LIMIT = 300 * 1024, RESPONSE_LIMIT = 16 * 1024 * 1024;
const hex64 = /^[a-f0-9]{64}$/;
const envelopeValid = e => e && /^[a-f0-9]{24}$/.test(e.nonce) && typeof e.ciphertext === 'string' && e.ciphertext.length >= 32 && e.ciphertext.length % 2 === 0 && /^[a-f0-9]+$/.test(e.ciphertext);
const TUNNEL_DEFAULTS = { pairTimeoutMs: 30_000, idleTimeoutMs: 600_000, maxMessage: 1024 * 1024, maxSessionsPerMailbox: 4, maxPending: 512, highWater: 4 * 1024 * 1024, lowWater: 1024 * 1024, queueLimit: 4 * 1024 * 1024 };
const authorized = (token, mailbox) => hex64.test(token) && timingSafeEqual(Buffer.from(createHash('sha256').update(token).digest('hex')), Buffer.from(mailbox));
const closable = code => (code >= 1000 && code <= 1011 && ![1004, 1005, 1006].includes(code)) || (code >= 3000 && code <= 4999);
export function createRelay(options = {}) {
  const T = { ...TUNNEL_DEFAULTS, ...options };
  const boxes = new Map(), rates = new Map();
  let bytes = 0, uploadBytes = 0, activeUploads = 0;
  function sweep() {
    const now = Date.now();
    for (const [key, box] of boxes) {
      for (const [id, record] of box) if (record.expires <= now) { bytes -= record.size; box.delete(id); }
      if (!box.size) boxes.delete(key);
    }
    for (const [ip, rate] of rates) if (rate.until <= now) rates.delete(ip);
  }
  const timer = setInterval(sweep, 10_000); timer.unref();
  const server = createServer(async (req, res) => {
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      sweep();
      if (req.url === '/health' && req.method === 'GET') return send(200, { ok: true });
      const ip = req.socket.remoteAddress;
      let rate = rates.get(ip);
      if (!rate) { if (rates.size >= 4096) return send(503, { error: 'Busy' }); rates.set(ip, rate = { until: Date.now() + 60_000, count: 0 }); }
      if (++rate.count > 3000) return send(429, { error: 'Too many requests' });
      const match = /^\/v1\/mailboxes\/([a-f0-9]{64})\/(requests|responses)(?:\/([a-f0-9]{64}))?$/.exec(req.url || '');
      if (!match) return send(404, { error: 'Unknown route' });
      const [, mailbox, kind, id] = match;
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      if (!authorized(token, mailbox)) return send(401, { error: 'Unauthorized' });
      let box = boxes.get(mailbox);
      if (req.method === 'GET') {
        if (kind === 'requests' && !id) return send(200, [...(box?.values() || [])].filter(r => !r.response).slice(0, 16).map(r => r.request));
        if (kind === 'responses' && id) { const record = box?.get(id); return record?.response ? send(200, record.response) : send(202, { waiting: true }); }
        return send(404, { error: 'Unknown route' });
      }
      if (req.method !== 'POST' || !id) return send(404, { error: 'Unknown route' });
      if (kind === 'responses' && !box?.has(id)) return send(404, { error: 'Request expired' });
      if (activeUploads >= 8) return send(503, { error: 'Busy' });
      const limit = kind === 'requests' ? REQUEST_LIMIT : RESPONSE_LIMIT;
      if (Number(req.headers['content-length']) > limit) return send(413, { error: 'Too large' });
      let size = 0; const chunks = [];
      activeUploads++;
      try {
        for await (const chunk of req) {
          if (size + chunk.length > limit || uploadBytes + chunk.length > 32 * 1024 * 1024) { send(413, { error: 'Too large' }); req.destroy(); return; }
          size += chunk.length; uploadBytes += chunk.length; chunks.push(chunk);
        }
      } finally { activeUploads--; uploadBytes -= size; }
      let data; try { data = JSON.parse(Buffer.concat(chunks).toString()); } catch { return send(400, { error: 'Invalid JSON' }); }
      if (data.id !== id || !envelopeValid(data.envelope)) return send(400, { error: 'Invalid envelope' });
      // Only retain the protocol fields; arbitrary extra data never enters storage.
      data = { id, envelope: { nonce: data.envelope.nonce, ciphertext: data.envelope.ciphertext } };
      box = boxes.get(mailbox); // Body streaming yielded; sweep or another request may have changed it.
      if (kind === 'responses') {
        const record = box?.get(id);
        if (!record) return send(404, { error: 'Request expired' });
        if (record.response) return send(200, { accepted: true });
        const responseSize = Buffer.byteLength(JSON.stringify(data));
        if (bytes - record.size + responseSize > MAX_BYTES) return send(503, { error: 'Busy' });
        bytes += responseSize - record.size; record.size = responseSize; record.request = null; record.response = data;
      } else {
        if (box?.has(id)) return send(200, { accepted: true });
        // Completed replies must remain available for safe retries, but they are
        // no longer queued work. Counting them against the 32 pending slots
        // prevented chunked file/voice uploads from advancing past step 32.
        const pending = box ? [...box.values()].filter(record => !record.response).length : 0;
        if (bytes + size > MAX_BYTES || (!box && boxes.size >= 1024) || pending >= 32 || (box?.size || 0) >= 4096) return send(503, { error: 'Busy' });
        if (!box) boxes.set(mailbox, box = new Map());
        box.set(id, { request: data, response: null, size, expires: Date.now() + TTL }); bytes += size;
      }
      send(200, { accepted: true });
    } catch { if (!res.headersSent) send(400, { error: 'Invalid request' }); else res.end(); }
  });

  // Preview tunnel: pairs one 'mac' and one 'device' socket per (mailbox, session)
  // and forwards binary messages verbatim. Nothing here is ever logged.
  const sessions = new Map(), perMailbox = new Map();
  let pending = 0;
  const wss = new WebSocketServer({ noServer: true, maxPayload: T.maxMessage, perMessageDeflate: false });
  function endSession(key, s, code, except) {
    if (s.ended) return; s.ended = true;
    clearTimeout(s.pairTimer); clearTimeout(s.idleTimer);
    if (!s.paired) pending--;
    sessions.delete(key);
    const n = (perMailbox.get(s.mailbox) || 1) - 1; if (n > 0) perMailbox.set(s.mailbox, n); else perMailbox.delete(s.mailbox);
    for (const ws of Object.values(s.sockets)) if (ws !== except && ws.readyState <= 1) ws.close(closable(code) ? code : 1000);
  }
  function attach(ws, key, mailbox, role) {
    ws.on('error', () => {});
    // ws closes with 1009 when a frame exceeds maxPayload; the contract says 4413.
    const close = ws.close.bind(ws); ws.close = (code, reason) => close(code === 1009 ? 4413 : code, reason);
    let s = sessions.get(key);
    if (s?.sockets[role]) return ws.close(4409);
    if (!s) {
      s = { mailbox, sockets: {}, paired: false, queue: [], queued: 0, ended: false };
      sessions.set(key, s); pending++; perMailbox.set(mailbox, (perMailbox.get(mailbox) || 0) + 1);
      s.pairTimer = setTimeout(() => endSession(key, s, 4408), T.pairTimeoutMs);
    }
    s.sockets[role] = ws;
    const peerOf = () => s.sockets[role === 'mac' ? 'device' : 'mac'];
    const touch = () => { clearTimeout(s.idleTimer); s.idleTimer = setTimeout(() => endSession(key, s, 1001), T.idleTimeoutMs); };
    const push = (to, buf) => {
      to.send(buf, { binary: true }, () => { if (ws._paused && to.bufferedAmount < T.lowWater) { ws._paused = false; ws._socket?.resume(); } });
      if (to.bufferedAmount > T.highWater && !ws._paused) { ws._paused = true; ws._socket?.pause(); }
    };
    if (s.sockets.mac && s.sockets.device) {
      s.paired = true; pending--; clearTimeout(s.pairTimer); touch();
      for (const [from, buf] of s.queue) { const to = s.sockets[from === 'mac' ? 'device' : 'mac']; to.send(buf, { binary: true }); }
      s.queue = []; s.queued = 0;
    }
    ws.on('message', (data, isBinary) => {
      if (!isBinary) return ws.close(4400);
      if (data.length > T.maxMessage) return ws.close(4413);
      if (s.paired) { touch(); return push(peerOf(), data); }
      if ((s.queued += data.length) > T.queueLimit) return ws.close(4413);
      s.queue.push([role, data]);
    });
    ws.on('close', code => endSession(key, s, code, ws));
  }
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    const deny = (status, text) => socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    const match = /^\/v1\/tunnels\/([a-f0-9]{64})\/([a-f0-9]{64})\?role=(mac|device)$/.exec(req.url || '');
    if (!match) return deny(404, 'Not Found');
    const [, mailbox, session, role] = match;
    if (!authorized((req.headers.authorization || '').replace(/^Bearer /, ''), mailbox)) return deny(401, 'Unauthorized');
    const key = `${mailbox}/${session}`, existing = sessions.get(key);
    if (!existing) {
      if ((perMailbox.get(mailbox) || 0) >= T.maxSessionsPerMailbox) return deny(429, 'Too Many Requests');
      if (pending >= T.maxPending) return deny(503, 'Service Unavailable');
    }
    wss.handleUpgrade(req, socket, head, ws => attach(ws, key, mailbox, role));
  });
  const closeServer = server.close.bind(server);
  server.close = cb => { for (const [key, s] of [...sessions]) { endSession(key, s, 1001); for (const ws of Object.values(s.sockets)) ws.terminate(); } return closeServer(cb); };
  server.requestTimeout = 15_000; server.headersTimeout = 10_000; server.maxConnections = 256;
  server.on('close', () => clearInterval(timer));
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createRelay();
  server.listen(Number(process.env.PORT || 8787), process.env.HOST || '0.0.0.0');
  process.on('SIGTERM', () => { server.close(); setTimeout(() => process.exit(0), 5000).unref(); });
}
