# #37 M0: Christmas mockups (snow, lights, tree, advent sheet), measured

Capture-time mockups only: **no app code changed**. Runtime: worktree at `main` `bc0e111`, server with `HP_DEV_NOW` = now + 9 days (5 Dec 2026, so the
`christmas` window is on) and the client's `Date` shifted by the same 9 days. Measured by `measure-37-m0.py` (PIL, numbers) on the 2x originals; PNGs here are
downscaled to device size (393x852 / 820x1180) **after** measuring. Sidecars `.json` hold DOM rects, computed text colours, projected tile centres and bulb points.

## Method / environment
- Spec `zz-capture-37.spec.ts.txt` (copy to `apps/client/tests/e2e/zz-capture-37.spec.ts`). Env as `m0-boss-hud/README.md` (Postgres, `.env`, `pnpm install`, `db:migrate`, `db:seed`, `pnpm --filter @heartpatch/shared build`),
  servers started by hand with `HP_DEV_NOW`, `HP_HOUSE=on HP_WILD_ISLE=on HP_LONG_NIGHT=on HP_DEV_SQUISHY_GRANTS=true`; `PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`, chromium projects, `?tier=high`, SwiftShader, DPR 2.
- iPhone 393x852 with CDP safe-area insets top 59 / bottom 34; iPad 820x1180. Night = `America/Sao_Paulo` (about 02:30 local), day = `Asia/Bangkok` (about 12:30). Day: iPhone only; iPad night only.
- Scene: a fresh Keeper and patch; 14 plain tiles round home set to the Keeper's by SQL (so owned vs wild is visible); nearest trading post used for the tree. Default zoom; the tree frames pan to the post (`mapDev().show`).
- **What the client already does in December:** nothing. `grep -i christmas apps/client/src` hits only tests; `seasonsOn()` returns `christmas` but no look keys on it. So frame 01 is today's autumn-less default map (no motes change, no sky change).

## Overrides used (verbatim)
```ts
// zz-capture-37.spec.ts.txt, installSnowRoutes: each is page.route(...) + route.fetch() + body rewrite
map-dressing.ts : 'export function tileColor(' -> 'function tileColorToday(' , then snow-dressing.js appended
map-config.ts   : + snow-config.js     ambient-layout.ts : + snow-layout.js     map-ambient.ts : + snow-ambient.js
map-scene.ts    : 'this.nodeField = new HomeNodes(scene,' -> 'window.__capScene = scene; this.nodeField = new HomeNodes(scene,'  (to project 3D points)
// snow is toggled per load by sessionStorage.__capSnow; the client's Date is shifted +9 days (init script) to match HP_DEV_NOW
```

**`overrides/snow-dressing.js`**
```js
// MOCK (capture time only): the Christmas tile colours. Appended to the served map-dressing module, which had
// `export function tileColor(` renamed to `tileColorToday(`. Wild (muted) land goes cool snow-white; owned land stays
// a touch warmer and keeps more of its own green; lakes get a frosted tint. Per-instance colour only: 0 draw calls.
export function tileColor(lookColor, jitter, muted) {
  const c = tileColorToday(lookColor, jitter, muted);
  if (sessionStorage.getItem('__capSnow') !== '1') return c;
  const SNOW = {
    '#c2eaa6': 0.94, '#93d6a0': 0.9, '#74b994': 0.86, '#e2d1a4': 0.94, '#c9bddb': 0.55,
    '#f4d68e': 0.9, '#efcf95': 0.8, '#c2eefb': 0.55,
  };
  const share = muted === true ? 1 : muted === false ? 0 : Math.min(1, Math.max(0, muted));
  const wild = share >= 0.5;
  let k = SNOW[lookColor.toLowerCase()];
  let target;
  if (lookColor.toLowerCase() === '#9fd6f5') { k = 0.62; target = [0.82, 0.92, 0.98]; }       // frosted lake
  else target = wild ? [1.0, 1.0, 1.0] : [1.0, 0.95, 0.86];                                  // cool wild / warm owned
  if (k === undefined) return c;
  if (!wild && lookColor.toLowerCase() !== '#9fd6f5') k *= 0.74;                                 // owned keeps more of itself
  const b = Math.min(1.08, Math.max(1.0, 1.0 + (jitter.brightness - 1) * 0.5 + 0.04));
  return c.map((v, i) => v + (Math.min(1, target[i] * b) - v) * k);
}
```

**`overrides/snow-config.js`**
```js
// MOCK: snowfall replaces pollen/fireflies; leaves become white flakes over every land terrain (config only).
if (sessionStorage.getItem('__capSnow') === '1') {
  Object.assign(MOTES.leaves, { perTile: 1.4, max: 120, color: '#ffffff' });
  MOTES.pollen.perTile = 0; MOTES.pollen.max = 0;
  MOTES.fireflies.perTile = 0; MOTES.fireflies.max = 0;
}
```

**`overrides/snow-layout.js`**
```js
// MOCK: the `fall` drift mode already exists (leaves); give it snow's size, height and sway, over all land.
if (sessionStorage.getItem('__capSnow') === '1') {
  TERRAINS_FOR.leaves = ['meadow', 'forest', 'old-forest', 'hills', 'pumpkin-fields', 'mountains', 'clearing', 'coast'];
  Object.assign(STYLE.leaves, { lift: [0.9, 1.7], size: [0.05, 0.085], range: [0.3, 0.55], speed: [0.35, 0.65] });
}
```

**`overrides/snow-ambient.js`**
```js
// MOCK: flakes fall at night too (the leaves kind was daylight-only).
if (sessionStorage.getItem('__capSnow') === '1') { WHEN.leaves.night = true; }
```

Overlays: `overrides/overlay.css`, `overlay.js` (lights canvas, tree SVG), `advent.js` (sheet). Bulbs: 6 edge strings x 6 bulbs on a tile at height 0.45, a 3-swag eave over home; 4 colours cycled (warm white `#fff0c4`, red `#ff5d52`, green `#5fe39a`, gold `#ffcc4d`), 3.1 px core + 15 px additive glow.

## Results
| frame | device | time | mocked vs real | colours (map area) | luminance / contrast | ownership dE (owned vs wild, off-centre samples) | targets (CSS px) | notes |
|---|---|---|---|---|---|---|---|---|
| iphone-night-01-today | iphone | night | real | 588 | lum 102.5 sd 44.4 | 9.4 (dL 5.0) | mock min 44px (n=8); HUD min 44 |  |
| iphone-night-02-snow | iphone | night | tile colours + snowfall motes: served-module rewrite (real renderer); no snow caps, no fade | 578 | lum 120.9 sd 40.6 | 15.0 (dL -15.0) | mock min 44px (n=8); HUD min 44 | vs today: dlum +18.4, dsd -3.8, colours x0.98 |
| iphone-night-03a-lights-tile | iphone | night | canvas overlay at projected 3D edge points; NOT occluded, not emissive in the engine | 731 | lum 122.1 sd 41.4 | - | mock min 44px (n=8); HUD min 44 | 30 bulbs, core lum 229.3, lift +128.8 lum, contrast vs bg 4.6x |
| iphone-night-03b-lights-home | iphone | night | same; swag drawn over the home base (the map has no house model to hang eaves on) | 753 | lum 121.7 sd 41.3 | - | mock min 44px (n=8); HUD min 44 | 23 bulbs, core lum 230.1, lift +112.4 lum, contrast vs bg 3.73x |
| iphone-night-03c-lights-both | iphone | night | same | 777 | lum 123.2 sd 42.9 | - | mock min 44px (n=8); HUD min 44 | 53 bulbs, core lum 229.7, lift +121.8 lum, contrast vs bg 4.22x |
| iphone-night-04-tree-00 | iphone | night | SVG sprite at the nearest trading post | 478 | lum 109.0 sd 47.5 | - | mock min 44px (n=8); HUD min 44 |  |
| iphone-night-04-tree-06 | iphone | night | same | 478 | lum 109.0 sd 47.5 | - | mock min 44px (n=8); HUD min 44 |  |
| iphone-night-04-tree-12 | iphone | night | same | 479 | lum 109.0 sd 47.5 | - | mock min 44px (n=8); HUD min 44 |  |
| iphone-night-05-advent | iphone | night | DOM sheet (mock), map under it is snow | 427 | lum 105.2 sd 48.0 | - | mock min 44px (n=36); HUD min 44 | 59 text runs, min contrast 4.95 (fails <4.5: 0) |
| iphone-day-01-today | iphone | day | real | 697 | lum 183.9 sd 31.7 | 13.3 (dL 8.7) | mock min 44px (n=8); HUD min 44 |  |
| iphone-day-02-snow | iphone | day | tile colours + snowfall motes: served-module rewrite (real renderer); no snow caps, no fade | 665 | lum 222.3 sd 40.0 | 17.7 (dL -38.1) | mock min 44px (n=8); HUD min 44 | vs today: dlum +38.4, dsd +8.3, colours x0.95 |
| iphone-day-03a-lights-tile | iphone | day | canvas overlay at projected 3D edge points; NOT occluded, not emissive in the engine | 733 | lum 222.4 sd 39.9 | - | mock min 44px (n=8); HUD min 44 | 30 bulbs, core lum 229.3, lift +35.3 lum, contrast vs bg 1.53x |
| iphone-day-03b-lights-home | iphone | day | same; swag drawn over the home base (the map has no house model to hang eaves on) | 729 | lum 222.4 sd 39.9 | - | mock min 44px (n=8); HUD min 44 | 23 bulbs, core lum 230.1, lift +33.7 lum, contrast vs bg 1.51x |
| iphone-day-03c-lights-both | iphone | day | same | 737 | lum 222.8 sd 39.8 | - | mock min 44px (n=8); HUD min 44 | 53 bulbs, core lum 229.7, lift +34.7 lum, contrast vs bg 1.52x |
| iphone-day-04-tree-12 | iphone | day | same | 609 | lum 220.0 sd 39.3 | - | mock min 44px (n=8); HUD min 44 |  |
| iphone-day-05-advent | iphone | day | DOM sheet (mock), map under it is snow | 579 | lum 221.4 sd 40.1 | - | mock min 44px (n=36); HUD min 44 | 59 text runs, min contrast 4.95 (fails <4.5: 0) |
| ipad-night-01-today | ipad | night | real | 623 | lum 94.3 sd 28.9 | 10.6 (dL 4.2) | mock min 48px (n=8); HUD min 44 |  |
| ipad-night-02-snow | ipad | night | tile colours + snowfall motes: served-module rewrite (real renderer); no snow caps, no fade | 605 | lum 119.2 sd 29.8 | 14.9 (dL -18.4) | mock min 48px (n=8); HUD min 44 | vs today: dlum +24.9, dsd +0.9, colours x0.97 |
| ipad-night-03a-lights-tile | ipad | night | canvas overlay at projected 3D edge points; NOT occluded, not emissive in the engine | 814 | lum 119.6 sd 30.1 | - | mock min 48px (n=8); HUD min 44 | 30 bulbs, core lum 228.0, lift +118.6 lum, contrast vs bg 4.11x |
| ipad-night-03b-lights-home | ipad | night | same; swag drawn over the home base (the map has no house model to hang eaves on) | 822 | lum 119.5 sd 30.1 | - | mock min 48px (n=8); HUD min 44 | 23 bulbs, core lum 229.9, lift +114.4 lum, contrast vs bg 3.62x |
| ipad-night-03c-lights-both | ipad | night | same | 901 | lum 120.0 sd 31.0 | - | mock min 48px (n=8); HUD min 44 | 53 bulbs, core lum 228.8, lift +116.8 lum, contrast vs bg 3.9x |
| ipad-night-04-tree-12 | ipad | night | same | 535 | lum 100.4 sd 39.7 | - | mock min 48px (n=8); HUD min 44 |  |
| ipad-night-05-advent | ipad | night | DOM sheet (mock), map under it is snow | 584 | lum 107.8 sd 41.0 | - | mock min 44px (n=36); HUD min 44 | 59 text runs, min contrast 4.95 (fails <4.5: 0) |

Colours = distinct RGB>>4 in the frame outside every `position:fixed` element. Ownership dE = CIE76 between mean owned-tile and mean wild-land-tile samples (3 off-centre points per tile, because the dark-moon marks sit on owned tile centres). Notch: no fixed element crosses the top 59 / bottom 34 insets in any iPhone frame (the advent sheet uses `env(safe-area-inset-*)`, its bottom edge sits at 852-34-12).

## Reading it
- **Snow does not go flat.** Colour count falls only 3-5% (iPhone day 697 to 665, night 588 to 578, iPad 623 to 605); contrast (sd) is +8.3 by day, -3.8 at night, +0.9 iPad. It does brighten: +38 lum by day, +18 to +25 at night. By day wild land is close to white (RGB 250,249,250); lakes keep a visible frosted blue.
- **Ownership still reads, better than today:** dE 15.0 to 17.7 against 9.4 to 13.3 today (owned is the warmer pink-cream, wild is cool white/blue-grey), on top of the real border ribbon and icons.
- **Night snow is dull.** The night light dims the white to blue-grey (lum 121 vs 102 today). It reads as frost, not a snow field; a real PR should lift the snow target at night (and add the sky/bloom) rather than copy this.
- **Lights** (night): 23 to 53 bulbs per frame (cap in the plan is 600); core luminance ~229, mean lift +112 to +129 lum over the same pixels without them, contrast 3.6x to 4.6x against the snow at night; by day the lift is only +34 (1.5x), so bulbs belong to night as planned. All four colours present in equal shares.
- **Advent sheet:** 59 text runs, min contrast 4.95:1 (the day-5 number on the plum tile), none under 4.5:1; tap targets min 44 px (close button and quiet button), day tiles 48 px, Open button 52 px; the sheet's own background is 99% opaque so the snow does not touch its text.
- **Tree:** footprint 88 x 141 px on a 59 px tile (1.5 x 2.4 tiles). Ornaments are visible at 6 and 12; the lit star has a glow only at 12.

## What a real PR must do differently
- Snow: real `CHRISTMAS` block in `tileColor` keyed by terrain id (not by hex colour), a `snow` uniform in the terrain plugin for the fade, snow-aware night lift, a `snowfall` drift mode (this mock re-used `fall` and the leaves kind: no sway tuning), motes capped 120 / 60 / 0 per tier, snow caps as `SnowCapField`.
- Lights: `BulbField` as instanced emissive geometry with depth testing and the GPU twinkle clock; here they are screen-space and sit over props. Bloom does not run on phones at medium, so the real glow must be baked into the bulb material.
- Tree: a building look at the post with real ornaments and an emissive star; this is a flat sprite.
- Advent: the real sheet uses `hpButton`/`hpClose`, STYLE_GUIDE copy and server data; copy and layout here are placeholders.

## Missing
- **Snow caps / icicles on buildings and trees:** no cheap mock (props are separate meshes); not shot.
- **Mid-fade:** the `snow` uniform does not exist and a pixel blend would be a fake; skipped.
- **Home eaves:** the map draws no house model on the home base, so the eave strings hang over the home tiles, not a real roof. Placing a building would need game flow I did not script.
- **Explore frame:** not shot (budget).
- iPad day and iPhone-day tree 0/6 (not shot); iPad tree 0/6 not shot. Frame 01 night also shows the real "That's a trading post!" toast and Long Night chips in the day run (real HUD, not mocked).
- Snowfall is shown as a still; sway and fall speed are not judged from these PNGs.
- Real HUD pills overlap the tree label ("Mossy Mailbox") near the post; the real PR should check the label.
