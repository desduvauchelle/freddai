# Streaming investigation — November 4, 2026

The initial investigation below made no application changes. The subsequently authorized fix is recorded at the end.

## Confirmed running-path bottleneck

Read-only calls to the existing `host.sock`, using protocol version `2`, returned:

| Request | Result | Elapsed | Response size |
| --- | --- | --- | --- |
| `hello` | Existing cached host identified | 0.16 ms | 230 bytes |
| `snapshot_since {revision:0, hostId:null}` | `Unknown host command: snapshot_since` | 0.07 ms | 49 bytes |
| `snapshot` | Full database, 45 sessions | 1450.85 ms | 15,203,122 bytes |

No response content was printed or saved; only timing, size, capability and session count were inspected.

The running host executable SHA-256 was `69d6973019b8b7f9af60c750dd4bd66103d61ad701469051354af06d257734df`; the installed executable was `58411df452b8f7d36fe00c94bc91cd2e16f070f8f4358a76dd9deb1ea2103a05`. This establishes a host/install mismatch, not that the installed build has been live-tested.

The actual path is `DesktopApp.fetchSnapshot` → native `rpc` → local host. Native `rpc` catches the unsupported incremental command and calls full `snapshot`, marking the reply `full:true`, revision `0`, host `legacy`. The desktop schedules its next poll 350 ms **after** the current fetch and processing finish, rather than every 350 ms regardless of cost. Every fallback transports and parses all conversation history again.

Existing `~/Library/Logs/Freddai/native.log` contained 278 `tauri_snapshot` measurements at inspection time: median RPC 1308.26 ms, p95 2134.08 ms, maximum 3435.21 ms. The 277 recorded intervals between call starts had median 1977.0 ms, p95 2836.3 ms, maximum 4193.8 ms. Almost all RPC duration was in the host call, with negligible blocking-worker queue time. These measurements establish substantial application-side overhead; they do not reproduce or fully explain one word every ten seconds. The log had no `provider_line` or `delta_applied` events, so provider-generation cadence cannot be established from it.

Current source already implements incremental snapshots and 750 ms debounced streaming persistence (`crates/core/src/runtime.rs`), structural sharing and markdown block memoization. Those source-level improvements must not be described as verified in the currently running host. Incremental snapshots still send an entire changed session, including its accumulated history; they are not individual text deltas.

## Orca comparison

Inspected fresh shallow checkout of `stablyai/orca`, commit `23ee7f46b1e2d26357671901fa16fc6540d481d4`. No reference code copied or executed.

- `src/main/ipc/pty/delivery/constants.ts`: 2 ms batching interval, 16 Ki-character flush chunks, two writes per flush, 1 ms continuation, and explicit per-terminal/global in-flight limits. These are scheduling constants, not measured end-to-end latency guarantees.
- `src/main/ipc/pty/delivery/accept.ts`: buffers arriving terminal data and schedules batch flushes; eligible interactive output can take the immediate delivery path.
- `src/main/ipc/pty/delivery/payload.ts`: pushes `pty:data` events through Electron IPC, accounting for bytes in flight.
- `src/preload/api/pty-bridge-stream-and-serialization.ts`: exposes a push subscription to those data events.
- `src/renderer/src/components/terminal-pane/pty-dispatcher.ts`: dispatches each terminal's data directly to its handler, before sidecar observers, with deferred consumption acknowledgement.

Orca's terminal hot path moves new terminal output and applies backpressure. Freddai's conversation hot path polls structured state, and the current older host forces full-database transport. This architectural distinction matters more than simply decreasing our polling timer. Terminal paint and structured conversation rendering are different workloads; no same-provider generation-speed comparison was performed.

## Additional source finding: Claude partial output

`Runtime::run_turn` requests Claude `--output-format stream-json`, but does not request `--include-partial-messages`. `run_protocol` handles `type:assistant` content blocks and does not handle `stream_event` / `content_block_delta` / `text_delta`. Thus the current implementation has no Claude partial-text rendering path. The installed CLI's event contract and message identity/final-message reconciliation need synthetic validation before implementing that path. This is separate from the confirmed legacy-host transport overhead and is not established as the user's affected provider.

## Next implementation priorities and verification limits

1. Ensure the updated host takes over through the existing idle-upgrade handshake when active work permits. Verify `snapshot_since` succeeds and successive unchanged requests are small. Preserve active agents; a GUI relaunch alone is not proof that its detached host upgraded.
2. Measure provider-line arrival → in-memory update → UI paint under synthetic timed output. Exact ten-second word cadence has not been reproduced, and no live provider turn was used as a fixture.
3. Replace conversation polling on the active-output path with ordered, resumable message/session delta notifications and bounded batching; keep snapshots for initial sync/recovery. Measure before committing to timer values.
4. Add Claude partial-message handling with synthetic initialization, delta, final-message, tool and resume fixtures, preventing duplicate text.

Source: unchanged. Checks: read-only socket measurements, existing-log statistics, executable hashes, and both source paths inspected. Build/signature/install: not performed in this investigation because no application change was made. Launch: not attempted; running host and active work preserved. Live-provider verification: not performed. Existing performance tests do not establish token-to-paint latency.

## Authorized fix and verification

Implemented serialized idle-host upgrade retries on incremental polls, throttled to once per five seconds. Busy hosts retain the compatibility fallback and active work; successful startup checks the expected executable identity. Added Claude partial-message CLI output and text projection onto the final message's block keys; final assistant messages replace partial text instead of duplicating it. Other providers retain their existing streaming handlers. Poll timing remains 350 ms, and changed sessions still travel as session bodies rather than individual transport-level text patches.

Before/after regressions: `cargo test -p freddai-core claude_process_roundtrip_and_approval -- --nocapture` initially failed with `None` versus `Some("Hello ")` before provider completion, then passed with partial text visible and a single final message. `cargo test -p freddai-native incremental_poll_retries_idle_upgrade -- --nocapture` initially failed with `missing request hello`, then passed, including a busy-host refusal and cooldown check.

Validation passed: workspace typechecks; 86 Node logic tests; 15 Vitest tests; 75 Rust core and 24 native unit tests; two core host integration tests. `cargo test -p freddai-native legacy_host_upgrades_to_installed_streaming_host -- --ignored --nocapture` additionally passed against the installed signed binary in a separate temporary workspace with no connected accounts. It exercises successful legacy-host upgrade and a 45-session synthetic history: full JSON result 16,225,172 bytes; unchanged JSON result 278 bytes, 0.34 ms. No real host was terminated by this fixture, and these timings do not establish provider-generation speed or end-to-end UI latency.

Build, signature and install completed through `pnpm native:install`, using existing Developer ID Denis Duvauchelle (BSH2UEDLU5), with strict installed signature verification. GUI relaunch is pending because the approved `orca` control command is unavailable. Existing GUI and agent host still map older bundles. Save drafts, let active work finish, quit normally, and reopen `/Applications/Freddai.app`. Live-provider and running-updated-window verification were not performed.
