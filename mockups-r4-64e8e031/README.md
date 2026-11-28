# Clockwork Isle mockups (#874), round 4: cozy steampunk metropolis

Owner direction (2026-11-28), via supervisor 55. Frosty Christmas headline, cozy tinker-town, never grimy or scary. Earlier sets stay in `mockups-64e8e031/`, `mockups-r2-64e8e031/` and `mockups-r3-64e8e031/` (the r3 folder has the small M2/M3/M4 fixes; this round carries them forward).

## What the owner asked for, and where to see it
1. **Centred on their tile.** Every building sits on its tile's centre, like Cozy and Wild patches. Tile centres come from the game's own projection of each hex (not by eye), so buildings and rings line up with the real hexes.
2. **Cozy steampunk, varied materials and colours.** Red brick, painted wood (teal, cream, mustard, sage, plum), dark riveted iron, copper roofs with verdigris, brass gauges, gears, pipes, brick and iron chimneys with steam, flower boxes. Warm light comes from windows and lamps; nothing glows gold all over. At night the windows and lamps light up (`m1-night-beacon`, `m1-metropolis-night`).
3. **Varied heights.** Squat Sorter, Depot shed and Bench cabin; medium cottages; tall Windmills, Beacon, a clock tower and townhouses. `m3-skyline-heights.png` lines them up on one baseline.
4. **Room for a road around every building.** Each building tile has a snow-dusted road ring and roads link neighbouring building tiles, so a road can drive round any building (`m1-zoom-day`, `m1-ipad-day`).
5. **A cozy metropolis.** `m1-metropolis-far.png` (phone), `m1-ipad-metropolis.png` and `m1-metropolis-night.png`: a big patch full of buildings with road loops and frost light. The clock tower, townhouses, cottages, workshops, greenhouse and water tank are skyline pieces for the picture only; they are not Wave 1 content. Only Windmill, Sorter, Depot, Bench and Beacon are Wave 1 buildings.

## Frames
| File | Shows | Caption |
|---|---|---|
| `m1-far-day.png` | Whole isle, the town small on its patch | "Our little isle, all frosty!" |
| `m1-zoom-day.png` | Zoomed town: tall Windmill L2, Beacon and Windmill L1 at the back, cottages, Bench, Sorter, Depot and workshop in front, ring roads | "Windmills, workshops and cosy roads." |
| `m1-metropolis-far.png`, `m1-ipad-metropolis.png` | The dense metropolis | "A whole snowy town!" |
| `m1-metropolis-night.png` | The metropolis at night | "Lamps on, chimneys puffing." |
| `m1-zoom-wind.png`, `m1-far-wind.png` | Wind layer on (blue tint and arrows) | "See where the wind blows strongest." |
| `m1-wind-three-strengths.png` | Three labelled strengths, feathered | "Little breeze, good breeze, big brrr!" |
| `m1-night-beacon.png`, `m1-ipad-night.png` | Night, warm windows, the Beacon's cone | "The Beacon hums." |
| `m1-ipad-day.png` | iPad day | |
| `m2-wire-and-rail-overlay.png`, `m2-ipad-overlay.png` | Lit wire chain Windmill L2 to Sorter; a second chain from Windmill L1 with one dashed gap hex on one empty tile; a cold Sorter with "Needs a wire to a Windmill ⚡" pointing at it; a stepped rail from a far tile that joins the Depot's stub, cart on the line | "Wires carry Spark. Rails carry goodies." |
| `m2-build-sheet-lines.png` | Build sheet, Lines tab: Wire, Rail, Rail (brass) | "Lay a wire. Lay a rail." |
| `m2-needs-a-wire-card.png` | Tile card for an unpowered Sorter | "Cold and quiet. Needs a wire!" |
| `m3-windmills.png` | Windmill L1 and L2, each on its tile with a road ring, 3 states, wind chip on every state, "Needs a wire" with a plug icon | "Windmills catch the winter wind." |
| `m3-sorter-and-depot.png` | Sorter (brick, hopper, crates, gauge) and Depot (teal shed, verdigris roof, clock, cart) | "Sorts goodies into tidy piles." / "Carts bring goodies home." |
| `m3-bench-and-beacon.png` | Research Bench (visible blueprint) and Clockwork Beacon (dark iron lattice, brass lantern) | "Tinker up a blueprint." / "The Beacon hums." |
| `m3-skyline-heights.png` | All six on one baseline | "Squat, medium and tall." |
| `m3-ipad-all-machines.png` | All six in all 3 states | |
| `m4-*` | Gearbit and Bulbun (round 3 fixes carried: brass-orange Gearbit, no cheek circles, key on a stem) | |

States: **Working** (warm windows, steam), **Resting** (dim windows, no steam), **Needs power / Needs a wire** (grey glass, snow on the chimney, dangling wire, ⚡ badge).

## How these were made
Terrain, hexes, snow and the night look are real renders of the game's map scene (`island.html?patch=wild&season=christmas`). A temporary local hook in the dev gallery (not committed) printed each hex's screen position (`source/proj.js` shows how; positions are in `source/tiles.js`). Everything Clockwork is original SVG (`source/kit2.js` buildings, `source/frames-r4.js` scenes). Map frames are 2x (the game caps DPR at 2); phone M3/M4 are 3x. No outside assets.

## Draft names still open
Gearbit and Bulbun (frosty alternatives Frostcog and Glowbun).
