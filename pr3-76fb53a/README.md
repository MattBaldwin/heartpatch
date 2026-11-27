# #190 PR 3 (#890) at `76fb53a`: the BIG squishy arrives, measured

- Build: `190-boss-entrance` at `76fb53a`, `?tier=high`, Chromium + SwiftShader, DPR 2. iPhone 393×852 with notch insets (CDP `setSafeAreaInsetsOverride` 59/34), iPad 1024×1366. Day = the e2e daytime zone, night = `Asia/Tokyo`. Reduced motion = `emulateMedia({ reducedMotion: 'reduce' })`.
- Spec: `zz-capture-190-pr3.spec.ts.txt` (throwaway; copy to `apps/client/tests/e2e/` to run). It slows the page 20× (the pr2 `SLOW` virtual clock), then freezes it once the hook's `battle.entrance.at` passes each beat: arrive 300, stomp 640, card 1500, settled 2500 ms. Sidecar JSON per frame: entrance state, scene framing, rects of the card, skip pill, strip and handle.
- Measured by `measure-190-pr3.py`: the card in the band, clear of the boss's face, its head (the face top less 1.5 face-heights, `BOSS_ENTRANCE.headroom`) and the team's eyes.

## Result

- **Name card:** in all 5 frames where it shows, it sits inside the band and clear of the face, the head and the team. iPhone: 0.183–0.300 against face top ≥ 0.421 and team ≥ 0.521. iPad: 0.119–0.191 against face top ≥ 0.361. It sits in the sky over the boss's head. In the first take at `b70e229` the card was placed in the face-to-team gap, which is only ~37 px on iPhone, so it covered the boss's mouth and the team's heads. `76fb53a` fixed the rule.
- **Skip affordance only after the stomp:** both arrive frames (iPhone 334 ms, iPad 536 ms) have `skippable: false` and the pill at opacity 0. Every frame at or after 600 ms has `skippable: true` and the pill at opacity 1.
- **Settled frame matches PR 2's rest framing:**
  - Band: iPhone 0.142–0.610, iPad 0.045–0.654 (pr2b: iPad 0.045–0.654).
  - Feet (hook `teamFeet`): 0.610 / 0.654, i.e. at the band bottom, the same as pr2b's hook value. The drawn feet sit higher (pr2b true feet 0.639).
  - Boss face: iPad 0.394–0.466 against pr2b rest 0.405–0.473.
  - The picker stays up throughout the entrance (inert under the layer), so the sheet and band never move and there is no reframe when the entrance ends.
  - Worst body edge: not re-measured by pixels here. Framing is the PR 2 camera unchanged and the band and face match within 0.011.
- **Reduced motion:** `iphone-02-stomp-day-reduced` shows the boss standing round (no drop, no squash), the card timing unchanged and the skip pill up. The camera push and shake are zeroed, as PR 2's director does.

## Caveats

- **iPad overshoot:** the SwiftShader iPad renders slowly, so the frames froze later than their targets. Stomp day landed at 789 ms (still squash time), stomp night at 1074 ms (the card is already up, so this frame is stomp plus card). The iPad "settled" frame froze just after the end (`entrance: null`): the rest framing with no layer.
- **Feet during the stomp:** the landing push sets `teamFeet` below the band briefly (iPhone 0.624–0.626, iPad 0.689). This is the PR 2 landing thump itself, and it returns to the band bottom once settled. The iPad arrive frame also reads 0.691 while the camera finishes its open.
- **Night pill:** the skip pill's dark fill blends into the night sky. The white text stays readable.

## Table

| frame | at | skippable | skip_opacity | band | face | team_top | feet | card | card_opacity | in_band | clear_face | clear_head | clear_team |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ipad-01-arrive-day | 536 | False | 0 | 0.045-0.654 | 0.435-0.506 | 0.572 | 0.691 |  |  |  |  |  |  |
| ipad-02-stomp-day | 789 | True | 1 | 0.045-0.654 | 0.370-0.459 | 0.546 | 0.689 |  |  |  |  |  |  |
| ipad-03-card-day | 1730 | True | 1 | 0.045-0.654 | 0.382-0.456 | 0.528 | 0.654 | 0.133-0.184 | 1 | True | True | True | True |
| ipad-04-settled-day | done | None | None | 0.045-0.654 | 0.394-0.466 | 0.533 | 0.654 |  |  |  |  |  |  |
| ipad-02-stomp-night | 1074 | True | 1 | 0.045-0.654 | 0.400-0.476 | 0.541 | 0.691 | 0.141-0.191 | 1 | True | True | True | True |
| ipad-03-card-night | 1879 | True | 1 | 0.045-0.654 | 0.361-0.440 | 0.518 | 0.661 | 0.119-0.169 | 1 | True | True | True | True |
| iphone-01-arrive-day | 334 | False | 0 | 0.142-0.610 | 0.447-0.497 | 0.535 | 0.610 |  |  |  |  |  |  |
| iphone-02-stomp-day-reduced | 739 | True | 1 | 0.142-0.610 | 0.435-0.487 | 0.533 | 0.610 |  |  |  |  |  |  |
| iphone-02-stomp-day | 714 | True | 1 | 0.142-0.610 | 0.440-0.494 | 0.531 | 0.624 |  |  |  |  |  |  |
| iphone-03-card-day | 1538 | True | 1 | 0.142-0.610 | 0.421-0.478 | 0.524 | 0.610 | 0.183-0.294 | 1 | True | True | True | True |
| iphone-04-settled-day | 2543 | True | 1 | 0.142-0.610 | 0.432-0.486 | 0.529 | 0.610 |  |  |  |  |  |  |
| iphone-02-stomp-night | 731 | True | 1 | 0.142-0.610 | 0.432-0.488 | 0.531 | 0.626 |  |  |  |  |  |  |
| iphone-03-card-night | 1560 | True | 1 | 0.142-0.610 | 0.429-0.482 | 0.521 | 0.610 | 0.189-0.300 | 1 | True | True | True | True |
