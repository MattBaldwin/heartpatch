# #234 mini-boss briefs (lane 234a, draft for the owner's mockup round)

Four lines, three stages each: a **base** form and a **middle** form (both legendary) and the **boss** form (mythic), per the owner decision on #190 (#issuecomment-6886527914). Everything here is a draft until the owner approves the renders. Names, Rickeyride's look and the three move redrafts are settled at this step.

The draft data lives in `apps/client/src/procedural/gallery/boss-drafts.ts`. It is dev-gallery-only (`/gallery.html?drafts`), it is not in `GAME_DATA`, and no roster, spawn table or server code imports it. Lane 234b moves the approved bodies, parts and lines into `packages/shared/src/data`.

## Body style without a contract change (plan §8)

- **No new slot, primitive, schema field or rule.** Every new part is a data entry built from the existing five primitives (ellipsoid, capsule, cone, teardrop, arc), using the existing layouts (`single`, `pair`, `ring`, `row`, `scatter`, `quad`, `chain`) and the shared squishy material.
- **Where things go:** hair in `crown` and `mane`; rake-tine teeth and moustaches in `fangs`; Rakelet's rake bar in `mane` and the dark mouth behind his tines in `ears`; a cap brim, goggles, Momentum's hair sticks and the falling leaf in `horns`; Momentum's bangs in `mane`; Papa Brrr's belly patch in `pattern`; Momentum's forearms (the second arm piece) in `back`; Rakelet's rake handle in `tail` and his forearms in `back`; Rickeyride's exhaust pipes in `back`, his spoiler struts in `spikes` and his spoiler in `wings`; freckles in `cheeks`, so they sit on the head; Rickeyride's wheels in `legs` (the `quad` layout, so they grow to the ground).
- **New draft bodies:** `draft-upright` is the taller upright torso, still a soft blob with a slight waist. The others are `draft-cardigan` (it flares at the hem), `draft-dad-belly` (widest at the belly) and `draft-kart` (a low, boxy bumper kart).
- **Faces keep each feeling's face kit** (`ART_RULES.feelingFaces`, ART_BIBLE §1.6): silly has dot or sharp eyes and an open mouth; brave has brave brows; cozy has oval eyes and blush; joy has happy eyes. The human touch comes from brows (all four have them, and few squishies do), hair, moustaches and freckles, not from a new eye shape. A dedicated "human-style eye" part would need `feelingFaces` widened, which is an art-rule change, so it is left out.
- **Still squishies, never Keepers:** the head is big on a toy blob body, limbs are capsules with no hands or fingers, and there is no skin tone (the body colour carries the element).
- **Caps:** 8–11 parts per form (the cap is 12). The bosses use the `shimmer` finish (mythic). Base and middle forms use `iridescent` (legendary).

## The briefs

### Rakelet (Leaf · Silly) · Pileup → Rakeling → **Rakelet**
- **Hook:** his whole lower face is a rake head (owner, round 3): a flat white bar wider than his face, eight long tines hanging from it as his teeth with a dark mouth behind them, and the rake's handle sticking up over his shoulder. His hair is a heap of autumn leaves, and one russet leaf is always sliding off it.
- **Stages:** Pileup has a little comb of five baby tines; Rakeling gains the bar, seven tines and the lanky arms; Rakelet gains eight long tines, the handle, the falling leaf and a second arm piece (a thinner forearm splayed a little further out, so the arm bends).
- **Silhouette:** tall and lanky, with long arms hanging to his knees and a messy leafy top.
- **Palette:** leaf green `#9fd46e`, cream, autumn orange `#f08a3c`, rake-handle brown `#7a4a2e`. Freckles across the nose.
- **Nearest kind and the difference:** Glowgourd (toothy grin, leaf arms). Rakelet is tall and thin, his teeth are one straight row hanging down, he has a leaf heap rather than a stem, and he has no pumpkin body. Bristlebloom and Thistleknight share green and upright, but their dominant parts are thistles, not a leaf heap.

### Mom: **Momentum** (proposed; alt *Mama Flare*) · Momo → Mamarama → **Momentum** (Fire · Brave)
- **Hook:** a bun bigger than her head, with two gold hair sticks through it, and hands on hips with elbows out. The hair sticks are the fire glow accent (`glow: 'accent'`): she has no flames until she attacks, and then they light up for The Look (a move animation, #187).
- **No glowing eyes (coordinator ruling 2, round 2):** eyes are `ink`, and brows and cheeks are surface parts, which never glow (`glow` applies only to sticking-out parts). A glow tint on the brows or cheeks isn't possible in the kit, so "eyes that glow" is dropped from the brief.
- **Akimbo arms (ruling 3):** two straight pieces per side: the upper arm in `arms` angles down and out to the elbow, and the forearm in `back` comes back up from the hip to meet it. No schema change.
- **Stages:** Momo is small and simple (a fringe of bangs, stubby arms); Mamarama gains the big bun and the akimbo arms; Momentum gains the flared cardigan body and the glowing hair sticks. The round-1 gold buttons (gingerbread), side curls (mouse ears) and pearl earrings are gone.
- **Silhouette:** a ball on top, elbows out, and a cardigan flaring at the hem.
- **Palette:** coral `#ff8a6a`, cream, gold `#ffd166` (the hair sticks; glows, the fire rule), plum hair `#8a3550`.
- **Nearest kind and the difference:** Hearthbun (an upright fire brawler with a flame mane). Mom has one round bun instead of flames, akimbo arms instead of strong arms, and coral-red instead of orange. Pepperpip, Chillypep and Jalapow share red, fire and standing, but they are peppers with no hair.
- **Name:** "Momentum" puns on mom and a brave rush, it is kid-readable, and it passes the filter. "Momzilla" leans on a monster-movie brand.

### Dad: **Papa Brrr** (proposed; alt *Frostpop* for the boss) · Snowpop → Frostpop → **Papa Brrr** (Frost · Cozy)
- **Hook:** a moustache wider than his face under a red ball-cap brim, and giant white sneakers. Round 2: the cap is as wide as the head and centred on its crown, so it wraps the top instead of perching as a disc, and the brim grows out of its front edge; the belly patch sits higher, clear of the sneakers.
- **Silhouette:** a barrel body widest at the belly, the brim forward, moustache wings and big feet.
- **Palette:** icy blue `#a9d4f5`, frost white, cap red `#e2574c`, moustache cream `#f7f1ea`.
- **Nearest kind and the difference:** Drowsiberg and Slumberberg (yeti, strong arms) and Gnomguard (beard, cap). Papa Brrr has no fur ruff or fangs, a flat forward brim instead of a pointed cap, sneakers, and a moustache rather than a beard.

### Rickeyride (Spark · Silly) · Zoomlet → Revvy → **Rickeyride**
- **Hook:** he never stands still. He is a kid squishy who is half bumper kart: a boxy kart body on four chunky wheels, hair blown straight back, goggles on his forehead, and arms reaching forward to steer.
- **Feeling (coordinator ruling 1):** silly, not joy. Joy's face kit needs closed happy-arc eyes; silly allows open dot eyes with an open mouth, which fits "never stands still". `ART_RULES.feelingFaces` is unchanged. Note: Rakelet is also silly, so the four no longer have four different feelings.
- **Legs (ruling 4):** the wheels keep the `legs` slot. His arms come out of the top of the kart. **LIMITED: feet.** Round 2's shoes on the front deck read as headlights, so round 3 removes them (coordinator render-check); he has no feet. No schema change.
- **Stages:** Zoomlet has a small hair swoop; Revvy gains the full swoop, goggles and twin exhaust pipes; Rickeyride gains fierce brows and a blue racing spoiler on two struts at the back. The exhaust stacks now stand up so they show from the front. The round-1 racing stripe and exhaust puffs and the round-2 fins and feet are gone.
- **Silhouette:** low and wide (the only low, wide, boxy squishy), with a big head poking out of the top.
- **Palette:** spark yellow `#ffd84a`, light cyan (goggles, puffs), blue hair `#3f8fe8`, dark wheels `#4a3a5c`.
- **Nearest kind and the difference:** Fuzzbolt, Zipkit, Frizzbolt and Thundermop (yellow, spark, standing) are cats and mops on legs. Rickeyride has a kart body and wheels and no ears. Zingaling is spark and joy, but it is a hovering star.
- **Open question for the owner:** the issue says all four have arms and legs. Rickeyride's "legs" are his wheels (the `legs` slot), and he has short arms holding the wheel. The alternative is legged with roller skates, but the art kit has no way to put a wheel at the foot, so it would read as stubby legs.
- **Ride:** the plan floated the `floater` field to carry a ride. That needs a new floater glyph kind, which is a shared schema change. The kart body does it with no contract change.

## Duplication matrix (against all 151 shipped kinds)

Recomputed for round 2 with the shared `dominantPart` and `hueFamily` functions (the same ones `checkRosterArt` uses). The draft test also runs `checkRosterArt` over roster + drafts, and it passes.

| Form | Body | Dominant part | Hue | Kinds sharing the dominant part | Kinds sharing 2 of body / dominant / hue | Same hue + element + pose (visual neighbours) |
|---|---|---|---|---|---|---|
| Pileup | blob | leaf-tuft | green | 0 | Lilyhop, Lilyleap, Croakaroo (blob + green; frogs, no hair or teeth) | Bristlepip |
| Rakeling | upright | lanky-arms | green | 0 | none | Bristlebloom, Thistleknight |
| **Rakelet** | upright | lanky-arms | green | 0 | none | Bristlebloom, Thistleknight |
| Momo | pear | stubby-arms | red | 4 (Glowboo, Sparksnail, Pepperpip, Snowtuft) | Pepperpip (stubby-arms + red; a pepper, no hair) | Chillypep, Pepperpip, Jalapow |
| Mamarama | upright | big-bun | red | 0 | none | none |
| **Momentum** | cardigan | big-bun | red | 0 | none | none |
| Snowpop | blob | ball-cap | blue | 0 | Lampfin, Lanternfin, Nightfin (blob + blue; fish) | the frost pups, Flakefluff, Snowtuft, Frostbold |
| Frostpop | dad-belly | ball-cap | blue | 0 | none | Drowsiberg, Slumberberg |
| **Papa Brrr** | dad-belly | ball-cap | blue | 0 | none | Drowsiberg, Slumberberg |
| Zoomlet | kart | steer-arms | yellow | 0 | none | Fuzzbolt, Zipkit, Frizzbolt, Thundermop |
| Revvy | kart | wind-swoop | yellow | 0 | none | same |
| **Rickeyride** | kart | wind-swoop | yellow | 0 | none | same |

**Against the Keepers:** Keepers have human proportions (a small head on a long body with real arms and legs), a skin tone, and hairstyles drawn from `KEEPER_HAIRSTYLES` (including `bun`, `curly` and `swoop`). The bosses have one body colour, toy proportions (head about 0.7–1 of the torso) and capsule limbs. Their hair is a squishy part (a leaf heap, a bun bigger than the head, a wind swoop). The line-up render puts Pip beside them for scale.

**Between the four:** each has a different element, body, hue family and dominant part (Rakelet and Rickeyride now share the silly feeling, ruling 1), and each differs in its silhouette: lanky, a ball on top, a wide belly with a brim, and low and wide.

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


**Momo's dominant part** is the shared `stubby-arms` after round 2 (the base form is deliberately small and simple, with no bun). Only Pepperpip also shares the hue, and it is a pepper with no hair; `checkRosterArt` passes over roster + drafts.
