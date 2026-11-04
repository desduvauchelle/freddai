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
