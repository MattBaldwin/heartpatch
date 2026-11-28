# Clockwork Isle mockups (#874), frames M1 to M4

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

## M3 three machines (original SVG, vinyl-toy brass, copper, wood, wool; snow on every roof)
Every machine has three states: **Working** (warm glow, steam, blades turn), **Resting** (powered but idle: dim bulb, still), **Needs power** (cold glass, dangling wire, ⚡ badge). Phone frames are 3x.
| File | Shows | Caption |
|---|---|---|
| `m3-windmill-and-sorter.png` | Windmill L1 (four woolly sails) and L2 (taller, six sails, brass band), each in 3 states with a wind chip ("Brrr! Fast" / "Slow wind"); Sorter with hopper, three coloured sweets, gears, chimney steam, a little belt | "Windmills catch the winter wind." / "The Sorter sorts, all by itself." |
| `m3-depot-bench-beacon.png` | Rail Depot with clock, rail stub and a loaded cart; Research Bench with blueprint, magnifier, gear and bulb lamp; Clockwork Beacon (brass post, gear, big bulb) | "Carts bring goodies home." / "Tinker up a blueprint." / "The Beacon hums." |
| `m3-ipad-all-machines.png` | All six looks (two Windmills, Sorter, Depot, Bench, Beacon) in all 3 states | |

## M4 two tech squishies (draft names Gearbit and Bulbun; Spark-leaning, soft and cute)
| File | Shows | Caption |
|---|---|---|
| `m4-idle.png` | Gearbit (golden, gear ears, wind-up key peeking out, red wool scarf, Spark/Joy) and Bulbun (lilac bunny, glass bulb nose that glows, teal scarf, Light/Cozy) idling in the snow | "Gearbit's ears spin when it's happy. Bulbun's nose glows at dusk." |
| `m4-battle.png` | A battle: Bulbun (far) and Gearbit (near) in brave poses, sparkle stars, HP bars, the move banner "Gearbit used Whirly Spin! ⚡" and four move cards | "Whirly Spin!" |
| `m4-part-sheet.png` | Part sheet: gear ears, bulb nose, wind-up key, frosty scarf, with a "same parts, new looks" strip | "Mix and match the tinker parts." |
| `m4-ipad.png` | iPad: idle pair and the battle in one frame | |

Move names here (Whirly Spin, Cozy Hum, Gear Hug, Tickle Tackle) are only placeholders for the picture; nothing in them is final.

## Look choices to react to
- **Frost** is a cool wash plus an icy vignette and a few sparkles over the terrain (the real build: one tint uniform when `patchType === 'clockwork-isle'`), warm brass and bulb glow against it. Snow caps sit on every roof, sail and sleeper.
- **Wind** is a separate layer, blue tint plus arrows, bigger and deeper at strength 3. It is off in the default map frames.
- **Unlit wire** is grey with cold glass posts; lit wire is a warm glow with moving sparks. A dashed ghost tile with "+" marks the missing wire tile.
- No dev HUD. The "Wires & rails" top pill and the bottom hint pill are proposed player UI.

## Draft names (the owner settles these)
Isle: **Clockwork Isle**. Buildings: Windmill, Sorter, Rail Depot, Research Bench, Clockwork Beacon. Squishies (M4): Gearbit, Bulbun. Alternatives if you want a more frosty edge: Frostcog, Glowbun.

## Questions for the owner (names settle here)
- Keep **Gearbit** and **Bulbun**, or take the frosty pair **Frostcog** and **Glowbun**? Evolutions planned: Cogwhirl and Lanternbun.
- Scarves are a Christmas touch. Should they be part of the species, or an accessory from the Wardrobe so the look can go season-neutral in Wave 2?
- Keep the "Clockwork Isle" name, or Tinker Isle or Gearwild?
