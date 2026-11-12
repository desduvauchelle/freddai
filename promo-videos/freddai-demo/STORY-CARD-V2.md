# Freddai promo film V2: "Vibe coding heaven."

Composition `FreddaiVibeCoding` (Remotion, 1920x1080, 30 fps, 69.6 s) in `remotion-project/`, next to the original `Film`. The original is untouched. Narrator: Tucky Narrator 7fht5v (Hume). Audience: vibe coders (you talk, the agent builds).

## The one line
**Vibe coding heaven.** You talk, and it's done. Set it and forget it. It's smooth. It works on your phone. When you hit a usage limit, you switch accounts and keep going.

## Hook (0:00 - 0:08)
A vibe coder mid-flow in a terminal, then the usage limit banner. "Not here." Cut to the Freddai logo and the title.
"Vibe coding is great. Until the usage limit hits. Not here. This is Freddai. Vibe coding heaven."

## Beats and narration
| Time | Beat | On screen | Narration |
|---|---|---|---|
| 0:00 | Hook | Terminal builds a dashboard, limit banner at 3.1 s, "Not here." (new) | "Vibe coding is great. Until the usage limit hits." / "Not here." |
| 0:06 | Title | Cream card, logo, "Vibe coding heaven." (new) | "This is Freddai. Vibe coding heaven." |
| 0:10 | You talk, it's done | Mic, waveform, dictated task, Start; thread dims and folds (reused Ch3) | "You talk, and it's done." / "Pick a project. Say what you want. Then forget about it." |
| 0:17 | Set it and forget it | Threads by project, finished step aside, then Schedules (reused Ch3) | "Your threads sit in their projects, and the finished ones step aside. Set it, and forget it." |
| 0:24 | Smooth | The Office view, rooms and agents at desks (reused Office) | "It's all super smooth. Every project is a room. Every thread is an agent at a desk." |
| 0:31 | More than one account | Six account cards pop in, "More than one account." (new) | "Now, if you vibe code, you probably have more than one account." |
| 0:37 | One place | Accounts panel, provider cards, then the usage-left spotlight with Claude Max amber at 9% (reused Ch2) | "Freddai keeps them all in one place. Codex, Claude Code, Gemini, Grok. And you can see what's left on each." |
| 0:45 | FEATURED: switch accounts | Thread hits the limit; click the account menu, pick Claude Code work; green "Switched, carrying on"; thread finishes (new) | "Hit a limit? Switch accounts, and keep going." |
| 0:49 | No re-login | "Log out", "Log in", "Start over" slam in and get struck through (new) | "No logging out. No logging in. No starting over." |
| 0:54 | Phone | Laptop and iPhone/Android, thread asks a question, reply, approve, done, recap (reused phone chapter, new caption "Works on your phone too.") | "And it works on your phone too." / "Your agent has a question? Answer it from the couch. Approve it. Done." |
| 1:04 | Close | Logo + "Vibe coding heaven." then the URL (new, built from original close styling) | "Vibe coding heaven." / "Freddai." |

Total 69.6 s (original: 115 s).

## Rules kept
Only features from the brief and the original film's claims: voice tasks, projects and threads, schedules, the Office, multiple accounts with usage and reset times, switching accounts, phone companion. No invented numbers, prices or customers.

## Audio
Hume TTS (voice.json "Tucky Narrator 7fht5v"), `music-warm.cjs` bed (turn 9.5, lift 44, hit 63.9, end 69), original SFX set reused, mastered to -14 LUFS.

## Where it lives
`src/timelineV2.ts` (timing, VO, SFX), `src/FilmV2.tsx` (assembly; `Slice` replays chapters of the original film at a remapped time), `src/scenesV2.tsx` (new scenes), `public/vo-v2/` (lines.json + audio), `public/music/bed-v2.wav`.
