# #37 1a: first snow on every patch, captured and measured (`37-1a-snow` at `fd71917`)

Real renderer, real code (no overrides): the dev island page `/island.html` (Vite dev server, no game server), `?tier=high`, Chromium + SwiftShader, **DPR 2**.
- iPhone 393x852 and iPad 1024x1366 (CSS px), `isMobile`, touch. The island page has no HUD, so the notch insets cross nothing (no fixed element).
- `patch=cozy` (`testPatch`, the busy 4-Keeper Cozy patch) and `patch=wild` (`testWildIsle`, radius 18). Night = `&night=1` (the Hollow layer's `NIGHT_LOOK`, as the map at nightfall).
- `today` = no season. `snow` = `&season=christmas&snow=1` (the fade played to its end, so snowfall shows). `midfade` = `&snow=0.5` (cover 0.5 on the eased fade). `far` = farthest zoom, to show the ground off the map.
- Script: `shoot-37-1a.cjs.txt` (`node shoot-37-1a.cjs <out> http://localhost:5199`). Draw calls and motes from the page's `__islandMap.stats()` (`stats.json`).
- Luminance is measured on the 2x originals (PIL, mean of the whole frame, Rec.601 L); the PNGs here are the same 2x frames quantised to 256 colours to keep the branch small.

## Results
| frame | draw calls | snow | motes | frame lum |
|---|---|---|---|---|
| iphone-cozy-day-today | 59 | - | sparkles 28 | 176.5 |
| iphone-cozy-day-snow | 60 | 1 | snow 120, sparkles 28 | 212.3 |
| iphone-cozy-day-midfade | 60 | 0.5 | snow 120 | 194.0 |
| iphone-cozy-night-today | 60 | - | fireflies 90 | 92.6 |
| **iphone-cozy-night-snow** | 60 | 1 | snow 120 | **147.1** |
| iphone-cozy-night-midfade | 60 | 0.5 | snow 120 | 114.1 |
| iphone-wild-day-today / snow | 65 / 66 | - / 1 | | 180.9 / 219.1 |
| iphone-wild-night-today / **snow** | 66 / 66 | - / 1 | | 96.0 / **150.6** |
| ipad-cozy-day-today / snow | 59 / 60 | | | 176.9 / 218.5 |
| ipad-cozy-night-today / **snow** | 60 / 60 | | | 90.6 / **148.9** |
| ipad-wild-day-today / snow | 65 / 66 | | | 178.7 / 219.4 |
| ipad-wild-night-today / **snow** | 66 / 66 | | | 93.4 / **150.8** |
| ipad-{cozy,wild}-{day,night}-snow-far | 59 / 65 | 1 | snow 120 | - |

`today` stands still on this page (reduced motion), so it draws no pollen or leaves by day; the +1 by day is the snowfall layer, which in the game replaces pollen + leaves (2 layers) by day and fireflies at night.

## Owner fix 1: night snow reads as snow
- **Night snow frame lum 147 to 151** (iPhone and iPad, Cozy and Wild Isle) against **today's night ground 91 to 96** on the same page and **M0's 121 to 123** (M0 measured the real app with the HUD, so compare deltas: M0 was +18 to +25 over today; this is **+55 to +57**).
- How: the snow catches the moon. A `snow` uniform in the terrain plugin adds `lift x albedo x moon` (lift 0.28, moon `[0.78, 0.88, 1]`, both `// TUNE`) to bright (snowy) surfaces after lighting, at night only; owned land keeps its warm cream and player wash, so ownership still reads. The backdrop under the island goes a deep moonlit blue (`CHRISTMAS.sky.night`); the clear colour stays the Hollow's lavender. Look at `iphone-cozy-night-snow.png`: white-blue snow, dark sky.

## Owner fix 2: off-map ground snowed: **yes**
- Cozy: the island disc and rim round the patch are snowed (`*-cozy-*-snow-far.png`: a pale snow disc on the night sky, no green ring). Wild Isle: the grass plate, the beach (less, `CHRISTMAS.ground.beach` 0.6) and the isles' sand skirts are snowed; the sea stays sea with its glint.
- Bottom-edge mean colour, iPhone Cozy: today day (163,199,167) green -> snow day (255,255,255); night (73,100,86) -> (165,179,198).

## Draw calls
Phone and iPad frames draw the same scene: **Cozy 60, Wild Isle 66** with snow (ceilings **78 / 85**; today 59-60 / 65-66). Snow caps are in the shader (props' up-facing surfaces, faded by the same uniform), so `SnowCapField` was not needed: **+0** for caps.

## For the render-check
- Day Wild Isle at the farthest zoom (`ipad-wild-day-snow-far.png`): the snowy island blooms bright against the sea at `tier=high`. Within M0's approved day brightness (frame lum 219 vs M0 222), but flag it if it reads too glary.
- Mid-fade frames show the tiles half way and caps half way; the fade is 6 s on the first open of the season, eased; reduced motion snaps.
