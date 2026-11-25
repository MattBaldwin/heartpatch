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
