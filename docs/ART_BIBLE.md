# Heartpatch — Art Bible

> How Heartpatch **looks and moves**. `GAME_DESIGN.md` §19 sets the direction (soft vinyl toys, procedural, never pixelated); `STYLE_GUIDE.md` covers words. This file pins the numbers and rules every visual lane builds against, so the squishies, the world and the UI read as one game. Reviewers check client PRs against it.
>
> **Status:** draft for owner approval (art-bible lane, 2026-10-06). The squishy chapter comes with a prototype roster and contact sheets; the other chapters are the plan the visual-upgrade lanes build mockup-first (COORDINATOR.md "Plan after stabilization").

**The one rule:** squishies are the stars. Everything else (land, sky, props, UI) is softer, calmer and lower-contrast than they are, and nothing in a scene is allowed to change a squishy's own colours.

**Reference look:** the close-up view (care and wardrobe) is right today: gloss, eye glints, blush, a soft contact shadow. Judge every other view against it.

---

## 1. Squishy style

### 1.1 Cute, never fierce

Squishies are collectible vinyl toys: round, glossy, chunky, a little clumsy. Even Brave squishies look *determined*, never angry: brows tilt up in the middle, mouths stay small, horns and spikes are soft-tipped cones. No teeth, claws, scars, red eyes or narrowed eyes. Spooky squishies say "boo!" and giggle.

Everything is procedural and data-driven (CLAUDE.md rule 5): a body from the body registry, up to 8 parts from the part registry, a palette of up to 4 colours, and the fields below. Adding a species is a data entry; `checkGameData` enforces every rule marked **[checked]**.

### 1.2 Silhouettes

A kid should name a squishy from its shadow alone (the catalog's unseen cards will be dark silhouettes of the real body).

- **13 bodies** (7 today + 6 new). Each line picks the body that tells its story first: a droplet for a water squishy, a snowman for a frost squishy, a candle for a candle cat.

| Body | Shape | New? | Used by |
|---|---|---|---|
| `drop` | droplet with a soft point | | Puddlepuff |
| `pebble` | wide, flat, soft-boxy stone | | Pebblesnooze, Bubbletub |
| `bun` | wide loaf | | Emberbun, Mossmuffin |
| `blob` | the classic round toy | | Fuzzbolt, Nookling |
| `bean` | upright jelly bean | | Flurrypup, Upsybat |
| `pear` | narrow top, wide bottom | | Thistlepip |
| `pumpkin` | grooved pumpkin | | Gourdon |
| `tall` | a candle or pillar, 1.4× taller than wide | ✓ | Candlekit |
| `mochi` | squat dumpling with a soft peak (gem, cloud) | ✓ | Glimmerock, Thunderpuff |
| `tiered` | two stacked balls (snowman) | ✓ | Snoozicle |
| `star` | puffy five-point star, standing | ✓ | Fizzlepop |
| `ghost` | rounded top, scalloped hem | ✓ | Glowboo |
| `orb` | near-perfect sphere | ✓ | Dawndrop |

- **[checked] No two species lines share body + dominant part + hue family.** The *dominant part* is the line's biggest sticking-out part (by silhouette area: width × length); the *hue family* is the body colour's family (red, orange, yellow, green, cyan, blue, purple, pink, or white, dark and neutral for very light, very dark and greyish colours). Each line also gets a **signature part** a kid can point at: a water curl, a nightcap, a flame, a crest of crystals, a thistle crown, a cloud.
- At most two lines share a body, and when they do they differ in hue family *and* dominant part (Fuzzbolt the yellow lightning cat vs Nookling the indigo long-eared bunny).

### 1.3 Evolutions: bigger, sparklier

- **[checked]** An evolution is **×1.2–1.4** the size of the form it grows from, and adds **at least one new sticking-out part** (a new silhouette, not a darker tint). It keeps the base's body, signature part and colour family, so the family resemblance is obvious.
- Evolutions are one rarity step up (a rule, already true in the data), so they usually also gain a material tier (§1.4): Glimmerock → Glittercrag starts to sparkle, Dawndrop → Dazzledrop gains an iridescent rim.

### 1.4 Rarity material tiers

All tiers are the same shared vinyl (§4) plus a per-instance code in the squishy shader. **No tier adds a mesh, material, texture or draw call**: the code rides in the spare 4th float of the existing `squishEvent` instance attribute, and instancing keeps working.

| Tier | Who **[checked]** | Look | Cost |
|---|---|---|---|
| Vinyl | common, uncommon, rare | glossy clearcoat + rim (today's look) | — |
| **Sparkle** | epic | tiny white flecks in the vinyl that twinkle as the view turns | ~12 ALU per fragment (a 3D cell hash), only on sparkly instances |
| **Iridescent** | legendary, secret | sparkle **plus** a rainbow rim that shifts with view angle | ~20 ALU per fragment |
| **Glow** | Light (whole squishy), Fire (its flames, the `accent` parts); others may opt in (Glowgourd's lantern body) | lit from inside: albedo added back as emission, so it reads at dusk and night | ~3 ALU |

- Face parts (eyes, brows, mouth, cheeks) never sparkle or glow, so faces stay clean.
- The tier decodes from a varying with uniform control flow per instance; fragments on vinyl squishies skip the branches. The rescue guardians' shadow look still wins over every tier.
- WebGPU (opt-in) has no squish plugin yet, so tiers fall back to plain vinyl there, like the rim and the squash today.

### 1.5 Element at a glance

Element shows in the **body colour first, then the signature part**. Spark must never read as Leaf.

| Element | Colour family (chips, VFX, bodies) | Signature shapes |
|---|---|---|
| Water | blue / teal `#6fb6f0` | droplets, curls, fins, bubbles |
| Fire | orange `#ff8a4a`, glowing flames | flame tufts and crowns (glow) |
| Leaf | green `#7cc96a` (or a green part on a seasonal body) | leaves, sprouts, stems, moss caps, thistles |
| Spark | yellow `#ffd23f` | lightning ears, frizzy crests, stars, antennae, bolts |
| Frost | icy white-blue `#bfe6fb` | snowmen, icicles, pointy ears, fluff |
| Stone | warm grey or gem lilac `#b9b2a7` | pebbles, crags, crystals |
| Shadow | indigo-purple `#7a5fa8` | long ears, bat wings, cream eyes |
| Light | warm cream-gold `#ffe8a3`, glowing | orbs, sun rays, ghosts that glow |

Seasonal lines may keep their season's colour (Gourdon is an orange pumpkin) but carry their element in a part (Gourdon's leaf).

### 1.6 Feeling at a glance

**[checked]** Each feeling has a face kit; a species must use its feeling's parts:

| Feeling | Must have | Reads as |
|---|---|---|
| Sleepy | `sleepy-eyes` | closed, drowsy arcs |
| Joy | `happy-eyes` | ^ ^ |
| Silly | `dot-eyes` + `open-mouth` | wide-eyed, giggling |
| Cozy | `oval-eyes` + `blush-cheeks` | soft and rosy |
| Brave | `brave-brows` (new) + `oval-eyes` or `dot-eyes` | determined, never cross |
| Spooky | `spooky-eyes` (new, tall and glinty) | "boo!" |

Idle animations (Silly spins, Sleepy nods off, Brave puffs up) add to this in the close-up view; the face alone must carry it in battle and on the map.

### 1.7 Faces: ink chosen per species by contrast

- **[checked]** Face ink (eyes, brows, mouth) contrasts with the body colour at **at least 4.5:1** (WCAG relative luminance), and with any large patch on the face (a belly patch).
- The default ink is soft plum `#3b2a3f`. Dark bodies (Candlekit, Wickwhisker, Nookling, Upsybat) set `visual.ink` to cream `#fff4dc`: big cream eyes on a dark body read as cute and a little spooky, with the white glint still on top.
- Every squishy keeps its eye glint (the highlight that makes it look alive).

### 1.8 Squishies ignore scene fog and mood tints

The squishy material opts out of scene fog, so a blue Puddlepuff stays blue in an iPhone-portrait battle where the camera pulls back into the haze. Mood (dusk, night) comes from the sky, the land and the light colour on the props, never from washing out the fighter. A later battle-lighting lane caps how far the dusk fill shifts a fighter's hue (§3).

### 1.9 Contract changes (need approval with the mockup)

Shared data shapes this chapter adds (all additive; no id is renamed or removed, and no rule changes):

- **Bodies:** optional `waist` (`at`, `depth`, `width`: a snowman pinch), `points` (`count`, `depth`: a standing star) and `hem` (`count`, `depth`: a ghost's scalloped edge) on `BodySchema`; six new body ids.
- **Parts:** a new `brows` slot (a face slot, lies on the surface); 26 new part ids using the existing five primitives (no new geometry builder, so no new part draw call).
- **Species visual:** optional `ink` (hex), `finish` (`vinyl` | `sparkle` | `iridescent`) and `glow` (`body` | `accent`).
- **Art rules:** a new `artRules` table in `GAME_DATA` (default ink, minimum contrast, finish by rarity, glow by element, evolution growth range, feeling face kits), validated by zod and enforced by `checkGameData`.
- **Visual-only species edits:** body, palette, parts, size, ink, finish and glow for all 36 public species and the two secret ones. Ids, names, elements, feelings, rarities, moves, stats, evolution levels and spawn tables are untouched.
- **Golden hashes:** `paramsHash` covers every visual field, so the pinned squishy hashes (`params.test.ts` and the gallery e2e) change once, on purpose.

### 1.10 Roster

The prototype roster (base → evolution). Size is the evolution's scale.

| Line | Element · Feeling | Rarity | Body | Signature → evolution adds | Colour | Ink | Tier |
|---|---|---|---|---|---|---|---|
| Puddlepuff → Splashmallow | Water · Silly | common → uncommon | drop | water curl → back fin, bubble tail (×1.3) | sky blue | plum | — |
| Pebblesnooze → Boulderdoze | Stone · Sleepy | common → uncommon | pebble | lilac nightcap → crag nubs (×1.35) | warm grey | plum | — |
| Emberbun → Hearthbun | Fire · Cozy | common → uncommon | bun | flame tuft → three-flame crown, ears (×1.3) | peach-orange | plum | glow flames |
| Snoozicle → Drowsiberg | Frost · Sleepy | common → uncommon | tiered | pointy ears → icicle crown (×1.3) | icy white | plum | — |
| Fuzzbolt → Frizzbolt | Spark · Silly | common → uncommon | blob | lightning ears → frizzy spark crest (×1.3) | lemon yellow | plum | — |
| Fizzlepop → Zingaling | Spark · Joy | uncommon → rare | star | little wings → antennae (×1.3) | gold | plum | — |
| Bubbletub → Bubbletide | Water · Cozy | uncommon → rare | pebble | bubble crown → back fin (×1.3) | teal | plum | — |
| Thistlepip → Bristlebloom | Leaf · Brave | uncommon → rare | pear | purple thistle crown → leaf wings (×1.25) | leaf green | plum | — |
| Flurrypup → Blusterpup | Frost · Brave | rare → epic | bean | floppy ears → big fluff tail (×1.3) | frost blue | plum | sparkle |
| Glimmerock → Glittercrag | Stone · Joy | rare → epic | mochi | crystal crown → crystal spines (×1.35) | gem lilac | plum | sparkle |
| Nookling → Snugglenook | Shadow · Cozy | uncommon → rare | blob | long ears → big fluff tail (×1.25) | indigo | cream | — |
| Mossmuffin → Mossquilt | Leaf · Cozy | rare → epic | bun | moss muffin cap → fern tail, ears (×1.35) | muffin tan + moss | plum | sparkle |
| Dawndrop → Dazzledrop | Light · Joy | epic → legendary | orb | halo of sun rays → glowing wings (×1.3) | cream-gold | plum | glow; sparkle → iridescent |
| Thunderpuff → Thunderplume | Spark · Brave | legendary | mochi | storm-cloud puffs, bolt tail → yellow plume wings (×1.3) | storm slate | plum | iridescent |
| Gourdon → Glowgourd | Leaf · Silly | common → uncommon | pumpkin | stem and leaf → leaf ears, glowing body (×1.3) | pumpkin orange | plum | Glowgourd glows |
| Glowboo → Brightboo | Light · Spooky | rare → epic | ghost | scalloped hem → little wings, wisp tail (×1.3) | moon white | plum | glow; sparkle |
| Upsybat → Topsywing | Shadow · Silly | uncommon → rare | bean | bat wings → big bat wings, curly tail (×1.25) | night purple | cream | — |
| Candlekit → Wickwhisker | Fire · Spooky | uncommon → rare | tall | wick flame → whisker flames (×1.25) | candle-cat plum | cream | glow flames |
| *Heartlet → Heartbloom (secret)* | Light · Cozy | secret | blob | little wings → leaf sprout (×1.3) | heart pink | plum | glow; iridescent |

---

## 2. Palette

- **World:** pastel terrain; wild land muted (saturation 0.5 with a lilac wash, `map-config.ts`); owned land soft and warm. The home-tile pink (`#ff6f9f`) becomes an outline or a lighter fill: nothing on the map is louder than a squishy.
- **Squishies:** saturated, clean colours from §1.5. Body lightness between 0.3 and 0.92 so faces can reach 4.5:1 with plum or cream ink.
- **UI:** cream and plum (§5).
- **Element colours** are fixed and shared by chips, move buttons, VFX and bodies: Water `#6fb6f0`, Fire `#ff8a4a`, Leaf `#7cc96a`, Spark `#ffd23f`, Frost `#bfe6fb`, Stone `#b9b2a7`, Shadow `#7a5fa8`, Light `#ffe8a3`.
- **Spooky is cozy:** night is a friendly deep blue, never black; the Hollow Man is absence and dimming, never a monster in the light.

## 3. Lighting

- **One key-direction story:** the key light comes from the upper left behind the camera on the map (sun 1.6) and in the home base; in battle it comes from behind the far side (key 2.0) so fighters get a warm rim. Both keep a cool fill from the opposite side.
- **Fighters get neutral light:** no fog (§1.8), rim always on, and the dusk/night fill may shift a fighter's hue by at most a small, fixed amount (battle-lighting lane to tune). Mood comes from the sky dome, props, motes and ground tint.
- **Gentle bloom** only on the brightest highlights (threshold 0.85), so glowing squishies glow and pastel ground doesn't.
- **Taken squishies** are grey and drift away gently; rescue guardians are the shadow look (dark lavender, glowing rim, glassy eyes).

## 4. Materials

- **One shared VINYL** for squishies, Keepers and buildings: roughness 0.42, clearcoat 0.9 at roughness 0.2, rim 0.35 (`procedural/config.ts`). Never a second squishy material: tiers are shader codes (§1.4).
- World props use the same vinyl family but matte-er (more roughness, no clearcoat) so squishies are the shiniest things on screen.
- Textures: none on squishies (colour per instance). Any world texture is KTX2.

## 5. UI kit tokens

To be built by the HUD-kit lane (mockup first). Lint for raw hex in CSS once the tokens exist.

- **Colours:** `--hp-ink #4a3150`, `--hp-plum #7a2d55`, `--hp-primary #b8487a`, `--hp-soft #f6dceb`, `--hp-paper #fffafc`, `--hp-cream #fff8ec`, `--hp-gold #ffc94d`, plus the element colours (§2).
- **Radii:** 999 (pills), 24 (sheets), 16 (cards).
- **Type sizes:** 13 / 15 / 17 / 22 / 28. A rounded OFL webfont (Nunito or similar) so Android and desktop match iOS's rounded system font.
- **Shadows:** two only: `0 4px 12px rgb(74 49 80 / 16%)` and `0 12px 40px rgb(107 75 110 / 18%)`.
- **Buttons:** primary solid pill, secondary soft pill, icon round. No underlined text links. Log out is always secondary and never on a game screen.
- **Squishy portraits** in 2D (catalog, job board, care, team, toasts) come from one snapshot renderer, cached per species and look, using this chapter's squishies; unseen species are dark silhouettes of their real body.

## 6. Motion

- **Every reward gets squash-pop plus a sound cue:** collect, the claim colour ripple (0.6–1 s outward from the tile, squishies popping back), build rise, milestone confetti.
- Squish: tap jiggle, landing wobble, happy bounce (vertex shader, `SQUISH` in `procedural/config.ts`). Keep the battle hit-stop and 1.5× squash and every reduced-motion fallback.
- Sheets slide up with 8 px or less of overshoot.
- Battle staging: fighters three-quarter towards the camera; the Keeper behind and to the side, never between them.
- Sparkle twinkles only as the view turns (no per-frame cost when the scene is idle; render on demand stays idle).

## 7. Sprout

Sprout (she/her) is "the tiny glowing spirit of your Heart Seed". Proposal for the Sprout lane's face mockup:

- A small `drop` body upside-down-seed silhouette, warm cream-gold (`#ffe8a3`, the Light colour), with a two-leaf sprout on top.
- A face: `happy-eyes` by default, plum ink, blush. She uses the squishy renderer and the **glow** tier, so she's lit from inside at night by the Heart Seed.
- She appears as a portrait in every speech bubble (the snapshot renderer, §5), never as a plain orb.

---

## Appendix: performance budget

- Draw calls per squishy field stay **one per body kind on screen + one per part primitive (5) + one contact-shadow mesh**, whatever the number of squishies. A battle shows at most 2 bodies, as today. A map showing every body at once could reach 13 + 5 + 1 = 19 draw calls instead of 13; a typical map shows far fewer.
- Material tiers, ink and fog opt-out add **no** draw calls, meshes, materials or textures. Their cost is fragment ALU on the squishies' own pixels only (§1.4).
- New bodies are the same lat/long grid at each LOD (low 14 rings, high 32, hero 48), so triangle counts per squishy don't change.
