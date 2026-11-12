# Commander verification — November 12, 2026

## Implemented

- Explicit task requests can start without a redundant proposal; ordinary agent permission checks remain. The destination project's agent takes precedence over the caller's fallback. Request IDs remain idempotent and delegated work gets a to-do.
- Shared inline task cards expose background status and open the corresponding thread.
- Relative reminder timestamps are computed by the host from `delay_minutes`. Due reminders and completion reviews are independent of the heartbeat cooldown; failed queue delivery remains retryable. User messages take precedence over queued Commander notices.
- New default personality is direct and brief; untouched old defaults migrate with a revision, and custom personality text remains intact. Heartbeat defaults agree across UI/backend and remain off. The user's existing saved heartbeat was already off.
- Commander Settings is available on desktop and in the companion sheet. Local/OpenRouter/Vercel transcription and speech can be selected independently. Keys stay in the Mac Keychain. Remote synthesis is invalidated when a call ends or is interrupted. New calls enable spoken replies by default while preserving saved preferences.
- Current local time and recent thread summaries are refreshed before Commander turns. The Call toolbar action uses the existing hands-free controller.

## Test evidence

- Core: **338 passed**, including explicit task start, retry idempotency, proposal approval/decline, tracked completion, reminder timing, and existing runtime/queue tests.
- Native speech: **24 passed**; the separately enabled real-engine test passed for WAV and M4A input. Generated phrase: “Hello Freddai, this is a dictation test.” Whisper returned “Hello, Fred A, this is a dictation test.” This checks local decoding and transcription, not a physical microphone call.
- Full shared UI suite: **956 passed across 133 files**. The focused dashboard review-card regression checks also passed (6 scenarios).
- Commander/settings/call unit tests: **64 passed**. Broader call integration tests: **87 passed** after checking the new spoken-reply prompt suffix and draft preservation.
- TypeScript check and Rust native compilation passed. `git diff --check` passed.
- Browser settings interaction and overflow checks passed at **320, 390, 768, 1024 and 1440 px**. The 390px screenshot was visually inspected.
- `scripts/test-commander-local.py`: installed `gemma4:e2b-it-q4_K_M` passed **8/8 isolated planning scenarios**: “Freddie” project alias, feature thread, research thread, one-hour reminder, priority capture, next action, recent threads, and reading completed work. Tool routing and reminder arguments were checked. No live project tasks or connected accounts were used as fixtures. This is planning verification, not live subscription-provider execution.
- The installed small Qwen model failed some routing and time calculations. The production changes include host-side relative time calculation; model reliability still matters.
- Intermediate broad UI runs exposed an agent-picker spacing assertion while concurrent work was changing that UI, then a stale-element assertion in the dashboard call review test. The call review test now reacquires the current card after changing agents, instead of clicking its detached previous DOM node.

## Delivery and limits

- macOS: built using `pnpm native:install`, signed with the existing Developer ID for team `BSH2UEDLU5`, installed at `/Applications/Freddai.app`. GUI restart and bridge continuity were checked. Final GUI PID 48430 was verified by `lsof` to map `/Applications/Freddai.app/Contents/MacOS/freddai-native`, and the bundle passed strict signature verification. The old background host remains active while existing agent work runs; its update banner reports pending activation. No agents were force-killed to activate the update. New runtime behavior is verified in isolated tests, not in the still-running old host.
- DiPhone (`00008140-00144DE80A7B001C`): signed build installed and launched. Running process was verified from the installed application container, PID 53351 at verification time.
- 2021 iPad Pro 12 (`00008103-001209062279001E`): signed build installed. Launch denied by iPadOS with `FBSOpenApplicationErrorDomain: Locked`. No running Freddai process was reported. Unlock the iPad and open Freddai; physical launch verification is still outstanding.
- 2022 iPad mini (`00008110-000579E00E7A801E`): signed build installed. Same locked-device launch denial; no running Freddai process was reported. Unlock the iPad and open Freddai; physical launch verification is still outstanding.
- Android: debug APK built and APK v2 signature verified. `adb devices -l` returned no devices. Connect the intended phone/tablet, unlock it, enable USB debugging and accept the computer authorization before physical installation/launch can be verified.
- No OpenRouter or Vercel speech key was supplied or used. Public model catalogs and provider request protocols were checked, but live authentication, paid speech generation and remote transcription remain unverified. The speech preset uses a model listed by both catalogs; access still depends on the user's account.
- Normal GUI restart preserved the background bridge and existing work. No macOS reboot or interrupted-agent resumption claim is made.

Sources: [OpenRouter transcription](https://openrouter.ai/docs/guides/overview/multimodal/stt), [OpenRouter speech](https://openrouter.ai/docs/guides/overview/multimodal/tts), [Vercel transcription](https://vercel.com/docs/ai-gateway/modalities/speech-to-text), [Vercel speech](https://vercel.com/docs/ai-gateway/modalities/text-to-speech).
