# #868 round 2: captures on `19a0d8c` (boss face in frame, team eyes vs cards)

Numbers come from `measure-868-round2.py` (PIL + numpy over each full-size PNG and its `data/*.json` sidecar: hook `scene.framing`
= `distance, fogEnd, band, face, team[], bossFacing`, `scene.playing`, `scene.shields`, and DOM rects). PNGs here are downscaled
to 393x852 (the measured originals were 786x1704, DPR 2). Tier `high`, Chromium + SwiftShader, no dev HUD.
iPhone 393x852 with CDP safe-area insets top 59 / bottom 34; iPad 820x1180. Night = tz America/Sao_Paulo (~03:00 local), day = Asia/Bangkok (~13:00). Boss Rakelet, team Lv 30, Partner Lv 18.

## How before/after pairs were made (same instant, by construction)
One build, `19a0d8c`, plus a one-line capture overlay (`overlay.diff`, never committed to the PR): when `globalThis.__noSlide` is set, the camera director snaps its slide `#drop` to 0 after its hold line.
With the slide at 0 the shot is main's `505fb56` camera (distance, cap, fog and shift are the #867 values). Each step: the page clock is frozen (`__capScale(0)`),
**after** is shot, `__noSlide` flips on, one frame renders, **before** is shot, then it flips off. So a pair shares the same round, move, caption, pose, team state and boss facing exactly.
I did not shoot a separate `505fb56` checkout: the overlay is the only way to get an identical frame, and main's hook has no `face`/`band`.
Steps are named by the dev hook step they were caught on (`playing.kind@ms`), driven by caption/step observers on a virtual clock (not wall timers). Move choice is fixed per round, but the real server rolls the battle seed, so night, day and iPad are not the same rounds as each other.

## Result (iPhone band 0.378-0.529, cards top 0.529; all y as fractions of screen height)
- **Boss face (the fix):** in every iPhone frame where the boss faces the camera, **before = under the plate (0.27-0.33), after = inside the band** (top 0.379-0.393 / 0.382-0.393 at the highest; never above 0.378). 9 of 9 facing-camera after frames inside; eyes and mouth both inside.
- **Boss facing away:** night `04-taunt` has `bossFacing` -0.657 (faces away), so "face not visible" is the honest label; the box is only where the head sits.
- **Team eyes above cards: NOT met in the real fight.** The expected 0.49-0.51 holds only at night rest (0.500-0.524, bottom of the box under 0.529). In 5 of 8 after frames with a posed boss, the friends' face box bottom is **under the cards top 0.529** (0.532, 0.577, 0.548, 0.572 night; 0.533, 0.548 day), i.e. their eyes or mouths slip under the cards. This is the case "boss keeps its eyes, gives up the team": the boss floor (`safe.top - high`) beats the team cap on these frames, and in the windup-01 / hit frames the friends' boxes sit lower than at rest. The before frames (slide off) keep the team at 0.40-0.47, well above the cards. So `19a0d8c` buys the boss face at the cost of the team's heads on these frames. For the render-check to judge.
- **Day rest "before" is not a valid before:** its before/after pixels are identical (0 differing), so the overlay did not take effect on that pair (the day-rest boss face in both is 0.379-0.408, a frozen-instant artifact). Night rest shows the real rest pair. Treat `day-iphone-01-rest-before` as invalid.
- **Result screen and iPad unchanged:** result before/after (night, day) differ in 0 pixels; iPad rest before/after differ in 0 pixels (slide 0, face 0.301-0.340 inside band 0.203-0.586).
- **Grey blob:** no stray translucent patch found in any frame (heuristic: >=0.4% of the band as one grey r~g~b patch; column `grey blob bbox` = none everywhere); `shields` is none in every frame (no sparkle bubble active). I could not reproduce round 1's `after-day/iphone-02-windup-00` blob on this head; that frame is not shot the same way, so this is absence of evidence on these 22 frames, not proof.
- Boss head top vs the Order strip: the code guarantees eyes only; the hook `face` top is the eye box top, so head top is higher than the numbers below by about the head height above the eyes.

## Not shot (stopped by the coordinator at the context cap)
iPad windup/hit, day taunt, any second windup timepoint for day. Night iPhone windup has 2 timepoints, day 1; the windup frames are early (32/364 ms and 40 ms into the power-up), not the peak.

## Table (all frames; one row per PNG)
Columns: `team eyes (hook)` = top-bottom of the friends' face boxes; `vs cards` compares the lowest box bottom with the cards top; `colours` = distinct RGB>>4 colours in the DOM band / in the boss's face rows (3 = opaque plate).

| run | frame | build | step | band | plate+Order bottom | cards top | boss face (hook) | facing | boss face in band | team eyes (hook) | team eyes vs cards | colours in band | face-row colours | grey blob bbox | shields |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| day | iphone-01-rest | after | idle `A BIG Rakelet wants to play!` | 0.378–0.529 | 0.366 | 0.529 | 0.379–0.408 | 0.932 | YES | 0.505-0.526 | above cards | 638 | 297 | none | none |
| day | iphone-01-rest | before | idle `A BIG Rakelet wants to play!` | 0.378–0.529 | 0.366 | 0.529 | 0.379–0.408 | 0.932 | YES | 0.505-0.526 | above cards | 638 | 297 | none | none |
| day | iphone-02-windup-00 | after | effect@40ms `` | 0.378–0.529 | 0.380 | 0.529 | 0.393–0.418 | 0.973 | YES | 0.509-0.533 | UNDER CARDS | 690 | 236 | none | none |
| day | iphone-02-windup-00 | before | effect@40ms `` | 0.378–0.529 | 0.380 | 0.529 | 0.329–0.353 | 0.973 | under plate | 0.445-0.469 | above cards | 616 | 197 | none | none |
| day | iphone-03-hit | after | hit@1143ms `` | 0.378–0.529 | 0.380 | 0.529 | 0.386–0.417 | 0.847 | YES | 0.525-0.548 | UNDER CARDS | 617 | 311 | none | none |
| day | iphone-03-hit | before | hit@1143ms `` | 0.378–0.529 | 0.380 | 0.529 | 0.305–0.336 | 0.847 | under plate | 0.445-0.468 | above cards | 528 | 139 | none | none |
| day | iphone-05-result | after | idle `` | 0.198–0.509 | - | - | -–- | 0.987 | result screen (no face framed) | - | - | - | - | none | none |
| day | iphone-05-result | before | idle `` | 0.198–0.509 | - | - | -–- | 0.987 | result screen (no face framed) | - | - | - | - | none | none |
| ipad | ipad-01-rest | after | idle `A BIG Rakelet wants to play!` | 0.203–0.586 | 0.194 | 0.586 | 0.301–0.340 | 0.992 | YES | 0.467-0.494 | above cards | 1082 | 454 | none | none |
| ipad | ipad-01-rest | before | idle `A BIG Rakelet wants to play!` | 0.203–0.586 | 0.194 | 0.586 | 0.301–0.340 | 0.992 | YES | 0.467-0.494 | above cards | 1082 | 454 | none | none |
| night | iphone-01-rest | after | idle `` | 0.378–0.529 | 0.366 | 0.529 | 0.384–0.410 | 0.879 | YES | 0.500-0.524 | above cards | 925 | 372 | none | none |
| night | iphone-01-rest | before | idle `` | 0.378–0.529 | 0.366 | 0.529 | 0.302–0.328 | 0.879 | under plate | 0.418-0.442 | above cards | 708 | 3 | none | none |
| night | iphone-02-windup-00 | after | effect@32ms `` | 0.378–0.529 | 0.380 | 0.529 | 0.389–0.414 | 0.992 | YES | 0.510-0.532 | UNDER CARDS | 915 | 335 | none | none |
| night | iphone-02-windup-00 | before | effect@32ms `` | 0.378–0.529 | 0.380 | 0.529 | 0.326–0.351 | 0.992 | under plate | 0.447-0.469 | above cards | 826 | 245 | none | none |
| night | iphone-02-windup-01 | after | effect@364ms `Rakelet is winding up Count ` | 0.378–0.529 | 0.380 | 0.529 | 0.382–0.417 | 0.655 | YES | 0.552-0.577 | UNDER CARDS | 913 | 405 | none | none |
| night | iphone-02-windup-01 | before | effect@364ms `` | 0.378–0.529 | 0.380 | 0.529 | 0.277–0.312 | 0.655 | under plate | 0.448-0.473 | above cards | 713 | 65 | none | none |
| night | iphone-03-hit | after | hit@1045ms `Rakelet was wide open. Big b` | 0.378–0.529 | 0.380 | 0.529 | 0.382–0.414 | 0.851 | YES | 0.523-0.548 | UNDER CARDS | 792 | 352 | none | none |
| night | iphone-03-hit | before | hit@1045ms `` | 0.378–0.529 | 0.380 | 0.529 | 0.302–0.334 | 0.851 | under plate | 0.442-0.467 | above cards | 722 | 76 | none | none |
| night | iphone-04-taunt | after | move@77ms `` | 0.378–0.529 | 0.380 | 0.529 | 0.405–0.440 | -0.657 | face not visible (faces away) | 0.529-0.572 | UNDER CARDS | 918 | 388 | none | none |
| night | iphone-04-taunt | before | move@77ms `` | 0.378–0.529 | 0.380 | 0.529 | 0.273–0.309 | -0.657 | face not visible (faces away) | 0.398-0.440 | above cards | 599 | 35 | none | none |
| night | iphone-05-result | after | idle `` | 0.198–0.509 | - | - | -–- | 0.987 | result screen (no face framed) | - | - | - | - | none | none |
| night | iphone-05-result | before | idle `` | 0.198–0.509 | - | - | -–- | 0.987 | result screen (no face framed) | - | - | - | - | none | none |

Files: `<run>-<frame>-<before|after>.png`, `data/*.json` sidecars, `overlay.diff`, `zz-capture-868-round2.spec.ts.txt` (copy to `apps/client/tests/e2e/`, tester names >= 3 chars), `measure-868-round2.py`.
