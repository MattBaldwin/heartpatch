# #37 2a: Twinkle Lights, captured and measured (`issue-37-2a-twinkle-lights` at `244a6c2`, PR #909)

Real renderer, real code (no overrides): the dev island page `/island.html` (Vite dev server, no game server), Chromium + SwiftShader, **DPR 2**, as lane 1a captured.
- iPhone 393x852 (CDP safe-area insets 59 / 34) and iPad 1024x1366 (24 / 20), `isMobile`, touch. The island page has no HUD (no dev HUD), so the insets cross nothing.
- **Quality tier: `medium` for every frame** (the phone tier with no bloom), except `iphone-home-night-high` (`high`) and `iphone-home-night-low` (`low`). Low and medium both draw no bloom and the frame stands still, so the low frame matches medium; the stats show the tier applied (`low`, ambient `off`, one draw call fewer).
- All frames are December (`season=christmas`, the first snow just there). `day` / `night` (`&night=1`, the Hollow layer's `NIGHT_LOOK`).
- `tile`: Twinkle Lights on one land tile per Keeper (4 Keepers). `home`: on each Keeper's Heart Seed tile beside an Ember Den (swag under its eaves) and a Training Grounds pad (no eaves: no swag; edge bulbs keep off it). `busy`: four lit tiles per Keeper (twice the per-Keeper cap of 2, as home and land count apart), near the cap. `wild-busy`: Wild Isle at the cap. `far`: farthest zoom.
- Reduced motion is the page's default, so every frame is **steady** except `iphone-home-night-motion` (`&motion=1`: twinkling; the page's clock doesn't tick, so it holds one twinkle frame).
- Script: `shoot-37-2a.cjs.txt` (`node shoot-37-2a.cjs <out> http://localhost:5199`); numbers from `__islandMap.stats()` (`stats.json`). PNGs quantised to 256 colours after capture.

## Results
| frame | tier | draw calls | lit tiles | bulbs | look | twinkle (ambient) |
|---|---|---|---|---|---|---|
| iphone-tile-day | medium | 57 | 4 | 140 | glass | steady (still) |
| iphone-home-day | medium | 60 | 4 | 120 | glass | steady (still) |
| iphone-busy-day | medium | 60 | 16 | 528 | glass | steady (still) |
| iphone-tile-night | medium | 57 | 4 | 140 | lit | steady (still) |
| iphone-home-night | medium | 60 | 4 | 120 | lit | steady (still) |
| iphone-busy-night | medium | 60 | 16 | 528 | lit | steady (still) |
| iphone-busy-night-far | medium | 59 | 16 | 528 | lit | steady (still) |
| iphone-wild-busy-night | medium | 66 | 24 | 552 | lit | steady (still) |
| ipad-tile-day | medium | 61 | 4 | 140 | glass | steady (still) |
| ipad-home-day | medium | 64 | 4 | 120 | glass | steady (still) |
| ipad-busy-day | medium | 64 | 16 | 528 | glass | steady (still) |
| ipad-tile-night | medium | 61 | 4 | 140 | lit | steady (still) |
| ipad-home-night | medium | 64 | 4 | 120 | lit | steady (still) |
| ipad-busy-night | medium | 64 | 16 | 528 | lit | steady (still) |
| ipad-busy-night-far | medium | 63 | 16 | 528 | lit | steady (still) |
| ipad-wild-busy-night | medium | 70 | 24 | 552 | lit | steady (still) |
| iphone-home-night-high | high | 64 | 4 | 120 | lit | steady (still) |
| iphone-home-night-low | low | 59 | 4 | 120 | lit | steady (off) |
| iphone-home-night-motion | medium | 58 | 4 | 140 | lit | twinkling (live) |

**Draw calls without lights**, same page and settings (`&built=1`): iPhone Cozy 58, Wild Isle 64; iPad Cozy 62, Wild Isle 68. With lights: **+2** (one draw call for every bulb on the patch, one for the Twinkle Lights post's building look). Ceilings 78 Cozy / 85 Wild Isle; highest here is iPad Wild Isle at the cap.

## Render-check (read-only helper, fresh each round)
1. `800b292`: FIX: day bulbs muddy; swag halos washing over buildings, edge bulbs on a building's pad; the post a blob at night and hidden by the Keeper.
2. `14b4140` (frames in `2a-14b4140/`): FIX: edge bulbs on the Training Grounds pad; the post clipping it.
3. `a4d55c6`: FIX: swag bulbs lying on the flat pad.
4. `244a6c2`: PASS (helper); supervisor 55: FIX. Superseded by `2a-d0be4f5/` (PASS).
