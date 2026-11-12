# Freddai Shorts — 10 vertical clips (plan v1)

Same concept as the 115 s promo (`../freddai-demo/STORY-CARD.md`): a real friction, then the calm version in the product's own UI, same narrator (Tucky Narrator, Hume), same warm-paper / forest-green look, dormouse only at the turn and the close. Each Short is one pain → one fix → one demo → end card.

OUTPUT: 1080×1920, 30 fps, 25–32 s each. Platform safe band: nothing meaningful above y=168 or below y=1330.
FRAME 0 = the hook: the bold hook line already on screen over the "old way" scene. Never black, never a logo.
MUTED VIEWERS: every narration line is also on screen as a caption group (2–5 words, bottom of the safe band, ~y 1150–1300), or is itself the headline.
SOUND: Hume narration (voice.json already saved), `music-warm.cjs` bed with `turn` at the fix, `hit` at the end card; SFX one per visual event.
END CARD (last 3 s, shared component): dormouse lands, wordmark "Freddai" wipes in, line "Give all your agents a home.", URL `freddai.ai-juicing.com`.
SHAPE (frames at 30 fps):
  0–90    HOOK: hook line on screen at frame 0 + the old-way scene behind it (narration line 01)
  90–270  PAIN: the old routine, sped up (line 02)
  270–330 TURN: dormouse peeks in, whoosh + thump, ground goes from the old-way surface to Freddai
  330–720 FIX + DEMO: the real rebuilt UI performing the action (lines 03–04), camera on the one control
  720–810 PAYOFF line (line 05) when there is one
  last 90 END CARD (final line "Freddai. Give all your agents a home.")

## The ten

| # | id | Hook (frame 0, ≤5 words/line) | Pain shown | Fix shown (UI kit) |
|---|----|------|-----------|-----------|
| 01 | limit | Hit your AI limit mid-task? | terminal, limit banner, logout/login/reopen folder sped up | AccountPicker: pick the other account, the thread carries on |
| 02 | usage | How much AI is left? | three provider apps opened one after another to check | footer usage rings: percent, reset time, one amber |
| 03 | reexplain | Stop re-explaining your project. | the same context typed into a fresh chat, again | New thread: project + account picker, four providers, same desk |
| 04 | thousand | A thousand old chats. One you need. | endless chat list scrolling, search, give up | threads grouped by project, finished ones dim and step aside |
| 05 | needsyou | Your agent waited an hour. | a "?" buried in a background tab, work stopped | Home "Needs you" column: allow / decline / answer in place |
| 06 | phone | Leave your desk. Agents keep working. | laptop at dusk, dots pulsing, nobody there | phone companion: ping, reply, approve, keep moving |
| 07 | voice | Just say it. | long prompt being typed, backspaced, retyped | Home mic: waveform breathes, text lands, thread starts |
| 08 | routines | Same chores every morning? | checklist of daily agent chores, same list three days | Schedules: weekday 9 AM routine, next-run label |
| 09 | office | Watch your agents work. Literally. | (no pain beat, pure wow) | Office: rooms, desks, walking mice, folder in-tray, lounge "?" |
| 10 | hands | Some agents can't use your Mac. | an agent stuck at "I can't click that" | agent cursor glides and presses a control in a background window |

## Narration (public/vo/lines.json seeds — ids are `<short>-<line>`)

01 limit
- 01-01 Hit your limit mid-task… again?
- 01-02 So you log out. Log into the other account. Set the project up. Find your place.
- 01-03 Freddai keeps every account in one app.
- 01-04 Pick the other one. Keep going. Nobody logs out.
- 01-05 Switch agents. Not your whole workflow.
- 01-06 Freddai. Give all your agents a home.

02 usage
- 02-01 How much do you have left on each account?
- 02-02 Open Claude. Check. Open Codex. Check. Open Gemini… you get it.
- 02-03 Freddai shows every account's usage in one footer. Percent left, and when it resets.
- 02-04 One amber ring, and you know before it bites.
- 02-05 Freddai. Give all your agents a home.

03 reexplain
- 03-01 Still re-explaining your project to every new agent?
- 03-02 Same folder. Same context. Typed out, again and again.
- 03-03 In Freddai, a project is set up once.
- 03-04 New thread: pick the project, pick the account, go. Codex, Claude, Gemini, Grok. Same desk.
- 03-05 Freddai. Give all your agents a home.

04 thousand
- 04-01 Which of your thousand old chats was the one that mattered?
- 04-02 Scrolling. Searching. Giving up, and starting over.
- 04-03 Freddai groups threads by project. Finished ones step aside.
- 04-04 What's live stays on top. What's done gets out of the way.
- 04-05 Freddai. Give all your agents a home.

05 needsyou
- 05-01 Your agent asked a question an hour ago. You never saw it.
- 05-02 Buried in a tab. Work stopped. Nobody told you.
- 05-03 Freddai's Home has a column called Needs you.
- 05-04 Every question, every approval, in one place. Allow, decline, answer. Done.
- 05-05 Freddai. Give all your agents a home.

06 phone
- 06-01 Chained to your desk while your agents work?
- 06-02 Your desk is optional.
- 06-03 Freddai's phone companion tells you when an agent needs you.
- 06-04 Reply. Approve. Keep moving. The Mac does the work.
- 06-05 Freddai. Give all your agents a home.

07 voice
- 07-01 Typing out every task for your agent?
- 07-02 Pick a project. Press the mic. Say what needs doing.
- 07-03 Freddai turns it into a thread, and lets it run.
- 07-04 Hands free. Head up.
- 07-05 Freddai. Give all your agents a home.

08 routines
- 08-01 Same agent chores every morning?
- 08-02 Update the deps. Triage the issues. Draft the standup. You, every single day.
- 08-03 Freddai runs routines on a schedule.
- 08-04 Weekdays, nine a.m. Done before your coffee.
- 08-05 Freddai. Give all your agents a home.

09 office
- 09-01 Ever wonder what your agents are actually doing right now?
- 09-02 Freddai has an Office. Every project is a room. Every thread is someone at a desk.
- 09-03 Working agents type. Finished ones hand in their folder.
- 09-04 The ones that need you wait in the lounge, question mark overhead.
- 09-05 Freddai. Give all your agents a home.

10 hands
- 10-01 Some agents drive a Mac better than others.
- 10-02 Freddai gives every one of them the same hands.
- 10-03 A visible agent cursor, working in the background. Your own windows stay yours.
- 10-04 Same hands for every agent.
- 10-05 Freddai. Give all your agents a home.

## Claims and sources
All claims are the ones already sourced in `../freddai-demo/STORY-CARD.md` ("Feature claims used, with source"). Nothing new is claimed. Providers shown: Codex, Claude Code, Gemini, Grok.

## Banned
Keycaps, chapter-title overlays, a logo docked in a corner, stock footage, any invented control, text under the right-hand action rail, anything to read under 36 px at 1080×1920.


---

# V2 — vibe coding

Angle from Denis: "Vibe coding heaven." You talk and it's done; set and forget; super smooth; works on your phone; switch accounts when you have more than one, because vibe coders hit usage limits. Ten new Shorts (ids 11-20), same kit, same narrator, same look, 20-45 s each. No features beyond: voice, threads running on their own, accounts/picker/usage rings, phone companion, four providers, schedules, computer control. Source: `v2/spec.json` (lines), audio built by `v2/build-audio.cjs`. Compositions `src/shorts/V2Short*.tsx`, registered in `src/shorts/groupV2.ts`.

## 11 talk — You talk. It's done.
- Hook: You talk. It's done.
- Beats: Hook plate + composer with mic idle at frame 0. Mic press, waveform breathes, the spoken sentence lands as text, send, a new thread row starts running.
- Narration:
  - 11-01 You talk. It's done.
  - 11-02 No typing out the prompt. No fiddling with settings.
  - 11-03 In Freddai you pick a project, press the mic, and just say what you want.
  - 11-04 Add a dark mode toggle to the settings page. Like you'd tell a person.
  - 11-05 It becomes a thread, and the agent gets to work.
  - 11-06 Talk, and it's done.
  - 11-07 Freddai. Give all your agents a home.

## 12 setforget — Set it and forget it
- Hook: Set it. Forget it.
- Beats: Hook over a fresh thread starting. User walks away (empty chair / dimmed composer). Thread rows tick running to done while the wall-clock label jumps forward. Finished rows dim and settle.
- Narration:
  - 12-01 Set it. Forget it.
  - 12-02 Start a task, then go do something else.
  - 12-03 No babysitting a terminal. No watching it type.
  - 12-04 Freddai lets every agent run on its own, and keeps every thread in one place.
  - 12-05 Come back later and the finished ones are already sitting there, done.
  - 12-06 Set and forget. Finally.
  - 12-07 Freddai. Give all your agents a home.

## 13 picker — Pick the account for each thread
- Hook: Which account takes this one?
- Beats: Hook over two account chips (one nearly empty ring, one full). Turn. Composer with account chip, picker opens, tap the roomy account, send, thread starts under that account.
- Narration:
  - 13-01 Which account should take this one?
  - 13-02 Your main one is nearly empty. Your other one is wide open.
  - 13-03 In Freddai, you choose the account for every new thread.
  - 13-04 Open the picker, tap the one with room, and send it.
  - 13-05 Same project, different account. That's all it takes.
  - 13-06 Freddai. Give all your agents a home.

## 14 twoacc — One account is never enough
- Hook: One account is never enough.
- Beats: Hook over a pile of logins (login form x3). Turn. ProviderCards stacked, two accounts each, signed-in ticks, Default tag moves between accounts.
- Narration:
  - 14-01 Vibe coders burn through usage. One account is never enough.
  - 14-02 So you get a second one. Then a third.
  - 14-03 Then you spend half your day logging in and out.
  - 14-04 Freddai keeps all of them signed in, side by side. Claude, Codex, Gemini, Grok.
  - 14-05 Mark one as the default, and switch whenever you want.
  - 14-06 Accounts stop being a chore.
  - 14-07 Freddai. Give all your agents a home.

## 15 limit — Limit hit mid-flow
- Hook: Limit hit. Mid-flow.
- Beats: Hook over terminal with the limit banner (resets in hours). Turn. Thread header account chip, picker, new account chosen, the thread resumes streaming output.
- Narration:
  - 15-01 Limit hit. Right in the middle of a good run.
  - 15-02 Normally, that's your evening gone.
  - 15-03 The banner says come back in a few hours.
  - 15-04 In Freddai, you just pick another account.
  - 15-05 The thread keeps going. You never log out, and you never lose your place.
  - 15-06 Same project, same thread, new account.
  - 15-07 Limits stop being a big deal.
  - 15-08 Freddai. Give all your agents a home.

## 16 usage — Know what's left
- Hook: Know what's left. Before it runs out.
- Beats: Hook over usage rings column at frame 0. Rings fill with percent + reset time, one goes amber, pointer taps another account, ring highlights.
- Narration:
  - 16-01 Know what's left before it runs out.
  - 16-02 Freddai shows every account's usage in one strip.
  - 16-03 Percent remaining, and when it resets.
  - 16-04 Claude, Codex, Gemini, Grok. All in the same place.
  - 16-05 One ring turns amber. That's your cue to switch.
  - 16-06 No more opening three apps to check.
  - 16-07 Switch, and keep vibing.
  - 16-08 Freddai. Give all your agents a home.

## 17 phone — Vibe code from the couch
- Hook: Vibe code from the couch.
- Beats: Hook over a phone frame in a hand-free dusk scene. Ping, thread list, reply typed, Allow once, the agent continues. Laptop dot keeps pulsing behind.
- Narration:
  - 17-01 Vibe code from the couch.
  - 17-02 Start the work at your desk. Then walk away.
  - 17-03 Walk the dog. Make a coffee. Go outside.
  - 17-04 Freddai works on your phone too. It pings you when an agent needs something.
  - 17-05 Reply or approve, and it carries on. The Mac does the heavy lifting.
  - 17-06 Your desk is optional.
  - 17-07 Freddai. Give all your agents a home.

## 18 smooth — Four agents, one smooth desk
- Hook: Four agents. One smooth desk.
- Beats: Hook over four provider glyphs. New thread: project chip, agent chip flips Claude, Codex, Gemini, Grok, send; thread list gains four running rows on one desk.
- Narration:
  - 18-01 Claude. Codex. Gemini. Grok.
  - 18-02 Different agents, usually in different apps.
  - 18-03 No hopping between apps to find the right one.
  - 18-04 In Freddai it's one desk. Pick the project, pick the agent, go.
  - 18-05 No setup rituals. No tab juggling. It just flows.
  - 18-06 Start another thread while the first one runs.
  - 18-07 That's the whole point. Smooth.
  - 18-08 Freddai. Give all your agents a home.

## 19 sleep — Vibe code while you sleep
- Hook: Vibe code while you sleep.
- Beats: Hook over a night sky / sleeping desk. ScheduleCard weekday 9 AM with next-run label, the clock jumps to morning, the routine shows done.
- Narration:
  - 19-01 Vibe code while you sleep.
  - 19-02 Some jobs come back every day. Update the dependencies. Triage the issues.
  - 19-03 Give them a schedule in Freddai. Weekdays, nine a.m.
  - 19-04 Set it once. It runs by itself, and the next run is right there on the card.
  - 19-05 Set and forget, on a timer.
  - 19-06 Freddai. Give all your agents a home.

## 20 hands — Your agent can use your Mac
- Hook: Your agent can use your Mac.
- Beats: Hook over a Mac desktop with a background window. Agent cursor labelled in lavender glides and presses a control in the background window while the user's own window stays put.
- Narration:
  - 20-01 Your agent can use your Mac.
  - 20-02 Not just write code. Actually click things.
  - 20-03 Open an app. Press a button. Fill in a form.
  - 20-04 Freddai gives agents computer control, with a visible cursor working in the background.
  - 20-05 Your own windows stay yours. You keep working while it does.
  - 20-06 Give it a job, and watch the cursor go.
  - 20-07 Talk, and it's done. Even the clicking.
  - 20-08 Freddai. Give all your agents a home.
