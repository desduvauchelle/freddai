Run the app logic tests with `node --test packages/app/tests/*.test.mjs`.

The thread-overflow regression renders the actual mobile app and desktop ScrollArea/ThreadTitle rows with isolated synthetic data and no accounts or provider connections. It asserts truncation, bounded scroll content, and visible date/icon columns across phone and desktop widths.

Start the Vite product preview with `pnpm dev:app`, then run:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node packages/app/tests/thread-overflow.browser.mjs
```

If Playwright is installed in the workspace, omit `PLAYWRIGHT_MODULE`. The test uses installed Chrome by default; set `PLAYWRIGHT_CHANNEL` to select another supported channel. `FREDDAI_PREVIEW_URL` overrides `http://127.0.0.1:1420`. Set `FREDDAI_LAYOUT_SCREENSHOTS` to an existing output directory to retain phone screenshots. The Vite-only fixture under `tests/fixtures` is not imported by either application build.

The companion tool-disclosure regression uses the same browser setup:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node packages/app/tests/tool-activity.browser.mjs
```

It checks initially hidden tool payloads, adjacent grouping, nested expansion, preserved disclosure state during polling, appended calls, and collapsed state when reopening a conversation. It uses the actual MobileApp with a synthetic transcript and no provider/native connection.

`project-groups.browser.mjs` uses the same environment variables and checks default project grouping, latest-user-message ordering, five active rows, per-project ten-row history pages, count labels, collapse/search reset, older-day separators, and read/Finished behavior. Its synthetic snapshot has no accounts and all work-dispatch operations are disabled.

`mobile-read.browser.mjs` uses the same browser setup and the project-groups fixture. It models a visible WKWebView without document focus, verifies background completions remain unread, foregrounding sends `markRead` to the (modelled) host so `read_at` comes back in the snapshot, returning removes the read reply from active rows, Finished retains it, and a legacy `freddai.companion.read` map is merged into the host once and removed.

`mobile-send.browser.mjs` renders MobileApp at 390×844 with a deferred synthetic client. It requires a message preview within 700ms while dispatch is unresolved, checks queue previews survive stale snapshots, reconciles repeated identical prompts without duplication, preserves rejected drafts, retains new-thread previews before snapshots arrive, verifies one-second foreground polling and immediate foreground refresh. It never calls the native bridge or a live provider.

Pairing UI (synthetic native boundary, no accounts/provider turns):

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node packages/app/tests/pairing.browser.mjs
```

Checks invalid codes, the explicit Mac approval gate, successful phone transition, Mac approval and device revocation. Native pairing/relay security tests run with `cargo test -p freddai-native --lib`; relay protocol checks are documented in `services/relay/README.md`.

Optimistic actions: `desktop-send.test.mjs` exercises the real desktop reply handler at a deferred synthetic IPC boundary, including immediate composer/attachment clearing, acknowledgement, queue routing, and rejected-send recovery with newer drafts. `outgoing.test.mjs` checks transcript/queue reconciliation. Browser regressions use the same Playwright setup:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node packages/app/tests/mobile-send.browser.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node packages/app/tests/optimistic-permission.browser.mjs
```

The mobile flow covers immediate sending, stale snapshots, acknowledgement, rejection with newer draft retention, optimistic allow/decline, failed-decision recovery and new-thread continuity. The shared permission renderer is also tested at desktop and phone widths for question-answer preservation, local resubmit prevention and next-request reset. All dispatch boundaries are synthetic; no live account, credential, provider turn or real decision is exercised.

`mobile-composer.browser.mjs` exercises shared model/effort and permission choices, attachment staging/restoration, phone Return and Cmd/Ctrl+Enter, queue pause/resume/removal, composer Stop, and composer/menu bounds at 320–720px. It uses the deferred synthetic companion client; no native credentials, connected account or provider turn is involved.

`office.browser.mjs` renders the Office fixture (`fixtures/office.tsx`: 6 synthetic projects, 12 synthetic threads, an Advance button) at 1440x900 and Home-card widths. It checks that room/zone floors never move while characters walk or states change, that walking happens, the mini height cap, tray-folder click-through and reduced motion, and saves screenshots to `/tmp/office-redesign` (override with `FREDDAI_LAYOUT_SCREENSHOTS`). No accounts, provider or native bridge involved.

`companion-dashboard.browser.mjs` uses the offline dashboard fixture to check agent/model/effort persistence into New thread, cached summary rendering, and phone/tablet project grids (including iPad's narrower landscape content beside its native sidebar). It never pairs, creates accounts, sends messages, or calls a provider. Run against native Vite with `FREDDAI_PREVIEW_URL` and, if needed, `PLAYWRIGHT_MODULE`; screenshots go to `output/playwright/dashboard-*.png`.

`mascot-controls.browser.mjs` checks the real Dormouse component at five sizes in desktop and companion layouts, with mouse and touch media. It asserts square pause/play controls, 44px phone targets, and working pause persistence. It uses the isolated `mascot-controls` fixture and no accounts or provider turns.

Workspace Settings: run the native Vite dev server on port 1420, then `node packages/app/tests/workspace-settings.browser.mjs` (or set `PLAYWRIGHT_MODULE` to the installed Playwright module). Uses fixture-only projects; verifies assignment, moving to another workspace, unassigning, real touchscreen workspace reorder and project dragging, and horizontal overflow at 390/820/1024px. Screenshots go to `/tmp/freddai-workspace-settings-<width>.png`.

`completion-cards.browser.mjs` checks passive completion cards at 320, 430, 768, 1024, and 1440 pixels using an offline fixture. It verifies thread navigation, wrapping, draft preservation, and dismissal without accounts or provider turns. Run with `PLAYWRIGHT_MODULE` if Playwright is external; screenshots are saved to `/tmp/freddai-completion-cards-<width>.png`.

`mobile-busy-send.browser.mjs` checks immediate queue placement before host acknowledgment, stale-snapshot handoff, dispatched-message reconciliation, and idle-reply transcript feedback at 320/390/768/1024px using only synthetic dispatch.

`dashboard-call.browser.mjs` uses the same preview and Playwright environment. It renders the real dashboard call island with an inert audio transport, checks compact and expanded layouts at 320/430/768/1024/1440px, and verifies mute and hangup without microphone, account, or provider access. `DashboardCall.test.tsx` covers serialized project dispatch, failure recovery, navigation persistence, spoken replies, and disconnect cleanup.

`model-configuration.browser.mjs` checks the shared provider-by-level settings table, Smart/Normal/Fast/Custom choices, Custom model (a `Model` select of known models, no free-text ID) and effort, and 390/744/1024px layouts against an offline fixture. Run with native Vite and `PLAYWRIGHT_MODULE` if external. Screenshots go to `/tmp/freddai-model-configuration-<width>.png`; no accounts or provider turns are used.

`recording-feedback.browser.mjs` checks the shared dictation overlay in Chromium and WebKit at all four viewport corners and 320/390/768/1024/1440px widths. It asserts Send/Cancel are inside the viewport and clickable despite a clipping parent. Uses an offline recording fixture, without microphone capture or provider turns. Set `PLAYWRIGHT_MODULE` when Playwright is installed externally.
