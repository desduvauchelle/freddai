# Freddai promo UI kit: brief for the shorts agents

Project: `remotion-project/` (Remotion 4, cloned from `../freddai-demo/remotion-project`). Film = 1920x1080 @30fps (untouched). Shorts = 1080x1920 @30fps, registered via `src/shorts/registry.ts` (each entry `{id, durationInFrames, component}`; `src/Root.tsx` maps them to `<Composition>`).
Still check: `npx remotion still src/index.ts <id> /tmp/x.png --frame=45 --browser-executable="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`. Typecheck: `npx tsc --noEmit`.

## 0. Vertical rules (read first)
- `src/shorts/ShortFrame.tsx` exports `W=1080, H=1920, SAFE_TOP=168, SAFE_BOTTOM=1330` and `<ShortFrame safe? background?>`: warm paper ground (radial `C.cream` -> `C.cream2`); children are centred (flex column) inside y 168..1330 by default. `safe={false}` gives the full canvas (children then position themselves absolutely; keep meaningful content inside the safe band).
- Nothing meaningful above 168 or below 1330 (platform UI/captions). Safe band is 1080 x 1162.
- **Every desktop UI component is built for the 1920x1080 landscape stage.** Never mount them at native size in 1080 wide. Wrap in a div with `transform: scale(s)` (`transformOrigin: "0 0"`) and a fixed native width/height, or crop to one panel. Window = 1640x920, so full window at 1080 wide is scale 0.62 (text ~11px: unreadable). Prefer showing ONE component at scale 1.3-1.8 (composer, ProviderCard, ThreadRow stack, ScheduleCard), not the whole window.
- Text components (`Words`, `Slam`, ...) take `size` in px; for a 1080 wide canvas use Words size 90-150, Slam 110-170 (Slam is `nowrap` + uppercase: keep text short or it overflows).
- Frame numbers: all `at`/`start`/`delay` props are LOCAL frames of the nearest `<Sequence>`; 30 fps (`sec(t)` = round(t*30) from `timeline.ts`).

## 1. theme.ts (tokens)
`C` (palette): dark `bgDark #1e241e`, `bgDark2 #282f26`, `line #404a3b`, `textDark #f0f1e7`, `sage #b9c99a`; light `cream/paper #faf9f5`, `cream2 #eeefe6`, `edge #dadccf`, `ink #282d23`, `forest/green/green2 #4d613d`, `mint/mintSoft #b9c99a`, `mintPale #eeefe6`; `amber #c7893c`, `amberSoft #e9ac42`, `slate #5f6857`, `slateLight #98a08c`, `white`, `red #e5484d`, `indigo` (= sage, accent slot for Kicker/Typewriter cursor), `navy #1e241e`, `fur #D3A16B` (dormouse).
`FONT` system-ui stack. `GRAD` = forest->sage horizontal gradient string; `GRAD_INDIGO` = forest->dark 135deg. `clamp` = `{extrapolateLeft:"clamp", extrapolateRight:"clamp"}` (spread into `interpolate` options). Light scenes: ink text on cream, forest as primary. Dark scenes: textDark on bgDark, sage as primary.

## 2. fonts.ts
System fonts only (no webfonts): `FONT_DISPLAY` (SF Pro Display stack), `FONT_BODY` (SF Pro Text), `FONT_MONO` (SF Mono/Menlo), `fontsReady` (resolved promise). Rendering must happen on macOS for SF.

## 3. text.tsx
- `Words {text, delay=0, stagger=3, size=96, color=white, weight=800, align="center"|"left", lineHeight=1.02, gradientWords=[], family, style}`: word-by-word spring rise + blur-in, wraps (flex-wrap), `gradientWords` painted with GRAD. THE display text; works vertically since it wraps. Wrap in a width-limited div.
- `Slam {text, delay, size=160, color, seed, exitAt?, letterSpacing, style}`: uppercase trailer slam (scale 1.6->1, shake on land, fade out at `exitAt`). Single line, nowrap.
- `Kicker {text, color=indigo, delay, size=22}`: small tracked uppercase eyebrow label, fade+rise.
- `Typewriter {text, start, cps=28, cursor, cursorColor, style}`: inline span, types text with blinking caret.
- `Mono {children, size=26, color=slateLight}`: tracked mono caption.
- `useCount(from, to, start, dur)`: eased number for count-ups.
- `fadeInOut(frame, inStart, inEnd, outStart, outEnd)`: opacity 0..1..0 helper.

## 4. fx.tsx
No standalone spring helper: use Remotion `spring` directly (house config `{damping:15, stiffness:190, mass:0.8}` for pops = `usePop` in ui.tsx; `{damping:16, stiffness:150, mass:0.7}` for text; windows `{damping:16, stiffness:140, mass:0.9}`).
- `shakeOffset(frame, intensity, seed)` -> `{x,y}` deterministic jitter.
- `Grain {opacity=0.09, blend="overlay"}`: full-frame animated film grain (SVG tile 480x270 scaled x4: landscape tile, covers 1920x1080 exactly; for 1080x1920 it only covers 1920x1080 of the tile area, so wrap/rotate or scale it if used). Film uses 0.09 on dark, 0.03 on light.
- `Vignette {strength=0.7, inner=45}`; `Letterbox {amount 0..1}` (2.39:1 bars, landscape only; do not use in shorts).
- `Glow {x,y,color,size=900,opacity=0.6,drift=0,seed}`: soft radial blob, absolute, drifts slowly. Used in LightBg (two mint glows at (300,200) and (1700,900): landscape coordinates, re-place for 1080x1920).
- `LightSweep {duration, delay, opacity, angle}`; `Flash {at, color, max, length}` (white/cream flash cut); `CameraPush {from=1,to=1.06,origin}` (slow scale over the whole parent Sequence); `Shake {intensity, seed}`; `SceneFade {inFrames=8,outFrames=8}`; `DotGrid {opacity, color}` (default violet: pass a theme colour); `Dust {count, color, opacity}` (uses `useVideoConfig` width/height, so it adapts to vertical).

## 5. ui.tsx (desktop Freddai app, dark palette `A`; ~1.5x real app so it reads at 1080p)
Exports data/tokens: `A` (app colours: bg #18191c, card, surface, border, text, textHi, muted, running #7fd0a0, unread, amber #e9b667, blue, done, red), `ACCOUNTS` (6 demo accounts: Codex personal/work, Claude Code Max (9% left)/work, Gemini, Grok; `{id, provider, label, color, left, reset, glyph}`), `PROJECTS` (Website, Mobile app, API with colours), `WIN` = {x140,y80,w1640,h920,title56,foot64,listW600}, `PANE` geometry, `COMPOSER` = {w920,h280,bottom36}.
Components (all native-pixel, landscape stage; unless noted they are fixed-width blocks you can lift out and scale):
- `usePop(start, cfg)`: hook -> spring 0..1 from local frame `start`.
- `Pop {at, children, from=0.94, y=16, origin}`: mounts children at `at` with rise+scale+fade (returns null before `at`). Wrap everything that should appear on a beat.
- `Icon {name, size=22, color, stroke}`: lucide-style icons: plus, mic, arrowUp, search, home, panel, more, check, clock, branch, chevron, x, folder, folderPlus, activity, alert, help, refresh, repeat.
- `Dormouse {size=120}`: brand mouse (the dormouse.svg) as an `<Img>`.
- `TrafficLights`: three mac window dots. `FreddaiTitlebar {homeActive}`: app title bar (home/panel icons, search); fills window width.
- `MacWindow {width, height, title?, titlebar?, children, radius=16, light?}`: dark (or light) rounded mac window with traffic lights + shadow.
- `Sidebar {children, width=600, query?}`: thread list column with search field. `ProjectGroup {name, color, children}`: coloured project header + its rows.
- `ThreadRow {title, status: running|unread|done|question|starting, time, account?, dim, worktree, selected, sub, pulse}`: one thread row with status dot/spinner, account chip, optional worktree badge. ~600 wide (list column) but flexes to parent width; good vertical card when put in a ~900 px box.
- `UsageRing {remaining|null, color, size=40, fill=1, children}`: circular progress ring; turns amber at <=10%. `fill` 0..1 animates it in.
- `AccountButton {a, fill, label, pulse, size=40}`: ring + "Claude Code · Max / 9% left - 52m" text. `UsageFooter {items:{a,show,fill,pulse}[]}`: the 64px bottom strip of 6 AccountButtons, 1640 wide (landscape only; use AccountButton in a column instead).
- `ProviderCard {provider, accounts, at, width=470}`: card with provider glyph, "N accounts connected", account rows (colour dot, label, Default tag, "Signed in" check). 470x250 native: ideal vertical stack item.
- `Composer {text, placeholder, project, account, worktree, listening, sendActive, pickerOpen, pickerHover, pickerChosen, pickerAccounts, caret, worktreeGlow}`: the prompt box (text area, project chip, account chip, worktree toggle, mic, send button) with an optional account-picker popover. 920x280 native; use scale ~1.1 to fit 1080 wide.
- `MicButton {listening 0..1, size=44}`; `Wave {level, n=26, color, h=44}` (voice waveform bars, also re-exported).
- `NewThreadPane {children, hero=true}`: empty-thread pane (Dormouse hero + "What should we work on?") that hosts a Composer; fills PANE (1040x~800).
- `HomeTile {name, color, working, done, needs, listening, agent, children, width=300, glow}`: Home dashboard project tile (counts, mic, plus). 300 wide: vertical friendly.
- `GitGraph {rows: GitRow[], reveal, rowH=62}`: commit graph with lanes/refs/author/hash; `reveal` is rows shown (animate). Wide (~900).
- `ScheduleCard {name, project, color, when, next, account, at, width=920, highlight}`: scheduled-task row with "next run" label.
- `Pointer {keys: PointerKey[]{x,y,at,leave?,click?}, color, scale=1.3}`: animated mac cursor that holds on each key then springs to the next; click ring on `click` frame. Coordinates are in the parent's local pixel space (it is `position:absolute`).
- `AppShell {list, pane, footer, homeActive}`: full 1640x920 window (titlebar + Sidebar + pane + footer). Landscape only.

## 6. uiOffice.tsx ("The Office": pixel-art isometric-ish office, animated by a time `t` in absolute film seconds)
Big file of pixel sprites; only one component is meant for scenes: `OfficeWindow {t}`: a 1824x1008 dark window (`WIN` there = {x48,y36,w1824,h1008,bar56,foot60}) with floor plan of 3 project rooms (desks, scoreboards, lounge, in-tray), characters (dormouse staff) walking to desks, typing, carrying folders to the tray, a waiting "?" agent, mouse cursor click opening its thread; camera zooms driven by `t` vs `CUE`. It hard-codes `CUE.*` times from timeline.ts (office 51.27 .. openThread 66.2) so to reuse in a short either remap `t` (pass `t = CUE.office + localSeconds`) or reuse building blocks. Landscape-assumed (STAGE 1824x~892; floor plan 3 columns); for vertical, render at scale ~0.55 cropped to one room or re-run `floorPlan(PROJECTS, 1)` (planCols picks columns from width).
Exported building blocks (all SVG/pixel, coordinates in the office's own pixel grid): types `OfficeAgentState`, `Point`, `Nav`, `PlanProject`, `Layout`, `PlacedRoom`, `CharPose`; helpers `makeNav`, `planRoute`, `planCols(count,w,h)`, `floorPlan(projects, cols)`; constants `CELL_W 80, CELL_H 74, ROOM_W, ROOM_H, DESKS 4 ...`, `FUR` (4 fur colours), `STATE_COLOR`, `PROJECTS`, `LAYOUT`; sprites `Pix`, `Head`, `Bubble`, `DeskFurniture`, `Character {x,y,variant,pose,moving,frame,flip,carry,folder,headset,shirtColor}`, `Folder`, `CoffeeMachine`, `Cup`, `Table`, `Bench`, `Plant`, `Cooler`, `Shelf`, `WallWindow`, `WallClock`, `UserAvatar`, `ClockAdmirer`.

## 7. uiComputer.tsx (computer-use chapter)
Only export: `ComputerBody {t}` (t = absolute film seconds, hard-coded to `T.computer` 68.8 and CUE.sloganHands/macWindow/background). Full-frame 1920x1080 scene: slogan "Same hands for every agent." that moves to a header, a generic Mac desktop with two windows (a focused Notes-style window where the user types, a background window with provider buttons), a lavender agent cursor labelled "Freddai · Press · <app>" doing the click in the BACKGROUND window while the user's caret/pointer stay put, a tool-call log. Landscape-only, full bleed; for shorts crop/scale it or rebuild with `MacWindow` + `Pointer`. Internal (not exported) pieces: Lights, TitleBar, MacArrow, win style.

## 8. uiPhone.tsx (phone chapter)
Only export: `PhoneBody {t}` (t = absolute seconds from `T.phone` 84.2). Full 1920x1080 dusk scene: sky gradient + stars, a laptop (thread dots pulse while the agent works, waits on a question, then continues after phone approval), an iPhone (430x860 screen, 458x888 with bezel) showing ThreadsList -> ThreadView (reply typed "20 per page", approval card "Allow once", "Allowed once · Waiting for agent...") then an Android phone and a Home recap card. Slogan "From your desk or your phone." The internal `PhoneFrame` (not exported; copy it out if needed) is the best vertical asset: portrait 458x888, scale ~1.3 fits the safe band (1080x1162) nicely. Landscape-assumed layout for the whole scene (laptop left, phones right); phone internals are portrait-native.

## 9. scenes.tsx / scenesB.tsx / Film.tsx (sequencing pattern)
- `timeline.ts`: `FPS=30`, `sec(t)`; `T` = chapter start seconds; `CUE` = per-beat absolute seconds; `VO[]` = {id,start,dur} narration lines; `SFX[]` = {file: tick|pop|chime|whoosh|thump|hit|boom|riser, at, vol}; `musicVolume(frame)` = music-bed gain callback.
- Film mounts each chapter: `<Sequence from={sec(T.chN)} durationInFrames={...} name="..."><ChN/></Sequence>`. Inside a chapter `useCurrentFrame()` is chapter-relative, so scenes convert absolute cues with `const L = (abs, ch) => sec(abs - ch)` (e.g. `L(CUE.window, T.ch2)`), and `useChapterT(start)` = `start + frame/FPS` for scenes that animate by absolute seconds (Office/Computer/Phone).
- Each scene is `<AbsoluteFill style={{background}}>` with layers: background (`LightBg` = cream + 2 `Glow`s, or dark), a `Stage` (absolute box at WIN.x/WIN.y scaled with `scale`/`origin` for camera moves, hosts `Pointer`), overlays (slogan `Words`, `Pop` cards), `Flash` at cuts. Appear animations: `<Pop at={frame}>`, `spring({frame: frame - at, fps, config})`, `ease(frame,a,b)` = clamp+Easing.out(cubic) interpolate, `typed(text, frame, start, cps)` slices a string for typing.
- scenes.tsx exports `Ch1` (terminal chaos + usage limit banner + dormouse peek), `Ch2` (window open, ProviderCard row, UsageFooter rings, picker), `Ch3` (voice composer, grouped ThreadRows, worktree + GitGraph, ScheduleCard), `Close` (terminal again, logo, CTA). Internal pieces worth copying: `Terminal {tabs, lines, ...}` (dark terminal window with tabs and streamed TERM_LINES), `LimitBanner {at, text, tone: amber|green, shake}` ("Usage limit reached - resets in 4h 52m"), `Dialog`, `Field`, `Btn` (fake login dialog bits), `Logo {size,color}` (dormouse + wordmark), `GroupList`, `Stage`, `LightBg`. scenesB.tsx: `OfficeScene`, `ComputerScene`, `PhoneScene` thin wrappers (`<AbsoluteFill bg><OfficeWindow t=.../>`).
- Audio in `Film.tsx` (siblings of the scenes, at the top level so they span chapters): music `<Audio src={staticFile("music/bed.wav")} volume={(f) => musicVolume(f)} />`; each narration `VO.map(l => <Sequence from={sec(l.start)}><Audio src={staticFile(`vo/n-${l.id}.wav`)} volume={1}/></Sequence>)`; each SFX `<Sequence from={sec(s.at)}><Audio src={staticFile(`sfx/${s.file}.wav`)} volume={s.vol}/></Sequence>`.
- Ducking: `musicVolume` base 0.3; for every VO line, between `start-0.15` and `start+dur+0.25` the gain is multiplied by `1 - 0.5*edge` (edge ramps 0..1 over 0.25 s on both sides, so -50% under speech); last 1.6 s linear fade-out to `total`. Whooshes are kept at vol 0.04 (very loud files), thumps 0.5, pop 0.4, chime 0.5, hit 0.9. Note: VO wavs (`public/vo/n-*.wav`) were NOT copied to this project; `vo/voice.json` only. Shorts need their own VO/timeline.
- Film-level extras: dark/light switch -> `Grain` opacity 0.09 dark / 0.03 light; `Flash at=CUE.logo color=cream`.

## 10. Brand/media in public/
`brand/dormouse.svg` (mascot, `staticFile("brand/dormouse.svg")`), `icon.svg`, `companion.png`, `desktop.png` (app screenshots); `music/bed.wav`; `sfx/{tick,pop,chime,whoosh,thump,hit,boom,riser}.wav`; `vo/voice.json` (voice settings only).

## 11. Most reusable for vertical product demos
1. `Words` / `Kicker` / `Typewriter` (text.tsx): wrap, any width.
2. `Composer` (920x280): the hero "say it" shot; scale 1.1.
3. `ProviderCard` + `AccountButton`/`UsageRing`: accounts and usage-left story, stack vertically (470 wide, scale ~1.7).
4. `ThreadRow` + `ProjectGroup` + `ScheduleCard`/`HomeTile`: status lists as vertical cards.
5. `PhoneFrame` (copy out of uiPhone.tsx; portrait 458x888) + `Pop`/`Pointer` for taps.
Avoid at native size: `AppShell`, `UsageFooter`, `OfficeWindow`, `ComputerBody`, `PhoneBody`, `GitGraph` (all assume 1640-1920 wide).

## 12. Shorts components (`src/shorts/`)
All times are SECONDS (`VoLine.start/duration`, `cues`, `music`, `sfx.at`, every `at` prop) except `HookTitle.from` (frames). 30 fps, 1080x1920.
- `types.ts`: `VoLine {id,start,duration,text}`, `ShortTimeline {id,fps:30,durationInFrames,vo,cues,music{turn,lift,hit,end},sfx[{name,at,gain}]}`.
- `ShortShell {tl, children, end?, audio=true}`: ShortFrame (full canvas) + ShortAudio + Captions. Scenes go in `children` (position them absolutely); pass `<EndCard/>` as `end` so it covers the captions. `audio={false}` for demos without wavs.
- `HookTitle {lines, from=0, accent?}`: frame-0 hook on a paper plate at x80..1000, y260. Fully visible at frame 0 when `from<=0`. Mount it in a `<Sequence>` ending at the turn.
- `Captions {vo}` / `Caption {text, at, duration}`: pill at y~1200, 56 px/600, pops in 6 f, hard cut out; lines over 9 words split in two groups.
- `Turn {at}` + `TURN_WIPE_SECONDS=0.5`: dormouse peeks from the bottom-right of the safe band (~1.2 s hold) + paper wipe. The wipe overlay vanishes at `at+0.5`: unmount the old-way scene then (ground underneath is the same paper).
- `EndCard {at}`: paper ground, dormouse + "Freddai" lockup (y700), "Give all your agents a home." (y800), URL + underline (y1150); 1.2 s stage.
- `ShortAudio {tl}`: music `music/<id>.wav` (0.3, -50% ducking under VO, 1.6 s fade-out), VO `vo/n-<id>.wav`, SFX `sfx/<name>.wav` at `gain`. `musicGain(frame, tl)` exported.
- `OldWay.tsx`: `TerminalPane {at, banner, bannerAt, height, lineEvery, style}`, `LoginForm {at, email, style}`, `FolderDialog {at, path, style}`, `TabPile {count, at, style}`; all 940 wide, `at<=0` means visible and static at frame 0.

```tsx
const tl: ShortTimeline = ShortTimelines["short-01-limit"];
export const Short01: React.FC = () => (
  <ShortShell tl={tl} end={<EndCard at={tl.cues.endCard} />}>
    <Sequence durationInFrames={105}><TerminalPane at={0} bannerAt={1} style={{ position: "absolute", left: 70, top: 570 }} /><HookTitle lines={["Hit your AI limit", "mid-task?"]} accent="limit" /></Sequence>
    <Turn at={tl.cues.turn} />
  </ShortShell>
);
```
