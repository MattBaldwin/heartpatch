# Clockwork Isle mockups (#874), frames M1 and M2

Throwaway mockups for the owner's Mockup Board. **No feature code.** Frosty Christmas headline: brass, copper, wood and wool with warm bulbs, plus frost, snow and winter wind. Cozy tinker-town, never a factory.

## How these were made
- **Terrain, hexes, snow, Keeper, night look** are real renders of the game's own map scene (`/island.html?patch=wild&season=christmas&snow=0.5`, `dist=16` zoomed, `dist=26` far, `&night=1`), shot headless in Chromium.
- **Everything Clockwork** (town, wires, rails, wind tint, frost wash, Build sheet, badge) is original hand-drawn SVG in `source/kit.js` and `source/frames-m1m2.js`, composited on those renders. The real build would draw these as procedural 3D, so treat shapes and colours as the look, not the geometry.
- Map frames are 2x (the game caps DPR at 2); iPhone 15 is 393x852, iPad is 1024x1366. Props are projected by eye, so they are not on exact tile centres.
- Original art only, no outside assets. To re-shoot: make plates with `source/shot-island.js` (needs the client dev server) into `plates/plate-<name>.png`, then run `source/shoot.js` with a JSON job list `[{f,out,w,h,dsf}]` (e.g. `f: "m1.zoomday"`).

## Frames
| File | Shows | Kid-friendly caption |
|---|---|---|
| `m1-far-day.png` | Far view of the whole isle, frost tint, tiny brass-and-wood town on the home patch | "Our little isle, all frosty!" |
| `m1-zoom-day.png` | Zoomed town: Windmill L2 and L1, Sorter, Research Bench, Rail Depot, Beacon around the Keeper | "Windmills, workshops and one cosy Beacon." |
| `m1-zoom-wind.png` | Zoomed with the wind layer on: arrows and blue tint, calm inland, strong on the coast | "See where the wind blows strongest." |
| `m1-far-wind.png` | Far view with the wind layer on | "Windy coasts make windmills zoom." |
| `m1-wind-three-strengths.png` | The three strengths side by side in bands: 1 pale and small, 2 medium, 3 deep blue and big | "Little breeze, good breeze, big brrr!" |
| `m1-night-beacon.png` | Night, a powered Beacon's warm cone, glowing workshop windows | "The Beacon hums. The Hollow Man keeps his distance." |
| `m1-ipad-day.png`, `m1-ipad-night.png` | iPad versions of day and night | |
| `m2-wire-and-rail-overlay.png` | Lines overlay. A lit wire chain Windmill L2 to Sorter; a second chain from Windmill L1 with a dashed "+" gap tile and grey unlit wire to a cold Sorter, with the "Needs a wire to a Windmill ⚡" bubble; a rail with snowy sleepers from a far tile to the Rail Depot with a loaded cart | "Wires carry Spark. Rails carry goodies." |
| `m2-build-sheet-lines.png` | Build sheet "Lines" tab: Wire card (1 Part per tile, up to 6 tiles), Rail card L1, Rail (brass) L2 locked behind Tidy Rails | "Lay a wire. Lay a rail." |
| `m2-needs-a-wire-card.png` | The tile card for an unpowered Sorter: the need line "Needs a wire to a Windmill ⚡", hint, "Lay a wire" button | "Cold and quiet. Needs a wire!" |
| `m2-ipad-overlay.png` | iPad version of the overlay | |

## Look choices to react to
- **Frost** is a cool wash plus an icy vignette and a few sparkles over the terrain (the real build: one tint uniform when `patchType === 'clockwork-isle'`), warm brass and bulb glow against it. Snow caps sit on every roof, sail and sleeper.
- **Wind** is a separate layer, blue tint plus arrows, bigger and deeper at strength 3. It is off in the default map frames.
- **Unlit wire** is grey with cold glass posts; lit wire is a warm glow with moving sparks. A dashed ghost tile with "+" marks the missing wire tile.
- No dev HUD. The "Wires & rails" top pill and the bottom hint pill are proposed player UI.

## Draft names (the owner settles these)
Isle: **Clockwork Isle**. Buildings: Windmill, Sorter, Rail Depot, Research Bench, Clockwork Beacon. Squishies (M4): Gearbit, Bulbun. Alternatives if you want a more frosty edge: Frostcog, Glowbun.

## Still to come
M3 (three machines), M4 (two tech squishies) land in this same folder.
