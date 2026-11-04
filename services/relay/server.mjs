// An ephemeral ciphertext mailbox. Run one replica behind an HTTPS reverse proxy.
// Never log request headers, mailbox identifiers, or payloads.
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const TTL = 120_000, MAX_BYTES = 64 * 1024 * 1024, REQUEST_LIMIT = 300 * 1024, RESPONSE_LIMIT = 16 * 1024 * 1024;
const hex64 = /^[a-f0-9]{64}$/;
const envelopeValid = e => e && /^[a-f0-9]{24}$/.test(e.nonce) && typeof e.ciphertext === 'string' && e.ciphertext.length >= 32 && e.ciphertext.length % 2 === 0 && /^[a-f0-9]+$/.test(e.ciphertext);
export function createRelay() {
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
      const hash = createHash('sha256').update(token).digest('hex');
      if (!hex64.test(token) || !timingSafeEqual(Buffer.from(hash), Buffer.from(mailbox))) return send(401, { error: 'Unauthorized' });
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
        if (bytes + size > MAX_BYTES || (!box && boxes.size >= 1024) || (box?.size || 0) >= 32) return send(503, { error: 'Busy' });
        if (!box) boxes.set(mailbox, box = new Map());
        box.set(id, { request: data, response: null, size, expires: Date.now() + TTL }); bytes += size;
      }
      send(200, { accepted: true });
    } catch { if (!res.headersSent) send(400, { error: 'Invalid request' }); else res.end(); }
  });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000; server.maxConnections = 256;
  server.on('close', () => clearInterval(timer));
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createRelay();
  server.listen(Number(process.env.PORT || 8787), process.env.HOST || '0.0.0.0');
  process.on('SIGTERM', () => { server.close(); setTimeout(() => process.exit(0), 5000).unref(); });
}
