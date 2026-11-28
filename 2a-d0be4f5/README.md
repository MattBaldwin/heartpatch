# #37 2a: Twinkle Lights, captured and measured (`issue-37-2a-twinkle-lights` at `d0be4f5`, PR #909)

Real renderer, real code (no overrides): the dev island page `/island.html` (Vite dev server, no game server), Chromium + SwiftShader, **DPR 2**, captured the way lane 1a did.
- iPhone 393x852 (CDP safe-area insets 59 / 34) and iPad 1024x1366 (24 / 20), `isMobile`, touch. The island page has no HUD (no dev HUD), so the insets cross nothing.
- **Quality tier: `medium` for every frame** (the phone tier with no bloom), except `iphone-home-night-low` (`low`). The low frame matches the medium one pixel for pixel: neither draws bloom and the frame stands still. The stats show the tier applied (`low`, ambient `off`, one draw call fewer). There is no high-tier frame: it came out identical to medium on this page, so I make no claim about it.
- All frames are December (`season=christmas`, the first snow just there). `day` / `night` (`&night=1`, the Hollow layer's `NIGHT_LOOK`).
- **Scenes:**
  - `tile`: Twinkle Lights on one land tile per Keeper (4 Keepers).
  - `home`: on each Keeper's Heart Seed tile, with an Ember Den behind it (a swag under its eaves) and a Training Grounds pad in front-left (no eaves, so no swag; edge bulbs keep off it), clear of the Keeper.
  - `busy`: four lit tiles per Keeper (twice the per-Keeper cap of 2, because home and land count separately).
  - `wild-busy`: Wild Isle near the cap (24 lit tiles).
  - `far`: the farthest zoom.
- Two lit tiles side by side share one string on their common edge. On a busy patch each swag keeps 4 bulbs and each coil 3, and the edges share the rest.
- Reduced motion is the page's default, so every frame is **steady** except `iphone-home-night-motion-t1` / `-t2` (`&motion=1&t=1` / `&t=2.7`: the terrain clock moved to that second). Those two differ: the bulbs twinkle.
- Script: `shoot-37-2a.cjs.txt` (`node shoot-37-2a.cjs <out> http://localhost:5199`); numbers from `__islandMap.stats()` (`stats.json`). PNGs are quantised to 256 colours after capture.

## Results
| frame | tier | draw calls | lit tiles | bulbs | look | twinkle (ambient) |
|---|---|---|---|---|---|---|
| iphone-tile-day | medium | 57 | 4 | 140 | glass | steady (still) |
| iphone-home-day | medium | 60 | 4 | 120 | glass | steady (still) |
| iphone-busy-day | medium | 60 | 16 | 477 | glass | steady (still) |
| iphone-tile-night | medium | 57 | 4 | 140 | lit | steady (still) |
| iphone-home-night | medium | 60 | 4 | 120 | lit | steady (still) |
| iphone-busy-night | medium | 60 | 16 | 477 | lit | steady (still) |
| iphone-busy-night-far | medium | 59 | 16 | 477 | lit | steady (still) |
| iphone-wild-busy-night | medium | 66 | 24 | 549 | lit | steady (still) |
| ipad-tile-day | medium | 61 | 4 | 140 | glass | steady (still) |
| ipad-home-day | medium | 64 | 4 | 120 | glass | steady (still) |
| ipad-busy-day | medium | 64 | 16 | 477 | glass | steady (still) |
| ipad-tile-night | medium | 61 | 4 | 140 | lit | steady (still) |
| ipad-home-night | medium | 64 | 4 | 120 | lit | steady (still) |
| ipad-busy-night | medium | 64 | 16 | 477 | lit | steady (still) |
| ipad-busy-night-far | medium | 63 | 16 | 477 | lit | steady (still) |
| ipad-wild-busy-night | medium | 70 | 24 | 549 | lit | steady (still) |
| iphone-home-night-low | low | 59 | 4 | 120 | lit | steady (off) |
| iphone-home-night-motion-t1 | medium | 61 | 4 | 120 | lit | twinkling (live) |
| iphone-home-night-motion-t2 | medium | 61 | 4 | 120 | lit | twinkling (live) |

**Draw calls without lights**, same page and settings (`&built=1`): iPhone Cozy 58, Wild Isle 64; iPad Cozy 62, Wild Isle 68. With lights it is **+2**: one draw call for every bulb on the patch, plus one for the Twinkle Lights post's building look. Ceilings are 78 Cozy / 85 Wild Isle; the highest here is 70 (iPad Wild Isle).

## Render-check (read-only helper, fresh each round)
1. `800b292`: FIX: day bulbs muddy; swag halos over buildings; post a blob at night and hidden.
2. `14b4140`: FIX: edge bulbs on the Training Grounds pad; post clipping.
3. `a4d55c6`: FIX: swag bulbs on the flat pad.
4. `244a6c2`: PASS (helper). Supervisor 55's own check: FIX (identical tier frames, a still motion frame, a crowded home tile, doubled strings on shared edges, murky green).
5. `88241032`: FIX: busy patches dropped swags and coils.
6. `e0016fb`: FIX: Wild Isle swag thin, one shared edge dark.
7. **`d0be4f5`: PASS.**
