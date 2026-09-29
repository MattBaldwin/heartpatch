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

---

## 1. Vision

A bright, playful, invite-only multiplayer game for ages 10–17, played mainly on **iPhone and iPad** as an installable web app (PWA) at `play.pumpkinpatchgames.com`.

Players collect adorable **squishies**, raise and train them, evolve them into rarer and more powerful forms, build a home base where they thrive, capture territory on a shared map, and defend it from 1–3 rival players and from the **Hollow Man**.

**Long-term goal:** collect every type of squishy, defend your territory, and build the most wonderful home base in the land.

**Design pillars**
- **The squishy is the star.** Every system should make squishies feel alive, loved and worth collecting.
- **Effort is rewarded, absence is not punished.** Attentive players progress faster; no one loses what they love by missing a day.
- **Rivals, but family.** Competition drives the map; cooperation and generosity are rewarded mechanically.
- **Always something to come back for.** Timers, nightly events, seasons and secrets.

## 2. Lore

**The Heartpatch.** Long ago every squishy was born in the Heartpatch, a glowing field in a valley called **Juniper's Gap**, where the world's joy took shape. Laughter, celebrations and cozy moments bloomed into new squishies.

**The Great Scatter.** The **Hollow Man** — a being with no joy of his own — was drawn to the Heartpatch and tried to swallow it. The Heartpatch shattered into **Heart Seeds**, and squishies tumbled across the wild lands.

**Keepers.** Each player is a young Keeper who plants a Heart Seed. It grows into their **home base**, rooted in Heartpatch magic, which is why a home base can never be taken.

**Seasons.** When the world celebrates, Heartpatch magic surges and new squishies bloom: spooky ones at Halloween, cozy ones at Thanksgiving, frosty ones in winter. New seasonal content is the world growing, not something bolted on.

**Juniper's Gap** sits at the center of every map: the richest land, the hardest guardians, and the shadowy entrance to the Hollow Man's Hollow.

Tone: whimsical, warm, lightly spooky. Never gory or cruel.

## 3. Players, maps and invites

- 2–4 players per map. One player creates the map and is its **owner** (admin).
- Creating a map produces an **invite code**. Entering a code creates a **join request** that the owner must approve.
- Codes expire **[DEFAULT: 7 days]** and can be regenerated or revoked.
- Owner admin powers: approve/deny joins, remove a player, mute a player, reset a player's password, toggle free chat (Phase 2).
- A player can be in several maps; progress is per map.
- **Multiplayer model: hybrid.**
  - The world is **persistent and asynchronous**: state lives in Postgres; timers (mining, training, care decay) resolve from timestamps.
  - Attacks on an offline defender resolve server-side using the defender's **defense stance**.
  - **Live battles** (Phase 2) happen in real-time rooms when both players are online.
- Map size scales with players **[DEFAULT]**: hex radius 9 (2 players, 271 tiles), 11 (3 players, 397), 12 (4 players, 469). Home bases are placed evenly around Juniper's Gap.

## 4. Squishies

Each squishy is an instance of a **species**. Species are data, not code.

**Species fields (minimum):** `id`, `name`, `element`, `feeling` (default/base), `rarity` (common, uncommon, rare, epic, legendary, secret), `season` (optional), `baseStats` (hp, attack, defense, speed), `moves`, `evolutions` (see §8), `visual` (procedural parameters, see §19), `habitatPreferences`, `spawnRules`.

**Instance fields:** `id`, `speciesId`, `ownerId`, `nickname`, `level`, `xp`, `element`, `feeling` (can shift with care), `contentment`, `lastCaredAt`, `careHistoryScore`, `habitatId`, `state` (active, hollowed, in-trade…), `accessories`, `stats` (with small individual variance).

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

- **Care multiplier.** Care actions (feed, pet, play, groom, train) raise **contentment** (0–100). Contentment decays slowly over real time **[DEFAULT: ~24h from full to baseline]**. Multiplier **[DEFAULT: 1.0× to 1.75×]**.
- **Habitat multiplier.** Habitats carry element and feeling tags. A squishy housed in a matching habitat gets **[DEFAULT: up to 1.75×]**. A mismatch gives 1.0×.
- **Floor of 1.0×.** Neglect never weakens or sickens a squishy; it only means no bonus. Combat alone always advances a squishy, just more slowly.
- **Cap.** Combined multiplier capped at **[DEFAULT: 3×]**.
- **Implementation:** no ticking simulation. Store `contentment` and `lastCaredAt`; compute current contentment lazily from elapsed time on read. Care actions have server-side cooldowns so tap-spamming can't max care.
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
- **Regret window:** lopsided trades show a gentle "Are you sure?" with a value comparison. Traded squishies have a **24h take-back window**.

## 11. Territory

- The map is a **hex grid** (axial coordinates `q, r`). Each tile has terrain, owner, state and optional resource node / guardian.
- **Capture:** defeat the tile's wild guardians or the rival squishies defending it.
- **Expansion rule:** you may attack tiles **adjacent to your territory** or **within an outpost's reach** (outposts: Phase 2).
- **Home base:** the Heart Seed tile and its surrounding ring are permanently owned and can never be captured. You can lose territory right up to your home base.
- **Connected supply (Phase 2):** owned tiles must connect to the home base. After each capture, run BFS from the home base; unreached tiles become **stranded** and fade to neutral over **[DEFAULT: 36h]** unless reconnected.
- **Raid rules [DEFAULT]:** a tile can't be re-attacked for 4h after a battle on it; new players get a 48h protection shield; each player gets 10 attack attempts per day (refills daily).
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

- **Hearthfire:** projects a safe radius (in tiles) against the Hollow Man; burns Emberwood.
- **Habitats:** tagged by element/feeling (e.g. Frost Grotto, Cozy Meadow, Ember Den, Glimmer Cave). Each has capacity. Matching squishies get the habitat multiplier.
- **Training Grounds:** passive XP trickle for assigned squishies (small).
- **Play areas and decorations:** raise Harmony (Phase 3) and give squishies cute idle behavior.
- **Nursery** (Phase 3), **Noise buildings** (bells, drums, squishy choir) for extra Hollow Man deterrence.
- Buildings are placed on a grid within home-base tiles; upgrade levels increase capacity/radius.

## 14. The Hollow Man

The shared threat and the heart of the lore. Tall, flickering silhouette with glowing eyes — spooky, never gory. Strongest in October.

**His rules → mechanics**

- **"He only needs one."** Each night at **nightfall [DEFAULT: 9:00 PM in the map's time zone]** a server job runs per map. For each player, if any squishies are **exposed**, he takes **one** of them.
- **Exposure:** a squishy is exposed if it's housed or stationed outside all Hearthfire safe radii and noise coverage. Squishies inside the home base with a lit Hearthfire are safe.
- **"Keep the fire lit."** Hearthfires need Emberwood; an unfuelled fire goes out at nightfall.
- **Repelled by noise.** Noise buildings extend protection.
- **Repelled by family love.** (Phase 2) Warmth between players with nearby territories reduces his reach.
- **"Never look too long."** (Phase 2 polish) Keeping the camera locked on him when he appears makes nearby squishies start to drift toward him.
- **Hollowed squishies** turn grey and are taken to **the Hollow** (entrance in Juniper's Gap). They are **never permanently lost**: a player rescues them via a rescue expedition (a special battle against shadow guardians). Rescue rewards Heartdust.
- Morning summary: "The Hollow Man visited last night…" shown on next login (push notification in Phase 3).

## 15. Seasons

Seasons are date windows in config (with time zone). Resource nodes, recipes, spawn tables and evolution branches carry an optional `season` tag. A dev-only date override lets any season be tested early.

| Season | Window [DEFAULT] | Resources | Specials |
|---|---|---|---|
| Halloween | Oct 1 – Nov 2 | Pumpkins, Witch Dust | Jack-o'-Lantern Hearthfires (extra-bright, scare the Hollow Man); spooky squishies and evolutions; Hollow Man at full strength |
| Thanksgiving | Nov 3 – Nov 30 | Magic Fallen Leaves (tap leaf piles), Turkey Feathers | Cozy habitats; Harvest Feast tables (hosting another player = big warmth bonus) |
| Christmas / Winter | Dec 1 – Dec 31 | Presents | Presents open for random drops; gifting an unopened present doubles warmth; frosty squishies |
| New Year | Dec 31 – Jan 2 | Fireworks | Fireworks are noise (Hollow Man repellent); midnight countdown event |

**Rules:** presents are **earned only, never bought**, and each shows its possible contents. Leftover seasonal resources carry over as **keepsakes**; their special recipes only unlock during their season.

There are **no real-money purchases** in Heartpatch.

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
- Passwords hashed with **Argon2id**. Sessions in secure, HttpOnly, SameSite cookies. Login rate-limited per username and IP.
- At signup the player gets a **recovery code** to save. The map owner can also reset a player's password.
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
  - Gestures: tap to boop, stroke to pet, drag a treat to feed, pinch to tickle → reactions (happy wiggle, blush, giggle, yawn) and care credit.
  - Idle personality animations reflect feeling (Silly spins, Sleepy nods off, Brave puffs up).
  - Dress-up accessories and photo mode (Phase 2+).

## 21. Retention loops

- **Daily:** tend and feed squishies, refuel Hearthfires before nightfall, check the morning Hollow Man report, collect gathered resources.
- **Session:** capture tiles, battle, capture wild squishies, build and upgrade.
- **Long-term:** complete the catalog (including seasonal and secret squishies), rare evolutions, hybrids, Lorebook pages.
- **Seasonal:** new squishies, resources and events every holiday; keepsakes build anticipation.
- **Social:** rivalry over territory; trades, gifts, feasts and joint defense against the Hollow Man.

## 22. Phased roadmap

**Phase 1 — Halloween first playable (by Oct 31, 2026):** accounts; create/join maps with codes and approval; hex map with home bases and adjacent-tile capture; 12–15 starter + 3–4 Halloween squishies (procedural vinyl style); elements, feelings and matrices; turn-based battles, capture; offline raid defense via stance AI; home base with Hearthfires and 1–2 habitats; Timber, Stone, Emberwood, Pumpkins, Witch Dust; care + close-up view; XP formula and simple evolution; the Hollow Man's nightly visit and simple rescue; quick messages and emoji; installable PWA deployed to AWS Lightsail.

**Phase 2 — Thanksgiving:** live real-time battles (Colyseus rooms); trading and gifting; free text chat with filtering and parent controls; branching evolution; outposts and stranded tiles; Thanksgiving content; family-love and stare mechanics; dress-up.

**Phase 3 — Christmas:** breeding and hybrids; presents; Home Base Harmony; full Lorebook and chihuahua Easter eggs; web push notifications; New Year fireworks; passkeys.
