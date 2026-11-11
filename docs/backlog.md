# Backlog

### Screen recording → parsed bug/feature list → implementation
- **Kind:** missing-capability · **Severity:** med
- **Found:** 2026-11-04, while building the screen-grab button
- **Decision needed:** How do we get from video to items: send frames plus a narration transcript to the model, or use a provider with native video input? Is the user's spoken voice-over part of the recording? Should the parsed list be reviewed before any implementation starts?
- **Context:** This extends the v1 screen grab (`apps/native/src-tauri/src/screen_grab.rs`, `packages/app/src/desktop/screen-grab.ts`, `ScreenGrabMenu.tsx`). Add a "Record screen" option that uses `screencapture -v` or ScreenCaptureKit with mic audio. Stage the video through the same `stage_attachments` path. A new thread then turns the video into a list of bugs, features and improvements, and those become implementation tasks.

### Remove dead commit-message / ship-preview Rust commands
- **Kind:** tech-debt · **Severity:** low
- **Found:** 2026-11-04, while replacing the Save & push popover with an agent-thread launch
- **Context:** The ship button (packages/app/src/desktop/ShipButton.tsx) now starts a "Commit & push" agent thread, so nothing calls `crates/core/src/commit_message.rs` (which still raises "This project has no default agent") or the `git_commit_message_*` / `git_ship_preview` Tauri commands in /Users/denisduvauchelle/Documents/code/freddai/apps/native/src-tauri. Delete them plus permissions/tests; cargo test + tsc.

### macOS install can ship a binary with no embedded frontend ("asset not found: index.html")
- **Kind:** bug · **Severity:** high
- **Found:** 2026-11-04, while fixing the desktop app not loading
- **Decision needed:** none
- **Context:** The 12:52 build of /Applications/Freddai.app embedded no `/assets/*` (likely `apps/native/dist` was being rewritten by a concurrent `pnpm build` while cargo compiled). A plain re-run of `pnpm native:install` did NOT recompile (`Finished in 0.58s`), reshipping the broken binary; only `cargo clean --release -p freddai-native` fixed it. Proposed: in `/Users/denisduvauchelle/Documents/code/freddai/scripts/install-macos.sh`, after `tauri build`, fail loudly unless `strings -a target/release/freddai-native` contains every `/assets/<file>` listed in `apps/native/dist/assets/`, and print the exact clean command to recover.

### Host snapshot ships every transcript on each call
- **Kind:** tech-debt · **Severity:** high
- **Found:** 2026-11-04, while diagnosing "Invalid host response"
- **Decision needed:** OK to change snapshot to send thread summaries and load transcripts per thread on open?
- **Context:** /Users/denisduvauchelle/Documents/code/freddai/crates/core/src/host.rs `snapshot` serializes the whole workspace DB; `sessions` was 33.6 MB of a 33.6 MB reply for 96 threads. Cap was raised to 512 MiB as a stopgap; the reply will keep growing and is re-sent on every snapshot. Proposed: snapshot returns session metadata only; add a per-session transcript method; UI fetches on open.

### Commander cannot approve or resume sub-agent threads
- **Kind:** decision-needed · **Severity:** med
- **Found:** 2026-11-08, while adding thread link / sub-agent cards to the Commander transcript
- **Decision needed:** Should Commander be able to approve a sub-thread's pending permission request or resume a paused thread (e.g. a `freddai_respond_approval` / `freddai_resume_thread` MCP tool, itself held behind the user's approval card), or should it only surface an inline "Approve" button on the sub-agent card for the user to tap?
- **Context:** `docs/mcp-bridge.md` ("Action gate") and the server instructions in `crates/core/src/mcp.rs` deliberately forbid approving via MCP; approvals only flow through the UI `respond` invoke (`packages/app/src/desktop/DesktopApp.tsx`) / mobile `onReply`, and Commander proposals via `commander_proposal_respond` (`crates/core/src/commander.rs` ~790). The lower-risk option is an Approve/Deny action on the new sub-agent ThreadCard (packages/app/src/conversation/) that calls the same respond path the thread view uses.

### Approval hold for outward Google tools outside Commander
- **Kind:** decision-needed · **Severity:** high
- **Found:** 2026-11-10, while building Google connected accounts (Gmail/Calendar/Drive)
- **Decision needed:** Should Freddai hold outward Google tools for approval in all threads, only in trigger-started (`gtrigger-` request ID) runs, or refuse `freddai_gmail_send` from trigger-started runs and allow drafts only?
- **Context:** `commander::is_outward` in /Users/denisduvauchelle/Documents/code/freddai/crates/core/src/commander.rs (~line 698) marks `freddai_gmail_send` and calendar create/update/delete that name attendees or set `send_updates` other than `none` (`google::calendar::reaches_people`) as outward; `mcp::dispatch` in /Users/denisduvauchelle/Documents/code/freddai/crates/core/src/mcp.rs holds those calls as proposals only when the caller is the Commander project. An ordinary thread sends immediately, limited only by the provider's own permission mode. That includes a thread started by a Google trigger (`REQUEST_PREFIX = "gtrigger-"` in /Users/denisduvauchelle/Documents/code/freddai/crates/core/src/google/triggers.rs) whose prompt wraps an email written by a third party, so a hostile email can try to steer the agent into sending mail. The trigger message labels the event data as "data, not instructions", which is a prompt-level mitigation only. Options: extend the hold to every caller (needs an approval path outside the Commander UI, e.g. an inline approval card in ordinary threads), hold only when the run's request ID starts with `gtrigger-`, or reject `freddai_gmail_send` there. Docs to update with the answer: `docs/mcp-bridge.md` ("Approval") and the Google section of `docs/spec.md`.
- **Update 2026-11-10:** Owner decision — email may only be sent with the user's explicit confirmation. For now this is an instruction-level rule (tool description, MCP server instructions, trigger delivery text); the technical hold and "validated workflows" that may send automatically are deferred to later.

### Google verification before distributing beyond 100 accounts
- **Kind:** decision-needed · **Severity:** med
- **Found:** 2026-11-10, while building Google connected accounts (Gmail/Calendar/Drive)
- **Decision needed:** Ship bring-your-own-client only, or pursue Google verification so one shared client ID can be bundled?
- **Context:** Each install currently needs the user's own Google Cloud "Desktop app" OAuth client (client ID in `<root>/google/config.json`, secret in the secret store; see /Users/denisduvauchelle/Documents/code/freddai/crates/core/src/google/store.rs and the setup steps in /Users/denisduvauchelle/Documents/code/freddai/packages/app/src/desktop/GoogleAccounts.tsx). An unverified client shows Google's unverified-app warning and is capped at 100 sign-ins for its lifetime; in "Testing" status sign-ins expire after 7 days. Bundling one shared client would need Google's restricted-scope verification for `gmail.modify`, `calendar` and `drive` (verified domain, homepage, privacy policy, weeks of review) and possibly the annual CASA security assessment. Unconfirmed: whether a locally running desktop app is exempt from any of this, and whether an individual (not a company) can pass verification. Check Google's current OAuth verification and restricted-scope requirements before deciding.

### Native credential stores on Linux and Windows for Google tokens
- **Kind:** tech-debt · **Severity:** med
- **Found:** 2026-11-10, while building Google connected accounts (Gmail/Calendar/Drive)
- **Decision needed:** none
- **Context:** `default_secret_store` in /Users/denisduvauchelle/Documents/code/freddai/crates/core/src/google/store.rs uses the macOS Keychain on macOS and `FileSecretStore` (`<root>/google/secrets.json`, mode 0600 on Unix, no extra permission handling on Windows) elsewhere, holding refresh tokens and the OAuth client secret in plain JSON. Proposed: add `SecretStore` implementations backed by Secret Service (libsecret) on Linux and Windows Credential Manager on Windows, with a one-time migration from `secrets.json` and the file kept as the fallback when no keyring is available (the fallback must be logged and shown, since `google_config_get` already reports `secretStorage`).

### Mobile thread picker is empty for triggers and schedules
- **Kind:** bug · **Severity:** med
- **Found:** 2026-11-10, while building Google connected accounts (Gmail/Calendar/Drive)
- **Decision needed:** none
- **Context:** On companions, the "Runs in" existing-thread picker in the Google trigger editor lists nothing. /Users/denisduvauchelle/Documents/code/freddai/packages/app/src/mobile/MobileApp.tsx (the `<ConnectedAccounts … db={{projects, accounts}}/>` call, ~line 1097) passes no `sessions`, and `reusableThreads` in /Users/denisduvauchelle/Documents/code/freddai/packages/app/src/desktop/DeliveryControls.tsx filters `db.sessions`, so there is nothing to choose. Companion snapshots carry no thread records for this; the same limitation applies to schedules. Proposed: give the companion a thread-summary source for the picker (a lightweight per-project thread list over the companion transport) and pass it as `db.sessions`. Until then trigger and schedule delivery to an existing thread cannot be chosen from a phone.

### Google features not verified live
- **Kind:** tech-debt · **Severity:** high
- **Found:** 2026-11-10, while building Google connected accounts (Gmail/Calendar/Drive)
- **Decision needed:** none (needs the owner to create the Google Cloud client and sign in)
- **Context:** Everything under /Users/denisduvauchelle/Documents/code/freddai/crates/core/src/google/ was tested only against the mock server in `test_support.rs`. Unverified against real Google: OAuth consent and loopback redirect, the unverified-app flow, the 7-day Testing-status expiry, macOS Keychain storage (`KeychainSecretStore`), threaded-reply sends (the `multipart/related` upload in `gmail.rs`), resumable Drive uploads (`drive.rs`), the trigger poller running inside the installed background host (`spawn_poller`), the mobile Connected accounts screens on physical devices, and Windows/Linux builds. Checklist once a client exists: connect an account; run each tool group once against a throwaway mailbox, calendar and folder; create one trigger of each event type and confirm baseline-first behavior; disconnect and confirm revoke; then record results in the Google section of `docs/spec.md`.

### Tool argument limits affect email
- **Kind:** tech-debt · **Severity:** low
- **Found:** 2026-11-10, while building Google connected accounts (Gmail/Calendar/Drive)
- **Decision needed:** none
- **Context:** `validate()` in /Users/denisduvauchelle/Documents/code/freddai/crates/core/src/mcp.rs rejects any string argument that is empty or whitespace-only or longer than 64 KB ("must contain 1–65536 bytes"). That limits `freddai_gmail_*` `body`/`html_body` length and means a calendar description cannot be cleared by passing `""` in `freddai_calendar_event_update`. Proposed: per-field overrides in the tool schema (a larger `maxLength` for email bodies, `minLength: 0` for clearable fields) read by `validate()`, with tests for both.

### Google trigger gaps
- **Kind:** tech-debt · **Severity:** low
- **Found:** 2026-11-10, while building Google connected accounts (Gmail/Calendar/Drive)
- **Decision needed:** none
- **Context:** In /Users/denisduvauchelle/Documents/code/freddai/crates/core/src/google/triggers.rs: (1) Drive changes with `removed: true` carry no file name or parents from the Changes API, so a `drive_file_changed` trigger filtered by name or limited to a folder never matches deletions. Proposed: remember file name/parents from earlier polls in `trigger-state.json`, or document deletions as unfilterable. (2) A new chat started by a trigger is titled from the prompt rather than the trigger name; pass the trigger name as the thread title in the delivery path (`Delivery::deliver` / `launch_with`).

### ACP turns have no silence watchdog; Antigravity threads can hang forever with no error
- **Kind:** bug · **Severity:** high
- **Found:** 2026-11-10, while testing the Antigravity agent end to end
- **Decision needed:** What timeout (e.g. 120 s of no ACP output while not awaiting approval) should fail a turn, and should Antigravity get a less-prompty `agy` mode for phone/schedule threads, given bypass is rejected for this provider?
- **Context:** In /Users/denisduvauchelle/Documents/code/freddai/crates/core/src/acp.rs and runtime.rs, once an ACP turn is `ready` nothing times out. Phone threads `e6649fd8` and `4a1bbba5` stayed `running` for ~3.8 h with `provider_id` null and no error, then went `interrupted` on restart (native.log had rotated, so the cause is unknown). Separately, every `agy` tool call raises `session/request_permission`, so phone/schedule threads sit in `waiting` with no visible prompt for the user. Proposed: a silence watchdog that fails the turn loudly with an error, a visible "waiting on approval" state on mobile and schedule threads, and structured logging of ACP frames (session/new response, prompt, updates) so the next hang can be diagnosed. Repro scripts: /tmp/acp_repro*.py.

### MCP bridge cannot add a project or assign it to a workspace
- **Kind:** missing-capability · **Severity:** low
- **Found:** 2026-11-10, while adding the new `pipelens` project to Freddai and the HOT workspace from an agent thread
- **Decision needed:** Should agents be allowed to add projects and edit workspaces over MCP, or should that stay a UI-only action (possibly behind an approval)?
- **Context:** /Users/denisduvauchelle/Documents/code/freddai/crates/core/src/mcp.rs exposes only context, list, read_thread, schedule, start_task and share_preview tools. To add a project an agent has to write raw JSON to `host.sock` (`import_project`, then `save_preferences` with the whole `workspaces` array, which replaces every workspace and can clobber a concurrent edit). Proposed: add `freddai_add_project {path, color?, workspace?}` backed by `Runtime::import_project` (crates/core/src/runtime.rs), plus a host-side "add project to workspace" operation that appends one id instead of replacing the array.

### Dashboard call review sheet: swipe-dismiss while sending, and late errors
- **Kind:** bug · **Severity:** low
- **Found:** 2026-11-11, while verifying the compact dashboard call indicator redesign
- **Decision needed:** Should an error that arrives as the call ends stay visible after the call is gone (where: header, toast)?
- **Context:** (1) `/Users/denisduvauchelle/Documents/code/freddai/packages/app/src/desktop/DashboardCall.tsx`: the dismiss-review listener ignores dismissal while a send is in flight (`sendingRef`), but on native the page sheet is already swiped away, so mode stays `callReview` and the review card fills the dashboard's embedded web view until the send finishes. Proposed: on `navBack` during sending, defer the dismissal and apply it when the send settles, or re-present the sheet. (2) Same file returns early when the call is not active, so `snapshot.error` / `syncError` present at the moment the call ends is never shown. (3) iOS: between a swipe's `navBack` and the web sending `dashboard` mode, a phase-change re-send of `callReview` can re-present the sheet (`/Users/denisduvauchelle/Documents/code/freddai/apps/native/src-tauri/plugins/native-shell/ios/Sources/NativeShellPlugin.swift` `openThreadSheet`); the existing `new` sheet flow has the same exposure. (4) Android: the header wave animation in `NativeShellPlugin.kt` (`callWaveAnimator`) stops on view detach when the drawer is re-parented into/out of the sheet and only restarts on the next `set_mode`.

### Reconnect on thread/queue auth errors + typed auth_expired
- **Kind:** tech-debt · **Severity:** med
- **Found:** 2026-11-11, while adding the Codex Reconnect button
- **Decision needed:** none
- **Context:** Reconnect (packages/app/src/desktop/ReconnectButton.tsx, isAuthError in packages/app/src/desktop/reconnect.ts) is wired into the usage card, AccountSetup rows and the Bug walk failure card only. Thread run errors (`session.error`) and queue errors in /Users/denisduvauchelle/Documents/code/freddai/packages/app/src/desktop/MessageQueue.tsx still show raw text like "refresh token was already used"; give them the same isAuthError + ReconnectButton treatment. Auth errors also cross the Tauri boundary as plain strings, and the UI string-matches what crates/core/src/usage.rs `is_auth_error` already classified. Replace this with a typed `kind: "auth_expired"` on the usage/run error.

### Empty workspaces cannot receive dashboard drops
- **Kind:** missing-capability · **Severity:** low
- **Found:** 2026-11-11, while adding dnd-kit cross-workspace drag-and-drop to the dashboard projects section
- **Decision needed:** Should a workspace with zero projects render as an empty group on the dashboard (so it can be a drop target), or only while a drag is in progress?
- **Context:** `/Users/denisduvauchelle/Documents/code/freddai/packages/app/src/mobile/dashboard-projects.ts` `dashboardProjectGroups()` omits workspaces with no projects, so `/Users/denisduvauchelle/Documents/code/freddai/packages/app/src/desktop/HomeView.tsx` never renders a droppable for them. The "Other projects" group already appears as an empty drop zone during a drag; the same approach (render empty workspace groups while `activeId` is set) would make them droppable. Also note cross-workspace drops are no-ops in non-native browser preview or when `preferences.workspaces` is absent.

### Awake loop repeatedly fails: full `snapshot` host reply hits the 512 MB cap
- **Kind:** bug · **Severity:** med
- **Found:** 2026-11-11, while diagnosing the browser-panel localhost crash (log `~/Library/Logs/Freddai/native.previous.log`)
- **Decision needed:** Should `awake` stop calling the full `snapshot` RPC and use `snapshot_since`/a scoped read instead, or should the host serve a trimmed snapshot (no message bodies) for that caller?
- **Context:** Every few seconds the log shows `{"event":"host_call.invalid_reply","method":"snapshot","bytes":536870912,"cap":536870912,...}` followed by `awake: cannot read host state: Host reply for `snapshot` exceeded 536870912 bytes and was truncated` (`/Users/denisduvauchelle/Documents/code/freddai/apps/native/src-tauri/src/awake.rs:122`, cap in `/Users/denisduvauchelle/Documents/code/freddai/crates/core/src/host.rs:22`). With ~578 sessions the full snapshot exceeds `MAX_HOST_MESSAGE_BYTES`, so the awake feature silently never gets host state (only an `eprintln`, nothing surfaced to the user), and the host serializes 512 MB each time. The companion `/v1/snapshot` path is fine (~317 KB, scoped). Proposed: switch `awake.rs` to the scoped/incremental snapshot the companion server uses, and surface repeated `host_call.invalid_reply` in the UI per the "failures must be loud" rule.

### Companion apps: usage ring, colour and reset time in the agent picker
- **Kind:** missing-capability · **Severity:** low
- **Found:** 2026-11-11, while fixing the desktop composer/thread-header account pickers (bug walk 2026-11-11 items 1 and 3)
- **Decision needed:** Should the iOS/Android native pickers (and the mobile web `<select aria-label="Agent">`) get a custom sheet that shows per-account colour, usage ring and reset time, or is the plain list acceptable on phones?
- **Context:** Desktop now renders `packages/app/src/desktop/AccountPicker.tsx` with the footer's colour, `UsageRing` and "Week N% left · resets …" line per account. Mobile web (`packages/app/src/mobile/MobileApp.tsx` ~1389) uses a native `<select>`, which cannot render rings; Android (`apps/native/src-tauri/plugins/native-shell/android/src/main/java/com/freddai/shell/DashboardView.kt:135-152`) and iOS (`.../ios/Sources/DashboardView.swift`) use native pickers. Proposed: a bottom-sheet list driven by the companion snapshot's usage data (helpers in `packages/app/src/mobile/product-usage.ts`), reusing the desktop row layout. Account ordering already follows the desktop `account-order.json` once the companion server applies it.

### Mobile usage footer shows nothing for monthly-only providers (Copilot)
- **Kind:** bug · **Severity:** low
- **Found:** 2026-11-11, while adding the GitHub Copilot CLI provider
- **Decision needed:** Should the mobile footer fall back to the limiting window (like desktop) when a provider has no 5h/weekly window?
- **Context:** /Users/denisduvauchelle/Documents/code/freddai/packages/app/src/mobile/product-usage.ts:31-32 and /Users/denisduvauchelle/Documents/code/freddai/packages/app/src/mobile/ProductUsageFooter.tsx:22-23 only render `summary.session` and `summary.weekly`. Copilot's quota is one monthly "Premium requests" window tagged `other` (crates/core/src/usage.rs `parse_copilot`), so the mobile card stays empty. Desktop already falls back to `summary.limiting` in packages/app/src/desktop/useAccountUsage.ts:76; mirror that in product-usage.ts (e.g. a third row, or substitute the limiting window for the Week row when weekly is absent).
