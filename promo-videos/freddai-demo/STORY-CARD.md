# Freddai — promo film story card (v2, "Switch agents, not your workflow")

Approved answers folded in. Nothing is rendered until you say go on this version.

## The one line
**"Switch agents. Not your whole workflow."** Freddai is a desktop app that puts all your coding agents, accounts and usage limits in one place, with a phone companion so your agents keep working while you move.

On-screen slogan pair (two beats, never together): **Switch agents. Not your whole workflow.** at the end of the juggle, and **From your desk or your phone.** at the phone chapter. Third and fourth slogan moments: **Same hands for every agent.** (computer use) and the close, **Give all your agents a home.** Four slogan moments in total, nothing else is a headline.

## Audience, length, voice
- Audience: solo developers with several AI subscriptions. Not teams, so no "your team" language anywhere.
- Length: about 112 s (range 105 to 120 s, set by the narration), about 270 words.
- Voice: the existing Tucky narrator (warm, calm, a little wry), reused.
- Providers named on screen: Codex, Claude Code, Gemini, Grok (all four are in the repo's supported provider list; shown as normal, no "experimental" label).
- Everything shown is treated as published and working, including iOS and Android. No "pending" or "beta" caveats.
- End card: URL only, `freddai.ai-juicing.com` (production URL per `apps/web/README.md`).

## The shape of the story
A day with too many subscriptions. It opens on the old routine (limit hits, log out, log in, rebuild the setup), turns into the calm version (one app, every account, say it and let it run), then widens twice: you can watch your agents like an office, and every agent gets the same hands on your Mac. Last, you leave the desk and the work follows you to your phone. The close replays the opening limit banner, now harmless. The viewer should feel calmer: less juggling, nothing lost, nothing waiting on them unseen.

Palette and craft: warm paper (light) with forest/sage green, dark variant for the product UI scenes; dormouse mascot only at the open turn and the close. Product UI rebuilt natively in React from the repo (Office from `packages/app/src/office`, fixtures in `packages/app/tests/fixtures`), not stock footage. No keycaps, no chapter-title overlays. The narration carries the structure.

## Beat sheet (about 112 s)

### Chapter 1 · The juggle (0:00 – 0:20)
| Time | On screen | Narration |
|---|---|---|
| 0:00 | Terminal-ish screen, an agent working. Banner: usage limit reached. | "You're mid-task when the limit hits." |
| 0:05 | The old routine, sped up: log out, log in to the other account, reopen the folder, re-explain. Tabs pile up. | "So you log out. Log in to your other account. Set the project up again. Find your place." |
| 0:14 | Beat of silence. | "Again." |
| 0:16 | Dormouse peeks in. Slogan: **Switch agents. Not your whole workflow.** | "There's a calmer way to do this." |

### Chapter 2 · One app, every account (0:20 – 0:42)
| Time | On screen | Narration |
|---|---|---|
| 0:21 | Freddai window opens. Provider chips appear one by one: Codex, Claude Code, Gemini, Grok, each with its accounts. | "Freddai puts Codex, Claude Code, Gemini and Grok in one app. Every account, side by side." |
| 0:29 | Zoom to the footer usage rings: percent left, reset times, one amber. | "See how much each account has left, and when it resets." |
| 0:36 | New thread: pick project, pick account, start. The other account untouched. | "Pick the account for the job. Nobody logs out." |

### Chapter 3 · Say it, let it run (0:42 – 1:00)
| Time | On screen | Narration |
|---|---|---|
| 0:43 | Home, projects in colour. Mic, waveform breathes, text lands, start. | "Pick a project, say what needs doing, and let it run." |
| 0:49 | Threads grouped by project, status dots; finished ones dim. Worktree toggle on a second thread, separate branch in git history. | "Threads group by project, finished ones step aside. Two agents in one repo? Give one its own worktree." |
| 0:57 | Schedules: weekday 9 AM routine, next-run label. | "And routines run on a schedule, without you." |

### Chapter 4 · The Office (1:00 – 1:20)
Truthful to `packages/app/src/office`: a fixed floor plan, one room per project with its name plate and scoreboard (messages, threads, working), desks per thread, pixel characters that walk (path-finding, seated typing, carrying a folder to the in-tray when done), a lobby with a receptionist and waiting benches for starting or queued threads, a coffee lounge where threads that need you wait with a "?" bubble, a clock shrine for scheduled routines. Click an agent to open its thread.
| Time | On screen | Narration |
|---|---|---|
| 1:00 | Office view fills the window: three coloured project rooms, scoreboards ticking. | "Then there's the Office. Every project is a room, every thread is someone at a desk." |
| 1:08 | Characters walk to desks and type; one finishes and carries a folder out. | "Working agents walk to their desks. Finished ones hand in their folder." |
| 1:13 | A "?" character sits in the lounge; click opens its thread. | "The ones that need you wait in the lounge, question mark overhead." |

### Chapter 5 · Same hands for every agent (1:20 – 1:36)
| Time | On screen | Narration |
|---|---|---|
| 1:20 | Slogan: **Same hands for every agent.** Behind it, a Mac window with the agent cursor gliding to a button. | "Some agents drive a Mac better than others. So Freddai gives every one of them the same computer-use tools." |
| 1:29 | Agent cursor presses a control inside a background window; the person's own cursor and focused app stay put. | "It works in the background, with a visible cursor. Your own windows stay yours." |

### Chapter 6 · Your desk is optional (1:36 – 1:52)
| Time | On screen | Narration |
|---|---|---|
| 1:36 | Dusk, laptop open on a desk, dots pulsing. Slogan: **From your desk or your phone.** | "And your desk is optional. Your agents keep working on the Mac." |
| 1:41 | Phone (iPhone, then Android) companion: project groups, one thread flags a question. Tap reply, approve. | "Your phone, iPhone or Android, tells you when one needs you. Reply. Approve. Keep moving." |
| 1:48 | Home recap card for the day. | "At the end of the day, a recap of what shipped." |

### Close (1:52 – 2:05)
| Time | On screen | Narration |
|---|---|---|
| 1:54 | The opening terminal again, limit banner, an account switch, work carries on. Dormouse waves. | "The limit still hits. It just stops mattering." |
| 1:59 | Logo (dormouse + wordmark), **Give all your agents a home.** | "Give all your agents a home." |
| 2:03 | End card: `freddai.ai-juicing.com` only. | "Freddai." |

(Final times come from the measured narration; the cue table in `src/timeline.ts` is the source of truth.)

## Feature claims used, with source
| Claim | Source |
|---|---|
| Accounts and usage limits in one app; no logout/login; project set up once | `apps/web/src/i18n/dictionaries/en.ts` |
| Footer ring meters: percent left, reset time, amber when low | `docs/spec.md` "Provider accounts, local sessions, and usage" |
| Multiple independent profiles per provider: Claude, ChatGPT/Codex, Gemini, Grok | `docs/spec.md` line 265 |
| Microphone on Home starts a thread | `en.ts` dashboardTitle/Body |
| Threads by project; finished ones step aside | `en.ts` threadTitle/Body; `docs/spec.md` sidebar lifecycle |
| Optional worktrees; git history graph | `docs/spec.md` "Shared folders and optional parallel work", "Git history view" |
| App-owned schedules | `docs/spec.md` "App-owned schedules" |
| Office: rooms per project, scoreboards, desks, walking characters, lobby, lounge "waiting for you", in-tray, clock shrine, click to open thread | `packages/app/src/office/{Office.tsx,officeModel.ts,officeStage.ts,officeLayout.ts}` (the spec text calling it a static placeholder is outdated) |
| Computer use: signed helper `Freddai Computer.app`; the same `freddai_computer` MCP server injected into Codex, Claude and ACP providers (Gemini, Grok, others); background mode by default (no app activation, no focus or physical pointer change), visible agent cursor | `docs/spec.md` "Native computer use milestone 1", "Background" section, "Local MCP bridge" (line ~2286); `apps/native/computer-use/main.swift` (`AgentCursor`); `crates/core/src/computer_use.rs` |
| Phone companion for iPhone and Android: reply, approve, live progress; work runs on the Mac | `README.md`; `docs/android.md`; `en.ts` mobile copy |
| Daily recap across projects | `en.ts` recapTitle/Body |

Note on computer use: the spec says per-provider live behaviour is not claimed and "a shared execution surface, not model-quality parity". The film says "same tools", not "same results".

No numbers, customers or awards appear; none exist in the repo.

## Brand assets (under `/Users/denisduvauchelle/Documents/code/freddai`)
- Mascot `apps/web/public/brand/dormouse.svg`, app icon `apps/web/public/brand/icon.svg`, captures `apps/web/public/screenshots/{desktop,companion}.png` (copied to `public/brand/`).
- Palette: light `#faf9f5` / `#eeefe6` / `#dadccf`, text `#282d23`, primary `#4d613d`; dark `#1e241e` / `#282f26` / `#404a3b`, text `#f0f1e7`, primary `#b9c99a`. Mascot fur `#D3A16B`. Font `system-ui`.

## Why it works
- Opens on a real friction and closes by replaying it solved.
- Two "wow" chapters (Office, computer use) sit in the middle after the practical spine is clear, so the film stays about workflow, not gadgets.
- Phone chapter is the exhale; the Mac still does the work.
- Only claims the repo supports; four slogan moments, no keycaps, no chapter overlays.

## Open questions for you
1. Phone pair: happy with "From your desk or your phone." as the second slogan?
2. Computer-use chapter shows a generic Mac window (not a real third-party app). OK?
3. Office chapter uses sample projects and agents, names invented by me. OK?
