# #234 mini-boss briefs (lane 234a, draft for the owner's mockup round)

Four lines, three stages each: a **base** form and a **middle** form (both legendary) and the **boss** form (mythic), per the owner decision on #190 (#issuecomment-6886527914). Everything here is a draft until the owner approves the renders. Names, Rickeyride's look and the three move redrafts are settled at this step.

The draft data lives in `apps/client/src/procedural/gallery/boss-drafts.ts`. It is dev-gallery-only (`/gallery.html?drafts`), it is not in `GAME_DATA`, and no roster, spawn table or server code imports it. Lane 234b moves the approved bodies, parts and lines into `packages/shared/src/data`.

## Body style without a contract change (plan §8)

- **No new slot, primitive, schema field or rule.** Every new part is a data entry built from the existing five primitives (ellipsoid, capsule, cone, teardrop, arc), using the existing layouts (`single`, `pair`, `ring`, `row`, `scatter`, `quad`, `chain`) and the shared squishy material.
- **Where things go:** hair in `crown` and `mane`; rake-tine teeth and moustaches in `fangs`; a cap brim, goggles, earrings and the falling leaf in `horns`; cardigan buttons in `pattern`; freckles in `cheeks`, so they sit on the head; Rickeyride's wheels in `legs` (the `quad` layout, so they grow to the ground).
- **New draft bodies:** `draft-upright` is the taller upright torso, still a soft blob with a slight waist. The others are `draft-cardigan` (it flares at the hem), `draft-dad-belly` (widest at the belly) and `draft-kart` (a low, boxy bumper kart).
- **Faces keep each feeling's face kit** (`ART_RULES.feelingFaces`, ART_BIBLE §1.6): silly has dot or sharp eyes and an open mouth; brave has brave brows; cozy has oval eyes and blush; joy has happy eyes. The human touch comes from brows (all four have them, and few squishies do), hair, moustaches and freckles, not from a new eye shape. A dedicated "human-style eye" part would need `feelingFaces` widened, which is an art-rule change, so it is left out.
- **Still squishies, never Keepers:** the head is big on a toy blob body, limbs are capsules with no hands or fingers, and there is no skin tone (the body colour carries the element).
- **Caps:** 8–11 parts per form (the cap is 12). The bosses use the `shimmer` finish (mythic). Base and middle forms use `iridescent` (legendary).

## The briefs

### Rakelet (Leaf · Silly) · Pileup → Rakeling → **Rakelet**
- **Hook:** a grin made of rake tines (a straight comb of white teeth under an open mouth). His hair is a heap of autumn leaves, and one red leaf is always sliding off.
- **Silhouette:** tall and lanky, with long arms hanging to his knees and a messy leafy top.
- **Palette:** leaf green `#9fd46e`, cream, autumn orange `#f08a3c`, red `#d6533a`. Freckles across the nose.
- **Nearest kind and the difference:** Glowgourd (toothy grin, leaf arms). Rakelet is tall and thin, his teeth are one straight row hanging down, he has a leaf heap rather than a stem, and he has no pumpkin body. Bristlebloom and Thistleknight share green and upright, but their dominant parts are thistles, not a leaf heap.

### Mom: **Momentum** (proposed; alt *Mama Flare*) · Momo → Mamarama → **Momentum** (Fire · Brave)
- **Hook:** a bun bigger than her head, elbows out and hands on hips, and pearl earrings. Her gold buttons are the glow accent: she has no flames until she attacks, and then the buttons and the eyes light up for The Look (a move animation, #187).
- **Silhouette:** a ball on top, elbows out, and a cardigan flaring at the hem.
- **Palette:** coral `#ff8a6a`, cream, gold `#ffd166` (glows, the fire rule), plum hair `#8a3550`.
- **Nearest kind and the difference:** Hearthbun (an upright fire brawler with a flame mane). Mom has one round bun instead of flames, akimbo arms instead of strong arms, and coral-red instead of orange. Pepperpip, Chillypep and Jalapow share red, fire and standing, but they are peppers with no hair.
- **Name:** "Momentum" puns on mom and a brave rush, it is kid-readable, and it passes the filter. "Momzilla" leans on a monster-movie brand.

### Dad: **Papa Brrr** (proposed; alt *Frostpop* for the boss) · Snowpop → Frostpop → **Papa Brrr** (Frost · Cozy)
- **Hook:** a moustache wider than his face under a red ball-cap brim, and giant white sneakers.
- **Silhouette:** a barrel body widest at the belly, the brim forward, moustache wings and big feet.
- **Palette:** icy blue `#a9d4f5`, frost white, cap red `#e2574c`, moustache cream `#f7f1ea`.
- **Nearest kind and the difference:** Drowsiberg and Slumberberg (yeti, strong arms) and Gnomguard (beard, cap). Papa Brrr has no fur ruff or fangs, a flat forward brim instead of a pointed cap, sneakers, and a moustache rather than a beard.

### Rickeyride (Spark · Joy) · Zoomlet → Revvy → **Rickeyride**
- **Hook:** he never stands still. He is a kid squishy who is half bumper kart: a boxy kart body on four chunky wheels, hair blown straight back, goggles on his forehead, a racing stripe, exhaust puffs trailing behind and a spoiler on the boss form.
- **Silhouette:** low and wide (the only low, wide, boxy squishy), with a big head poking out of the top.
- **Palette:** spark yellow `#ffd84a`, light cyan (goggles, puffs), blue hair `#3f8fe8`, dark wheels `#4a3a5c`.
- **Nearest kind and the difference:** Fuzzbolt, Zipkit, Frizzbolt and Thundermop (yellow, spark, standing) are cats and mops on legs. Rickeyride has a kart body and wheels and no ears. Zingaling is spark and joy, but it is a hovering star.
- **Open question for the owner:** the issue says all four have arms and legs. Rickeyride's "legs" are his wheels (the `legs` slot), and he has short arms holding the wheel. The alternative is legged with roller skates, but the art kit has no way to put a wheel at the foot, so it would read as stubby legs.
- **Ride:** the plan floated the `floater` field to carry a ride. That needs a new floater glyph kind, which is a shared schema change. The kart body does it with no contract change.

## Duplication matrix (against all 151 shipped kinds)

Computed with the shared `dominantPart` and `hueFamily` functions (the same ones `checkRosterArt` uses). The draft test also runs `checkRosterArt` over roster + drafts, and it passes.

| Form | Body | Dominant part | Hue | Kinds sharing the dominant part | Kinds sharing 2 of body / dominant / hue | Same hue + element + pose (visual neighbours) |
|---|---|---|---|---|---|---|
| Pileup | blob | leaf-tuft | green | 0 | Lilyhop, Lilyleap, Croakaroo (blob + green; frogs, no hair or teeth) | Bristlepip |
| Rakeling | upright | leaf-pile-hair | green | 0 | none | Bristlebloom, Thistleknight |
| **Rakelet** | upright | leaf-pile-hair | green | 0 | none | Bristlebloom, Thistleknight |
| Momo | pear | little-bun | red | 0 | none | Chillypep, Pepperpip, Jalapow |
| Mamarama | cardigan | big-bun | red | 0 | none | none |
| **Momentum** | cardigan | big-bun | red | 0 | none | none |
| Snowpop | blob | ball-cap | blue | 0 | Lampfin, Lanternfin, Nightfin (blob + blue; fish) | the frost pups, Flakefluff, Snowtuft, Frostbold |
| Frostpop | dad-belly | ball-cap | blue | 0 | none | Drowsiberg, Slumberberg |
| **Papa Brrr** | dad-belly | ball-cap | blue | 0 | none | Drowsiberg, Slumberberg |
| Zoomlet | kart | wind-swoop | yellow | 0 | none | Fuzzbolt, Zipkit, Frizzbolt, Thundermop |
| Revvy | kart | wind-swoop | yellow | 0 | none | same |
| **Rickeyride** | kart | spoiler | yellow | 0 | none | same |

**Against the Keepers:** Keepers have human proportions (a small head on a long body with real arms and legs), a skin tone, and hairstyles drawn from `KEEPER_HAIRSTYLES` (including `bun`, `curly` and `swoop`). The bosses have one body colour, toy proportions (head about 0.7–1 of the torso) and capsule limbs. Their hair is a squishy part (a leaf heap, a bun bigger than the head, a wind swoop). The line-up render puts Pip beside them for scale.

**Between the four:** each has a different element, body, hue family and dominant part, and each differs in its silhouette: lanky, a ball on top, a wide belly with a brim, and low and wide.

## Moves (redrafts for the three the plan flags, plus Rickeyride)

All of these use effects the move schema already has (`stat`, `heal`, `status: dizzy|sleepy`) or that lane 190a adds (`targets: all-foes`, `flinch`, `windup`, `powerWhenLow`).

| Boss | Move | Draft |
|---|---|---|
| Rakelet | **Leaf Pile Pounce** (redraft) | "Buries the foe in a crunchy leaf pile. It might get dizzy!" A hit plus a dizzy chance. It replaces "lowers accuracy", which has no stat. |
| Momentum | **Mama Bear Charge** (redraft) | "A big rush that gets stronger the lower she is." `powerWhenLow`. It works alone as a boss and on a team. |
| Papa Brrr | **Ask Your Mother** (redraft) | "He shrugs and waits it out." Raises his own defence by 2 and heals a little (`stat` self +2 defence and `heal`). No swap and no ally needed. |
| Rickeyride | **Zoomies** (signature) | A fast Spark hit that raises his speed (`stat` self +1 speed). |
| Rickeyride | **Speed Bump** | A Spark hit that may slow the foe (`stat` opponent −1 speed). |
| Rickeyride | **Drift Spin** | Spins out and hits every foe (`targets: all-foes`, from 190a). |
| Rickeyride | **Pit Stop** | Heals a bit and gets ready (`heal` and `stat` self +1 speed). |

The plan's "three small actions a round" for Rickeyride is engine behaviour (the boss acts twice in 190a). If the owner wants three, that is a 190a question. His moves fit as-is: he is the fastest boss, and his speed keeps climbing.
