# #37 2a: home frames re-shot at `d6fd39b` (PR #909)

Supervisor 55's re-check of `2a-d0be4f5/` asked for the home tile's Twinkle Lights post to stand clear of the Heart Seed and the Keeper. The dev gallery (`withTwinkleLights`) now puts it on the west ring spot. That is a dev helper only: no game code changed between `d0be4f5` and `d6fd39b`. So the other frames in `2a-d0be4f5/` still stand, and only the home frames are re-shot here. Same method and script as `2a-d0be4f5/README.md` (medium tier unless named, DPR 2, no HUD).

| frame | tier | draw calls | lit tiles | bulbs | look | twinkle |
|---|---|---|---|---|---|---|
| iphone-home-day | medium | 60 | 4 | 120 | glass | steady |
| iphone-home-night | medium | 60 | 4 | 120 | lit | steady |
| ipad-home-day | medium | 64 | 4 | 120 | glass | steady |
| ipad-home-night | medium | 64 | 4 | 120 | lit | steady |
| iphone-home-night-low | low | 59 | 4 | 120 | lit | steady |
| iphone-home-night-motion-t1 | medium | 61 | 4 | 120 | lit | twinkling |
| iphone-home-night-motion-t2 | medium | 61 | 4 | 120 | lit | twinkling |

High tier: bloom doesn't visibly change the bulbs on the island page; checking that is a follow-up, so no claim is made here.
