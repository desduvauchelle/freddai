# Freddai companion relay

An ephemeral encrypted mailbox service for paired Mac/iPhone devices. It has no provider integrations, account database, plaintext conversation access, or persistent message storage. Run **one replica** behind HTTPS; replicas do not share mailboxes. Restarting it discards in-flight messages. Clients report uncertain sends rather than replaying them automatically.

The deployed service is https://freddai-companion-relay-production.up.railway.app in the separate Railway project `freddai-companion-relay`. Railway terminates HTTPS and forwards to port 8787. The service uses the existing Railway workspace and incurs its normal hosting usage. `PORT=8787` is explicitly configured. Local Docker deployment: `docker build -t freddai-relay .` then `docker run --rm -p 8787:8787 freddai-relay`. Do not configure clients with an HTTP URL; the app accepts HTTPS origins only.

Each approved device has a random mailbox capability distinct from its end-to-end encryption key. Mailbox IDs are SHA-256 hashes of capabilities. Requests authenticate the capability over HTTPS; the relay never receives encryption keys or LAN bearer credentials. AES-256-GCM envelopes authenticate direction, device identity and request identity. Fresh nonces are generated with the OS RNG. Request expiry and durable mutation receipts on the Mac prevent replay across listener restarts. Revoked devices are checked again immediately before dispatch. The relay can observe traffic size, timing and mailbox identifiers and can drop messages. It cannot decrypt or forge authenticated device messages.

Only snapshot/start/reply/respond operations are allowed by the Mac. Pairing and credential exchange are **local only**, over the Mac's pinned private TLS authority. Codes expire after three minutes, allow at most five attempts, and require explicit Mac approval. The approval grant can be claimed once using the phone's independent 256-bit claim secret. Phone credentials are stored in iOS Keychain. The Mac registry is locked and stored with private filesystem permissions. No authentication credential is embedded in new iPhone builds; they retain this Mac's address and public TLS trust certificate. Initial discovery of other Macs is not implemented.

The server bounds message sizes, total retained ciphertext (64 MiB), mailbox counts, queue depths and request rates. Each mailbox permits 32 pending requests and retains up to 4096 total records, including completed replies for safe retries. Completed replies do not consume pending slots, so sequential file and dictation chunks can continue beyond 32 requests. Messages expire after 120 seconds; memory is swept every ten seconds. Body uploads are limited to eight at a time and 32 MiB globally. It keeps no payload/access logs. Avoid enabling proxy logs that capture authorization headers or bodies. A compromised relay can deny service; this personal relay is not a highly available service.

**Preview tunnel.** `GET /v1/tunnels/<mailbox>/<session>?role=mac|device` (WebSocket, `Authorization: Bearer <token>`, same auth as mailboxes; session is 64 hex) pairs one `mac` and one `device` socket and forwards binary messages verbatim (see `docs/preview-tunnel.md`). Close codes: 4408 peer did not arrive within 30 s, 4409 role already taken, 4400 text message, 4413 message over 1 MiB. Either side closing closes the other; 10 minutes without traffic closes the session. Limits: 4 sessions per mailbox, 512 pending globally; senders are paused when the peer's send buffer exceeds 4 MiB. Nothing about tunnels is logged. This adds the `ws` dependency, so the Docker build runs `npm ci --omit=dev`.

To configure the installed Mac without touching providers:

```sh
'/Applications/Freddai.app/Contents/MacOS/freddai-native' --companion-relay \
  "$HOME/Library/Application Support/com.freddai.desktop" \
  https://freddai-companion-relay-production.up.railway.app
```

Alternatively save the relay address in Mac Settings → iPhone connection. Connect a paired phone locally once after changing the address so it learns the new address. On a different network, the phone tries a local snapshot then the internet relay. Once the relay is selected, sends use it directly. An uncertain local mutation is never automatically retried over a second transport. The Mac must remain awake, online and logged in with the companion listener running; this is not remote wake or push notification support.

Checks:

```sh
node --test services/relay/server.test.mjs
node services/relay/smoke.mjs https://freddai-companion-relay-production.up.railway.app
cargo test -p freddai-native --lib
```

The smoke test uses ephemeral synthetic device material and sends no user data or provider turns. Device pairing and cellular operation must still be accepted on the actual phone; relay transport tests alone do not establish that acceptance.
