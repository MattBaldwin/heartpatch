# #37 2a: Twinkle Lights, captured and measured (`issue-37-2a-twinkle-lights` at `14b4140`)

Real renderer, real code (no overrides): the dev island page `/island.html` (Vite dev server, no game server), Chromium + SwiftShader, **DPR 2**, as lane 1a captured.
- iPhone 393x852 (CDP safe-area insets 59 / 34) and iPad 1024x1366 (24 / 20), `isMobile`, touch. The island page has no HUD (no dev HUD either), so the insets cross nothing.
- **Quality tier: `medium` for every frame** (the phone tier with no bloom), except `iphone-home-night-high` (`high`) and `iphone-home-night-low` (`low`).
- All frames are December (`season=christmas`, the first snow just there). `day` / `night` (`&night=1`, the Hollow layer's `NIGHT_LOOK`).
- `tile`: Twinkle Lights on one land tile per Keeper (4 Keepers, `&lightsAt=land`). `home`: on each Keeper's Heart Seed tile, beside an Ember Den and Training Grounds (`&built=1`). `busy`: four lit tiles per Keeper (twice the per-Keeper cap of 2: home and land count apart), near the 600 cap. `wild-busy`: Wild Isle, at the cap (24 tiles, 600 bulbs). `far`: farthest zoom.
- Reduced motion is the page's default, so every frame is **steady** except `iphone-home-night-motion` (`&motion=1`, twinkling; the page's clock doesn't tick, so it holds one twinkle frame).
- Script: `shoot-37-2a.cjs.txt` (`node shoot-37-2a.cjs <out> http://localhost:5199`); numbers from `__islandMap.stats()` (`stats.json`).

## Results
| frame | tier | draw calls | lit tiles | bulbs | bulbs | twinkle (ambient) |
|---|---|---|---|---|---|---|
| iphone-tile-day | medium | 57 | 4 | 140 | glass | steady (still) |
| iphone-home-day | medium | 60 | 4 | 156 | glass | steady (still) |
| iphone-busy-day | medium | 60 | 16 | 544 | glass | steady (still) |
| iphone-tile-night | medium | 57 | 4 | 140 | lit | steady (still) |
| iphone-home-night | medium | 60 | 4 | 156 | lit | steady (still) |
| iphone-busy-night | medium | 60 | 16 | 544 | lit | steady (still) |
| iphone-busy-night-far | medium | 59 | 16 | 544 | lit | steady (still) |
| iphone-wild-busy-night | medium | 66 | 24 | 576 | lit | steady (still) |
| ipad-tile-day | medium | 61 | 4 | 140 | glass | steady (still) |
| ipad-home-day | medium | 64 | 4 | 156 | glass | steady (still) |
| ipad-busy-day | medium | 64 | 16 | 544 | glass | steady (still) |
| ipad-tile-night | medium | 61 | 4 | 140 | lit | steady (still) |
| ipad-home-night | medium | 64 | 4 | 156 | lit | steady (still) |
| ipad-busy-night | medium | 64 | 16 | 544 | lit | steady (still) |
| ipad-busy-night-far | medium | 63 | 16 | 544 | lit | steady (still) |
| ipad-wild-busy-night | medium | 70 | 24 | 576 | lit | steady (still) |
| iphone-home-night-high | high | 64 | 4 | 156 | lit | steady (still) |
| iphone-home-night-low | low | 59 | 4 | 156 | lit | steady (off) |
| iphone-home-night-motion | medium | 58 | 4 | 140 | lit | twinkling (live) |

**Draw calls without lights**, same page and settings (`&built=1`): iPhone Cozy 58, Wild Isle 64; iPad Cozy 62, Wild Isle 68. With lights: **+2** (one for every bulb on the patch, one for the Twinkle Lights post's building look). Ceilings 78 Cozy / 85 Wild Isle: highest here **70** (iPad Wild Isle at the cap). The `tile` frames are +2 over the page without `built` (55 / 59).

## Render-check
Round 1 (`2a-800b292`, not kept): FIX: day bulbs muddy; swag halos washing over buildings and edge bulbs on a building's pad; the post a blob at night and hidden by the Keeper. Fixed in `14b4140`: unlit glass colours with a rim shine, swag bulbs at 0.6 size, no edge bulbs under a footprint, a chunkier four-stripe post on the camera side.
