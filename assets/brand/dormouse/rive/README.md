# Freddai dormouse Rive motion study

Selected artwork: `../dormouse-v3.svg`, the smaller body approved after reviewing v4. `../dormouse.svg` and `../dormouse-icon.svg` are identical copies of the selected v3 assets. v4 remains an archived alternative. The rig reads v3 directly and does not alter its SVG geometry.

## Build and preview

```sh
python3 gen_scene.py
~/.rive/bin/rive . --verify
~/.rive/bin/rive inspect . --summary
~/.rive/bin/rive . --once
~/.rive/bin/rive .
```

The last command opens the local Rive preview window and watches source changes. No Rive account, upload or publishing is needed. There are no embedded scripts or external assets. `build/freddai-dormouse.riv` is the local runtime asset. `scene.rml`, `gen_scene.py` and `vector_tools.py` are editable authoring sources. The app now loads the standalone copy at `../freddai-dormouse.riv`. Browser playback is verified; installed native playback is currently blocked by the macOS startup recovery/crash issue described in the product specification. After rebuilding, copy `build/freddai-dormouse.riv` to `../freddai-dormouse.riv` to update the app asset.

To regenerate the review video, run `python3 render_preview.py`. It requires Pillow, ffmpeg, the local Rive CLI and the macOS Arial font. It captures actual Rive state-machine frames rather than approximating motion in another animation system. Output: `build/dormouse-states.mp4`, `build/states.png` and a frame manifest.

## Runtime contract

Artboard: `Freddai`. State machine: `Main`. Bound view model: `Pet`.

| Property | Type | Values |
| --- | --- | --- |
| `mood` | number | Integer state values below |
| `lookX` | number | -1 left, 0 center, 1 right |
| `lookY` | number | -1 up, 0 center, 1 down |
| `poke` | trigger | Play a small squash and recovery |

| Mood | State | Motion (bold, readable at 38 px) | App mapping |
| --- | --- | --- | --- |
| 0 | Idle | Calm: breath, occasional blink, nose sniff, ear flick | No active work |
| 1 | Listening | Gentle attentive tilt and lifted brows | Reserved |
| 2 | Working | Loop: head bobs down/up (about 9% of artboard height), eyes look down, paws alternate in front of the chest, tail wags, thought bubble with bouncing dots | Starting/running |
| 3 | Paused | Relaxed half-open eyes | Reserved |
| 4 | Waiting | Loop: looks at viewer, brows raised, ears perked, one paw raised high on a visible arm and waving slowly, "?" bubble | Pending input, or unread finished reply |
| 5 | Saved | Brief pleased smile and nod, then neutral | Reserved |
| 6 | Done | Reaction then held: two big hops, both paws up, happy ^ ^ eyes, sparkle stars pop; settles to a held content pose (smile, ^ ^ eyes, paws at chest) while stars twinkle and the body sways | Finished and read |
| 7 | Interrupted | Held pause stance: slumped, half-lidded, flat mouth, ears slightly down, paws down, "pause" mark | Interrupted |
| 8 | Failed | Held: frown, droopy ears, tail down, sweat drop | Failed |
| 9 | Hula | Loop (144 f): hip sway via `Groove`, arms sweep side to side, grass skirt strands lag the sway, flower lei, happy eyes, wagging tail | App mapping: random idle antic |
| 10 | Skate | Loop (180 f): rides a skateboard (wheels spin, speed lines), drifts across, leans, kick-pushes and one ollie, ears pinned back | App mapping: random idle antic |
| 11 | Gaming | Loop (144 f): holds a controller, paws tap, pupils dart, focused brows, brief happy "win" hop | App mapping: random idle antic |
| 12 | Snooze | Loop (240 f): eyes closed, head tilted and drooped, slow breath, tucked paws, rising Z glyphs | App mapping: random idle antic |
| 13 | Juggle | Loop (120 f): three-ball cascade above the head, arms alternate small tosses, eyes look up | App mapping: random idle antic |
| 14 | Jam | Loop (96 f): headphones, head bangs on the beat, paws drum the belly, rising music notes | App mapping: random idle antic |

Moods 2, 4 and 9-14 loop. Moods 9-14 are playful anticks: every prop (skirt, board, controller, headphones, glyphs) is opacity 0 in all other moods; `Groove` is a body wrapper between `Breath` and the art that every mood resets. 3, 4-settle, 7 and 8 hold their final pose; 6 holds a content pose and keeps looping sparkles and sway on a separate `Celebrate` layer (it starts when mood becomes 6 and resets when mood leaves 6). Reaction 5 finishes neutral. The host should set mood 0 and then 6 again to replay the Done reaction. Do not continuously resend completion events during renders. Gaze and poke are independent layers and work on top of every mood. Overlay props (bubbles, sparkles, drop, pause mark) sit near the artboard corners; the app lets the animated art overflow the circular disc so they are not clipped.

Review sheets: `python3 render_moods.py [out_dir]` renders several frames per mood at 240, 148 and 38 px (`mascot3-moods-*.png`).

Reduced motion: show `../dormouse.svg` as a static fallback, retaining status text and controls. The mascot must supplement existing status/approval UI and must never imply that work happened without runtime evidence.

## Tucky reference and adaptation

Read-only sources:

- `/Users/denisduvauchelle/Documents/code/tucky/public/mascot/tucky-animated.svg`
- `/Users/denisduvauchelle/Documents/code/tucky/src/desktop-pet/rive/tucky-v2/gen_scene.py`
- `/Users/denisduvauchelle/Documents/code/tucky/src/desktop-pet/RiveTucky.tsx`

`vector_tools.py` adapts Tucky's path-to-vertices, node emission and timeline helpers. Freddai's importer bakes the approved SVG's static transforms, preserves named parts and eye clips, and adds separate blink, gaze, head pose, breathing and poke groups. Unlike Tucky, this character has no bag, paper, writing, or ripping props. State gestures use the dormouse's paws and expressions instead. No Tucky project files were changed.

## Verification and limits

- Local Rive compile verification and resolved-tree inspection pass without errors or warnings.
- All nine moods, poke and both gaze directions were rendered through the local state machine for the review clip.
- Sampled frames were checked to differ for idle, thinking, needs input, completion, poke and gaze.
- Representative state frames were visually inspected, including a blink and failure expression.
- The header integration now connects the selected thread and OS reduced-motion preference, with a persistent pause control and static SVG fallback. The app was rebuilt, signed and installed. Browser playback and interaction are verified; installed native playback remains blocked by a macOS startup recovery/crash issue. No live provider turn, upload or deployment was performed.
