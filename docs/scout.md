# Scout — design contract (November 13, 2026)

Scout is a second app living in this repo next to Freddai. Freddai, Scout and (later)
Tucky ship in one desktop package; the user launches one at a time and can open the
others from inside any of them. Design source: Figma "Command Center"
(https://www.figma.com/design/EebG2GbamPpyKzEcRXSEUg), screenshots in
`output/figma-command-center/`. Desktop first; nothing may close the door on iOS/Android
later (keep platform-specific code behind the same `platform` IPC and `isTauri()` checks
Freddai uses).

## Layout (monorepo)

```
packages/shared   @freddai/shared   app registry + switcher, typed agent client, voice (shared by every app)
packages/app      @freddai/app      Freddai UI (unchanged, now depends on @freddai/shared)
packages/scout    @freddai/scout    Scout UI (depends on @freddai/shared, @freddai/app, @freddai/ui)
packages/ui       @freddai/ui       shadcn primitives + Tailwind entry (unchanged)
crates/core       freddai-core      Freddai runtime (unchanged)
crates/scout-core scout-core        Scout data model + JSON persistence, no Tauri dependency
apps/native       @freddai/native   the single Tauri shell; routes to an app by `?app=` query
```

Dependency direction: `scout -> app -> shared -> ui`. `shared` never imports from `app` or `scout`.
Each app is a package so it can be split into its own repo later by moving a folder.

## App registry and windows

- `packages/shared/src/apps/registry.ts` exports `apps: AppDescriptor[]`:
  `{ id: "freddai" | "scout" | "tucky", name, tagline, accent, status: "ready" | "soon" }`.
  Tucky is `status: "soon"` (greyed, not launchable) until it is imported.
- `apps/native/src/main.tsx` reads `?app=scout` and renders `ScoutApp` from `@freddai/scout`
  instead of `DesktopApp`. No param means Freddai (unchanged behaviour).
- Rust command `open_app_window(app: String)` in `apps/native/src-tauri/src/app_windows.rs`,
  modelled on `thread_windows.rs`: clones the `main` window config, label `app-<id>`,
  URL `index.html?app=<id>`, title `"<Name>"`, width 1280 height 860, focus-if-exists,
  main-thread creation, macOS writing-tools install. `focus_main_window()` focuses `main`.
  `capabilities/default.json` windows gets `"app-*"`.
- `AppSwitcher` (shared) is a dropdown listing the registry; selecting Scout calls
  `open_app_window`, selecting Freddai calls `focus_main_window`. Freddai shows "Open Scout"
  in its titlebar More menu (above Settings) and as a shortcut; Scout shows the switcher
  in its header.
- Scout windows inherit the Overlay title bar with hidden title and traffic lights at
  x20/y28: the Scout header leaves 80px left padding and is a drag region
  (`data-tauri-drag-region`).

## Shared agent client (`packages/shared/src/agent/`)

Typed wrappers over the existing Freddai IPC, nothing new on the Rust side:

- `useFreddaiSnapshot(intervalMs = 3000)` polls `invoke("snapshot")` and returns
  `{ db: Database | null, error: string | null, refresh }`. Errors are surfaced, never swallowed.
- `launchThread({ project, account?, prompt, options? }) -> Promise<string>` wraps `launch`.
- `queueMessage(session, prompt)` wraps `queue_message` with `{ request_id: crypto.randomUUID() }`.
- `respond(session, requestId, allow, answers)` wraps `respond`; `stop(session)` wraps `stop`.
- `Database`, `Session`, `Message`, `Account`, `Project`, `Workspace` types are re-exported
  from `@freddai/app`'s `desktop/types.ts` (shared re-exports type-only, so the dependency
  direction stays `app -> shared`; if that proves circular, copy the types into shared).

Voice: `voice.ts` and `VoiceControls.tsx` (MicButton, useHoldToTalk, VoiceNotice) move from
`packages/app/src/desktop/` to `packages/shared/src/voice/`, with re-export shims left at the
old paths so Freddai imports keep working.

## Scout data model (Rust `scout-core`, mirrored in `packages/scout/src/api.ts`)

All ids are UUID strings, timestamps RFC 3339 strings. Field names are snake_case on both sides.

```
Workspace { id, name, color, order: number, collapsed: boolean }
Project   { id, workspace, name, color, order, pinned: boolean, hidden: boolean,
            freddai_project: string | null }
Item      { id, project, kind: "email" | "meeting" | "task" | "contact" | "note" | "code",
            title, subtitle: string | null, lane: "focus" | "backlog" | "done",
            status: "needs_you" | "agent_working" | "ready" | "none",
            source: string | null, origin: "user" | "rule" | "agent" | "import" | "sample",
            thread: string | null,            // Freddai session id once a chat exists
            order, created, updated, done_at: string | null }
Rule      { id, name, when_text, then_text, enabled: boolean, project: string | null, order }
Source    { id, account: string,              // Freddai account id (agent)
            kind: "gmail" | "slack" | "calendar" | "meet" | "imessage" | "whatsapp" |
                  "discord" | "custom",
            label, detail, access: "direct" | "computer_use" | "browser",
            enabled: boolean, status: "connected" | "needs_sign_in" | "not_connected" }
Settings  { onboarding_done: boolean, onboarding_step: number, sample_data: boolean }
ScoutState { revision: number, workspaces: Workspace[], projects: Project[], items: Item[],
             rules: Rule[], sources: Source[], settings: Settings }
```

Persistence: `<app_data_dir>/scout/state.json`, pretty JSON, written atomically
(temp file + fsync + rename), loaded once into a `Mutex<ScoutState>` managed by Tauri.
Missing file = empty state with `onboarding_done: false`. A corrupt file is an error
surfaced to the UI, never silently replaced.

## Scout IPC (Tauri commands in `apps/native/src-tauri/src/scout.rs`)

Every mutating command returns the full `ScoutState` after the change, with `revision + 1`.

```
scout_state() -> ScoutState
scout_workspace_save(workspace) / scout_workspace_delete(id) / scout_workspace_reorder(ids: string[])
scout_project_save(project) / scout_project_delete(id) / scout_project_move(id, workspace, index)
scout_item_save(item) / scout_item_delete(id) / scout_item_move(id, lane, index)
scout_rule_save(rule) / scout_rule_delete(id)
scout_source_save(source) / scout_source_delete(id)
scout_settings_save(settings)
scout_import_freddai() -> ScoutState
scout_sample_data(load: boolean) -> ScoutState
```

- `*_save` is an upsert by id; missing `order` is appended at the end.
- `scout_item_move` to `done` sets `done_at`; moving out of `done` clears it.
- `scout_import_freddai` reads the Freddai snapshot through the existing `Host` rpc
  (`rpc(host, "snapshot", ...)`) and upserts: one Scout workspace per Freddai workspace
  (`preferences.workspaces`), one Scout project per Freddai project (`freddai_project` set,
  placed in its workspace, or in a workspace named "Freddai" when unassigned), and one
  `kind: "code"` item per non-archived session updated in the last 30 days (max 8 per
  project): `lane: "focus"` and `status: "needs_you"` when `pending` is set,
  `status: "agent_working"` when busy (`starting|running|waiting`), otherwise
  `lane: "backlog"`, `status: "none"`; `thread` = session id; `origin: "import"`.
  Idempotent: matching by `freddai_project` and by `thread`.
- `scout_sample_data(true)` inserts the board shown in the Figma home (workspaces LiveCase,
  Recursive Solutions, Freddai, School PA, Home; projects Sales, Support, Code, Clients,
  Delivery, Build, Community, Board, Family; a few items each across kinds and lanes;
  2 rules; 3 sources) with `origin: "sample"` and `settings.sample_data = true`.
  `scout_sample_data(false)` removes everything with `origin: "sample"` (and sample
  workspaces/projects that end up empty) and clears the flag. The UI shows a persistent
  "Sample data" banner with a Clear button while the flag is set.

## Chat on an item (reuse of Freddai agents)

- An item thread uses the Freddai session in `item.thread`. Messages render with
  `ThreadTranscript` from `@freddai/app` fed by `db.sessions.find(s => s.id === item.thread)`.
- First message: requires the Scout project to be linked to a Freddai project
  (`project.freddai_project`). If not linked, the composer is replaced by a clear notice
  with a "Link a Freddai project" picker (saves `freddai_project`). Never fall back silently.
- Launch prompt is the user's text prefixed with a short context block:
  `Scout item · <kind> · <title>[ · <subtitle>]` on its own line. Account: project policy
  via `resolveAccount(db, project)` from `@freddai/app`. After `launch` resolves, save the
  item with `thread` set.
- Follow-ups use `queueMessage`; approvals use `respond`; Stop uses `stop`.
- Voice: `MicButton` from `@freddai/shared` appends dictation to the composer.

## Screens (Figma frame ids)

Home board 51:46 (chat open 51:630, suggestions 72:1585, hidden projects 76:1588, dragging
60:1379, voice note 63:1817), New item 64:1576, Project panel 55:46, Item thread: email
55:800, task 58:5569 / 66:1579, meeting 58:6364, code 68:1582, headers by type 55:1492.
Settings v2: Agents & sources 56:46, Rules 56:546 (Workspaces and Account tabs: simple
lists built from the same data). Onboarding v4: 1 Agents & sources 47:46, 1b custom source
50:125, 2 Workspaces & projects 47:788, 3 Place your sources 58:437, 4 Rules 49:46,
5 Practice run 49:451. Done mark 34:47, done animations 34:71+.
Frames prefixed "Old ·" are superseded and ignored.

## Style

Scout has its own stylesheet `packages/scout/src/scout.css`, tokens under `.scout-app`
(`--scout-bg: #f6f4f1`, cards `#ffffff`, text `#1a1a1a`, muted `#8a8a8a`, borders
`#e9e6e2`, orange brand `#f0582c`, purple accent `#7c5cff`, red "needs you" `#e5484d`,
green "ready" `#2fb344`, dark pill buttons `#1a1a1a` with white text, radius 14px for cards,
999px for pills). It reuses `@freddai/ui` primitives (DropdownMenu, Dialog, Tooltip) and
respects `useTheme()` appearance (dark variant may be minimal for now). Tailwind classes work
only if `packages/ui/src/styles.css` has `@source` lines for `../../scout/src` and
`../../shared/src`.

## Checks

`pnpm typecheck`, `pnpm --filter @freddai/scout test`, `pnpm --filter @freddai/app test`,
`cargo test -p scout-core`, `cargo check --workspace`. No live agent turns or accounts as
test fixtures. Failures must be loud: any IPC error is shown in the UI.
