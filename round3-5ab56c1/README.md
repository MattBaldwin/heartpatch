# #868 round 3: captures on `5ab56c1` (team cards fade while the boss acts)

Owner's option 3: on a notched iPhone (393x852, CDP safe-area insets top 59 / bottom 34) `.boss-friends` fades to opacity 0.18
(`.battle-cards-faded`, pointer-events none) during the boss's windup / hit / taunt, so the boss face and the team's eyes both fit the band;
cards return after the camera settles. `face` is null when `bossFacing` < 0.3. iPad never fades. `BOSS_CARDS.shortBand` 0.28.
Method as in `../captures/README.md` and round 2: Chromium + SwiftShader, DPR 2, tier high, boss Rakelet, team Lv 30, Partner Lv 18,
night = America/Sao_Paulo, day = Asia/Bangkok, 5x slowed step timers on a virtual clock. Numbers from `measure-868-round3.py`
(PIL + numpy over each full-size PNG and its `.json` sidecar: hook `scene.framing` / `scene.playing`, DOM rects, `.boss-friends` computed opacity/class).
PNGs here are downscaled to 393x852 / 820x1180 after measuring. **after** = runtime `5ab56c1`; **before** = runtime `19a0d8c` (round-2 head, no fade),
a separate checkout and separate fight, same step type (not the same instant; the server rolls the battle seed).

Pass rules: *team eyes* = pass if `cardsFaded` or every team box bottom <= cards top. *boss face* = in band (>= max(hook band top, head/plate/Order bottom), <= band bottom)
when bossFacing >= 0.3; null when facing away. *cards pixels* = distinct RGB>>4 colours / luminance std in the `.boss-friends` rect, and the std ratio vs the same run's rest frame (a real fade drops it well below 1).
All y fractions of screen height.

## Table
| run | frame | step | band (hook) | open | cardsFaded | cards opacity (DOM) | `.battle-cards-faded` | cards top | cards pixels (colours / lum-std; vs rest) | team box bottom | team eyes | boss face (hook) | bossFacing | boss face | head/plate/Order bottom | sheet top |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| after-day | iphone-01-rest | idle | 0.378–0.529 | - | False | 1 | False | 0.529 | 222 / 45.2; 1.00× rest lum-std | 0.524 | pass | 0.380–0.408 | 0.986 | pass | 0.366/0.331/0.366 | 0.673 |
| after-day | iphone-02-windup-00 | effect@34ms | 0.392–0.529 | 0.832 | True | 0.18 | True | 0.529 | 331 / 27.5; 0.61× rest lum-std | 0.555 | pass (faded) | 0.410–0.435 | 0.994 | pass | 0.380/0.331/0.380 | 0.832 |
| after-day | iphone-02-windup-01 | effect@337ms | 0.392–0.529 | 0.832 | True | 0.18 | True | 0.529 | 411 / 24.4; 0.54× rest lum-std | 0.591 | pass (faded) | -–- | -0.223 | null OK | 0.380/0.331/0.380 | 0.832 |
| after-day | iphone-02-windup-02 | effect@678ms | 0.392–0.529 | 0.832 | True | 0.18 | True | 0.529 | 376 / 28.1; 0.62× rest lum-std | 0.572 | pass (faded) | 0.413–0.443 | 0.991 | pass | 0.380/0.331/0.380 | 0.832 |
| after-day | iphone-03-hit | hit@1431ms | 0.392–0.529 | 0.858 | True | 0.18 | True | 0.529 | 349 / 27.1; 0.60× rest lum-std | 0.572 | pass (faded) | 0.413–0.443 | 0.976 | pass | 0.380/0.331/0.380 | 0.858 |
| after-day | iphone-04-taunt | move@57ms | 0.392–0.529 | 0.858 | True | 0.18 | True | 0.529 | 336 / 27.5; 0.61× rest lum-std | 0.562 | pass (faded) | -–- | 0.291 | null OK | 0.380/0.331/0.380 | 0.858 |
| after-day | iphone-05-result | idle | 0.198–0.633 | - | False | 1 | False | - | - | - | - | 0.326–0.371 | 0.977 | result card up | -/-/- | - |
| after-ipad | ipad-01-rest | idle | 0.203–0.586 | - | False | 1 | False | 0.586 | 109 / 7.8; 1.00× rest lum-std | 0.494 | pass | 0.296–0.335 | 0.956 | pass | 0.194/0.169/0.194 | 0.789 |
| after-ipad | ipad-02-windup-00 | effect@69ms | 0.203–0.586 | - | False | 1 | False | 0.586 | 273 / 58.0; 7.47× rest lum-std | 0.536 | pass | 0.360–0.388 | 0.986 | pass | 0.204/0.169/0.204 | 0.926 |
| after-ipad | ipad-03-hit | hit@2892ms | 0.203–0.586 | - | False | 1 | False | 0.586 | 258 / 58.9; 7.59× rest lum-std | 0.533 | pass | 0.308–0.351 | 0.971 | pass | 0.204/0.169/0.204 | 0.926 |
| after-night | iphone-01-rest | idle | 0.378–0.529 | - | False | 1 | False | 0.529 | 264 / 63.1; 1.00× rest lum-std | 0.525 | pass | 0.378–0.407 | 0.962 | pass | 0.366/0.331/0.366 | 0.673 |
| after-night | iphone-02-windup-00 | effect@30ms | 0.392–0.529 | 0.832 | True | 0.18 | True | 0.529 | 387 / 20.8; 0.33× rest lum-std | 0.561 | pass (faded) | 0.418–0.443 | 0.964 | pass | 0.380/0.331/0.380 | 0.832 |
| after-night | iphone-02-windup-01 | effect@358ms | 0.392–0.529 | 0.832 | True | 0.18 | True | 0.529 | 364 / 22.4; 0.36× rest lum-std | 0.596 | pass (faded) | 0.404–0.439 | 0.521 | pass | 0.380/0.331/0.380 | 0.832 |
| after-night | iphone-02-windup-02 | effect@684ms | 0.392–0.529 | 0.832 | True | 0.18 | True | 0.529 | 395 / 21.2; 0.34× rest lum-std | 0.569 | pass (faded) | 0.421–0.449 | 0.991 | pass | 0.380/0.331/0.380 | 0.832 |
| after-night | iphone-03-hit | hit@1227ms | 0.378–0.529 | 0.858 | True | 0.18 | True | 0.529 | 374 / 21.8; 0.35× rest lum-std | 0.559 | pass (faded) | 0.396–0.428 | 0.972 | pass | 0.380/0.331/0.380 | 0.858 |
| after-night | iphone-04-taunt | move@56ms | 0.392–0.529 | 0.858 | True | 0.18 | True | 0.529 | 375 / 21.4; 0.34× rest lum-std | 0.564 | pass (faded) | 0.417–0.442 | 0.343 | pass | 0.380/0.331/0.380 | 0.858 |
| after-night | iphone-05-result | idle | 0.198–0.633 | - | False | 1 | False | - | - | - | - | 0.324–0.369 | 0.990 | result card up | -/-/- | - |
| before-night | iphone-01-rest | idle | 0.378–0.529 | - | None | 1 | False | 0.529 | 282 / 63.3; 1.00× rest lum-std | 0.525 | pass | 0.378–0.407 | 1.000 | pass | 0.366/0.331/0.366 | 0.673 |
| before-night | iphone-02-windup-00 | effect@30ms | 0.378–0.529 | - | None | 1 | False | 0.529 | 379 / 67.3; 1.06× rest lum-std | 0.579 | FAIL | 0.397–0.439 | 0.999 | pass | 0.380/0.331/0.380 | 0.832 |
| before-night | iphone-03-hit | hit@1609ms | 0.378–0.529 | - | None | 1 | False | 0.529 | 315 / 62.6; 0.99× rest lum-std | 0.542 | FAIL | 0.387–0.416 | 0.974 | pass | 0.380/0.331/0.380 | 0.858 |
| before-night | iphone-05-result | idle | 0.198–0.633 | - | None | 1 | False | - | - | - | - | 0.325–0.371 | 0.919 | result card up | -/-/- | - |

Rest drift vs round 2 (|Δ| of face top/bottom, band, cards top):
- after-day iphone-01-rest: face top Δ0.001 bottom Δ0.000; band top Δ0.000 bottom Δ0.000; cards opacity 1, cardsFaded False
- after-ipad ipad-01-rest: face top Δ0.005 bottom Δ0.004; band top Δ0.000 bottom Δ0.000; cards opacity 1, cardsFaded False
- after-night iphone-01-rest: face top Δ0.006 bottom Δ0.003; band top Δ0.000 bottom Δ0.000; cards opacity 1, cardsFaded False
- before-night iphone-01-rest: face top Δ0.006 bottom Δ0.003; band top Δ0.000 bottom Δ0.000; cards opacity 1, cardsFaded None

## Result
- **Fade is real and drawn (iPhone, after):** in all 10 boss-beat frames (night 5, day 5: windup x3, hit, taunt) `cardsFaded` true, DOM opacity 0.18, `.battle-cards-faded` present; the cards' pixel luminance contrast falls to 0.33-0.36x (night) / 0.54-0.62x (day) of the same run's rest frame. Rest and result frames: opacity 1, `cardsFaded` false.
- **Boss face:** in band in every after frame where `bossFacing` >= 0.3 (windup-01 night, 0.521, and taunt night, 0.343, included). Face null where `bossFacing` < 0.3: day windup-01 (-0.223) and day taunt (0.291).
- **Team eyes:** every after boss-beat frame passes only because the cards are faded: the team boxes' bottoms are 0.555-0.596, under the cards top 0.529 (eyes sit behind the 0.18 cards). Rest frames: team bottom 0.524-0.525 <= 0.529, pass without the fade.
- **Before (`19a0d8c`, opaque cards):** team box bottom 0.579 (windup) and 0.542 (hit) vs cards top 0.529: FAIL, cards contrast 1.06x / 0.99x rest, `cardsFaded` field absent (None). That is the round-2 miss, the fade fixes it.
- **Rest drift vs round 2:** face top/bottom within 0.006/0.004, band exactly equal (iPhone night, before and after; iPad also band equal).
- **iPad:** `cardsFaded` false, opacity 1 in all 3 frames (rest, windup, hit). The "vs rest" pixel ratio is meaningless there: the rest frame's cards box is mostly empty background (lum-std 7.8), the later frames' box also includes team cards.
- **Result frames:** after-night/day result band 0.198-0.633 with the face drawn; before-night result is the same 0.198-0.633, so the result framing is unchanged between `19a0d8c` and `5ab56c1`. Round 2's night/day results (0.198-0.509, face null) were different fight outcomes (boss tuckered), not a framing change.

## Missing
- Before (`19a0d8c`): night only, rest + windup-00 + hit + result; no before taunt, no before windup-01/02, no before day.
- Before and after are separate fights (separate seeds), not the same instant as round 2's overlay pairs.
- iPad: night rest + windup (1 frame) + hit only; no iPad taunt/result/day. The iPad run's final wait for a result timed out (the three wanted frames were already saved).
- After-night windup-00 caught 30 ms into the power-up, windup-01/02 at 358/684 ms (bursts are early in the windup, as in round 2).
- The hit frames are the hit step (`hit@...ms`) on this SwiftShader runtime; iPad hit landed at 2892 ms (late in the step).
- Day and night runs are different fights (random seeds).
