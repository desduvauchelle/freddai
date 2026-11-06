# Freddai: switch agents (115 s)

Story: `STORY-CARD.md`. Remotion 4 project: `remotion-project/`.

## Files
- `freddai-switch-agents-115s.mp4` master (-14 LUFS), `freddai-switch-agents-115s-1080p-web.mp4` web encode (send this one)
- `storyboard-contact-sheet.png`, `poster-frame.png` (Office beat, 51.6 s)
- `remotion-project/out/raw.mp4` unmastered render

## Where things live (remotion-project/)
- Timing: `src/timeline.ts` (`T` chapters, `CUE` beats, `VO` narration starts/durations, `SFX`, music ducking). Do not change numbers without re-timing the VO.
- Scenes: `src/scenes.tsx` (chapters 1-3 + close), `src/scenesB.tsx` (Office, computer use, phone); UI kits in `src/ui.tsx`, `uiOffice.tsx`, `uiComputer.tsx`, `uiPhone.tsx`.
- Narration: `public/vo/lines.json` + `public/vo/n-NN.wav`; music/SFX in `public/`. Media is gitignored.

## Re-render
Chrome download fails in the sandbox, so `remotion.config.ts` sets the browser executable
(`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`). Equivalent flag:
`--browser-executable="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.

    cd remotion-project
    npx tsc --noEmit
    npx remotion still src/index.ts Film /tmp/f.png --frame=1548   # one frame
    bash ~/.claude/skills/promo-film/scripts/master.sh ./ Film freddai-switch-agents-115s 51.6

master.sh does not abort on render failure; check the master's mtime and for "An error occurred".
