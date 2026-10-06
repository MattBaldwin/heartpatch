# Heartpatch — Art Bible

> How Heartpatch **looks and moves**. `GAME_DESIGN.md` §19 sets the direction (soft vinyl toys, procedural, never pixelated); `STYLE_GUIDE.md` covers words. This file pins the numbers and rules every visual lane builds against, so the squishies, the world and the UI read as one game. Reviewers check client PRs against it.
>
> **Status:** draft for owner approval (art-bible lane, 2026-10-06; mockup 2). The squishy chapter comes with a prototype vertical slice (6 lines) and contact sheets; the other chapters are the plan the visual-upgrade lanes build mockup-first (COORDINATOR.md "Plan after stabilization").

**The one rule:** squishies are the stars. Everything else (land, sky, props, UI) is softer, calmer and lower-contrast than they are, and nothing in a scene is allowed to change a squishy's own colours.

**Reference look:** the close-up view (care and wardrobe) is right today: gloss, eye glints, blush, a soft contact shadow. Judge every other view against it.

---

## 1. Squishy style

### 1.1 Babies are cute; evolutions grow up

Squishies are collectible vinyl toys, and they come in every shape a toy shelf does. A line starts as a **baby** and **grows up** when it evolves, the way a kid's favourite creature lines do.

- **Base forms are baby-cute:** a big head on a small body, round eyes, stubby limbs, a soft little mouth.
- **Evolutions grow up:** a smaller head compared to the body, longer limbs, a more upright or ready stance; a confident face (determined brows, narrower `sharp-eyes`, a smirk, small soft fang nubs); and bigger signature features (horns, spikes, crests, manes, wings).
- **Fierce means cool and strong, never scary or mean.** No blood, gore, scars, claws drawn to hurt, or angry red eyes. Fangs are small, soft and white; spikes are rounded cones. A 10-year-old should want to collect every form.

Everything is procedural and data-driven (CLAUDE.md rule 5): a torso from the body registry, an optional head, up to 12 parts from the part registry, a palette of up to 4 colours, and the fields below. Adding a species is a data entry; `checkGameData` enforces every rule marked **[checked]**.

### 1.2 Body plans and silhouettes

A kid should name a squishy from its shadow alone (the catalog's unseen cards will be dark silhouettes of the real body). Each line differs in **body plan**, not just in the stickers on a blob.

**Building blocks** (all on the existing five primitives, so no new geometry kinds):

| Block | Data | Examples |
|---|---|---|
| Torso | a registry body (`blob`, `barrel`, `tall`, `pear`, `orb`, …) | a barrel for four-legged animals, a tall body for a cactus knight or a candle |
| Head | `visual.head`: a registry body, its size against the torso, and where it sits | big heads on babies, smaller heads on grown-ups |
| Stance | `visual.stance`: how far the torso stands off the ground | short legs, long legs, or hovering when there are none |
| Legs | `legs` slot, `quad` (four) or `pair` (two) layout; legs grow to reach the ground | stubby pup legs, a wolf's long legs, biped feet |
| Arms | `arms` slot | stubby arms, strong arms, leaf arms |
| Tails and long bodies | `chain` layout: pieces that step, bend and swing side to side | a wiggly tadpole tail, a sea serpent's body, a flame tail, a spiked tail |
| Spines and rings | `row` (up the back) and `ring` (around) layouts | back spikes, fin rows, manes, crests, tail feathers |
| Spike coats | `scatter` over the whole body | a burr ball |
| Wings and fins | flattened teardrops | stubby wings, big thunderbird wings |

**Body plans** in the slice: quadruped (Flurrypup → Blusterpup), biped with arms (Emberbun → Hearthbun), serpentine (Puddlepuff → Splashmallow), flier (Thunderpuff → Thunderplume), spiky ball → spiky knight (Thistlepip → Bristlebloom), and an object (Candlekit the candle → Wickwhisker the lantern cat). The remaining lines get plans from the same kit: plants and food shapes (Mossmuffin, Gourdon), finned swimmers (Bubbletub), clouds and crystals (Glimmerock), ghosts (Glowboo).

- **[checked] No two species lines share body + dominant part + hue family.** The *dominant part* is the line's biggest sticking-out part apart from legs (by silhouette area); the *hue family* is the body colour's family (red, orange, yellow, green, cyan, blue, purple, pink, or white, dark and neutral).
- **Pose and attack part** (for the battle-feel lane): every line names how it stands (`pose`: sit, stand, upright, slither, hover) and the slot a move animation drives (`attackPart`: a tail to swing, arms to punch, wings to flap, spikes to puff). **[checked]** the attack part's slot exists on the species.

### 1.3 Evolutions grow up

- **[checked]** An evolution is **×1.2–1.4** the size of the form it grows from and adds **at least one new sticking-out part**. It keeps the base's colour family and signature, so the family resemblance is obvious.
- Grown-up proportions: the head shrinks against the torso (Flurrypup's head is 1.1× its torso's height, Blusterpup's 0.88×), limbs lengthen (stance 0.15 → 0.45), and the stance gets readier (sit → stand → upright).
- Evolutions are one rarity step up (a rule, already true in the data), so they usually also gain a material tier (§1.4).

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
| Cozy | `oval-eyes` (or grown-up `sharp-eyes`) + `blush-cheeks` | soft and rosy |
| Brave | `brave-brows` (new) + `oval-eyes`, `dot-eyes` or grown-up `sharp-eyes` | determined, never cross |
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

- **Bodies:** optional `waist`, `points` and `hem` on `BodySchema`; new body ids (`tall`, `mochi`, `tiered`, `star`, `ghost`, `orb`, `barrel`).
- **Part slots:** `brows`, `legs`, `arms`, `back`, `spikes`, `mane`, `fangs`. `HEAD_SLOTS` says which slots sit on the head when a species has one.
- **Part layouts:** `ring`, `row`, `quad` and `chain`, next to `single`, `pair` and `scatter`. New parts use the existing five primitives.
- **Species visual:** optional `ink`, `finish`, `glow`, `head`, `stance`, `pose` and `attackPart`; up to 12 parts (was 8).
- **Art rules:** a new `artRules` table in `GAME_DATA`, validated by zod and enforced by `checkGameData`.
- **Visual-only species edits.** Ids, names, elements, feelings, rarities, moves, stats, evolution levels and spawn tables are untouched.
- **Golden hashes:** `paramsHash` covers every visual field, so the pinned squishy hashes (`params.test.ts` and the gallery e2e) change once, on purpose.

### 1.10 Vertical slice (mockup 2)

| Line | Element · Feeling | Body plan | Base (baby) | Evolution (grown up) | Attack part |
|---|---|---|---|---|---|
| Flurrypup → Blusterpup | Frost · Brave | quadruped | chibi pup: big round head, stubby legs, floppy ears, curly tail | frost wolf: smaller head, long legs, sharp eyes, smirk and fangs, alert ears, icicle mane, spiked tail (×1.3, sparkle) | tail |
| Emberbun → Hearthbun | Fire · Cozy | biped with arms | fire bunny: big head, stubby arms and feet, flame tuft | fire brawler: upright, strong arms, swept-back ears, flame mane and flame tail (×1.3) | arms |
| Puddlepuff → Splashmallow | Water · Silly | serpentine | droplet tadpole with a wiggly tail | sea serpent: a long swinging body, fin row, toothy grin (×1.3) | tail |
| Thunderpuff → Thunderplume | Spark · Brave | flier | hovering storm-cloud chick | thunderbird: big yellow wings, beak, storm crest, tail feathers (×1.3) | wings |
| Thistlepip → Bristlebloom | Leaf · Brave | spiky | burr ball on little feet | thistle knight: tall cactus body, thistle crown, back spines, leaf arms (×1.25) | spikes → arms |
| Candlekit → Wickwhisker | Fire · Spooky | object → quadruped | candle cat | lantern cat: four long legs, flame mane, whisker flames, flame tail, fangs (×1.25) | crown → tail |

The other 12 lines keep mockup 1's look until the owner approves this slice; then they get body plans from the same kit.

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

- **Draw calls** per squishy field stay **one per body kind on screen + one per part primitive (5) + one contact-shadow mesh**, however many squishies there are. Every new part uses the existing primitives, so body plans add no part draw calls. A head adds its body kind to the field: a battle fighter is at most **7** draw calls (torso, head, 5 primitives), up from 6.
- **Triangles** grow with the extra pieces. Measured on the slice (base and evolution):

| Detail level | Used for | Current | Mockup 2 |
|---|---|---|---|
| high (32 rings) | battle, care, wardrobe | 7.5k–12.7k per squishy | 10.5k–21.9k per squishy |
| low (14 rings) | map | 1.5k–2.8k per squishy | 2.2k–4.7k per squishy |

  Two fighters in a battle draw under 50k squishy triangles; 50 squishies on the map about 235k (was about 125k). Both should fit a recent iPhone at 60 fps and an older iPad at 30 fps; that is an estimate to confirm on the devices (the dev roster page and the gallery's `?count=50` stress test). If the governor drops a tier, the map's `low` level is already in use; a later lane can add a `tiny` level (fewer rings for limbs and chain pieces) for crowded maps.
- Material tiers, ink and fog opt-out add **no** draw calls, meshes, materials or textures (§1.4).
