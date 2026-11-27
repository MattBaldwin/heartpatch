# #190 PR 1 (#873) at `d6e0c66`: friend callout stacked above the caption, measured

Re-shoot of the one render-check defect from `f48d8ca` (a friend's `.boss-callout-small`, "Super cozy!", landed on the caption pill above the handle). The fix lifts it above the pill.
**Verdict: fixed.** In all 11 caption+callout readings (3 iPhone + 2 iPhone same-instant repeats, 3 iPad + 2 iPad repeats; see table) the callout rect never intersects the caption rect; vertical gap **6.2 px** (iPhone and iPad), callout never covers a chip (≥ 56 px above the chips). One new thing the shots show: two friends' callouts at once overlap *each other* by 35 px (see Findings).

No app code changed, no CSS injected; worktree at `d6e0c66`. Method follows `../pr1-f48d8ca/README.md` (dev servers by hand with `HP_MINI_BOSSES=testers`, testers list, `HP_SIGNUP_CODE`, `HP_DEV_SQUISHY_GRANTS=true`; Rakelet pinned into `boss_windows`; team Lv 30, Partner Lv 18; Chromium + SwiftShader, DPR 2, `?tier=high`, `--trace off`; night = America/Sao_Paulo; iPhone 393x852 with CDP insets 59/34, iPad 820x1180).

## What changed vs the pr1 method
- `zz-capture-190.spec.ts.txt` (copy to `apps/client/tests/e2e/zz-capture-190.spec.ts`): an in-page poll every 30 ms looks for a visible caption (`.battle-caption`, non-empty, height > 0) AND a visible `.boss-callout-small` (not hidden, width > 0); the first time per chip it **freezes the page clock** (`__capScale(0)`) synchronously, then the screenshot and the whole sidecar are read at that frozen instant (no 400 ms wait as in pr1, so no drift). A second poll does the same for `boss-windup` visible while the sheet is `lowered` (the ⏳). Added to the sidecars: `calloutRects` (per callout: chip index, text, rect, `--boss-callout-lift`), `captionRect`, `handleRect`, plus the pr1 fields (friend chips, hook band/face/team, strip, `dockSheet`).
- `measure-190-pr1b.py` reads the sidecars: caption rect vs each visible callout rect (axis-aligned `getBoundingClientRect`, tilt included), gap = caption top − callout bottom, callout vs chip rects, callout vs each other, callout top vs hook band top and strip bottom, band %, face in band, eyes vs handle, ⏳ inside strip, targets ≥ 44. Measured on the 2x originals; PNGs downscaled to device size afterwards. Per-device `table.md` is its raw output.
- Frame naming: `*-06-callout-chipN` = the first frame where chip N's callout was up with the caption; `iphone-07-hourglass-collapsed` = ⏳ frame; `01-rest-raised` = the raised no-regression frame.

## Table
| frame | device | step | caption rect | callout rects | intersect? | gap px | covers chip? | band % | face | ⏳ | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| iphone-06-callout-chip0 | iPhone night 393x852 | lowered / hit | 75,708–318,740 | chip0 "Super cozy!" 71,658–178,702 | NO | 6.2 | NO (chips top 758) | 73.4% | YES | not shown | caption "Puddlepuff lost some energy." |
| iphone-06-callout-chip1 | iPhone night | lowered / hit | 75,708–318,740 | chip0 71,658–178,702; chip1 143,658–250,702 | NO | 6.2 / 6.2 | NO | 73.4% | YES | not shown | **chip0×chip1 callouts overlap each other 35 px** |
| iphone-06-callout-chip2 | iPhone night | lowered / hit | 75,708–318,740 | chip1 143,658–250,702; chip2 215,658–322,702 | NO | 6.2 / 6.2 | NO | 73.4% | YES | not shown | chip1×chip2 overlap 35 px |
| iphone-01b-rest-collapsed, iphone-01c-after-go | iPhone night | lowered / hit | = the chip0 instant | = chip0 | NO | 6.2 | NO | 73.4% | YES | not shown | **not independent frames**: the poll froze the clock on the first caption+callout, which these two shots also read |
| iphone-07-hourglass-collapsed | iPhone night | lowered / effect@9ms | 16,689–377,740 ("Rakelet is winding up Count to Three…") | none up | - | - | - | 73.4% | YES | **shown, inside strip** (rect 297,92–317,108 in strip) | closes the "⏳ at 393 px" gap; caption is two lines here (689–740) |
| iphone-01-rest-raised | iPhone night | raised / idle | none | - | - | - | - | 46.8% | YES | not shown | no regression vs pr1 (46.8%, eyes clear 87 px); targets min 44 |
| ipad-06-callout-chip0 | iPad night 820x1180 | lowered / hit | 236,1070–584,1102 | chip0 284,1020–392,1064 | NO | 6.2 | NO (chips top 1120) | 88.6% | YES | not shown | caption "Puddlepuff was on guard. Just a little boop." |
| ipad-06-callout-chip1 | iPad night | lowered / hit | 288,1070–532,1102 | chip1 356,1020–464,1064 | NO | 6.2 | NO | 88.6% | YES | not shown | |
| ipad-06-callout-chip2 | iPad night | lowered / hit | 288,1070–532,1102 | chip2 428,1020–536,1064 | NO | 6.2 | NO | 88.6% | YES | not shown | left / middle / right all covered on iPad |
| ipad-01b / ipad-01c | iPad night | lowered | 319,1070–501,1102 / 288,1070–532,1102 | chip1 356,1020–464,1064 (both) | NO | 6.2 | NO | 88.6% | YES | not shown | two more intersect-free readings (own instants) |

## Results
- **Caption vs callout:** no intersection in any frame; callout bottom is 6.2 px above the pill top on both devices (callout 44.7 px tall, lift 61 px = pill-to-chip distance + margin; same `--boss-callout-lift` in every frame). Zero overlap with the pill means the old defect (callout *on* the pill) is gone.
- **Callout vs chips:** never covers one: chips top at 758 (iPhone) / 1120 (iPad), callouts bottom at 702 / 1064, so 56 px clear; the pill sits between them.
- **Where the stack ends:** callout top 658 px (iPhone) / 1020 px (iPad), far below the hook band top (121 / 62 px) and the strip bottom (111 / 52 px), so the stack stays inside the stage and nowhere near the boss strip.
- **Band collapsed:** 73.4% on the notched iPhone (≥ 0.70), 88.6% iPad. Raised 46.8% (iPhone). **Face in band:** YES everywhere. **Eyes above handle:** clear in every frame (87 px raised, 244–289 px collapsed on iPhone). **⏳ at 393 px:** shown and inside the strip (frame 07). **Targets:** min 44 px in all frames.

## Findings (new)
- **Two friends' callouts at once overlap each other by 35 px** (iPhone: chips 0+1 and 1+2 both up with "Super cozy!"; callouts 107 px wide on a 72 px chip pitch). Both sit on the same row (top 658), the later one on top, so the left one's text is partly hidden ("Super co…"). Not the caption defect (the pill is clear), but a stacking gap in the same feature; on iPad the chip pitch is wider and I saw no overlap. I did not see 3 at once. Worth a fix or an accept decision by the lane.

## Missing (honest list)
- No "Just a little boop." as a *callout* text in a frame; every callout I caught reads "Super cozy!" (the boop line showed up only as caption text on iPad chip0). Same lift code either way.
- One distinct callout frame per chip (iPhone 3, iPad 3); iPhone 01b/01c repeat the chip0 instant, iPad 01b/01c are own instants. Counts are not 10 independent pictures.
- No iPhone windup *burst* with a callout up at the same time; the ⏳ frame has no callout (wasn't on screen). iPhone ⏳ came from a second run (first run stalled at 3 callout frames; cause: the spec's in-page hit/windup watchers froze the clock for keys not in `WANT`; fixed in the shipped spec).
- No day, SE, WebKit or real-device frames; software GL, no frame-time claims. The hook gives eye rows only (y), so "eyes above handle" is a row test.
