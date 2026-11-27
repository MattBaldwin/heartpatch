# #37 MX: Christmas Eve mockups (patch bar, notice chip, the fall, gallery), measured

Capture-time mockups only: **no product code changed**. Method as `m0-christmas/README.md`: DOM/CSS overlays (`overrides/mx.css`, `overrides/mx.js`) injected over the real app in Chromium (SwiftShader, `?tier=high`, DPR 2), real server with a real signed-up Keeper and patch.
Frames are downscaled to device size (393x852, 852x393 landscape, iPad 1024x1366) **after** measuring; sidecars `.json` hold the DOM rects, font sizes and insets at shot time. `measure-37-mx.py <dir>` turns them into `measure.md` (every number below is in it, per frame).
Spec: `zz-capture-mx.spec.ts.txt` (copy to `apps/client/tests/e2e/zz-capture-mx.spec.ts`). Runs: iPhone night (`America/Sao_Paulo`), iPhone day (`Asia/Bangkok`), iPad night, iPad day. iPhone has CDP safe-area insets top 59 / bottom 34 (landscape: left/right 59, bottom 21).

## What is real and what is mocked
| | Real | Mocked |
|---|---|---|
| (a) patch bar | the real boss fight (a Rakelet visit pinned into `boss_windows`) and its real 44 px strip, name, energy bar, ⏳ slot, picker | the patch bar itself (DOM node inserted in the strip's second line) and the "Chipped!" sticker. **The boss is Rakelet, not the Eve boss**, and the arena looks the same at night as by day (the arena does not key on the clock; "night" here is the time zone only) |
| (b) notice chip, event card | the map under them, the top HUD and tray | both pieces (copy is a placeholder in STYLE_GUIDE voice) |
| (c) fall, thanks sheet, short-bar morning | the map | flakes, the Snowbundle stand-in, the sticker, both sheets. Present / Frost Dust / Heart Charms in the bundle are placeholders, not decisions |
| (d) gallery | the map under it | the whole sheet and all three drawings (SVG stand-ins, not the 3D renderer; Puddlepuff is a drawn stand-in, not the real species render) |

## Frames (iphone-night, iphone-day, ipad-night, ipad-day: 10 portrait frames each, plus 4 landscape on each iPhone run)
- `a1/a2/a3` patch bar at 0 %, 50 %, 100 % (at 100 % the bar turns gold); `a4` the "Chipped! +12%" sticker moment at 62 %.
- `b1` the notice chip on the map at 16:00 Dec 24 ("A BIG snowy squishy is coming to visit!"); `b2` the event card with the chip.
- `c1` the fall on the map ("Poof! Snowbundle flopped!"); `c2` the thanks sheet with the befriend ask ("Ask to be friends", 3 Heart Charms, 2 asks, warmth hearts); `c3` the short-bar morning at 10:00 Dec 25 ("It dozed off!", thanks bundle, **no asks**).
- `d1` gallery sheet: Snowbundle (big), Bundlebit (tiny form, beside it) and a Puddlepuff for scale.
- `e1..e4` (iPhone only) the b2, c2, c3 and d1 cards with the phone on its side (852x393).
48 frames in total: 14 + 14 (iPhone night, day) + 10 + 10 (iPad night, day).

## Measurements (CSS px; all numbers from the sidecars)
- **The bar never pushes the name or ⏳ out of the 44 px strip: PASS.** At 393 px the strip is 44 px tall (inset 59 + 8 = y 67..111) and 317 wide. Name 214 px wide, not clipped ("Rakelet"; the name flex-shrinks with an ellipsis, as on `main`); the ⏳ slot keeps its 20 px; the energy bar and the patch bar are 130 px each (patch bar = ❄ + track + %), inside the strip, no overlap with the slot or the energy bar, at 0 %, 50 % (`50%`, 32 px) and 100 % (`100%`, 35 px) and 62 %. The patch bar takes its room from the energy bar (about 252 px at iPad, 130 px at iPhone), never from the name or slot: the name's width is the same with or without it.
  - **Cost to flag:** the energy bar is now about half as wide (it used to take the whole second line). A real PR should decide that on a phone.
- **Notice chip clears the safe area: PASS.** Chip at y 177..221 on the iPhone (inset top 59; the top HUD row ends at 167), 12 px side margins; it overlaps no real control (the first version at y 123..167 sat on the heart pill and was moved; the check runs on every b-frame and finds nothing). In landscape (insets l/r 59) it sits y 64..108 with no overlap.
- **Cards fit a phone on its side: PASS.** In 852x393 with insets l59 r59 b21: event card 346 px tall at y 14..360, thanks sheet 306 px, morning card 256 px, gallery 352 px (two columns): all inside the safe area and none scrolls (`scrollHeight == clientHeight`, full per-frame in `measure.md`). In portrait all sheets end 12 px above the 34 px bottom inset.
- **Text sizes: PASS for the smallest the style guide implies.** STYLE_GUIDE has no explicit minimum; tap targets are 44 pt. Smallest text here is **12 px** (the % on the bar, the gallery labels, the small "3 💖" cost), body copy is 14 px, titles 20 to 22 px, stickers 16 px; the boss name on `main` is 14 px. If the owner wants a 14 px floor, the % and the labels need a bump. Tap targets (buttons, ✕) are all at least 44 px (min measured 44; the bar is display-only).
- **Scale (gallery):** Snowbundle is 3.5x the height of the Puddlepuff stand-in on the phone (273 vs 77 px; 3.4x in landscape), and Bundlebit is about its size (78 vs 77 px).
- No FAIL: nothing crosses an inset, nothing clips.

## Not shot / known gaps
- The patch bar is only shown in the portrait fight; landscape fights have the same strip (not shot).
- The ⏳ slot is hidden at rest (its room is reserved), so no frame shows ⏳ next to the bar; the measurement shows the room stays.
- Iterations: the first notice chip overlapped the heart pill and the first landscape gallery scrolled; both fixed before the final run (the final run is the only one committed).
