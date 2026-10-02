# Heartpatch — Game Design Document

> Source of truth for game design. Issues link to sections here instead of restating them.
> Items marked **[DEFAULT]** are sensible starting values chosen during design; tune them in playtesting and keep them in data config, not code.

## Contents
1. [Vision](#1-vision)
2. [Lore](#2-lore)
3. [Players, maps and invites](#3-players-maps-and-invites)
4. [Squishies](#4-squishies)
5. [Elements and feelings](#5-elements-and-feelings)
6. [Battles](#6-battles)
7. [Growth: care, habitats and XP](#7-growth-care-habitats-and-xp)
8. [Evolution](#8-evolution)
9. [Breeding](#9-breeding)
10. [Trading and gifting](#10-trading-and-gifting)
11. [Territory](#11-territory)
12. [Resources](#12-resources)
13. [Home base and buildings](#13-home-base-and-buildings)
14. [The Hollow Man](#14-the-hollow-man)
15. [Seasons](#15-seasons)
16. [Lorebook and Easter eggs](#16-lorebook-and-easter-eggs)
17. [Communication](#17-communication)
18. [Accounts and safety](#18-accounts-and-safety)
19. [Visual direction](#19-visual-direction)
20. [Camera and views](#20-camera-and-views)
21. [Retention loops](#21-retention-loops)
22. [Phased roadmap](#22-phased-roadmap)
23. [Keepers and wardrobe](#23-keepers-and-wardrobe)
24. [Keeper milestones](#24-keeper-milestones)
25. [Opening cinematic](#25-opening-cinematic-the-great-scatter)
26. [Single-player tutorial](#26-single-player-tutorial-the-first-patch)

---

## 1. Vision

A bright, playful, invite-only multiplayer game for ages 10–17, played mainly on **iPhone and iPad** as an installable web app (PWA) at `play.pumpkinpatchgames.com`.

Players pick and dress up their own **Keeper** character, collect adorable **squishies**, raise and train them, evolve them into rarer and more powerful forms, build a home base where they thrive, capture territory on a shared map, and defend it from 1–3 rival players and from the **Hollow Man**.

**Long-term goal:** collect every type of squishy, defend your territory, and build the most wonderful home base in the land.

**Design pillars**
- **The squishy is the star.** Every system should make squishies feel alive, loved and worth collecting.
- **Effort is rewarded, absence is not punished.** Attentive players progress faster; no one loses what they love by missing a day.
- **Rivals, but family.** Competition drives the map; cooperation and generosity are rewarded mechanically.
- **Always something to come back for.** Timers, nightly events, seasons and secrets.

## 2. Lore

**The Heartpatch.** Long ago every squishy was born in the Heartpatch, a glowing field in a valley called **Juniper's Gap**, where the world's joy took shape. Laughter, celebrations and cozy moments bloomed into new squishies.

**The Great Scatter.** The **Hollow Man** — a being with no joy of his own — was drawn to the Heartpatch and tried to swallow it. The Heartpatch shattered into **Heart Seeds**, and squishies tumbled across the wild lands.

**Keepers.** Each player is a young Keeper (see §23 for how Keepers look and dress) who plants a Heart Seed. It grows into their **home base**, rooted in Heartpatch magic, which is why a home base can never be taken.

**Seasons.** When the world celebrates, Heartpatch magic surges and new squishies bloom: spooky ones at Halloween, cozy ones at Thanksgiving, frosty ones in winter. New seasonal content is the world growing, not something bolted on.

**Juniper's Gap** sits at the center of every map: the richest land, the hardest guardians, and the shadowy entrance to the Hollow Man's Hollow.

Tone: whimsical, warm, lightly spooky. Never gory or cruel.

New players experience this story in the opening cinematic (§25) and the tutorial (§26).

## 3. Players, maps and invites

- 2–4 players per map. One player creates the map and is its **owner** (admin).
- Creating a map produces an **invite code**. Entering a code creates a **join request** that the owner must approve.
- Codes expire **[DEFAULT: 7 days]** and can be regenerated or revoked.
- Owner admin powers: approve/deny joins, remove a player, set the map's **PvP mode** (§11), and reset the password of a member whose maps are **all** owned by this owner (otherwise the operator resets it, §18). Mute a player and toggle free chat arrive with free chat in Phase 2 (Phase 1 has only preset messages and emoji, which rate limits cover).
- A player can be in several maps; progress is per map.
- **Multiplayer model: hybrid.**
  - The world is **persistent and asynchronous**: state lives in Postgres; timers (mining, training, care decay) resolve from timestamps.
  - Attacks on an offline defender resolve server-side using the defender's **defense stance**.
  - **Live battles** (Phase 2) happen in real-time rooms when both players are online.
- Map size scales with players **[DEFAULT]**: hex radius 9 (2 players, 271 tiles), 11 (3 players, 397), 12 (4 players, 469). Home bases are placed evenly around Juniper's Gap.

## 4. Squishies

Each squishy is an instance of a **species**. Species are data, not code.

**Species fields (minimum):** `id`, `name`, `element`, `feeling` (default/base), `rarity` (common, uncommon, rare, epic, legendary, secret), `season` (optional), `baseStats` (hp, attack, defense, speed), `moves`, `evolutions` (see §8), `visual` (procedural parameters, see §19), `habitatPreferences`. Spawn rules live in server-only spawn tables, not on the species, so they can't be datamined (tech spec §2). **Secret species** (rarity `secret`) and secret evolution forms are server-only too: the client receives a species definition only when the player meets it.

**Instance fields:** `id`, `speciesId`, `ownerId`, `nickname`, `level`, `xp`, `element`, `feeling` (can shift with care), `contentment`, `lastCaredAt`, `careHistoryScore`, `habitatId`, `state` (active, hollowed, in-trade…), `accessories` (items from the shared Wardrobe catalog, §23), `stats` (with small individual variance).

**Launch roster (Phase 1):** 12–15 base species across elements and feelings, plus 3–4 Halloween species.

## 5. Elements and feelings

Every squishy has **one element** and **one feeling**.

**Elements [DEFAULT set]:** Fire, Water, Leaf, Frost, Spark, Stone, Shadow, Light.
**Feelings [DEFAULT set]:** Joy, Cozy, Brave, Silly, Sleepy, Spooky.

Three data tables drive combat (all JSON config in `packages/shared`):

1. **Element matrix** — attacker element vs defender element. Multipliers in the range 0.5× to 2×. Standard advantage wheel (e.g. Fire > Leaf > Water > Fire).
2. **Feeling matrix** — attacker feeling vs defender feeling. Smaller range **[DEFAULT: 0.75× to 1.5×]**. This is where counters live: a plain-looking squishy with the right feeling can blunt an element disadvantage (e.g. Silly disarms Brave; Brave overwhelms Sleepy).
3. **Synergy table** — a squishy's own element × feeling combination gives a bonus or penalty **[DEFAULT: 0.85× to 1.2×]** to its stats. Harmonious combos (e.g. Spooky + Shadow, Cozy + Fire) are stronger; conflicted combos (e.g. Joy + Shadow) are weaker but may unlock unique evolution branches.

**Design intent:** no squishy is strictly best. Synergistic squishies are valuable finds; underdog counters to overpowered squishies are equally valuable.

A **balance simulator** (see issues) runs thousands of seeded battles and flags any combo with an outlier win rate.

## 6. Battles

**Turn-based**, Pokémon-style: each side picks a move per turn; speed decides order.

- Teams of up to **[DEFAULT: 3]** squishies. Swap costs a turn.
- Each species has 2–4 moves. Moves have element, power, accuracy and optional effects (status, buffs, heal).
- **Damage** = `base(move power, attack, defense, level)` × element multiplier × feeling multiplier × synergy multiplier × random(0.9–1.1, seeded).
- **Engine:** a pure deterministic reducer in `packages/shared`: `(state, action, seed) → newState`. The same code runs in live battles, offline raid resolution, client previews and the balance simulator. Every battle can be replayed from its seed and action log.
- **PvE:** wild squishies and tile guardians use a simple AI.
- **Offline defense:** the defender's squishies are controlled by an AI following their **defense stance** (aggressive, defensive, balanced).
- **Capture:** weakening a wild squishy and using a **Heart Charm** (craftable) gives a capture chance that rises as its HP drops.
- Battles are never violent: squishies get "tuckered out", not hurt.

## 7. Growth: care, habitats and XP

**XP gained = battle XP × care multiplier × habitat multiplier**

- **Care multiplier.** Care actions (**feed, pet, play**) raise **contentment** (0–100). Contentment decays slowly over real time **[DEFAULT: ~24h from full to baseline]**. Multiplier **[DEFAULT: 1.0× to 1.75×]**.
- **Habitat multiplier.** Habitats carry element and feeling tags. A squishy housed in a matching habitat gets **[DEFAULT: up to 1.75×]**. A mismatch gives 1.0×.
- **Floor of 1.0×.** Neglect never weakens or sickens a squishy; it only means no bonus. Combat alone always advances a squishy, just more slowly.
- **Cap.** Combined multiplier capped at **[DEFAULT: 3×]**.
- **Implementation:** no ticking simulation. Store `contentment` and `lastCaredAt`; compute current contentment lazily from elapsed time on read. Care actions have server-side cooldowns so tap-spamming can't max care.
- **Diminishing returns:** the first **[DEFAULT: 3]** care actions per squishy per day give full contentment; later ones give less. Patch Coins from care are capped per account per day **[DEFAULT]**. Attentive play is rewarded without turning care into a chore that favours whoever has the most screen time.
- **Why three actions:** each maps to close-up gestures (§20): drag a treat → **feed**, stroke → **pet**, tap to boop or pinch to tickle → **play**. Each also has a visible button. This keeps care easy to pick up. Training is the **Training Grounds** building (§13), not a care button. Grooming returns with squishy dress-up (Phase 2). Care actions are data, so adding one later needs no engine change.
- Care history (a rolling score over the squishy's life) feeds evolution odds (§8).

## 8. Evolution

Squishies evolve at level thresholds. The evolved form **branches by feeling plus rare conditions**, and the whole environment the player builds influences the outcome.

When a squishy is ready, the server rolls a **weighted table** of possible forms for that species:

- **Dominant feeling** at evolution time (shaped by care and habitat) sets the base branch.
- **Home Base Harmony** (Phase 3; a cached score for habitat variety, upkeep, Hearthfire coverage, decorations and play areas) raises rare-form odds.
- **Care quality** over the squishy's lifetime raises rare-form odds.
- **Rare conditions** unlock secret branches: season, time of day, nearby buildings, battle feats, Easter-egg triggers.

**Guardrails**
- **Hints, not a slot machine.** In-game "whispers" and Lorebook pages hint at conditions ("this squishy seems to love moonlight…").
- **Pity protection.** Each common result for a well-cared-for squishy slightly raises that player's next rare roll odds.
- Rolls are server-side with a seeded RNG; inputs are logged so any result can be explained and replayed.

Phase 1 ships simple level-based single-form evolution; branching arrives in Phase 2.

## 9. Breeding

(Phase 3.) A **Nursery** building pairs two squishies to produce an egg.

- **Trait inheritance (common):** the egg's species comes from a parent; element from one parent and feeling from the other, enabling combos not found in the wild.
- **Hybrid species (rarer):** specific parent pairings produce species that exist only through breeding.
- Nursery quality and Home Base Harmony raise hybrid odds (same weighted-roll system as evolution).
- Eggs hatch on a timer; cooldowns per parent.

## 10. Trading and gifting

(Phase 2.)

- **Trades** use **escrow**: both offers lock the squishies/items; a single database transaction swaps ownership or nothing changes. An append-only trade ledger records every trade.
- **Fair trade bonus:** each squishy has a server-computed value (rarity, level, synergy, evolution stage). If both sides are within **[DEFAULT: ±15%]**, both players get a bonus (XP, resources or Harmony).
- **Generosity:** gifting builds **warmth** with that player. Warmth strengthens the "family love" defense against the Hollow Man (§14) when territories are near each other.
- **Anti-farming:** diminishing returns and a per-pair daily cap on bonuses.
- **Clothing** trades and gifts use the same flow, bonuses and caps (see §23). Milestone items are account-bound.
- **Regret window:** lopsided trades show a gentle "Are you sure?" with a value comparison. Traded squishies have a **24h take-back window**.

## 11. Territory

- The map is a **hex grid** (axial coordinates `q, r`). Each tile has terrain, owner, state and optional resource node / guardian.
- **Capture:** defeat the tile's wild guardians or the rival squishies defending it.
- **Expansion rule:** you may attack tiles **adjacent to your territory** or **within an outpost's reach** (outposts: Phase 2).
- **Home base:** the Heart Seed tile and its surrounding ring are permanently owned and can never be captured. You can lose territory right up to your home base.
- **Guaranteed home resources:** every home ring contains a Timber node, a Stone node, an **Emberwood** node and a farm plot (Treats), so a player can always fuel their Hearthfire and feed their squishies, however much land they lose.
- **Connected supply (Phase 2):** owned tiles must connect to the home base. After each capture, run BFS from the home base; unreached tiles become **stranded** and fade to neutral over **[DEFAULT: 36h]** unless reconnected.
- **Raid rules [DEFAULT]:** a tile can't be re-attacked for 4h after a battle on it; new players get a 48h protection shield; each player gets 10 attack attempts per day (refills daily). Starting a battle uses an attempt and starts the tile cooldown; leaving a battle counts as a loss.
- **PvP mode (map owner setting) [DEFAULT: Gentle]:** families have kids of very different ages and schedules, so rivalry must never turn into one player farming another.
  - **On:** rival tiles can be challenged; a defender can lose at most **[DEFAULT: 3]** tiles per day.
  - **Gentle (default):** as On, but a defender can lose at most **[DEFAULT: 1]** tile per day, and challenging a player with far less territory (under **[DEFAULT: half]** of yours) earns reduced rewards.
  - **Off:** no player-vs-player challenges. Players race for neutral land and work together against the Hollow Man.
- Hearthfire safe radii are measured in hex tiles (§14).

## 12. Resources

Resources vary by terrain, making certain tiles worth fighting over.

| Resource | Source | Use |
|---|---|---|
| Timber | Forest | Basic building |
| Stone | Hills, mountains | Basic building |
| Emberwood | Old forest | Hearthfire fuel (nightly upkeep) |
| Glimmer | Mountains, caves | Advanced habitats, decorations |
| Heartdust | Rescuing Hollowed squishies, events | Nurseries, evolution boosters (rare) |
| Treats | Grown on farm plots | Feeding squishies, raising care |

**Seasonal resources** (special uses, see §15): Pumpkins, Witch Dust, Magic Fallen Leaves, Turkey Feathers, Presents, Fireworks.

Gathering is timer-based (start a gather on an owned node; collect when done), computed from timestamps.

## 13. Home base and buildings

The home base is where squishies live, train, play, breed and hang out to be admired.

- **Hearthfire:** projects a safe radius (in tiles) against the Hollow Man; burns one night of Emberwood at each nightfall and stores several nights of fuel (§14).
- **Habitats:** tagged by element/feeling (e.g. Frost Grotto, Cozy Meadow, Ember Den, Glimmer Cave). Each has capacity. Matching squishies get the habitat multiplier.
- **Training Grounds:** passive XP trickle for assigned squishies (small).
- **Play areas and decorations:** raise Harmony (Phase 3) and give squishies cute idle behavior.
- **Nursery** (Phase 3), **Noise buildings** (bells, drums, squishy choir) for extra Hollow Man deterrence.
- Buildings are placed on a grid within home-base tiles; upgrade levels increase capacity/radius.

## 14. The Hollow Man

The shared threat and the heart of the lore. Tall, flickering silhouette with glowing eyes — spooky, never gory. Strongest in October.

**His rules → mechanics**

- **"He only needs one."** Each night at **nightfall [DEFAULT: 9:00 PM in the map's time zone]** a server job runs per map. For each player, if any squishies are **exposed**, he takes **one** of them.
- **Exposure:** a squishy is exposed if it's housed outside all Hearthfire safe radii and noise coverage, or if it's at home when the fire has gone out. Squishies inside the home base with a lit Hearthfire are safe.
- **Defenders stand watch:** squishies stationed to defend an owned tile are on watch and are **not** exposed. Holding territory never costs a squishy every night, so the Hollow Man stays a planning challenge (keep the fire lit, house squishies inside its light), not a daily loss.
- **"Keep the fire lit."** Hearthfires store up to **[DEFAULT: 5 nights]** of Emberwood. At each nightfall: if the fire has fuel for tonight, it burns one night's worth and protects tonight; otherwise it goes out. Stocking up teaches planning ahead: an active player tops up in seconds, and a player who misses a few days comes back to a fire that's still lit. The fire shows its remaining nights clearly (e.g. "3 nights left").
- **Absence is not punished (pillar 2).** While the fire is lit, squishies at home are always safe; only squishies the player chose to house outside the light can be taken. If a player is away longer than their stored fuel lasts, the fire goes out and home squishies become exposed too. Taken squishies can always be rescued.
- **Repelled by noise.** Noise buildings extend protection.
- **Repelled by family love.** (Phase 2) Warmth between players with nearby territories reduces his reach.
- **"Never look too long."** (Phase 2 polish) Keeping the camera locked on him when he appears makes nearby squishies start to drift toward him.
- **Hollowed squishies** turn grey and are taken to **the Hollow** (entrance in Juniper's Gap). They are **never permanently lost**: a player rescues them via a rescue expedition (a special battle against shadow guardians), started from anywhere: the Hollow's entrance is in Juniper's Gap, but reaching it doesn't require owning nearby land. Rescue rewards Heartdust, capped at **[DEFAULT: 1]** rescue reward per player per day so exposing squishies on purpose isn't a farm.
- Morning summary: "The Hollow Man visited last night…" shown on next login (push notification in Phase 3).

## 15. Seasons

Seasons are date windows in config (with time zone). Resource nodes, recipes, spawn tables and evolution branches carry an optional `season` tag. A dev-only date override lets any season be tested early.

**Windows may overlap** (New Year already overlaps Christmas). When two seasons are active, content tagged with either is available.

**Window format:** each season has a **recurring month-day window** (e.g. `10-01` to `11-02`, in the map's time zone) plus optional **per-year overrides** (e.g. `2026: 10-01 to 11-09`). A one-year change is a data edit that doesn't affect future years. A window whose end is earlier than its start (New Year, `12-31` to `01-02`) wraps into the next year; its per-year override is keyed by the start year.

**2026 launch:** the Halloween window is extended to **[DEFAULT: Nov 9, 2026]** via a 2026 override so the first playable gets a full Halloween run.

| Season | Window [DEFAULT] | Resources | Specials |
|---|---|---|---|
| Halloween | Oct 1 – Nov 2 (2026: Nov 9) | Pumpkins, Witch Dust | Jack-o'-Lantern Hearthfires (extra-bright, scare the Hollow Man); spooky squishies and evolutions; Hollow Man at full strength |
| Thanksgiving | Nov 3 – Nov 30 | Magic Fallen Leaves (tap leaf piles), Turkey Feathers | Cozy habitats; Harvest Feast tables (hosting another player = big warmth bonus) |
| Christmas / Winter | Dec 1 – Dec 31 | Presents | Presents open for random drops; gifting an unopened present doubles warmth; frosty squishies |
| New Year | Dec 31 – Jan 2 | Fireworks | Fireworks are noise (Hollow Man repellent); midnight countdown event |

**Rules:** presents are **earned only, never bought**, and each shows its possible contents. Leftover seasonal resources carry over as **keepsakes**; their special recipes only unlock during their season.

Each season also brings **seasonal clothing** (§23), obtainable only during that season and wearable forever.

There are **no real-money purchases** in Heartpatch. The only currency, **Patch Coins**, is earned in play (§23).

## 16. Lorebook and Easter eggs

A second collection alongside the squishy catalog.

- **Hidden lore pages** unlock when players capture certain tiles or meet conditions: journal scraps from old Juniper's Gap, tiny paw prints leading to a mysteriously tidied clearing, a sketch of two watchful dogs by a fire.
- **The forest chihuahuas** — benevolent spirits said to guard the old Gap — are never NPCs. They appear only as lore, ambient glimpses (a tiny silhouette at the edge of firelight, distant barking just before the Hollow Man would have arrived) and **ultra-rare secret squishies** with the game's tightest spawn conditions (e.g. near a fully lit Hearthfire at night; when two players defend adjacent tiles together).
- **Implementation:** data-driven triggers `{ id, conditions: [...], reward }` evaluated server-side on game events. Conditions never ship to the client, so they can't be datamined.

Phase 1 may seed 2–3 lore pages; the full Lorebook arrives in Phase 3.

## 17. Communication

- **Quick messages** (preset phrases like "Nice trade!", "Watch out, it's getting dark!") and **emoji / squishy stickers** — Phase 1.
- **Free text chat** — Phase 2, with:
  - server-side filtering (profanity + personal info: phone numbers, emails, addresses, links) before broadcast; the client is never trusted to filter;
  - owner controls (mute, remove, chat off per map);
  - report button; message history retained **[DEFAULT: 30 days]** for parent review;
  - rate limiting;
  - chat unlocks for under-13 profiles only after parent approval (see §18).

## 18. Accounts and safety

- Kids create their own accounts: **username + password**. **No email required.**
- **Family signup code (Phase 1):** creating an account requires a signup code issued by the game operator (a server setting). The site is genuinely family-only even if someone finds the URL or an invite code leaks.
- Passwords hashed with **Argon2id**. Sessions in secure, HttpOnly, SameSite cookies. Login rate-limited per username and IP.
- At signup the player gets a **recovery code** to save (one active code, stored hashed; using it to reset the password shows a fresh code). The map owner can also reset the password of a member whose maps are all owned by that owner; any other reset goes to the operator. A reset revokes the member's sessions and tells them on next login.
- **Operator reset:** a player who isn't in any map yet (e.g. still in the tutorial) has no owner to help, so the game operator can reset any password with a server-side command-line tool.
- Usernames pass the same filter as chat (no inappropriate or identifying names).
- **Birth year** prompt at signup; under-13 profiles need a lightweight parent-approval step before free chat unlocks. (COPPA consideration — verify before public launch.)
- Passkeys (WebAuthn) are an optional later upgrade.
- Collect the minimum personal data possible.

## 19. Visual direction

**Soft vinyl-toy style** in smooth, stylized 3D: glossy, rounded, bright collectible-toy squishies. Playful and crisp — **never pixelated, never retro/8-bit**. Think a modern 3D creature-collector, lighter-weight.

- **Procedural squishies:** a parametric body (blob shape, proportions) plus swappable parts (ears, eyes, mouths, tails, horns, wings, patterns) and palettes, all driven from species data. Scales to hundreds of species, hybrids and evolutions.
- **Materials:** PBR with a clearcoat layer for vinyl sheen; image-based lighting from an environment map; rim lighting so squishies pop.
- **Squish:** squash-and-stretch via vertex shader — wobble on landing, jiggle on tap, bounce when happy.
- **World:** rounded terrain, pastel-bright palettes, baked soft shadows for static scenery, gentle bloom. The world is lightweight so squishies are the stars.
- **Sharpness on iOS:** render at device pixel ratio capped around 2; FXAA/SMAA; dynamic resolution scaling to hold frame rate instead of going blurry; KTX2 compressed textures; LODs; instancing.
- **UI:** vector icons (SVG) and SDF/vector fonts; touch-first, large tap targets, iOS safe areas.

## 20. Camera and views

- **Map view:** third-person, top-down (slight tilt), pan with one finger, pinch to zoom, smooth inertia.
- **Close-up interaction view:** tap a squishy and the camera swoops in face-to-face; background blurs (depth of field, only in this view); high-detail model swapped in. **The squishy is the star.**
  - Gestures: tap to boop, stroke to pet, drag a treat to feed, pinch to tickle → reactions (happy wiggle, blush, giggle, yawn) and care credit. Boop and tickle both count as **play**; stroke is **pet**; the treat is **feed** (§7). Each care action also has a visible button.
  - Idle personality animations reflect feeling (Silly spins, Sleepy nods off, Brave puffs up).
  - Dress-up accessories (shared Wardrobe, §23) and photo mode (Phase 2+).

## 21. Retention loops

- **Daily:** tend and feed squishies, refuel Hearthfires before nightfall, check the morning Hollow Man report, collect gathered resources.
- **Session:** capture tiles, battle, capture wild squishies, build and upgrade.
- **Long-term:** Keeper milestones and signature clothing (§24); complete the catalog (including seasonal and secret squishies), rare evolutions, hybrids, Lorebook pages.
- **Seasonal:** new squishies, resources and events every holiday; keepsakes build anticipation.
- **Social:** rivalry over territory; showing off outfits and titles; trades, gifts (squishies and clothing), feasts and joint defense against the Hollow Man.

## 22. Phased roadmap

**Phase 1 — Halloween first playable (by Oct 31, 2026):** accounts; **opening cinematic and single-player tutorial (§25–26)**; create/join maps with codes and approval; hex map with home bases and adjacent-tile capture; 12–15 starter + 3–4 Halloween squishies (procedural vinyl style); elements, feelings and matrices; turn-based battles, capture; offline raid defense via stance AI; home base with Hearthfires and 1–2 habitats; Timber, Stone, Emberwood, Pumpkins, Witch Dust; care + close-up view; XP formula and simple evolution; the Hollow Man's nightly visit and simple rescue; quick messages and emoji; **Keeper selection and customization, Wardrobe with starter and Halloween clothing, found clothing, Keeper milestones with clothing rewards, Patch Coins and the Boutique**; installable PWA deployed to AWS Lightsail.

**Phase 2 — Thanksgiving:** live real-time battles (Colyseus rooms); trading and gifting (squishies and clothing); free text chat with filtering and parent controls; branching evolution; outposts and stranded tiles; Thanksgiving content; family-love and stare mechanics; dress-up.

**Phase 3 — Christmas:** breeding and hybrids; presents; Home Base Harmony; full Lorebook and chihuahua Easter eggs; web push notifications; New Year fireworks; passkeys.

## 23. Keepers and wardrobe

Every player is represented by a **Keeper**, a character drawn in the same soft vinyl-toy style as the squishies (§19): rounded, chibi-proportioned, glossy and playful. Squishies are still the stars, but your Keeper is how *you* show up in the world.

### Choosing a Keeper
- At signup, players **select a Keeper** from a roster of preset base characters **[DEFAULT: 8]** that vary in body shape, skin tone, face and hairstyle.
- Each base can then be tweaked: hair color, eye color, and a **[DEFAULT: 6]**-color palette for the starter outfit.
- Players can change their Keeper at any time from the Wardrobe, for free. Progress and clothing stay with the account, not the base character.
- No clothing is locked to any body type or presentation. Everything fits every Keeper.

### Where your Keeper appears
- **Home base:** your Keeper wanders and idles among your squishies; tap them to open the Wardrobe.
- **Map:** a small Keeper figure marks your home base and the tile you're currently battling on, so rivals can see who's who.
- **Battles:** your Keeper stands behind your squishies, cheering and reacting (a happy jump on a super-effective hit).
- **Profile card:** shown on invites, join requests, trades, chat and the raid log.
- **Close-up view:** your Keeper appears at the edge of the frame when feeding or petting, but the squishy stays the focus (§20).

### Wardrobe and clothing
- **Slots:** hat, hair accessory, top, bottom, shoes, back (capes, backpacks, wings), held item (lantern, wand, net), and a full-body **costume** slot that overrides the others.
- **Rarity:** common, uncommon, rare, epic, legendary, matching squishy rarity colors.
- **Outfits:** players can save **[DEFAULT: 3]** outfit presets and swap between them.
- **Squishy accessories** (tiny hats, bows, scarves) live in the same Wardrobe and inventory system, so one item catalog and one trading flow cover both.
- Clothing is **cosmetic only**. It never affects battle stats, so no one can buy or trade their way to power.

### Getting clothing
1. **Found:** small chance from capturing tiles, opening resource nodes, rescuing Hollowed squishies, and (Phase 3) presents. Some items only drop in specific terrain or seasons.
2. **Awarded through milestones:** see §24. Milestone items are signature pieces you can't get any other way, so wearing them shows what you've achieved.
3. **Purchased** in the **Boutique** using **Patch Coins**, an in-game currency earned from battles, captures, daily care and milestones. Patch Coins belong to the **account** (like the wardrobe), with daily earning caps **[DEFAULT]** so extra maps or accounts aren't a coin farm. Patch Coins can **never be bought with real money** (§15). The Boutique stock rotates **[DEFAULT: daily]**, with seasonal racks during each season.
4. **Traded and gifted** between players, using the same escrow, fair-trade bonus, generosity/warmth and regret-window rules as squishy trades (§10). Milestone items are **account-bound** and can't be traded, so they stay meaningful.

### Seasonal clothing
Each season brings its own items: Halloween costumes (pumpkin hoods, ghost capes, witch hats, squishy onesies), Thanksgiving scarves and leaf crowns, Christmas sweaters and elf hats, New Year party hats. Like seasonal resources, seasonal clothing stays wearable year-round as keepsakes; it's just only *obtainable* during its season.

### Implementation notes
- **Procedural Keepers:** a parametric base body (a few preset meshes) with attachment bones/sockets per slot, so clothing is modular meshes plus material/palette swaps driven from data, the same approach as squishy parts.
- **Data:** `clothing` items are data in `packages/shared/data` (`id, name, slot, rarity, season?, sources[], tradable, boutiquePrice?, visual`). `keeper` config is stored per player.
- **Server-authoritative:** ownership, Boutique purchases and Patch Coin balances are validated server-side; purchases run in a single DB transaction (CLAUDE.md rule 7).
- **Names and nicknames** players type (outfit names) pass the same text filter as usernames.

## 24. Keeper milestones

Milestones are long-term goals that reward signature clothing, Patch Coins and titles. They give players something to work toward across every system.

| Track | Example tiers [DEFAULT] | Example rewards |
|---|---|---|
| Territory | Capture 10 / 50 / 150 tiles; hold Juniper's Gap tile for 7 days | Explorer's Hat → Cartographer Cape → Crown of the Gap |
| Collector | Catch 10 / 25 / 50 species; complete an element | Squishy Net → Collector's Satchel → Rainbow Jacket |
| Evolution | Evolve 5 / 20 squishies; get a rare branch | Evolver's Goggles → Prism Boots |
| Caretaker | Pet/feed 100 / 500 / 2,000 times; keep 5 squishies at max contentment | Cozy Apron → Heart Mittens |
| Defender | Win 10 / 50 defenses; protect every squishy for 7 nights | Hearthkeeper Lantern → Ember Cloak |
| Rescuer | Rescue 1 / 10 Hollowed squishies | Brave Scarf → Lightbringer Wings |
| Friendship | (Phase 2) Gift 10 items; complete 10 fair trades | Friendship Bracelet → Matching outfit sets for both players |
| Seasonal | Complete each season's event goals | That season's legendary costume |
| Secret | Hidden conditions tied to the Lorebook (§16) | Secret items, never listed until found |

- Each tier also grants a **title** shown on the profile card (e.g. "Keeper of the Gap", "Hollow Rescuer").
- A **Milestones screen** shows progress bars for visible tracks. Secret milestones show as "???" until earned.
- **Scope:** milestones and titles belong to the **account**. Progress from map play (territory, defenses) only counts on maps with at least **[DEFAULT: 2]** active members, so a solo second account can't farm them.
- **Implementation:** milestone definitions are data. Progress counters update server-side from game events (the same event stream used for Easter-egg triggers in §16). Rewards are granted exactly once, idempotently.

## 25. Opening cinematic: "The Great Scatter"

A short, skippable cinematic that every new player sees once, right after choosing their Keeper (§23) and before the tutorial (§26). It explains what happened to the world and **why** each core mechanic matters, so the tutorial feels like a story and not a manual.

**Format [DEFAULT]**
- **Length:** about 90–120 seconds, seven shots.
- **In-engine, not video:** rendered live in Babylon.js using the same procedural squishies, terrain and the player's own Keeper. That keeps the download small and lets the final shot show *your* character.
- **Narration as captions** (large, rounded, readable for a 10-year-old) over music and sound effects. Each caption stays up long enough to read, and a tap advances early. Recorded voice-over can come later.
- **Skippable** after the first viewing (and by a long-press for impatient siblings), **replayable** from Settings.
- **Tone:** wonder first, a flash of spooky, then hope. The Hollow Man is a tall, flickering silhouette with glowing eyes; never gory or jump-scary.

**Shot list [DEFAULT script — edit freely]**

| # | Shot | What we see | Caption (narration) | Why it matters |
|---|---|---|---|---|
| 1 | **The Heartpatch** | Sweeping golden-hour flight over a glowing valley. Squishies bloom out of the ground like flowers when nearby squishies laugh. | "Long ago, every squishy was born in the Heartpatch — a glowing field where the world's joy took shape." | Establishes the world before the fall. |
| 2 | **Seasons of joy** | Quick dissolves: pumpkins glowing and spooky squishies popping up; leaf piles with cozy squishies; snowfall and frosty squishies. | "When the world celebrated, the magic surged — and new squishies bloomed with every season." | Sets up seasonal squishies. |
| 3 | **The Keepers of old** | Keepers tending Hearthfires; squishies playing, napping and growing into bigger, sparklier forms in cared-for meadows. | "Keepers tended the fires and cared for the squishies. Loved squishies grew… and changed into something wonderful." | Hearthfires, care, habitats and evolution. |
| 4 | **The Hollow Man** | Color drains from the edges of the frame. A tall flickering silhouette steps out of the trees, eyes glowing. The music drops out. | "But one night, something hollow came. He had no joy of his own… so he wanted ours." | Introduces the threat. |
| 5 | **The Great Scatter** | He reaches for the Heartpatch; it cracks with light and shatters into glowing Heart Seeds that streak across the sky. Squishies tumble into the wild lands; a few turn grey and drift into the shadows. | "The Heartpatch shattered. Its Heart Seeds scattered. And the squishies were lost across the land." | Why squishies are wild, why some are Hollowed. |
| 6 | **The land today** | The map from above: patchy, washed-out, wild. One by one, old Hearthfires flicker out. Far away, a few other Heart Seeds glow. | "Now the land is wild, and the fires are going out. He still walks at night — and he only needs one." | Territory to reclaim; nightfall; other Keepers. |
| 7 | **Your Heart Seed** | A Heart Seed lands at the feet of **the player's own Keeper** and glows. Camera pushes in. | "But a Heart Seed has found you, Keeper. Plant it. Light a fire. Bring the squishies home… and bring the color back, one patch at a time." | The player's goal. Cut to title card: **HEARTPATCH**. |

**Lore consistency:** reclaiming a tile visibly restores its color and brings squishies back to it. This is the in-world reason territory matters, and the map's art should show it (neutral and stranded tiles look a little washed-out; owned tiles are vivid).

## 26. Single-player tutorial: "The First Patch"

Every new player plays a short solo tutorial before joining or creating a multiplayer map. It teaches every Phase 1 mechanic hands-on, in story order, with nothing to lose.

**Where:** a small private map, **the Tutorial Glade** [DEFAULT: hex radius 3, 37 tiles], hand-authored (not random) so every player gets the same, well-paced experience.

**Guide [DEFAULT]:** **Sprout**, the tiny glowing spirit of your Heart Seed. Sprout talks in short speech bubbles, points at things, and cheers you on. (The forest chihuahuas stay lore-only, §16.) Sprout appears again later for occasional tips.

**Steps [DEFAULT]** — each is a short goal with a highlighted target and one or two lines from Sprout:

1. **Plant your Heart Seed.** Tap the glowing spot → your home base grows from the ground with color spreading outward. *Teaches: home base can never be taken.*
2. **Gather.** Collect Timber and Emberwood from nearby nodes (tutorial timers take seconds, not minutes). *Teaches: resources and timers.*
3. **Light your first Hearthfire.** Build it, fuel it, see the warm safe radius on the map. *Teaches: fires keep squishies safe.*
4. **Meet a wild squishy.** A friendly wild squishy wanders up. **First battle** (scripted to be winnable) introduces moves and one clear example of element and feeling effectiveness ("Super cozy!").
5. **Capture it.** Use a Heart Charm (capture is guaranteed here). The player names their first squishy — it becomes their **Partner**.
6. **Care for it.** The camera swoops into the **close-up view**: pet, boop and feed it. Sprout explains, simply, that happy squishies learn faster.
7. **Give it a home.** Build a habitat that matches its element or feeling and move it in. *Teaches: the right home helps it grow.*
8. **Claim your first territory.** Attack a neighboring tile, beat its guardian, and watch color return to the land. Sprout explains you can only claim land next to land you already hold, and that land brings resources and new squishies.
9. **Defend.** A shadowy "echo" (not a real player) raids your new tile. Pick a **defense stance** and win. *Teaches: rivals can attack your tiles, but never your home base.*
10. **Nightfall.** The sky dims and the Hollow Man appears at the edge of the Glade. One squishy is outside the firelight; move it inside (or stretch the fire). He hesitates at the light and fades away. Sprout explains the rules: keep the fire lit, he only needs one — and if he ever takes a squishy, you can always rescue it.
11. **Evolve.** One more battle gives your Partner enough XP to evolve. Big celebration moment. *Teaches: battles plus care plus a good home = growth.*
12. **Your first milestone.** Earn the **"First Patch"** milestone and the account-bound **Seedling Scarf**; open the Wardrobe and put it on.
13. **Graduation.** Sprout: "Other Keepers have Heart Seeds too…" The player chooses **Create a map** or **Enter an invite code**.

**Rules**
- Target length **[DEFAULT: 12–18 minutes]**. Progress is saved after every step; quitting resumes where you left off.
- Nothing can be lost in the tutorial. The Hollow Man can't take anything here.
- **Carry-over:** the player's Partner species, the Seedling Scarf and the "First Patch" milestone are account-level rewards. Every new map the player joins starts them with their Partner (a fresh level-1 copy) alongside the normal starting kit.
- Players can skip the tutorial only after finishing it once (e.g. on a new device), and can replay it any time from Settings.
- **Tutorial gate is a server setting:** while the tutorial is still being built (and for testing), the operator can let new accounts create or join maps without finishing it. The multiplayer game never waits on the tutorial to be playable. The tutorial's last steps (Seedling Scarf in the Wardrobe, First Patch milestone) can arrive once those systems exist.
- Every step is reachable with one hand on an iPhone; text is short and large.
