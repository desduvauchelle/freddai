# Header redesign proposal (Mac toolbar, Mac conversation header, iPhone nav bar + drawer)

Evidence: screenshots in `/private/tmp/claude-501/-Users-denisduvauchelle-Documents-code-freddai/ef08748e-1774-4de8-9eba-b59d94204e03/scratchpad/headers/` (`mac-1440-conversation.png`, `mac-900-*.png`, iPhone shots `ios-*.png`). Desktop shots use the real DesktopApp with mocked IPC, so layout is real; the macOS-only `padding-left: 86px` traffic-light gap is not applied in a plain browser.

## What is wrong today

### Mac window toolbar (`DesktopApp.tsx:1214-1251`, `desktop.css:463-500, 589-612`)
1. **Two stacked bars where the system expects one.** A 44px titlebar (`desktop.css:464`) sits above a second 44px conversation bar (`.pane-title`, `desktop.css:993-1002`) and a third "heading" row with title + status chip (`DesktopApp.tsx:328-333`). That is about 150px of chrome before any content, and the thread title appears only in the third row.
2. **Identity in the wrong place.** The wordmark "freddai" (`:1217`, 12px bold lowercase) is repeated brand text in a window that already has an app name; the mascot is pulled out of flow with `position:absolute; left:50%` (`desktop.css:601-606`) while a `padding-left:86px` rule (`:469`) pushes the brand beside it. The two rules fight, so the mascot reads as a stray sticker, not part of the layout.
3. **Primary CTA is heavy.** "New thread  ⌘N" is a solid dark pill with a visible kbd chip (`:1241-1249`, `desktop.css:950`); it is the loudest element on screen yet is used rarely compared with reading threads. Native toolbars use a quiet icon button and show shortcuts only in menus/tooltips.
4. **Three unrelated utility icons** (screen grab, schedules, settings; `:1220-1240`) at 28px with 8px gaps and mixed stroke style (lucide 1.6 stroke at 15px vs 14px `Plus`). No grouping, no divider, no labels.
5. **Heights are inconsistent**: titlebar 44, `.workbench-toolbar` 43, `.app-titlebar` 38 (legacy `workspace.css:1`), list header 44, status footer 28. Border colours differ between bars.

### Mac conversation header (`DesktopApp.tsx:289-327`, `desktop.css:993-1010, 807-812`)
6. **Context is a monospace-ish breadcrumb** ("Freddai  ·  Claude Code · Claude Code", `:299-305`): provider name is duplicated (provider and account name are both "Claude Code"), 12px muted colour but project text is coloured with the project hue, so the row mixes three colours.
7. **Right side: status text + fork + split + close** (`:306-325`) - status duplicates the "Done" chip in the title row; Close (X) sits next to Split with no separation and the same weight.
8. **Title row is 16px/550 with a 32px mascot on its left and a chip on its right** (`desktop.css:911-922`): three competing focal points. The mascot ring changes colour per state, so state is signalled three times (ring, chip, status dot).

### iPhone (`ShellViewController.swift:60-110`, `ThreadDrawerViewController.swift:110-160`, `MobileApp.tsx:337-352`, `mobile.css`)
9. **Nav bar is standard but crowded**: left `sidebar.left`, centre a 28px mascot + 17pt semibold title stack, right a `desktopcomputer` connection glyph that is only tinted gray/green/red (colour-only status, `:71-76`). Title cannot show the project or run state, so the user cannot tell which of 3 projects a thread belongs to.
10. **Drawer header is a 4-element row**: mascot, "Freddai" 22pt bold, connection icon, spacer, compose button, then a separate search row with a filter button (`ThreadDrawerViewController.swift:112-161`). The brand repeats the nav bar and the connection icon is duplicated.
11. **Web fallback header** (`mobile.css:2`, thread header `min-height:100px`, 60px avatar) is a different design from the native bar, so any non-native fallback looks like a different app.

## Target design

Shared tokens (existing): `--background`, `--border`, `--foreground`, `--muted-foreground` (`themes.css`), `--adaptive-*` for text on themed surfaces. Type uses the system stack already set on `.native-workspace` (`-apple-system` = SF Pro). Introduce three new variables in `desktop.css :root`: `--bar-h: 52px`, `--bar-pad: 12px`, `--bar-sep: color-mix(in oklab, var(--border) 70%, transparent)`.

### (a) Mac window toolbar - one unified 52px bar

| Zone | Content | Spec |
|---|---|---|
| Leading (0-78px) | Traffic lights (system) | Reserve `padding-left: 78px` (keeps current 86px minus the extra gap; vertically centre lights at y=26 via Tauri `trafficLightPosition: {x:20, y:19}`). |
| Leading cluster | Sidebar toggle (`PanelLeft` 16px, 32x28 hit area) | Collapses the thread list; replaces nothing today and is the Mac-native expectation. |
| Centre (flex, left aligned after the cluster) | Selected thread title 13px/600, then one secondary line is NOT used; instead `Project / branch` 12px/400 `--muted-foreground` inline after a 1px 14px divider | Title truncates first; the mascot is not here. |
| Trailing | `Plus` new-thread (32x28, ghost, tooltip "New thread  ⌘N"), `Search`/filter lives in the list not here, then an overflow `Ellipsis` menu | Utility icons (screen grab, schedules, settings) move into the `Ellipsis` menu and the app menu bar (they already have shortcuts `⌘⇧S`, `⌘,`). Only two icons stay: New thread and the menu. |
| Mascot | 28px Dormouse, leading edge of the list column (inside the sidebar header, left of "Threads"), no wordmark, ring only when needs-attention or running | Removes `position:absolute` centring and the wordmark (`:1217`). Click opens the companion/mood popover that already exists. |
| Surface | `background: var(--background)` with `backdrop-filter: saturate(180%) blur(20px)` over a 70% mix so scrolling content shows through; bottom hairline `1px solid var(--bar-sep)` | `data-tauri-drag-region` stays on the whole bar except buttons. Height 52px, items vertically centred, gap 8px, trailing padding 12px. |

Split view: each pane owns a 40px sub-header (see b); the window toolbar shows the focused pane's title, with the other pane's title in `--muted-foreground`.
Narrow (<=900px): hide the divider + project/branch text, keep title and the two trailing icons; sidebar toggle becomes mandatory.

### (b) Mac conversation header - fold three rows into one 44px row + remove the heading row

- Delete the separate `.detail-heading` title row (`:328-333`); the title moves into this header (and is renamable by click, via existing `ThreadTitle`).
- Layout (left to right), 44px high, `padding: 0 12px 0 16px`, bottom hairline `--bar-sep`:
  1. 8px project colour dot (existing `--project color`), project name 13px/500 `--foreground`.
  2. `/` separator in `--muted-foreground` at 40% opacity, then thread title 13px/600 (truncates).
  3. Flexible spacer.
  4. Status as a single 22px pill: 11px/500 text, leading 6px dot, `--muted` fill, no border; "Completed" collapses to a dot only when width < 700px. Remove the duplicate chip and the mascot ring colour change (ring is kept only for `needs-you` so there is one signal).
  5. Icons at 16px, 28x28, 4px gap: `Split` and an `Ellipsis` menu holding Fork thread, Rename, Archive, Close pane. Close (X) only appears in split mode as the last item, 8px away.
- Provider: show once as a 12px muted line in the Ellipsis menu header or as a subtle tooltip on the project name ("Claude Code - Account"), not as repeated text in the bar.

### (c) iPhone native nav bar and drawer

Nav bar (UIKit, `ShellViewController.swift`):
- Standard 44pt inline bar (`largeTitleDisplayMode = .never` stays; thread detail never uses large titles). Remove the mascot from the title view; use a two-line `titleView`: line 1 thread title 17pt semibold (`UIFont.preferredFont(.headline)`), line 2 `Project name` 12pt `.secondaryLabel` (11pt caption1), centred, truncating tail. The line-2 text takes the run state in words when active ("Running" in `.systemBlue`, "Needs you" in `.systemOrange`).
- Left: `sidebar.left` stays (SF Symbol, 17pt regular). Right: replace the `desktopcomputer` glyph with a single `ellipsis.circle` menu (`UIMenu`: Mac connection status as the first disabled item with `checkmark.circle.fill`/`exclamationmark.triangle.fill`, Stop, Archive, Delete). Connection state becomes a 7pt coloured dot badge only when NOT connected (red/orange); connected = no indicator. Never colour-only: the menu item carries the text.
- Mascot: moves to the empty/new-thread state and the drawer header (see below), not the bar.
- Use `UIBarAppearance.configureWithDefaultBackground()` as today (blur) - keep.

Drawer header (`ThreadDrawerViewController.swift:110-161`):
- Row 1 (height 44): large title "Threads" 28pt bold (`largeTitle` style, `.label`) left; trailing `square.and.pencil` 22pt tinted accent in a 44x44 hit area. No mascot, no brand text, no connection icon.
- Row 2 (height 36, 8pt below): native `UISearchBar` style `.minimal`, with the filter as its `bookmark` button using `line.3.horizontal.decrease` (filled when active). Corner radius 10, fill `.tertiarySystemFill`.
- Connection: a single footer row at the bottom safe area (`desktopcomputer` + "Connected to Denis's Mac" 13pt `.secondaryLabel`; red text on failure). The mascot sits in this footer at 24pt as a quiet signature, hidden while the keyboard is up.
- Section headers keep the project colour dot (8pt) + 13pt semibold project name; row spacing unchanged.

Web fallback header (`mobile.css`): reduce to the same layout - 44px, title 17px/600 + project line 12px, no 60px avatar (drop `min-height:100px`, `.companion-thread-header` grid).

## Top changes in order of impact
1. Collapse three Mac rows (titlebar, pane-title, heading) into one 52px unified toolbar plus one 44px pane header (saves about 50px and one border).
2. Remove wordmark and absolute-centred mascot; place a 28px Dormouse in the sidebar header with a state ring used only for needs-attention.
3. Demote "New thread" to an icon button with tooltip; move screen grab, schedules, settings into an overflow menu / app menu.
4. Conversation header becomes `dot Project / Title` + one status pill + split + overflow; remove duplicated status and provider text.
5. iPhone: two-line title (thread + project/state) with the mascot removed from the bar, `ellipsis.circle` menu with connection status text, and a "Threads" large-title drawer header with search and a footer connection row.

## Implementation notes (do after the concurrent native-drawer/read-state work lands)
- Files: `DesktopApp.tsx` header JSX (`:1214-1251`, `:289-333`), `desktop.css` (`:463-500, 589-612, 807-812, 993-1010, 911-922`), `ShellViewController.swift` (`:60-110`), `ThreadDrawerViewController.swift` (`:110-161`), `mobile.css`.
- `tauri.conf.json` already has `titleBarStyle: Overlay`; add `trafficLightPosition` for the 52px bar.
- Verify with `pnpm ios:sim:fixture` (iPhone) and the browser IPC-mock script at `.../scratchpad/headers/shot.mjs` (Mac).
