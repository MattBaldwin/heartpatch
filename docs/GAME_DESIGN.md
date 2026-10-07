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
- Owner admin powers: approve/deny joins, remove a player, set the map's **PvP mode** (§11), and reset the password of a member whose game maps (tutorial maps excluded) are **all** owned by this owner (otherwise the operator resets it, §18). Mute a player and toggle free chat arrive with free chat in Phase 2 (Phase 1 has only preset messages and emoji, which rate limits cover).
- A player can be in several maps. **Per map:** squishies, territory, resources and buildings. **Per account:** Keeper, wardrobe, Patch Coins, milestones and titles (§23–24). Account-level daily caps reset at midnight in the time zone saved on the account (taken from the device at signup).
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

**First squishy:** on joining a patch, a new player picks 1 of 3 starters, one per element family (a data-driven list; Puddlepuff is one). The tutorial presents the same choice as meeting their Partner (§26).

## 5. Elements and feelings

Every squishy has **one element** and **one feeling**.

**Elements [DEFAULT set]:** Fire, Water, Leaf, Frost, Spark, Stone, Shadow, Light.
**Feelings [DEFAULT set]:** Joy, Cozy, Brave, Silly, Sleepy, Spooky.

Three data tables drive combat (all JSON config in `packages/shared`):

1. **Element matrix** — attacker element vs defender element. Multipliers in the range **[DEFAULT: about 0.67× to 1.5×]**, softened so feelings can push back (tuned with the balance simulator). Standard advantage wheel (e.g. Fire > Leaf > Water > Fire).
2. **Feeling matrix** — attacker feeling vs defender feeling. Smaller range **[DEFAULT: 0.75× to 1.35×]**. This is where counters live: a plain-looking squishy with the right feeling can blunt an element disadvantage (e.g. Silly disarms Brave; Brave overwhelms Sleepy).
3. **Synergy table** — a squishy's own element × feeling combination gives a bonus or penalty **[DEFAULT: 0.85× to 1.2×]** to its stats. Harmonious combos (e.g. Spooky + Shadow, Cozy + Fire) are stronger; conflicted combos (e.g. Joy + Shadow) are weaker but may unlock unique evolution branches.

**Design intent:** no squishy is strictly best. Synergistic squishies are valuable finds; underdog counters to overpowered squishies are equally valuable.

A **balance simulator** (see issues) runs thousands of seeded battles and flags any combo with an outlier win rate.

## 6. Battles

**Turn-based**, Pokémon-style: each side picks a move per turn; speed decides order.

- Teams of up to **[DEFAULT: 3]** squishies. Swap costs a turn.
- **Pick your team.** The player picks who comes along to battles, in order (the team picker). Each squishy has **one job** at a time: on the team, a guard on watch (§11, §14), a gatherer (§12), or resting at home or in a habitat; picking a guard or a gatherer for the team takes it off that job. With nobody picked, the strongest resting squishies go, never guards or gatherers, so a new player is never stuck. The trade-off is the point: this one gathers well, that one guards well, and the strongest are needed to befriend a strong squishy.
- Each species has 2–4 moves. Moves have element, power, accuracy and optional effects (status, buffs, heal).
- **Damage** = `base(move power, attack, defense, level)` × element multiplier × feeling multiplier × synergy multiplier × random(0.9–1.1, seeded).
- **Engine:** a pure deterministic reducer in `packages/shared`: `(state, action) → newState`, with the seeded RNG state stored inside the battle state. The same code runs in live battles, offline raid resolution, client previews and the balance simulator. Every battle can be replayed from its seed and action log (server-side only; the seed and RNG state never reach clients).
- **PvE:** wild squishies and tile guardians use a simple AI.
- **Offline defense:** the defender's squishies are controlled by an AI following their **defense stance** (aggressive, defensive, balanced).
- **Capture:** weakening a wild squishy and using a **Heart Charm** (craftable) gives a capture chance that rises as its HP drops.
- **No re-fighting for XP, and no getting stuck:** a wild squishy you beat without befriending, lose to or run from wanders off for you for the rest of its spawn window, so the next one you find is someone new. A tie leaves it there. Other players can still find it. On the Tutorial Glade only befriending moves one on, so a new player can always try again.
- **Rarer wild squishies are a step harder:** rare and rarer base forms have bigger stats, so at your Partner's level they're a real challenge. A team is the way to take them on, and battle potions are coming (#214) (owner decision 2026-10-07).
- Battles are never violent: squishies get "tuckered out", not hurt.

## 7. Growth: care, habitats and XP

**XP gained = battle XP × care multiplier × habitat multiplier**

- **Care multiplier.** Care actions (**feed, pet, play**, and the rare Heart Snack below) raise **contentment** (0–100). Contentment decays slowly over real time **[DEFAULT: ~24h from full to baseline]**. Multiplier **[DEFAULT: 1.0× to 1.75×]**. A new squishy starts at contentment **[DEFAULT: 50]** ("Feeling okay!"), not at the baseline.
- **Habitat multiplier.** Habitats carry element and feeling tags. A squishy housed in a matching habitat gets **[DEFAULT: up to 1.75×]**. A mismatch gives 1.0×. A squishy is either housed in a habitat or standing watch (§14), not both.
- **Floor of 1.0×.** Neglect never weakens or sickens a squishy; it only means no bonus. Combat alone always advances a squishy, just more slowly.
- **Cap.** Combined multiplier capped at **[DEFAULT: 3×]**.
- **Implementation:** no ticking simulation. Store `contentment` and `lastCaredAt`; compute current contentment lazily from elapsed time on read. Care can't be tap-spammed: each squishy's returns shrink as the day's actions pile up (below), and the server ignores a repeat of the same action within about 10 seconds so one stroke counts once.
- **Diminishing returns:** the first **[DEFAULT: 3]** care actions per squishy per day give full contentment; later ones give less (50%, then 25%, then 10%). Patch Coins from care are capped per account per day **[DEFAULT: 10]**, and only full-value actions earn one. Attentive play is rewarded without turning care into a chore that favours whoever has the most screen time.
- **Heart Snack (rare treat).** A care button that costs **[DEFAULT: 3]** Heartdust and adds **[DEFAULT: 25]** contentment. It always counts in full, sits outside the day's diminishing returns and earns no Patch Coins, so Heartdust from rescues has a use (owner decision 2026-10-06).
- **Why three everyday actions:** each maps to close-up gestures (§20): drag a treat → **feed**, stroke → **pet**, tap to boop or pinch to tickle → **play**. Each also has a visible button. This keeps care easy to pick up. Training is the **Training Grounds** building (§13), not a care button. Grooming returns with squishy dress-up (Phase 2). Care actions are data, so adding one later needs no engine change.
- **Levels and pace.** Levels go up to 100. Wild squishies match the player's Partner at **[DEFAULT: −2 to +0]** of its level, so a lone Partner beats an ordinary one about 75% of the time as it grows (owner decision 2026-10-07). The XP curve steepens past level 16 (when starters grow up) and again past 30, so 30–100 is a long tail rather than a first-week sprint. A befriended squishy joins at most **[DEFAULT: 1]** level below its first evolution, so it grows up by training rather than by being caught. Battle XP tires out over a day: each squishy gets full XP for its first **[DEFAULT: 7]** wins of the map-local day, then **[DEFAULT: 10%]**, so playing all day doesn't race far ahead (owner decisions 2026-10-06). `pnpm sim:progression` shows the pace day by day.
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
- **Guaranteed home resources:** every home ring contains a Timber node, a Stone node, an **Emberwood** node and a farm plot (Treats), regardless of the ring's terrain, so a player can always fuel their Hearthfires and feed their squishies, however much land they lose. It also has two **seasonal** nodes (owner decision 2026-10-06): a **pumpkin patch** (Pumpkins, with Witch Dust) and a **leaf pile** (Magic Fallen Leaves). Each one only shows and gathers in its season (§15), so every kid can carve a Jack-o'-Lantern without map luck. Its middle spot stays reserved all year. Patches made before these nodes get them the next time the patch or a home is read, on a ring tile picked by the map seed; if a building stands in that tile's middle, it moves to a free spot beside it on the same tile, keeping everything.
- **Connected supply (Phase 2):** owned tiles must connect to the home base. After each capture, run BFS from the home base; unreached tiles become **stranded** and fade to neutral over **[DEFAULT: 36h]** unless reconnected.
- **Raid rules [DEFAULT]:** a tile can't be re-attacked for 4h after a battle on it; new players get a 48h protection shield; each player gets **[DEFAULT: 5]** attack attempts per map-local day (refills daily; owner decision 2026-10-06, was 10). Starting a tile battle (neutral or rival) uses an attempt and starts the tile cooldown; wild encounters and rescues don't use attempts. **Leaving** a battle means an explicit forfeit or no action for **[DEFAULT: 10 minutes]**, and counts as a loss. A dropped connection (app backgrounded, a phone call) resumes where it left off, because battle state lives on the server.
- **PvP mode (map owner setting) [DEFAULT: Gentle]:** families have kids of very different ages and schedules, so rivalry must never turn into one player farming another.
  - **On:** rival tiles can be challenged; a defender can lose at most **[DEFAULT: 3]** tiles per map-local day. Once a defender reaches the cap, challenges against them are blocked for the day (they don't use up attempts).
  - **Gentle (default):** as On, but a defender can lose at most **[DEFAULT: 1]** tile per map-local day, and challenging a player with far less territory (under **[DEFAULT: half]** of yours, home rings not counted) earns **[DEFAULT: 50%]** rewards, battle XP included (the result card shows the reduced XP).
  - **Off:** no player-vs-player challenges. Players race for neutral land and work together against the Hollow Man.
- **Land that misses you (owner decision 2026-10-06):** land is tended, not finished. Claiming a tile tends it, and **Visit** tends all of a player's land at once. Land untended for **[DEFAULT: 4 days]** starts to fade and its owner sees "Some land misses you!". Land untended for **[DEFAULT: 12 days]** can go wild again at nightfall: it turns neutral and its guardians come back, at most **[DEFAULT: 2]** of a player's tiles a night in Gentle (**[DEFAULT: 3]** in On and Off), farthest from home first. The home ring and the ring right outside it (**[DEFAULT: 2 tiles]** from the Heart Seed) never fade, so a week away never costs land and a returning player always has a home patch. Only the owner sees their own land fading. `pnpm sim:map-fill` models it.
- Hearthfire safe radii are measured in hex tiles (§14).

## 12. Resources

Resources vary by terrain, making certain tiles worth fighting over.

| Resource | Source | Use |
|---|---|---|
| Timber | Forest | Basic building |
| Stone | Hills, Stone nodes | Basic building |
| Emberwood | Old forest | Hearthfire fuel (nightly upkeep) |
| Glimmer | Mountains, caves | Hearthfire level 3, advanced habitats, decorations |
| Heartdust | Rescuing Hollowed squishies, events | Heart Snack (care), nurseries, evolution boosters (rare) |
| Treats | Grown on farm plots (the best way), or cooked from Greens at home (2 Greens → 3 Treats) (#238) | Feeding squishies, raising care |
| Water | A well on every lake (#238) | Moats; freezing into Ice; later, watering farm plots |
| Greens | Meadow land, worked by a squishy gatherer; a Greens spot on about 1 forest in 4 (#238) | Hedges and Bramble Hedges; cooking Treats |
| Ice | Mountain land, worked by a squishy gatherer, or 3 Water frozen at home (half the time with a Frost squishy on your team) (#238) | Ice Walls |

**Seasonal resources** (special uses, see §15): Pumpkins, Witch Dust, Magic Fallen Leaves, Turkey Feathers, Presents, Fireworks.

Gathering is timer-based (start a gather on an owned node; when it's done it goes straight into your bag), computed from timestamps.

**Recipe book.** Every craft recipe and every building you can put up has a page. A page opens the first time your account has collected everything it needs, on any patch, and stays open. The Heart Charm, the Hearthfire and both habitats are open from the start (the tutorial uses them). A sealed page can't be crafted or built yet and shows a short hint about where its missing pieces turn up (DECISIONS "Recipe book and unlocks"). One thing cooks at a time per patch; the book shows what's cooking with a countdown, and it pops into your bag when it's done.

**Squishy gatherers.** The Keeper still gathers by hand. On top of that, each squishy given the gatherer job works one more tile of the player's land **on its own, again and again**, until it's moved: a node, or **owned territory** outside the home base, which yields its terrain's **primary resource** (meadow → Greens, forest → Timber, old forest → Emberwood, hills → Stone, mountains → Ice, lake → Water, pumpkin fields → Pumpkins in season; `JOB_RULES.terrainYields`, **[DEFAULT]**). Gather spots are the rarer **secondary** (Glimmer and Stone on mountains, Greens on some forests), and a spot wins on its tile. Treats are cooked from Greens or grown on farm plots (the nesting economy, owner decision on #238). More squishies and more land mean more resources, which is why capturing squishies and holding territory both matter.

- One gatherer per tile, one job per squishy. A squishy's gather takes about **[DEFAULT: twice]** the Keeper's time per cycle; finished cycles go into the bag by themselves; if nobody visits, up to **[DEFAULT: 4]** wait, then it naps until you're back.
- **Matches gather faster**, like the habitat match (§7): a squishy whose element (or a Halloween squishy, for Pumpkins) matches the resource is 1.35× as quick, and 1.75× when its feeling matches too (Leaf/Brave → Timber, Stone/Sleepy → Stone, Fire/Cozy → Emberwood, Light or Spark/Joy → Glimmer, Water/Silly → Water, Leaf/Cozy → Greens, Frost/Sleepy → Ice, Shadow or Halloween/Spooky → Pumpkins; **[DEFAULT]**). The job board shows each squishy's best jobs: "Great at gathering Timber 🌲", "Strong fighter 💪".
- Taking a gatherer off its tile puts what it had ready in the bag; a half-done gather is let go. If its land changes hands, what it finished before then still goes in the bag; the unfinished cycle is lost, as with the Keeper's own gathers.
- **Night risk:** a gatherer spends the night on its tile, so outside a lit Hearthfire's safe radius it's exposed to the Hollow Man like any squishy outside the firelight (§14). The job board warns before assigning.

## 13. Home base and buildings

The home base is where squishies live, train, play, breed and hang out to be admired.

- **The Heart Seed keeps home safe (owner decision 2026-10-07).** Every home tile is always safe at nightfall, fire or no fire; it's the ultimate, permanent hearthfire.
- **Hearthfire:** stands only on **captured land** (an owned tile outside the home base), **one per tile, in the tile's middle**; a tile whose middle holds a resource can't take one, but a fire next door reaches it. It projects a safe radius (in tiles) against the Hollow Man, burns one night of Emberwood at each nightfall and stores several nights of fuel (§14). It's built, fuelled, upgraded and taken down from that tile's panel on the map; **Fuel all fires** on the home screen tops up every fire on your land in one tap, the lowest first, a night at a time, as far as the bag goes. The home build sheet says where fires go. A fire on land you lose (a rival wins it, it goes wild, or you leave the patch) comes down and gives back what taking it down would (half of what it cost, upgrades included) plus all its unburned fuel, with a line in the Challenge report or the welcome-back card. Fires that stood at home before this rule packed up and gave back **everything** spent on them, unburned fuel included, with a one-time note on the morning report (owner decision 2026-10-07).
- **Habitats:** tagged by element/feeling (e.g. Frost Grotto, Cozy Meadow, Ember Den, Glimmer Cave). Each has capacity. Matching squishies get the habitat multiplier. A housed squishy can't stand watch on a tile (§14).
- **Training Grounds:** passive XP trickle for assigned squishies (small): a **Train** job on the job board, **[DEFAULT: 5 XP an hour, room for 2]** (level 2: 8 an hour, room for 3), at most **[DEFAULT: 24 h]** waiting, landing by itself like gathered things. Plain XP: no care bonus, and it isn't a battle win, so the daily battle-XP falloff doesn't apply. A trainee sleeps at home, so it's always safe (owner decisions 2026-10-06 and 2026-10-07).
- **Play areas and decorations:** raise Harmony (Phase 3) and give squishies cute idle behavior.
- **Nursery** (Phase 3), **Noise buildings** (bells, drums, squishy choir) for extra Hollow Man deterrence.
- Home buildings are placed on a grid within home-base tiles, on **typed spots** (#204): a tile's middle is its centre spot (the Heart Seed, a resource node, or a centre building such as a Hearthfire on land), and habitats and Training Grounds go on the six ring spots around it. Upgrade levels increase capacity/radius. **Upgrade** on a building's card pays the next level's cost and raises it at once: Hearthfire level 2 reaches 2 tiles, level 3 reaches 3 and needs Glimmer; habitats and Training Grounds get more room. Taking one down gives back half of everything spent on it, upgrades included.

## 14. The Hollow Man

The shared threat and the heart of the lore. Tall, flickering silhouette with glowing eyes — spooky, never gory. Strongest in October.

**His rules → mechanics**

- **"He only needs one."** Each night at **nightfall [DEFAULT: 9:00 PM in the map's time zone]** a server job runs per map. For each player, if any squishies are **exposed**, he takes **one** of them, picked by a seeded roll the player can't see. Tutorial maps take nothing. If the server was down, only the latest missed night runs, and a map's first night is the first nightfall after its first member joined (that's when the map starts running; each player's own grace is below).
- **"…but never your last friend."** He never takes a player's last active squishy (one that isn't already in the Hollow, wherever it sleeps), so a player always has someone to play with and to go and rescue the others. The morning report still says he came by (owner decision 2026-10-05).
- **First-night grace [DEFAULT: 2 nightfalls]:** he skips a player for their first 2 nightfalls after joining a patch, so someone who joins at 8:55 PM with no fire yet loses nothing. A cozy hint tells them to light a fire when one of their gatherers or guards would spend the night out in the dark.
- **Exposure:** a squishy spends the night in its habitat's tile, or at its owner's Heart Seed if it has no habitat; a gatherer (§12) spends it on the tile it works, and a guard on the tile it stands watch on. Home tiles are always safe (the Heart Seed, §13). Any other tile is exposed if it's outside every lit Hearthfire's safe radius (noise coverage joins in once noise buildings exist), or if the fire there has gone out. So only a gatherer or a guard out on dark land can be taken.
- **Defenders stand watch, in the firelight (owner decision 2026-10-07, superseding "guards are safe on watch"):** squishies stationed to defend an owned tile are on watch, and a guard needs a lit Hearthfire's reach like a gatherer does: on a tile no lit fire reaches, it's exposed. A guard taken to the Hollow leaves the watch that same nightfall, and its tile falls back to its land's guardians, as with any guard that can't stand watch. The tile panel warns before a guard stands in the dark ("It's dark here at night. Build a fire nearby to keep your guard safe! 🔥"), and the "light a fire" nudge counts guards too. A squishy on watch isn't housed in a habitat, and a housed one isn't on watch. Holding territory never has to cost a squishy, so the Hollow Man stays a planning challenge (light fires on your land, keep guards and gatherers inside their light), not a daily loss.
- **"Keep the fire lit."** Hearthfires store up to **[DEFAULT: 5 nights]** of Emberwood. At each nightfall: if the fire has fuel for tonight, it burns one night's worth and protects tonight; otherwise it goes out. Stocking up teaches planning ahead: an active player tops up in seconds, and a player who misses a few days comes back to a fire that's still lit. The fire shows its remaining nights clearly (e.g. "3 nights left").
- **Absence is not punished (pillar 2).** Squishies at home are always safe, however long the player is away; only a gatherer or guard the player sent out onto land past the firelight can be taken. If a player is away longer than their stored fuel lasts, fires on their land go out and gatherers and guards there become exposed. Taken squishies can always be rescued.
- **Repelled by noise.** Noise buildings extend protection.
- **Repelled by family love.** (Phase 2) Warmth between players with nearby territories reduces his reach.
- **"Never look too long."** (Phase 2 polish) Keeping the camera locked on him when he appears makes nearby squishies start to drift toward him.
- **Hollowed squishies** turn grey and are taken to **the Hollow** (entrance in Juniper's Gap). They are **never permanently lost**: a player rescues them via a rescue expedition (a special battle against shadow guardians, sized just under the player's strongest squishy, drawn as the Nookling shape in a dark lavender, softly glowing tint; if every squishy is in the Hollow, the one being rescued fights), started from anywhere: the Hollow's entrance is in Juniper's Gap, but reaching it doesn't require owning nearby land. Rescue rewards Heartdust, capped at **[DEFAULT: 1]** rescue reward per player per day so exposing squishies on purpose isn't a farm.
- Morning summary: "The Hollow Man visited last night…" shown on next login, covering the last 3 nights (push notification in Phase 3).

## 15. Seasons

Seasons are date windows in config (with time zone). Resource nodes, recipes, spawn tables and evolution branches carry an optional `season` tag. A dev-only date override lets any season be tested early.

**Windows may overlap** (New Year already overlaps Christmas). When two seasons are active, content tagged with either is available.

**Window format:** each season has a **recurring month-day window** (e.g. `10-01` to `11-02`, in the map's time zone) plus optional **per-year overrides** (e.g. `2026: 10-01 to 11-09`). A one-year change is a data edit that doesn't affect future years. A window whose end is earlier than its start (New Year, `12-31` to `01-02`) wraps into the next year; its per-year override is keyed by the start year.

**2026 launch:** the Halloween window is extended to **[DEFAULT: Nov 9, 2026]** via a 2026 override so the first playable gets a full Halloween run.

| Season | Window [DEFAULT] | Resources | Specials |
|---|---|---|---|
| Halloween | Oct 1 – Nov 2 (2026: Nov 9) | Pumpkins, Witch Dust | Jack-o'-Lantern Hearthfires (extra-bright, scare the Hollow Man); spooky squishies and evolutions; Hollow Man at full strength |
| Thanksgiving | Nov 3 – Nov 30 | Magic Fallen Leaves (the home leaf pile; a bonus on Timber gathers), Turkey Feathers | Cozy habitats; Harvest Feast tables (hosting another player = big warmth bonus) |
| Christmas / Winter | Dec 1 – Dec 31 | Presents | Presents open for random drops; gifting an unopened present doubles warmth; frosty squishies |
| New Year | Dec 31 – Jan 2 | Fireworks | Fireworks are noise (Hollow Man repellent); midnight countdown event |

**Rules:** presents are **earned only, never bought**, and each shows its possible contents. Leftover seasonal resources carry over as **keepsakes**; their special recipes only unlock during their season. A Jack-o'-Lantern Hearthfire already built keeps protecting after Halloween (radius 2).

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
- **Sharpness on iOS:** render at device pixel ratio capped around 2; FXAA; dynamic resolution scaling to hold frame rate instead of going blurry; KTX2 compressed textures; LODs; instancing.
- **UI:** vector icons (SVG) and SDF/vector fonts; touch-first, large tap targets, iOS safe areas.

## 20. Camera and views

- **Map view:** third-person, top-down (slight tilt), pan with one finger, pinch to zoom, smooth inertia.
- **Close-up interaction view:** tap a squishy and the camera swoops in face-to-face; background blurs (depth of field, only in this view); high-detail model swapped in. **The squishy is the star.**
  - Gestures: tap to boop, stroke to pet, drag a treat to feed, pinch to tickle → reactions (happy wiggle, blush, giggle, yawn) and care credit. Boop and tickle both count as **play**; stroke is **pet**; the treat is **feed** (§7). Each care action also has a visible button.
  - Idle personality animations reflect feeling (Silly spins, Sleepy nods off, Brave puffs up).
  - Dress-up accessories (shared Wardrobe, §23) and photo mode (Phase 2+).

## 21. Retention loops

- **Daily:** tend and feed squishies, refuel Hearthfires before nightfall, check the morning Hollow Man report, and see what your gatherers brought home.
- **Session:** capture tiles, battle, capture wild squishies, build and upgrade.
- **Long-term:** Keeper milestones and signature clothing (§24); complete the catalog (including seasonal and secret squishies), rare evolutions, hybrids, Lorebook pages.
- **Seasonal:** new squishies, resources and events every holiday; keepsakes build anticipation.
- **Social:** rivalry over territory; showing off outfits and titles; trades, gifts (squishies and clothing), feasts and joint defense against the Hollow Man.

## 22. Phased roadmap

**Phase 1 — Halloween first playable (by Oct 31, 2026):** accounts (family signup code); **opening cinematic and single-player tutorial (§25–26)**; create/join maps with codes and approval; hex map with home bases and adjacent-tile capture, with the map-owner PvP mode (On / Gentle / Off); 12–15 starter + 3–4 Halloween squishies (procedural vinyl style); elements, feelings and matrices; turn-based battles, capture; offline raid defense via stance AI; home base with Hearthfires and 1–2 habitats; Timber, Stone, Emberwood, Pumpkins, Witch Dust; care + close-up view; XP formula and simple evolution; the Hollow Man's nightly visit and simple rescue; quick messages and emoji; **Keeper selection and customization, Wardrobe with starter and Halloween clothing, found clothing, Keeper milestones with clothing rewards, Patch Coins and the Boutique**; installable PWA deployed to AWS Lightsail.

**Phase 2 — Thanksgiving:** live real-time battles (Colyseus rooms); trading and gifting (squishies and clothing); free text chat with filtering and parent controls; branching evolution; outposts and stranded tiles; Thanksgiving content; family-love and stare mechanics; dress-up.

**Phase 3 — Christmas:** breeding and hybrids; presents; Home Base Harmony; full Lorebook and chihuahua Easter eggs; web push notifications; New Year fireworks; passkeys.

## 23. Keepers and wardrobe

Every player is represented by a **Keeper**, a character drawn in the same soft vinyl-toy style as the squishies (§19): rounded, chibi-proportioned, glossy and playful. Squishies are still the stars, but your Keeper is how *you* show up in the world.

### Choosing a Keeper
- At signup, players **select a Keeper** from a roster of preset base characters **[DEFAULT: 12]** (8 at launch; 4 more with short styles, owner decision 2026-10-06) that vary in body shape, skin tone, face and hairstyle.
- Each base can then be tweaked: hair style (any base can wear any style; picking a base starts from its own), hair color, eye color, and a **[DEFAULT: 6]**-color palette for the starter outfit.
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
| Collector | Befriend 3 / 8 / 14 kinds of squishy with a Heart Charm; complete an element | Collector's Satchel → Rainbow Jacket |
| Evolution | Evolve 1 / 5 / 20 squishies; get a rare branch | Evolver's Goggles → Prism Boots |
| Caretaker | Pet/feed 100 / 500 / 2,000 times; keep 5 squishies at max contentment | Heart Mittens |
| Defender | Win 1 / 10 / 50 defenses (only on maps where PvP isn't Off); protect every squishy for 7 nights | Hearthkeeper Lantern → Ember Cloak |
| Rescuer | Rescue 1 / 10 Hollowed squishies | Brave Scarf → Lightbringer Wings |
| Friendship | (Phase 2) Gift 10 items; complete 10 fair trades | Friendship Bracelet → Matching outfit sets for both players |
| Seasonal | Complete each season's event goals | That season's legendary costume |
| Secret | Hidden conditions tied to the Lorebook (§16) | Secret items, never listed until found |

**Phase 1 built tracks: see DECISIONS #44** ("Keeper milestones (#44)"). The tiers above are examples; the built ones differ (for example Collector is 3 / 8 / 14, sized to the kinds Phase 1 has), and the Cozy Apron and Squishy Net stay found pieces.

- Each tier also grants a **title** shown on the profile card (e.g. "Keeper of the Gap", "Hollow Rescuer").
- A **Milestones screen** shows progress bars for visible tracks. Secret milestones show as "???" until earned.
- **Scope:** milestones and titles belong to the **account**. Progress from map play (territory, defenses) only counts on maps with at least **[DEFAULT: 2]** active members, so a solo second account can't farm them.
- **Implementation:** milestone definitions are data. Progress counters update server-side from game events (the same event stream used for Easter-egg triggers in §16). Rewards are granted exactly once, idempotently.

## 25. Opening cinematic: "The Great Scatter"

A short, skippable cinematic that every new player sees once, right after choosing their Keeper (§23) and before the tutorial (§26). It explains what happened to the world and **why** each core mechanic matters, so the tutorial feels like a story and not a manual.

**Format [DEFAULT]**
- **Length:** about 120–150 seconds, nine shots: the backstory, then "Your part" (what the player does), then the title.
- **In-engine, not video:** rendered live in Babylon.js using the same procedural squishies, terrain and the player's own Keeper. That keeps the download small and lets the final shot show *your* character.
- **Narration as captions** (large, rounded, readable for a 10-year-old) over music and sound effects. Each caption stays up long enough to read, and a tap advances early. Recorded voice-over can come later.
- **Skippable** after the first viewing (and by a long-press for impatient siblings), **replayable** from Settings.
- **Tone:** wonder first, a spooky-tense middle, then hope. The Hollow Man is a tall, thin, flickering silhouette with long reaching arms and glowing eyes that flare as he reaches (owner decision 2026-10-04, style guide §5); never gory or jump-scary, and he never rushes at the camera. Reduced motion drops the shake, the flicker and the flare.

**Shot list [DEFAULT script — edit freely]**

| # | Shot | What we see | Caption (narration) | Why it matters |
|---|---|---|---|---|
| 1 | **The Heartpatch** | Sweeping golden-hour flight over a glowing valley. Squishies bloom out of the ground like flowers when nearby squishies laugh. | "Long ago, every squishy was born in the Heartpatch — a glowing field where the world's joy took shape." | Establishes the world before the fall. |
| 2 | **Seasons of joy** | Quick dissolves: pumpkins glowing and spooky squishies popping up; leaf piles with cozy squishies; snowfall and frosty squishies. | "When the world celebrated, the magic surged — and new squishies bloomed with every season." | Sets up seasonal squishies. |
| 3 | **The Keepers of old** | Keepers tending Hearthfires; squishies playing, napping and growing into bigger, sparklier forms in cared-for meadows. | "Keepers tended the fires and cared for the squishies. Loved squishies grew… and changed into something wonderful." | Hearthfires, care, habitats and evolution. |
| 4 | **The Hollow Man** | Color drains from the edges of the frame. A tall, thin silhouette steps out of the trees, eyes glowing, and flickers. The music drops out. At the end his long arms start to lift. | "But one night, something hollow came. He had no joy of his own… so he wanted ours." | Introduces the threat. |
| 5 | **The Great Scatter** | He glides to the Heartpatch and reaches out with his long arms. The glow (joy) drifts out of every squishy as little warm lights into his hands; his eyes flare and a low rumble rises. The Heartpatch cracks with light and shatters into glowing Heart Seeds, with a short camera shake. A cold wind blows the lights and the squishies away across the land; a few turn grey and drift into the shadows. | "He pulled the joy right out of them…" "The Heartpatch shattered, and its Heart Seeds scattered." "A cold wind blew the squishies across the land." | How the Great Scatter happened; why squishies are wild, why some are Hollowed. |
| 6 | **The land today** | The map from above: patchy, washed-out, wild. One by one, old Hearthfires flicker out. Far away, a few other Heart Seeds glow. | "Now the land is wild, and the fires are going out. He still walks at night — and he only needs one." | Territory to reclaim; nightfall; other Keepers. |
| 7 | **Your Heart Seed** | A Heart Seed lands at the feet of **the player's own Keeper** and glows. | "But a Heart Seed has found you, Keeper." "Now it's your turn!" | The player's goal. |
| 8 | **Your part** (about 24 s, owner's playtest notes 2026-10-04) | Four quick beats with soft dissolves, the world still drained grey until the colour comes back: **plant** (the Keeper plants the seed and a Hearthfire comes up, lit); **claim** (from above, grey land turns colourful tile by tile round home, and squishies come back to it); **care** (a boop, a puff of hearts, and the squishy glows); **befriend** (a wild squishy, a Heart Charm toss, three wobbles, and it joins with a happy bounce). | "Plant your seed. Light a fire. Make a home." "Bring color back to the land, one patch at a time." "Care for your squishies…" "…and find new friends with a Heart Charm!" | Teaches the player's role: home, territory, care, collecting. |
| 9 | **Heartpatch** | The colourful home: the Keeper, the lit fire, and their squishies, new friend included. | (none) | Title card: **HEARTPATCH**. |

**Lore consistency:** reclaiming a tile visibly restores its color and brings squishies back to it (shot 8 shows exactly that). This is the in-world reason territory matters, and the map's art should show it (neutral and stranded tiles look a little washed-out; owned tiles are vivid).

## 26. Single-player tutorial: "The First Patch"

Every new player plays a short solo tutorial before joining or creating a multiplayer map, unless the operator has turned the tutorial gate off (see Rules below). It teaches every Phase 1 mechanic hands-on, in story order, with nothing to lose.

**Where:** a small private map, **the Tutorial Glade** [DEFAULT: hex radius 3, 37 tiles], hand-authored (not random) so every player gets the same, well-paced experience.

**Guide [DEFAULT]:** **Sprout**, the tiny glowing spirit of your Heart Seed. Sprout talks in short speech bubbles, points at things, and cheers you on. (The forest chihuahuas stay lore-only, §16.) Sprout appears again later for occasional tips.

**Steps [DEFAULT]** — each is a short goal with a highlighted target and one or two lines from Sprout:

1. **Plant your Heart Seed.** Tap the glowing spot → your home base grows from the ground with color spreading outward. *Teaches: home base can never be taken.*
2. **Gather.** Gather Timber from a nearby node; it pops into your bag when it's ready (tutorial timers take seconds, not minutes). *Teaches: resources and timers.*
3. **Your Heart Seed keeps you safe.** Sprout explains that the Heart Seed glows all night, so home is always safe, and that land past home gets dark (owner decision 2026-10-07; the fire itself comes after step 8). *Teaches: home is safe.*
4. **Meet a wild squishy.** A friendly wild squishy wanders up. **First battle** (scripted to be winnable) introduces moves and one clear example of element and feeling effectiveness ("Super cozy!").
5. **Capture it.** Use a Heart Charm (capture is guaranteed here). *Teaches: befriending.* Then the player meets their **Partner**: the starter pick from §4 (1 of 3), named by the player. Exact beats are #24's.
6. **Care for it.** The camera swoops into the **close-up view**: pet, boop and feed it. Sprout explains, simply, that happy squishies learn faster.
7. **Give it a home.** Build a habitat that matches its element or feeling and move it in. *Teaches: the right home helps it grow.*
8. **Claim your first territory.** Attack a neighboring tile, beat its guardian, and watch color return to the land. Sprout explains you can only claim land next to land you already hold, and that land brings resources and new squishies. Then **light a fire on your land**: build a Hearthfire in the new tile's middle and fuel it. *Teaches: fires keep squishies out on your land safe.*
9. **Defend.** A shadowy "echo" (not a real player) raids your new tile. Pick a **defense stance** and win. *Teaches: rivals can attack your tiles, but never your home base.*
10. **Nightfall.** The sky dims and the Hollow Man appears at the edge of the Glade. Home glows safe under the Heart Seed and the new fire lights the land past it. He hesitates at the light and fades away. Sprout explains the rules: keep the fire lit, he only needs one — and if he ever takes a squishy, you can always rescue it.
11. **Evolve.** One more battle gives your Partner enough XP to evolve. Big celebration moment. *Teaches: battles plus care plus a good home = growth.*
12. **Your first milestone.** Earn the **"First Patch"** milestone and the account-bound **Seedling Scarf**; open the Wardrobe and put it on.
13. **Graduation.** Sprout: "Other Keepers have Heart Seeds too…" The player chooses **Create a map** or **Enter an invite code**.

**Rules**
- Target length **[DEFAULT: 12–18 minutes]**. Progress is saved after every step; quitting resumes where you left off.
- Nothing can be lost in the tutorial. The Hollow Man can't take anything here.
- **Carry-over:** the Seedling Scarf and the "First Patch" milestone are account-level rewards. The Partner is not copied: it is stored on the account, and on every patch the player joins they pick 1 of 3 starters (§4) with their Partner's species pre-selected (DECISIONS "The First Patch (#24)").
- Players can skip the tutorial only after finishing it once (e.g. on a new device), and can replay it any time from Settings.
- **Tutorial gate is a server setting:** while the tutorial is still being built (and for testing), the operator can let new accounts create or join maps without finishing it. The multiplayer game never waits on the tutorial to be playable. A player who skipped it picks 1 of 3 starters from the starter list (§4) when they join a patch, like everyone else. The tutorial's last steps (Seedling Scarf in the Wardrobe, First Patch milestone) are built.
- Every step is reachable with one hand on an iPhone; text is short and large.

**Built as (#24; DECISIONS "The First Patch (#24)"):**
- The tutorial has 15 steps. Sprout's `welcome` comes first, and `name-partner` follows `befriend`.
- **Defend** is posting a guard: the step completes when a squishy goes on watch on the new tile. There is no echo raid and no stance pick.
- **Nightfall** is a scripted button ("Night falls"); the Hollow Man takes nothing. Moving a squishy into the firelight isn't a beat yet.
- A Glade friend (a level-5 Pebblesnooze) plays the first battle, and the Glade's wild squishies are the three starters.
