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
