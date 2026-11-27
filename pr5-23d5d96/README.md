# #190 PR 5b (#898) at `23d5d96`: signature moments, visual tuning pass

- **Build:** `190-boss-signatures` at `23d5d96`, `?tier=high&battle-clock=manual`, Chromium + SwiftShader, DPR 2, dev HUD hidden. iPhone 393×852 with notch insets (59/34). iPad 820×1180. Day is `America/Los_Angeles` (about 13:30 there), night is `Asia/Dubai` (about 01:30).
- **Spec:** `zz-capture-190-pr5.spec.ts.txt`, a throwaway; copy it to `apps/client/tests/e2e/` to run. Unchanged from `pr5-0e39b74/`. Run one project per capture (`--project=iphone-chromium` / `ipad-chromium`); without it all three projects write the same folder.
- **Capture only:** the HUD's 1.1 s sticker-hide timer is held, so a sticker can be carried over from the step before (01b, 03b).
- **Frame time:** not measurable here (SwiftShader, about 1 fps). An on-device capture is still owed.

## What changed since `pr5-0e39b74/`

The first helper read said the effects sat on the boss's face or behind the team. Root cause: the team stands in front of the BIG squishy's body, so anything at its feet or chest is hidden, and `at.y ± h` put bits on the face. The scene now passes the boss's real face box and body radius to `emit`; bursts anchor off them.

| effect | before | now |
|---|---|---|
| leaf pile (`windup:leaf`) | orbiting ring, ~15 of 134 visible, clumped on cheek/eye, red-heavy | two flank swirls at chin height beside the head, gold/green palette |
| frost shards (`assist:frost` call) | on the forehead | off both shoulders at the chin line, sideways |
| backup flash | one big pale disc (a second sun) | small core plus 14 stars beside the head, no halo discs |
| shout rings | flat discs / edge-on bar | standing `hoop` motion facing the camera, above the head |
| drift arcs | debris level with the team | across the chest, brought out towards the camera |

## Measurements: iPhone day

| frame | at ms | live | peak | draws | sticker | boss face (top–bottom) | team top |
|---|---|---|---|---|---|---|---|
| iphone-00-rest-day | — | 0 | 0 | 54 | — | 0.434–0.487 | 0.523 |
| iphone-01-leaf-pile-day | 520 | 134 | 142 | 56 | 2… | 0.631–0.668 | 0.691 |
| iphone-01a-three-day | 200 | 19 | 0 | 57 | 3! | 0.617–0.652 | 0.675 |
| iphone-01b-leaf-burst-day | 380 | 99 | 38 | 59 | 3! | facing away/none | 0.679 |
| iphone-02-shout-day | 260 | 62 | 21 | 58 | Everyone! | 0.617–0.652 | 0.675 |
| iphone-03-backup-call-day | 300 | 45 | 48 | 56 | Backup! | 0.549–0.613 | 0.674 |
| iphone-03b-backup-flash-day | 110 | 50 | 48 | 58 | Backup! | facing away/none | 0.681 |
| iphone-04-drift-day | 440 | 78 | 0 | 58 | Everyone! | 0.603–0.662 | 0.676 |
| iphone-04b-drift-hit-day | 200 | 89 | 78 | 59 | Everyone! | 0.602–0.666 | 0.674 |


Draw calls: 54 at rest, at most 59 at a beat (unchanged; no new meshes). Live particles peak at 142 of the pool; the unit-tested leaf peak stays under 150. Reduced motion takes 60% of each count (unit-tested).

## Measurements: iPhone night

| frame | at ms | live | peak | draws | sticker | boss face (top–bottom) | team top |
|---|---|---|---|---|---|---|---|
| iphone-00-rest-night | — | 0 | 0 | 55 | — | 0.434–0.487 | 0.526 |
| iphone-01-leaf-pile-night | 520 | 134 | 142 | 57 | 2… | 0.631–0.668 | 0.689 |
| iphone-01a-three-night | 200 | 19 | 0 | 58 | 3! | 0.617–0.652 | 0.676 |
| iphone-01b-leaf-burst-night | 380 | 99 | 38 | 60 | 3! | facing away/none | 0.682 |
| iphone-02-shout-night | 260 | 62 | 0 | 59 | Everyone! | 0.616–0.652 | 0.677 |
| iphone-03-backup-call-night | 300 | 45 | 48 | 57 | Backup! | 0.549–0.613 | 0.674 |
| iphone-03b-backup-flash-night | 110 | 50 | 48 | 59 | Backup! | facing away/none | 0.681 |
| iphone-04-drift-night | 440 | 78 | 0 | 59 | Everyone! | 0.603–0.662 | 0.676 |
| iphone-04b-drift-hit-night | 200 | 89 | 78 | 60 | Everyone! | 0.602–0.666 | 0.675 |


## Measurements: iPad 820×1180

| frame | at ms | live | peak | draws | sticker | boss face (top–bottom) | team top |
|---|---|---|---|---|---|---|---|
| ipad-00-rest-day | — | 0 | 0 | 54 | — | 0.411–0.477 | 0.533 |
| ipad-01-leaf-pile-day | 520 | 134 | 142 | 56 | 2… | 0.639–0.684 | 0.727 |
| ipad-01a-three-day | 200 | 19 | 0 | 57 | 3! | 0.620–0.663 | 0.704 |
| ipad-01b-leaf-burst-day | 380 | 99 | 38 | 59 | 3! | facing away/none | 0.712 |
| ipad-02-shout-day | 260 | 62 | 0 | 58 | Everyone! | 0.619–0.664 | 0.705 |
| ipad-03-backup-call-day | 300 | 45 | 48 | 56 | Backup! | 0.535–0.616 | 0.703 |
| ipad-03b-backup-flash-day | 110 | 50 | 48 | 58 | Backup! | facing away/none | 0.710 |
| ipad-04-drift-day | 440 | 78 | 0 | 58 | Everyone! | 0.604–0.683 | 0.705 |
| ipad-04b-drift-hit-day | 200 | 89 | 78 | 59 | Everyone! | 0.603–0.689 | 0.704 |


## Render read (helper subagents, text only), final pass

- **PASS:** 00-rest, 01a-three (day); 03-backup-call (all three sets): shards at both shoulders, face clear. The shout hoop reads as a thin upright ring at night.
- **No effect lands on the boss's eyes or mouth in any frame, on any device.**
- **Still soft (effects):**
  - Leaf pile: two leafy clumps either side of the head, not yet a swirl. Flat, saturated orange and green.
  - 01b leaf burst: a big lime blob on a friend; it is the leaf element's ordinary impact, not the signature burst.
  - 02 shout: the hoop reads, but a red/orange blob sits on the head tip and flat discs at the chin come from the stub move's own fire impact (the stub's shout is a copy of its area stomp).
  - 03b backup flash: lands left of the boss when the boss has turned away on its own beat, so the stars read as a scatter.
  - 04/04b: the dust crescent and spark arc read loosely; sparks scatter rather than form one arc on the hit friend.
  - Night: effects are legible but flat, not glowing (only the hoop glows). iPad: effects scale fine; the ring is low contrast against the day sky.
- **Not effects (camera/HUD), for PR 6:** the boss faces away or sideways on its landing and backup beats (01b, 03b); a friend covers the boss's mouth (04, 04b); the left friend is cropped at the screen edge (and the lying friend on iPad 01a/01b/04b); the sun sits behind the HUD name bar; the "Flinched!" label overlaps the bottom bar on iPad.

## Status

Better placed and no face overlap, but not yet owner-ready on looks. Remaining work in `element-fx.ts`: soften the leaf element's own impact and the move's ordinary impact during a signature beat, and a lit/additive look at night. The boss-turn beats need the camera lane.
