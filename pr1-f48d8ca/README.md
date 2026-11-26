# #190 PR 1 (#873) boss HUD, real implementation at `f48d8ca`, measured

Shot from a worktree at `f48d8ca` (`190-boss-hud`); **no app code changed, no CSS injected** (M0's overrides/sync are gone). Numbers come from
`measure-190-pr1.py` (sidecar `.json`: DOM rects at shot time + the battle dev hook `scene.framing`; pixels for stage colours), measured on the 2x
originals, PNGs then downscaled to device size (393x852, 375x667, 820x1180). Spec: `zz-capture-190.spec.ts.txt` (copy to `apps/client/tests/e2e/zz-capture-190.spec.ts`).

## Method / environment
- Postgres 16 local, `pnpm install`, `db:migrate`, `db:seed`, `pnpm build`; server and client dev servers started by hand with `HP_MINI_BOSSES=testers`,
  `HP_MINI_BOSSES_TESTERS=capc,…`, `HP_SIGNUP_CODE`, `HP_DEV_SQUISHY_GRANTS=true`, `HP_HOUSE/HP_WILD_ISLE=on` (Playwright's own server start did not apply the testers switch: the boss tile showed as plain wild land). Chromium + SwiftShader, DPR 2, `?tier=high`, `--trace off`, projects `iphone-chromium` / `ipad-chromium`.
- Rakelet pinned into `boss_windows` with SQL; team Lv 30, Partner Lv 18. Night = America/Sao_Paulo, day = Asia/Bangkok.
- iPhone 393x852 with CDP safe-area insets top 59 / bottom 34; SE 375x667 no insets; iPad 820x1180 no insets.
- Sequence per run: **01-rest-raised** (move picker open) → taps three moves, recording the dock/sheet height at each step → **Go!** → **01c-after-go** (screenshot straight after the tap) → ~1.2 s later **01b-rest-collapsed** (round playing, page clock frozen) → hunt for windup burst / hit / result while the fight continues (page timers slowed 5x as in #868).
- Columns: band DOM = strip bottom → handle top (both as fractions of window height; the handle box is the 64 px handle, the hook band ends 8 px above it); band hook = `scene.framing.band`; band % = hook band height; face in band only judged when `bossFacing ≥ 0.3`, face top ≥ max(band top, strip bottom); eyes vs handle = team eye-box bottoms (hook) vs handle top, gap in px; bar px = `boss-energy` width; ⏳ = `boss-windup` rect inside the `boss-strip` rect, and (from the later frames on) its computed visibility; targets = chips, visible picker buttons, Go, ✕ (min side ≥ 44); ✕ vs band = ✕ rect vs hook band top; sticker vs eyes = `battle-caption` rect rows vs team eye rows; colours = distinct RGB>>4 in the hook band / face rows; fits = scrollHeight/clientHeight; Round↔chip gap = first chip left − "Round N" right.

## Results summary
- **Band:** iPhone notched collapsed **73.4%** (0.142–0.876; DOM strip→handle 75.5%), raised **46.8%** (0.142–0.610; plan said ~0.48). SE collapsed 79.9%, raised 41.5%. iPad collapsed 88.6%, raised 60.1%.
- **Face in band:** YES in every frame with `bossFacing ≥ 0.3` (all of them except the result card, n/a).
- **Team eyes vs handle:** clear in every frame (87 px raised / ~250 px collapsed on the iPhone; 69 px raised on the SE).
- **Energy bar:** 267 px on the iPhone, 249 px SE, 510 px iPad (≥ 120 everywhere). **⏳** inside the strip in every frame where it is shown (iPhone night 01b/01c/03, SE 01b/01c/windup 00–02, iPad windup 00–02); never clipped.
- **Targets:** every chip, move, Go and ✕ ≥ 44 px (min 44). **✕** bottom (0.130) sits above band top (0.142) on the iPhone; same on SE and iPad.
- **Stage colours:** 950–1300 distinct colours in the band, 280–610 in the face rows: a scene, not a flat dome.
- **Sheet height across picker steps (raised):** identical in all three devices (iPhone dock 289.7 / sheet 323.7 px; SE 320.2; iPad 401.2) across 4 recorded steps.
- **Round label vs first chip (the round-3 addendum), SE 375x667 raised:** "Round 1" gap **17.1 px**; with the label text *set* to **"Round 48"** by `page.evaluate` for that one frame (`se-01-rest-raised-round48`, not a real round 48) the gap is **5.0 px** (≥ 4 expected). iPhone 393: 18.1 px with "Round 1".
- **Caption sticker vs the friends' eyes (open owner item):** during a round the sticker sits at rows 0.832–0.869 (iPhone), 0.807–0.883 (SE), 0.907–0.934 (iPad), directly above the handle; the team eyes are at 0.53–0.62. **It does not cover the eye rows in any frame (≥ 0.2 of screen apart).** Caveat: the hook gives eye rows only (y), no x, so this is a row test, not a rect intersection; the screenshots show it.

## Frames (tables from the script)

### iPhone 393x852, night (`iphone-night/`)
| frame | device | sheet / step | band DOM (strip→handle) | band hook | band % | face in band | eyes vs handle | bar px | ⏳ | targets ≥44 | ✕ vs band | sticker vs eyes | colours band/face | fits | chip status | Round↔chip gap | caption |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| iphone-01-rest-raised | iphone 393x852 | raised / idle | 0.130–0.620 (49.0%) | 0.142–0.610 | 46.8% | YES | clear (87px) | 267 | shown, inside strip (slot rect only; visibility not recorded) | YES (min 44) | clear (✕ bottom 0.130 ≤ band top 0.142) | no sticker | 1007/381 | picker 226/226, sheet 750/324 | picking,ok,ok | 18.1px | A BIG Rakelet wants to play! |
| iphone-01b-rest-collapsed | iphone 393x852 | lowered / effect@2583ms | 0.130–0.885 (75.5%) | 0.142–0.876 | 73.4% | YES | clear (249px) | 267 | shown, inside strip (slot rect only; visibility not recorded) | YES (min 44) | clear (✕ bottom 0.130 ≤ band top 0.142) | clear of eyes (sticker 0.832–0.869, eyes 0.557–0.593) | 1047/412 | - | ok,ok,ok | 18.1px |  |
| iphone-01c-after-go | iphone 393x852 | lowered / hit@709ms | 0.130–0.885 (75.5%) | 0.142–0.876 | 73.4% | YES | clear (260px) | 267 | shown, inside strip (slot rect only; visibility not recorded) | YES (min 44) | clear (✕ bottom 0.130 ≤ band top 0.142) | clear of eyes (sticker 0.832–0.869, eyes 0.531–0.579) | 1051/513 | - | ok,ok,ok | 18.1px |  |
| iphone-03-hit | iphone 393x852 | lowered / hit@1365ms | 0.130–0.885 (75.5%) | 0.142–0.876 | 73.4% | YES | clear (251px) | 267 | shown, inside strip (slot rect only; visibility not recorded) | YES (min 44) | clear (✕ bottom 0.130 ≤ band top 0.142) | clear of eyes (sticker 0.832–0.869, eyes 0.553–0.590) | 1073/435 | - | ok,ok,ok | 18.1px |  |
| iphone-05-result | iphone 393x852 | lowered / idle | -–- | 0.198–0.509 | 31.1% | n/a (bossFacing 0.99) | - | - | not shown | YES (min 44) | clear (✕ bottom 0.189 ≤ band top 0.198) | no sticker | 969/0 | - | ok,ok,down | - |  |

iphone-sheet-heights.json: 4 picker steps; dock heights [289.7], sheet heights [323.7] -> IDENTICAL

### iPhone 393x852, day (`iphone-day/`)
| frame | device | sheet / step | band DOM (strip→handle) | band hook | band % | face in band | eyes vs handle | bar px | ⏳ | targets ≥44 | ✕ vs band | sticker vs eyes | colours band/face | fits | chip status | Round↔chip gap | caption |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| iphone-01-rest-raised | iphone 393x852 | raised / idle | 0.130–0.620 (49.0%) | 0.142–0.610 | 46.8% | YES | clear (85px) | 267 | not shown (slot rect only) | YES (min 44) | clear (✕ bottom 0.130 ≤ band top 0.142) | no sticker | 701/305 | picker 226/226, sheet 750/324 | picking,ok,ok | 18.1px | A BIG Rakelet wants to play! |
| iphone-01b-rest-collapsed | iphone 393x852 | lowered / effect@3320ms | 0.130–0.885 (75.5%) | 0.142–0.876 | 73.4% | YES | clear (245px) | 267 | not shown (slot rect only) | YES (min 44) | clear (✕ bottom 0.130 ≤ band top 0.142) | clear of eyes (sticker 0.832–0.869, eyes 0.559–0.598) | 700/305 | - | ok,ok,ok | 18.1px | Rakelet is wide open! |
| iphone-01c-after-go | iphone 393x852 | lowered / hit@726ms | 0.130–0.885 (75.5%) | 0.142–0.876 | 73.4% | YES | clear (257px) | 267 | not shown (slot rect only) | YES (min 44) | clear (✕ bottom 0.130 ≤ band top 0.142) | clear of eyes (sticker 0.832–0.869, eyes 0.527–0.583) | 707/380 | - | ok,ok,ok | 18.1px | Puddlepuff lost some energy. |
| iphone-03-hit | iphone 393x852 | lowered / hit@1980ms | 0.130–0.885 (75.5%) | 0.142–0.876 | 73.4% | YES | clear (247px) | 267 | not shown (slot rect only) | YES (min 44) | clear (✕ bottom 0.130 ≤ band top 0.142) | clear of eyes (sticker 0.832–0.869, eyes 0.559–0.596) | 736/303 | - | ok,ok,ok | 18.1px | Rakelet was wide open. Big bump! |

iphone-sheet-heights.json: 4 picker steps; dock heights [289.7], sheet heights [323.7] -> IDENTICAL

### iPhone SE 375x667, night (`se-night/`)
| frame | device | sheet / step | band DOM (strip→handle) | band hook | band % | face in band | eyes vs handle | bar px | ⏳ | targets ≥44 | ✕ vs band | sticker vs eyes | colours band/face | fits | chip status | Round↔chip gap | caption |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| se-01-rest-raised-round48 | se 375x667 | raised / idle | 0.078–0.520 (44.2%) | 0.093–0.508 | 41.5% | YES | clear (69px) | 249 | not shown (slot rect only) | YES (min 44) | clear (✕ bottom 0.078 ≤ band top 0.093) | no sticker | 984/367 | picker 256/256, sheet 654/320 | picking,ok,ok | 5.0px | A BIG Rakelet wants to play! |
| se-01-rest-raised | se 375x667 | raised / idle | 0.078–0.520 (44.2%) | 0.093–0.508 | 41.5% | YES | clear (69px) | 249 | not shown (slot rect only) | YES (min 44) | clear (✕ bottom 0.078 ≤ band top 0.093) | no sticker | 984/367 | picker 256/256, sheet 654/320 | picking,ok,ok | 17.1px | A BIG Rakelet wants to play! |
| se-01b-rest-collapsed | se 375x667 | lowered / effect@1313ms | 0.078–0.904 (82.6%) | 0.093–0.892 | 79.9% | YES | clear (196px) | 249 | shown, inside strip | YES (min 44) | clear (✕ bottom 0.078 ≤ band top 0.093) | clear of eyes (sticker 0.807–0.883, eyes 0.557–0.611) | 1088/449 | - | ok,ok,ok | 17.1px | Rakelet is winding up Count to Three… wa |
| se-01c-after-go | se 375x667 | lowered / effect@3ms | 0.078–0.904 (82.6%) | 0.093–0.892 | 79.9% | YES | clear (198px) | 249 | shown, inside strip | YES (min 44) | clear (✕ bottom 0.078 ≤ band top 0.093) | clear of eyes (sticker 0.807–0.883, eyes 0.557–0.607) | 1067/430 | - | ok,ok,ok | 17.1px | Rakelet is winding up Count to Three… wa |
| se-02-windup-00 | se 375x667 | lowered / effect@29ms | 0.078–0.904 (82.6%) | 0.093–0.892 | 79.9% | YES | clear (197px) | 249 | shown, inside strip | YES (min 44) | clear (✕ bottom 0.078 ≤ band top 0.093) | clear of eyes (sticker 0.807–0.883, eyes 0.555–0.609) | 1149/279 | - | ok,ok,ok | 17.1px | Rakelet is winding up Count to Three… wa |
| se-02-windup-01 | se 375x667 | lowered / effect@367ms | 0.078–0.904 (82.6%) | 0.093–0.892 | 79.9% | YES | clear (196px) | 249 | shown, inside strip | YES (min 44) | clear (✕ bottom 0.078 ≤ band top 0.093) | clear of eyes (sticker 0.807–0.883, eyes 0.560–0.610) | 1180/393 | - | ok,ok,ok | 17.1px | Rakelet is winding up Count to Three… wa |
| se-02-windup-02 | se 375x667 | lowered / effect@682ms | 0.078–0.904 (82.6%) | 0.093–0.892 | 79.9% | YES | clear (196px) | 249 | shown, inside strip | YES (min 44) | clear (✕ bottom 0.078 ≤ band top 0.093) | clear of eyes (sticker 0.807–0.883, eyes 0.560–0.610) | 1098/406 | - | ok,ok,ok | 17.1px | Rakelet is winding up Count to Three… wa |

se-sheet-heights.json: 4 picker steps; dock heights [320.2], sheet heights [320.2] -> IDENTICAL

### iPad 820x1180, night (`ipad-night/`)
| frame | device | sheet / step | band DOM (strip→handle) | band hook | band % | face in band | eyes vs handle | bar px | ⏳ | targets ≥44 | ✕ vs band | sticker vs eyes | colours band/face | fits | chip status | Round↔chip gap | caption |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ipad-01-rest-raised | ipad 820x1180 | raised / idle | 0.044–0.660 (61.6%) | 0.053–0.653 | 60.1% | YES | clear (136px) | 510 | not shown (slot rect only) | YES (min 44) | clear (✕ bottom 0.044 ≤ band top 0.053) | no sticker | 1142/407 | picker 337/337, sheet 991/401 | picking,ok,ok | 231.6px | A BIG Rakelet wants to play! |
| ipad-01b-rest-collapsed | ipad 820x1180 | lowered / effect@1ms | 0.044–0.946 (90.2%) | 0.053–0.939 | 88.6% | YES | clear (436px) | 510 | not shown (slot rect only) | YES (min 44) | clear (✕ bottom 0.044 ≤ band top 0.053) | clear of eyes (sticker 0.907–0.934, eyes 0.516–0.577) | 1201/491 | - | ok,ok,ok | 231.6px | Puddlepuff is wide open! |
| ipad-01c-after-go | ipad 820x1180 | lowered / effect@7ms | 0.044–0.946 (90.2%) | 0.053–0.939 | 88.6% | YES | clear (428px) | 510 | not shown (slot rect only) | YES (min 44) | clear (✕ bottom 0.044 ≤ band top 0.053) | clear of eyes (sticker 0.907–0.934, eyes 0.521–0.583) | 1199/613 | - | ok,ok,ok | 231.6px | Puddlepuff used Belly Flop! |
| ipad-02-windup-00 | ipad 820x1180 | lowered / effect@84ms | 0.044–0.946 (90.2%) | 0.053–0.939 | 88.6% | YES | clear (403px) | 510 | shown, inside strip | YES (min 44) | clear (✕ bottom 0.044 ≤ band top 0.053) | clear of eyes (sticker 0.907–0.934, eyes 0.544–0.604) | 1309/421 | - | ok,ok,ok | 229.0px | Rakelet is winding up Count to Three… wa |
| ipad-02-windup-01 | ipad 820x1180 | lowered / effect@397ms | 0.044–0.946 (90.2%) | 0.053–0.939 | 88.6% | YES | clear (399px) | 510 | shown, inside strip | YES (min 44) | clear (✕ bottom 0.044 ≤ band top 0.053) | clear of eyes (sticker 0.907–0.934, eyes 0.559–0.608) | 1307/430 | - | ok,ok,ok | 229.0px | Rakelet is winding up Count to Three… wa |
| ipad-02-windup-02 | ipad 820x1180 | lowered / effect@765ms | 0.044–0.946 (90.2%) | 0.053–0.939 | 88.6% | YES | clear (390px) | 510 | shown, inside strip | YES (min 44) | clear (✕ bottom 0.044 ≤ band top 0.053) | clear of eyes (sticker 0.907–0.934, eyes 0.557–0.615) | 1205/463 | - | ok,ok,ok | 229.0px | Rakelet is winding up Count to Three… wa |
| ipad-03-hit | ipad 820x1180 | lowered / hit@3211ms | 0.044–0.946 (90.2%) | 0.053–0.939 | 88.6% | YES | clear (401px) | 510 | not shown (slot rect only) | YES (min 44) | clear (✕ bottom 0.044 ≤ band top 0.053) | clear of eyes (sticker 0.907–0.934, eyes 0.548–0.606) | 1219/524 | - | ok,ok,ok | 231.6px | Rakelet lost some energy. |

ipad-sheet-heights.json: 4 picker steps; dock heights [401.2], sheet heights [401.2] -> IDENTICAL


## Notes
- `01-rest-raised` caption reads "A BIG Rakelet wants to play!" (the entrance line) on the picker's first step; chips `picking,ok,ok`.
- The **after-Go instant** (`01c-after-go`) was caught on every device: sheet `lowered`, band already 0.142–0.876 (iPhone) in that frame, so no stale raised band in this Chromium run (the round-3 note already says WebKit CI is the real check for the stale frame).
- iPhone night frames before the `windVis` field was added to the spec (`iphone-night/`) say "slot rect only; visibility not recorded" for ⏳: the rect is the fixed-width slot (room kept), so "shown" there only means the slot is inside the strip. Later runs record computed visibility.

## Missing (honest list)
- **No iPhone windup burst** (night: 10 rounds / 2 fights; day: 6 rounds) and **no 04-taunt** anywhere; windup bursts exist for the **SE** and **iPad** only. The iPhone frames with ⏳ live are `iphone-night/iphone-01b-rest-collapsed` / `01c-after-go` (a windup was in progress, not the caption burst).
- **No iPhone day windup/result and no day SE/iPad**; iPhone day has rest raised, after-Go, collapsed and one hit. **iPad has no result frame** (the run was cut at the budget); iPhone night has the result (05).
- `.battle-sheet` `scrollHeight` reads 750/324 (iPhone), 654/320 (SE), 991/401 (iPad) in the raised state while the **picker itself fits** (226/226, 256/256, 337/337) and dock heights are as above. I did not chase this: the sheet's scrollHeight probably includes the collapsed handle's off-screen translate, but that is a guess, not measured. Worth a look by the lane.
- Sticker vs eyes is a y-row test (hook has no x). Eye boxes are the hook's, not pixel-detected.
- The "Round 48" frame is a label text set by script, not a real two-digit round.
- Software GL (SwiftShader), so nothing here is a frame-time claim; only the notched iPhone inset set (59/34); no real device, no landscape, no WebKit.
