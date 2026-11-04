# Backlog

### Screen recording → parsed bug/feature list → implementation
- **Kind:** missing-capability · **Severity:** med
- **Found:** 2026-11-04, while building the screen-grab button
- **Decision needed:** How do we get from video to items: send frames plus a narration transcript to the model, or use a provider with native video input? Is the user's spoken voice-over part of the recording? Should the parsed list be reviewed before any implementation starts?
- **Context:** This extends the v1 screen grab (`apps/native/src-tauri/src/screen_grab.rs`, `packages/app/src/desktop/screen-grab.ts`, `ScreenGrabMenu.tsx`). Add a "Record screen" option that uses `screencapture -v` or ScreenCaptureKit with mic audio. Stage the video through the same `stage_attachments` path. A new thread then turns the video into a list of bugs, features and improvements, and those become implementation tasks.
