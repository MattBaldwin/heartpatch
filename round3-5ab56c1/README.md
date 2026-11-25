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
| after-night | iphone-01-rest | idle | 0.378–0.529 | - | False | 1 | False | 0.529 | 264 / 63.1; 1.00× rest lum-std | 0.525 | pass | 0.378–0.407 | 0.962 | pass | 0.366/0.331/0.366 | 0.673 |
| after-night | iphone-02-windup-00 | effect@30ms | 0.392–0.529 | 0.832 | True | 0.18 | True | 0.529 | 387 / 20.8; 0.33× rest lum-std | 0.561 | pass (faded) | 0.418–0.443 | 0.964 | pass | 0.380/0.331/0.380 | 0.832 |
| after-night | iphone-02-windup-01 | effect@358ms | 0.392–0.529 | 0.832 | True | 0.18 | True | 0.529 | 364 / 22.4; 0.36× rest lum-std | 0.596 | pass (faded) | 0.404–0.439 | 0.521 | pass | 0.380/0.331/0.380 | 0.832 |
| after-night | iphone-02-windup-02 | effect@684ms | 0.392–0.529 | 0.832 | True | 0.18 | True | 0.529 | 395 / 21.2; 0.34× rest lum-std | 0.569 | pass (faded) | 0.421–0.449 | 0.991 | pass | 0.380/0.331/0.380 | 0.832 |
| after-night | iphone-03-hit | hit@1227ms | 0.378–0.529 | 0.858 | True | 0.18 | True | 0.529 | 374 / 21.8; 0.35× rest lum-std | 0.559 | pass (faded) | 0.396–0.428 | 0.972 | pass | 0.380/0.331/0.380 | 0.858 |
| after-night | iphone-04-taunt | move@56ms | 0.392–0.529 | 0.858 | True | 0.18 | True | 0.529 | 375 / 21.4; 0.34× rest lum-std | 0.564 | pass (faded) | 0.417–0.442 | 0.343 | pass | 0.380/0.331/0.380 | 0.858 |
| after-night | iphone-05-result | idle | 0.198–0.633 | - | False | 1 | False | - | - | - | - | 0.324–0.369 | 0.990 | result card up | -/-/- | - |

Rest drift vs round 2 (|Δ| of face top/bottom, band, cards top):
- after-night iphone-01-rest: face top Δ0.006 bottom Δ0.003; band top Δ0.000 bottom Δ0.000; cards opacity 1, cardsFaded False

## Notes / Missing
(in progress: groups are pushed as they finish; see the commit log)
