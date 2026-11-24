# #868 captures: the boss's face in frame on a notched iPhone

Measured, not eyeballed: every number below comes from `measure-868.py` (PIL, prints numbers) over each PNG
and its `.json` sidecar (the battle dev hook's `scene.framing` / `scene.playing`, and DOM rects taken at
shot time). Quality tier `?tier=high` (pinned), Chromium + SwiftShader (`--use-gl=angle --use-angle=swiftshader`),
DPR 2. Boss: Rakelet (mini-boss, `HP_MINI_BOSSES=testers`), team Lv 30, Partner Lv 18.

- **iPhone**: 393×852, `isMobile`, safe-area insets top 59 / bottom 34 (CDP `Emulation.setSafeAreaInsetsOverride`).
- **iPad**: 820×1180, no insets.
- **night** = browser `timezoneId` America/Sao_Paulo (~02:50–03:50 local), **day** = Asia/Bangkok (~12:50–13:50 local).
  No `HP_DEV_NOW`; the boss window is pinned with SQL `now()` (see the spec).
- **after** = PR branch `868-boss-face-in-frame` at `f9c81d6` (runtime identical to `3ecdcf4`; `f9c81d6` only touches a unit test).
- **before** = main `505fb56` with the PR's four battle files overlaid **and the slide pinned to zero**
  (`want = 0 * faceDrop(...)` in `camera-director.ts`). With the slide at zero the shot's lens shift is
  `frame.shift`, exactly main's, so the picture is main's; the overlay only makes the hook report where the
  face lands (main's hook has no `band`/`face`). Not committed anywhere.

## How each frame was shot (`zz-capture-868.spec.ts.txt`)

Copy to `apps/client/tests/e2e/zz-capture-868.spec.ts`, run `pnpm dev` with the env in the issue's recipe, then
`PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium CAPTURE_OUT=… CAPTURE_DEVICE=iphone|ipad CAPTURE_TZ=… npx playwright test tests/e2e/zz-capture-868.spec.ts --project=iphone-chromium --trace off`.
Step timers are slowed 5× (captions stay up) and the page runs on a virtual clock.

- **01-rest**: the move picker, 2.5 s after the fight is up.
- **02-windup-00…02**: a MutationObserver sees the "Winding up!" caption, drops the clock to 1/20 speed and shoots a burst.
  The burst settles after shot 02 (shots 03–05 were pixel-identical to 02 and were dropped).
- **03-hit**: the boss getting bonked: an in-page poll sees `scene.playing.kind === 'hit'` while the caption names
  Rakelet ("Rakelet was wide open. Big bump!" / "…on guard. Just a little bump!"), drops the clock to 1/10, shoots.
- **04-taunt**: the boss's windup landing, caption "Here it comes!" (its `move` step), clock at 1/10.
- **05-result**: `battle-result` visible, 3 s settle.

## Columns

band (DOM) = `.boss-head` bottom → `.boss-friends` (team cards) top; hook band = `scene.framing.band`;
plate+Order bottom = max(`boss-plate`, `boss-order`) bottom; face = `scene.framing.face` (eyes-and-mouth box);
**face in band** = face top ≥ max(hook band top, plate/Order bottom) and face bottom ≤ band bottom
("under plate" = the whole face box is above the plate/Order bottom); band colours = distinct RGB>>4 colours in the
DOM band (full width); face-row colours = distinct RGB>>4 colours in the face's rows, centre half of the width
(3 = an opaque plate covers it). All y values are fractions of the screen height.

| run | frame | step | band (DOM head→cards) | hook band | plate+Order bottom | face (hook) | face in band | band colours | face-row colours |
|---|---|---|---|---|---|---|---|---|---|
| after-day | iphone-01-rest | idle | 0.366–0.529 | 0.378–0.529 | 0.366 | 0.393–0.403 | YES | 628 | 153 |
| after-day | iphone-02-windup-00 | effect@461ms | 0.380–0.529 | 0.378–0.529 | 0.380 | 0.406–0.425 | YES | 435 | 158 |
| after-day | iphone-02-windup-01 | effect@1172ms | 0.380–0.529 | 0.378–0.529 | 0.380 | 0.397–0.415 | YES | 590 | 198 |
| after-day | iphone-02-windup-02 | effect@1410ms | 0.380–0.529 | 0.378–0.529 | 0.380 | 0.392–0.409 | YES | 624 | 198 |
| after-day | iphone-03-hit | hit@2566ms | 0.380–0.529 | 0.378–0.529 | 0.380 | 0.394–0.405 | YES | 627 | 181 |
| after-day | iphone-05-result | idle | -–- | 0.198–0.509 | - | -–- | no face (hook null) (result card up; band = above the card) | - | - |
| after-night | ipad-01-rest | idle | 0.194–0.586 | 0.203–0.586 | 0.194 | 0.301–0.315 | YES | 1085 | 295 |
| after-night | ipad-03-hit | effect@1869ms | 0.204–0.586 | 0.203–0.586 | 0.204 | 0.301–0.315 | YES | 1098 | 311 |
| after-night | iphone-01-rest | idle | 0.366–0.529 | 0.378–0.529 | 0.366 | 0.395–0.405 | YES | 885 | 213 |
| after-night | iphone-02-windup-00 | effect@533ms | 0.380–0.529 | 0.378–0.529 | 0.380 | 0.417–0.428 | YES | 831 | 203 |
| after-night | iphone-02-windup-01 | effect@1260ms | 0.380–0.529 | 0.378–0.529 | 0.380 | 0.393–0.404 | YES | 886 | 240 |
| after-night | iphone-02-windup-02 | effect@1260ms | 0.380–0.529 | 0.378–0.529 | 0.380 | 0.393–0.404 | YES | 880 | 265 |
| after-night | iphone-03-hit | hit@2913ms | 0.380–0.529 | 0.378–0.529 | 0.380 | 0.393–0.404 | YES | 867 | 256 |
| after-night | iphone-04-taunt | move@908ms | 0.380–0.529 | 0.378–0.529 | 0.380 | 0.395–0.407 | YES | 1032 | 255 |
| after-night | iphone-05-result | idle | -–- | 0.198–0.509 | - | -–- | no face (hook null) (result card up; band = above the card) | - | - |
| before-day | iphone-01-rest | idle | 0.366–0.529 | 0.378–0.529 | 0.366 | 0.295–0.305 | under plate | 451 | 3 |
| before-day | iphone-02-windup-00 | effect@266ms | 0.380–0.529 | 0.378–0.529 | 0.380 | 0.283–0.296 | under plate | 623 | 31 |
| before-day | iphone-02-windup-01 | effect@730ms | 0.380–0.529 | 0.378–0.529 | 0.380 | 0.314–0.325 | under plate | 631 | 18 |
| before-day | iphone-02-windup-02 | effect@999ms | 0.380–0.529 | 0.378–0.529 | 0.380 | 0.315–0.326 | under plate | 532 | 12 |
| before-day | iphone-03-hit | hit@2180ms | 0.380–0.529 | 0.378–0.529 | 0.380 | 0.313–0.324 | under plate | 516 | 3 |
| before-day | iphone-05-result | idle | -–- | 0.198–0.509 | - | -–- | no face (hook null) (result card up; band = above the card) | - | - |
| before-night | ipad-01-rest | idle | 0.194–0.586 | 0.203–0.586 | 0.194 | 0.301–0.315 | YES | 1116 | 303 |
| before-night | ipad-03-hit | effect@2251ms | 0.204–0.586 | 0.203–0.586 | 0.204 | 0.301–0.315 | YES | 1095 | 298 |
| before-night | iphone-01-rest | idle | 0.366–0.529 | 0.378–0.529 | 0.366 | 0.292–0.303 | under plate | 696 | 3 |
| before-night | iphone-02-windup-00 | effect@342ms | 0.380–0.529 | 0.378–0.529 | 0.380 | 0.269–0.282 | under plate | 812 | 32 |
| before-night | iphone-02-windup-01 | effect@957ms | 0.380–0.529 | 0.378–0.529 | 0.380 | 0.313–0.324 | under plate | 766 | 25 |
| before-night | iphone-02-windup-02 | effect@1043ms | 0.380–0.529 | 0.378–0.529 | 0.380 | 0.312–0.323 | under plate | 772 | 25 |
| before-night | iphone-03-hit | hit@2155ms | 0.380–0.529 | 0.378–0.529 | 0.380 | 0.310–0.321 | under plate | 777 | 3 |
| before-night | iphone-04-taunt | move@897ms | 0.380–0.529 | 0.378–0.529 | 0.380 | 0.356–0.368 | under plate | 907 | 156 |
| before-night | iphone-05-result | idle | -–- | 0.198–0.633 | - | 0.326–0.342 | YES (result card up; band = above the card) | - | 320 |

## Reading it

- **iPhone before** (main): the eyes-and-mouth box sits at **0.29–0.30** at rest (0.27–0.28 at the windup's peak,
  0.36–0.37 at "Here it comes!"), above the plate+Order bottom (0.366 / 0.380): fully **under the opaque boss head**
  (3 colours in those rows at rest and on the hit: plate fill only).
- **iPhone after**: the face is at **0.393–0.405** at rest, **0.392–0.428** across the windup bursts, 0.393–0.405 on
  the hits and 0.395–0.407 on the taunt: **inside the band 0.378–0.529 in every frame** (150–265 colours in its rows).
  The slide is about 0.10 of the screen height (~85 CSS px).
- **iPad**: the face already sits inside the band (0.301–0.315 in 0.203–0.586) on main, and the PR leaves it there
  (no slide needed): before and after match.
- **Result**: the band becomes "above the result card" (0.198–0.509/0.633); when the boss is tuckered out the hook's
  face is null by design (`#bossFace` returns null for a downed boss).

## Missing

- iPad 03-hit (before and after): caught on the hit step, but on SwiftShader the screenshot landed on the step after it
  (`effect@…` in the table), so they show the boss just after the bonk.

- iPhone **taunt** for day (before and after): the boss never landed a windup within the run budget.
- iPad: before night rest + hit and after night rest + hit only; iPad windup/taunt/result and all iPad day frames
  were not shot (time budget; the iPad frame needs no slide, so they would add little).
- before-day result: the face is null there (boss tuckered); before-night result had the boss standing.
