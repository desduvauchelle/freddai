# Companion preview tunnel

Lets a paired phone/iPad load a web app running on the Mac at `http://localhost:<port>` inside the companion app, on Wi‑Fi or cellular, through the Freddai relay. The relay is a blind pipe: it never sees plaintext.

## Flow

1. An agent shares a localhost link (a `http://localhost:NNNN/...` or `http://127.0.0.1:NNNN/...` URL in a thread message, or the `freddai_share_preview` MCP tool). Mobile renders a **Preview** chip/card.
2. Tapping it calls the Tauri command `preview_open { threadId, url }` (mobile only).
3. The phone sends the existing companion RPC operation `preview_open { threadId, port, path }` (direct LAN or mailbox relay, whichever the RPC path already uses).
4. The Mac checks the **grant** (below). On success it mints `session` (32 random bytes hex), dials the relay tunnel as `role=mac`, and replies `{ session, port }`. On failure it replies with a named error (`preview_not_granted`, `preview_port_unreachable`, `preview_tunnel_unavailable`).
5. The phone dials the relay tunnel as `role=device` with the same `session`, starts a loopback HTTP server on `127.0.0.1:<random>` inside the app, and presents a native full‑screen web view on `http://127.0.0.1:<random><path>`.
6. Every HTTP request / WebSocket the web view makes to the loopback server is multiplexed as frames over the tunnel; the Mac executes it against `127.0.0.1:<port>`, rewriting `Host` (and `Origin`/`Referer` if present) to `localhost:<port>`.

## Grants (Mac)

The Mac proxies only to `127.0.0.1:<port>` and only when:
- the requesting device is paired (existing device registry), and
- the port is ≥ 1024, is not a Freddai port (49744 or any Freddai listener), and
- the port was shared: either recorded by `freddai_share_preview`, or a `localhost:<port>`/`127.0.0.1:<port>` URL appears in a message of `threadId`.

Grants live in memory in the companion-server process, keyed by port, expire after 12 h. `freddai_share_preview` runs in the background host, a different process, so it writes `companion/preview-grants.json` (owner-only, 12 h expiry) and the companion server imports it through `preview_host::grant_port(port, "mcp")` at the start of each `preview_open`.

`preview_open` runs outside the global companion dispatch gate (direct and relay paths) because dialing the relay can take up to 10 s. No other host is ever reachable through the tunnel.

## Relay endpoint

`GET wss://<relay>/v1/tunnels/<mailbox>/<session>?role=mac|device` with `Authorization: Bearer <token>`. It uses the same mailbox/token auth as `/v1/mailboxes`, where `sha256(token) == mailbox`.

Behaviour:
- **Pairing.** One `mac` socket and one `device` socket per `(mailbox, session)`. The first socket waits up to 30 s for its peer, then closes with code 4408. A third socket for an occupied role closes with code 4409.
- **Forwarding.** Binary messages are forwarded verbatim to the peer. Text messages are rejected with close code 4400. Messages over 1 MiB close with code 4413.
- **Closing.** When either side closes, the relay closes the other. A session closes after 10 min with no traffic.
- **Limits.** At most 4 concurrent sessions per mailbox. At most 512 pending sessions globally.
- **Logging.** Only counts and bytes are logged, never mailbox, session, headers or payloads.

## Frame encryption

Each WebSocket binary message has the form `nonce(12) || AES-256-GCM ciphertext`. The key is the device key, the same one `companion_crypto` uses.

AAD is `freddai-tunnel-v1:<session>:<dir>:<seq>`. `dir` is `m2d` or `d2m`. `seq` is a per-direction u64 counter starting at 0. The receiver tracks its expected seq, and any mismatch or authentication failure kills the tunnel loudly.

## Frame plaintext

`type u8 | stream u32 BE | payload`. Stream ids are chosen by the device: odd numbers, incrementing.

| type | name | dir | payload |
|---|---|---|---|
| 1 | REQ_HEAD | d2m | JSON `{method, path, headers:[[k,v]...]}` |
| 2 | BODY | both | raw bytes, ≤ 256 KiB per frame |
| 3 | END | both | empty: end of body for this stream |
| 4 | RES_HEAD | m2d | JSON `{status, headers:[[k,v]...]}` |
| 5 | WS_OPEN | d2m | JSON `{path, headers:[[k,v]...], protocols:[...]}` |
| 6 | WS_ACCEPT | m2d | JSON `{protocol?}` |
| 7 | WS_TEXT | both | UTF‑8 |
| 8 | WS_BINARY | both | bytes |
| 9 | WS_CLOSE | both | JSON `{code?, reason?}` |
| 10 | RESET | both | JSON `{error}`: abort this stream with a named error |
| 11 | PING / 12 PONG | both | empty, stream 0, every 20 s |

Header handling:
- Hop-by-hop headers are dropped in both directions: `connection`, `keep-alive`, `transfer-encoding`, `upgrade`, `proxy-*`, `te`, `trailer`.
- Response bodies stream as they arrive. There is no full buffering.

## Failures are loud

Every failure shows a visible line in the preview view, for example "Preview tunnel failed: preview_port_unreachable (nothing listening on 3000)", and logs a named event (`preview_tunnel_*`). This covers a failed relay dial, a refused grant, a refused connection on the Mac port, and a broken seq/auth check. There is no silent fallback.

## Limits / non-goals (v1)

- Works only while the companion app is in the foreground.
- No direct LAN fast path yet. All traffic goes through the relay.
- Only `localhost` / `127.0.0.1`. No LAN or other hosts.
