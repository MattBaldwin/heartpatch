# Plan: Clockwork Isle Wave 1

Plan for #874 (big feature, COORDINATOR §2). Written 2026-11-28 against `main` `64e8e03` (migrations through 0071). Owner goal: **Wave 1 playable by Dec 1, 2026**: power, one machine tier, rails, research bench, beacon, the isle map, isle-only tech squishies, a balance sim covering Spark and Parts, owner-approved mockups before every client PR. Every number marked **TUNE** is a guess that lives in data config with a `// TUNE:` comment.

Model rules (COORDINATOR §6): Fable wrote this plan; Opus codes every lane; a Fable reviewer joins the first full review of the contracts PR. Sonnet only for the mockup frames (no code).

## 0. Shape of the solution

Clockwork Isle is **a Wild Isle that you wire up**. It reuses the Wild Isle island generator, terrains, roads, bridges, reach-and-supply and the `works` building engine, and adds four things: a **wind map**, **lines** (wires and rails, a per-tile attribute like roads), **power as a reach rule**, and **research**. Squishies stay central: machines never gather (recommended answer to Q2); they turn what squishies and Keepers gather into better things, carry it home, and light the night.

- **A third patch type**: `clockwork-isle`, chosen at creation, never changed. `PATCH_TYPE_RULES['clockwork-isle'] = { excludedTerrains: ['lake'], travel: true, weather: false, power: true, rails: true, research: true }`. The three new flags turn into `PatchRules.power | rails | research` (rule objects or `null`), exactly as `travel` and `weather` do today. Cozy and Wild rows gain the three flags as `false`; `patchRules('cozy')` and `patchRules('wild-isle')` stay equal to today's values (pinned test).
- **Wind is terrain data from the seed.** The generator sets `tiles.wind` (1–3) on every land tile from a sub-seed, like `isle`. It is public (the client draws it), it is not the map seed, and it never changes. Windmills make Spark faster where wind is 3.
- **Spark is a bag resource, made and eaten by `works` buildings.** A Windmill is a `works` row that `makes` Spark; a machine is a `works` row that `eats` Spark (plus raw goods) and `makes` finished goods. The existing settle banks both lazily from `produced_since` timestamps. **No new production engine.** A new machine is a data row.
- **Power is a reach rule, not a flow simulation** (recommended answer to Q3, option 1). A building with `needsPower: true` works only while **wire-joined** to one of its owner's generators: a wire chain (tile lines of kind `wire`, up to `maxRun` tiles) or adjacency. `powerReach` is a pure shared BFS cloned from `canalReach`. Power changes are written as a timestamp (`buildings.unpowered_since`), refreshed in the same transaction as any line, placement or removal, so an unpowered machine's idle window is an exact interval and idle machines cost nothing.
- **Rails are roads with a different look and a Depot.** `tile_lines` of kind `rail` feed `supplyMap` as road spots with their own `reach` and `speedPercent`, so claiming along rails and gatherer speed-ups are free. A **Rail Depot** (new kind `depot`) lets rail-joined squishy gatherers deliver straight to the bag with a much higher waiting cap, banked in the settle transaction (the "atomic depot move").
- **Research is a timer.** A Research Bench runs one research node at a time per player per patch (`research_jobs`, `ready_at`), paying Parts and Spark up front; finishing marks the node known (`research_known`) and grants Blueprints to the bag. A building with `requiresResearch` is built only once that node is known; Tier 1 costs Blueprints.
- **Beacon = the `lights` kind** already on `main` (its doc comment names the Clockwork beacon), with `needsPower` and `glowNights` made optional (absent = every night). `safeRadius` 2 with no fuel, run on Spark.
- **Secrets stay server-side:** spawn tables (now with `patchTypes`), scrap-heap find odds, and the wind sub-seed derivation live behind `@heartpatch/shared/server` or in the generator; the client sees only `wind` values and public species.
- **Gate:** `HP_CLOCKWORK_ISLE = off | testers | on` (default off) + `HP_CLOCKWORK_ISLE_TESTERS`, a clone of `wild-isle-switch.ts`. `MyMapsResponse.canMakeClockworkIsle` (additive).

### Correction to the issue text
The issue says rails and wires are "edge features like roads and fences". On `main` only **fences** sit on hex edges; **roads are a per-tile attribute** (`tile_roads`) and bridges are `travel` buildings. Wires and rails follow the **road** pattern (one line of each kind per tile), because that is what `supplyMap`, the roads module and `RoadField` already know how to do. Edge wires would need a second reach algorithm and a second renderer in three days.

## 1. Wave 1 scope against the acceptance list

| Acceptance (umbrella) | Wave 1 | Cut to Wave 2 |
|---|---|---|
| Plan with waves, PR breakdown, contracts, owner questions | this document | revision after owner answers |
| Owner-approved mockups: isle map, power/rail overlay, three machines, two tech squishies | frames M1–M4 on the Mockup Board before C4, C5, C6 | — |
| Playable end to end on a fresh Clockwork patch: power, one machine tier, rails, research bench, beacon | Windmill (generator), Wire, Rail, Rail Depot, Research Bench, **Sorter** (the one machine), Clockwork Beacon; research tier 1 | tier 2 (Press, Observatory, Clock Tower, Greenhouse II, Repair Shop, Battery + Solar Pane), waterwheels, carts that move, gear-driven gatherer |
| Balance sim covers Spark and Parts | `pnpm sim:clockwork` | — |
| Tests: map determinism, power and supply rules, timestamp resolution, no-secrets-to-client, atomic depot moves | named per lane below | — |
| Tech squishies | 2 isle-only species (the mockup pair) | 4 more + the Mythic; catalog "isle only" filter; Tinkerer milestone track |
| Christmas tie-in | none built in (see Q1) | frosty garnish if the owner wants it |
| Weather on the isle | off (`weather: false`) | wind fronts that change windmill pace |

## 2. Contracts PR first (C0, Opus, target merged within ~6 h of plan OK)

Title `#874: Clockwork Isle contracts (patch type, wind, lines, power, research data)`. Everything is **expand-only and gated**; nothing changes for Cozy or Wild Isle. Branch after **#909 (Twinkle Lights)** merges, because both touch `schemas/data/buildings.ts` and `data/buildings.ts`; if #909 is not merged by then, merge `main` before regenerating the migration.

### Migration 0072 `clockwork_isle_contracts` (one migration for the whole wave)

| Change | Backfill | Rollback (previous image on the new schema) |
|---|---|---|
| `ALTER TYPE patch_type ADD VALUE 'clockwork-isle'` | none | old image never creates one (the gate refuses before the seed is drawn, like Wild Isle 0059) |
| `tiles.wind smallint NULL` (1–3, set at generation; null on Cozy and Wild) | none | ignored |
| `tile_lines (tile_id → tiles cascade, kind line_kind('wire','rail'), map_id, owner_user_id, level smallint 1..2, built_at, PK (tile_id, kind))` + fk `(map_id, owner_user_id)` → `map_members`, index `(map_id, owner_user_id)`; lock step **6c** (after `tile_roads` 6b) | none | ignored |
| `buildings.unpowered_since timestamptz NULL` (null = powered or needs no power) | none | ignored; a machine reads as working for the minutes until roll-forward (same class as `damaged_at`, harmless) |
| `research_jobs (id, map_id, user_id, building_id → buildings set null, node_id text, started_at, ready_at, claimed_at NULL)` + partial unique `(map_id, user_id) WHERE claimed_at IS NULL` (one going per player per patch) | none | ignored |
| `research_known (map_id, user_id, node_id, known_at, PK (map_id, user_id, node_id))` | none | ignored |

`migration-0072.test.ts` follows `migration-0071.test.ts`: expected statements present, CHECKs list every shared enum option, no destructive statements, apply-and-rollback under `DATABASE_URL`. Regenerate on the latest `main` before merge (TECH_SPEC §4).

### Shared types (zod sketches)

```ts
// patch-types/patch-type.ts
export const PatchTypeSchema = z.enum(['cozy', 'wild-isle', 'clockwork-isle']);
// data/patch-types.ts: PATCH_TYPE_RULES rows gain power/rails/research booleans;
// patch-types/index.ts: PatchRules gains power: PowerRules | null, rails: RailRules | null, research: ResearchRules | null

// schemas/data/power.ts  (values in data/power.ts, checked by checkPowerRules)
export const PowerRulesSchema = z.strictObject({
  model: z.enum(['wires', 'radius', 'none']),           // owner Q3; 'wires' recommended
  wire: z.strictObject({ cost: ResourceCostSchema, maxRun: z.number().int().min(1).max(12) }),
  radius: z.number().int().min(1).max(3),                // used only when model === 'radius'
  windPace: z.record(z.enum(['1', '2', '3']), z.number().int().positive()), // percent by tile wind
});

// schemas/data/rails.ts  (RailRulesSchema; values RAIL_RULES)
export const RailRulesSchema = z.strictObject({
  levels: z.array(z.strictObject({ cost: ResourceCostSchema, reach: z.number().int().min(1).max(6), speedPercent: z.number().int().positive() })).min(1),
  depot: z.strictObject({ waitingCycles: z.number().int().positive() }), // replaces JOB_RULES' 4 for rail-joined gatherers
});

// schemas/data/research.ts  (ResearchRulesSchema + the tree; values RESEARCH_TREE)
export const ResearchNodeSchema = z.strictObject({
  id: ContentIdSchema, tier: z.number().int().min(1).max(3), name: z.string(), description: z.string(),
  cost: ResourceCostSchema, seconds: z.number().int().positive(),
  requires: z.array(ContentIdSchema).default([]),
  grants: ResourceCostSchema,                           // Blueprints into the bag
});
export const ResearchRulesSchema = z.strictObject({ nodes: z.array(ResearchNodeSchema).min(1), oneAtATime: z.literal(true) });
// checkResearchTree: ids unique, requires exist and point to a lower tier, every `requiresResearch` on a building names a node

// schemas/data/buildings.ts (additive on buildingBase)
needsPower: z.literal(true).optional(),
requiresResearch: ContentIdSchema.optional(),
// WorksBuildingSchema: wind?: z.literal(true).optional()  (pace follows PowerRules.windPace at the tile's wind)
// LightsBuildingSchema: glowNights becomes .optional() (absent = every night); refine keeps uniqueness when present
// new kinds: DepotBuildingSchema { kind: 'depot', levels: levels({ waitingCycles }) },
//            ResearchBuildingSchema { kind: 'research', levels: levels({ pacePercent }) }
export const CLOCKWORK_BUILDING_KINDS = ['depot', 'research'] as const; // plus works/lights rows with patchTypes ['clockwork-isle']
// checkGameData: every row with patchTypes ['clockwork-isle'] is a works, lights, depot or research row; needsPower only on clockwork rows
// schemas/buildings.ts BuildingKindSchema (DB rows) gains 'depot', 'research'; PublicBuildingSchema gains unpowered?: true, research?: { nodeId, readyAt }

// schemas/lines.ts
export const LineKindSchema = z.enum(['wire', 'rail']);
export const LineRequestSchema = z.strictObject({ q, r, kind: LineKindSchema });
export const PublicLineSchema = z.strictObject({ q, r, kind: LineKindSchema, ownerUserId, level, powered: z.boolean().optional() /* wires only */ });
export const LinesViewSchema = z.strictObject({ lines: z.array(PublicLineSchema) });
export const LineTileResponseSchema = /* mirrors RoadTileResponseSchema */;

// schemas/research.ts
export const StartResearchRequestSchema = z.strictObject({ buildingId: z.uuid(), nodeId: ContentIdSchema });
export const ResearchViewSchema = z.strictObject({ known: z.array(ContentIdSchema), going: z.object({ nodeId, startedAt, readyAt }).nullable(), serverTime });

// schemas/maps.ts: PublicTileSchema.wind: z.number().int().min(1).max(3).optional(); MyMapsResponseSchema.canMakeClockworkIsle: z.boolean().optional()
// schemas/data/map-gen.ts: MapGenSchema.clockworkIsle: WildIsleMapGenSchema.extend({ wind: { smoothing, coastBonus, hillBonus }, scrapHeaps: { perHome, minFromSeed } }).optional()
// schemas/data/spawn-tables.ts (server-only): SpawnTableSchema.patchTypes: z.array(PatchTypeSchema).min(1).optional()  (absent = every patch type, today's behaviour)
```

- **Resources** (`data/resources.ts`): `spark` (kind `crafted`, "Fizzy power in a jar. Windmills make it."), `parts` (kind `gathered`, `gather { seconds: 1800, quantity: 2 }` **TUNE**, from Scrap Heap nodes), `blueprints` (kind `crafted`, "A clever drawing. Unlocks a new build."). Each gets `TRADE_VALUES` and `SELL_RULES` rows **TUNE**, recipe-book hints, and passes the "way in and way out" test (Spark: windmill in, Sorter and research out; Parts: nodes and explore finds in, builds and research out; Blueprints: research in, Tier 1 builds and selling out).
- **Events** (`schemas/events.ts`, registered now even where the writer comes later): `line.built`, `line.upgraded`, `line.removed` (public: who, tile, kind, level; cost internal); `building.powered`, `building.unpowered` (public: whose, tile); `research.started` (owner only), `research.done` (public: who, node); `tile.rewilded.cause` unchanged; `map.created.patchType` already carries the type.
- **`ItemChangeReason`** + `line`, `line-refund`, `research`, `research-grant`, `depot`.
- **Errors:** no new codes. Unpowered, cut-off, wrong-patch and unknown-research refusals are `FORBIDDEN` or `CONFLICT` with kid text (§7).
- **Env:** `HP_CLOCKWORK_ISLE`, `HP_CLOCKWORK_ISLE_TESTERS` in `config.ts`; `modules/maps/clockwork-isle-switch.ts`; the create path accepts `clockwork-isle` behind the gate and requires a `mapGen.clockworkIsle` layout for `maxPlayers` (about ten lines at `maps/service.ts:414`; **not** the `view` block, which #910 and the 2c tree lane own).
- **Client rows the pinned tests demand** and nothing else: `PATCH_NAMES['clockwork-isle']` in `buildings-guide-model.ts`; `arena-config`/`map-config` need no rows (no new terrain).
- **C0 owns:** `packages/shared/src/{patch-types,schemas,data,hex}` (new files `schemas/data/{power,rails,research}.ts`, `schemas/{lines,research}.ts`, `data/{power,rails,research}.ts`; edits to `patch-types.ts`, `buildings.ts`, `resources.ts`, `trading.ts`, `recipe-book.ts`, `events.ts`, `inventory.ts`, `maps.ts`, `map-gen.ts`, `spawn-tables.ts`), `apps/server/src/db/schema.ts` + migration 0072 + its test, `apps/server/src/config.ts`, `modules/maps/clockwork-isle-switch.ts` (new) and the create branch in `maps/service.ts`, `maps/repo.ts` (`wind` insert). **Must not change:** `maps/service.ts` `view`, `milestones.ts`, anything under `boss/`, `advent/`, `christmas.ts`.
- **C0 tests:** `patch-types.test.ts` (options are the three; cozy and wild rules equal today's; a `CreateMapRequest` rejects `'volcano'`), `checkPowerRules`/`checkRailRules`/`checkResearchTree`, `checkGameData` on every clockwork row, `content.test.ts` ways in/out for the three resources, events registry, `server-data-boundary.test.ts` (spawn-table `patchTypes` never reaches the root entry), `maps.test.ts` (gate off → `FORBIDDEN`; testers list; cozy default unchanged; `canMakeClockworkIsle`), migration test. **Battle content hash is unchanged** by C0 (no species, no battle items).

## 3. Parallel lanes after C0

All lanes are Opus. "Owns" is the lane's file set; no two lanes touch the same file. Every client lane needs its Mockup Board frames approved before its PR opens (frames in §3.1). Captures go to `captures-874-clockwork/<lane>-<sha>/`, render-checked by an Opus helper before the owner sees them.

| Lane | Title | Depends on | Owns | Must not change | Mockup | Tests |
|---|---|---|---|---|---|---|
| **C1** | `#874: Clockwork Isle map generator (wind and scrap heaps)` | C0 | `packages/shared/src/mapgen/clockwork-isle.ts` (new; calls `generateWildIsle` with the `clockworkIsle` layout, then `windMap(seed)` and scrap-heap extra nodes), the `clockworkIsle` branch in `mapgen/index.ts`, `data/map-gen.ts` `clockworkIsle` block (radius 18, 2 rivers, no offshore isles **TUNE**), `apps/client/src/map/test-view.ts` `testClockworkIsle()` | `wild-isle.ts`, Cozy generator | none | `clockwork-isle.test.ts`: identical map for the same seed; pinned hash for `'pinned-seed'`; every land tile has `wind` 1–3 and ~15/50/35 % split **TUNE**; ≥ 1 scrap heap within 3 steps of every Heart Seed; Cozy and Wild pinned hashes unchanged |
| **C2** | `#874: wires, rails, power and the Rail Depot (server)` | C0 | `packages/shared/src/territory/power.ts` (`powerReach`, `poweredSet`), `territory/rails.ts` (rail spots → `supplyMap` inputs), `apps/server/src/modules/lines/` (new: routes `GET /maps/:id/lines`, `POST /maps/:id/lines`, `/lines/upgrade`, `/lines/remove`; `refreshPower`; take-down on lost land), `territory/supply.ts` (`supplyInputs` adds rails), `jobs/work.ts` (rail speed-up; depot waiting cap), `buildings/production.ts` (`canWorkAt` subtracts unpowered intervals), `buildings/settle-production.ts`, `settle/service.ts` depot banking | `buildings/service.ts` (C3's), `maps/service.ts`, `roads/` | none | `power.test.ts`: wire chain up to `maxRun`, adjacency counts, another owner's generator doesn't, model `radius` and `none` branches; `lines.test.ts`: Cozy and Wild → `NOT_FOUND`, lay/raise/remove with refunds, cut-off refusal, one wire and one rail may share a tile, lost land takes lines down; `supply`: claims reach along rails by level, Cozy `attackTargetProblem` unchanged for every tile of a generated cozy map; `production`: a machine unpowered at T1 and repowered at T2 banks exactly the powered minutes; **depot**: rail-joined gatherer banks past 4 cycles up to `waitingCycles`, in one transaction (a failing second grant rolls everything back), unjoined gatherer still naps at 4; `lock-order.test.ts` 6c |
| **C3** | `#874: the Research Bench (server)` | C0 | `packages/shared/src/research/` (`researchGateProblem`, `nextNodes`, `researchReadyAt`), `apps/server/src/modules/research/` (new: `GET /maps/:id/research`, `POST /maps/:id/research` start, `POST /maps/:id/research/claim`; settle hook claims a ready job lazily on read), the `requiresResearch` check in `buildings/service.ts` `place` (one call) and `PublicBuilding.research` in `buildings/repo.ts` | `production.ts`, `settle-production.ts`, `lines/` | none | `research.test.ts`: Cozy → `NOT_FOUND`; start pays Parts + Spark, one going per player per patch (`CONFLICT`), `ready_at` from node seconds × bench pace, claim before ready → `CONFLICT`, ready job claimed lazily on `GET` grants Blueprints once (idempotent across settle and read), `requires` enforced; `buildings.test.ts`: Sorter refused until `sorting` is known, kid text; secrets: the view never carries another player's `known` |
| **C4** | `#874: choose a Clockwork Isle; the isle map with wind, wires and rails` | C0, C1 (test view) | `apps/client/src/ui/lobby/patch-types.ts` + `lobby-overlay.ts` card (⚙️ "Clockwork Isle: wind, wires and workshops. For clever Keepers!"), `apps/client/src/lines/` (new: `line-feed.ts`, `line-field.ts` thin-instanced wire posts and rail sleepers reusing `road-layout.ts` join masks, `line-model.ts` `LINE_TEXT`, build sources for Wire and Rail, `line-api.ts`), `apps/client/src/map/wind-layer.ts` (new: one instanced arrow mesh, wind strength as tint, drifting in the shader off the terrain clock), `map-scene.ts` hook lines, `main.ts` source registration, `tests/e2e/lobby.spec.ts`, `map.spec.ts` `CLOCKWORK_BUDGET` | `procedural/buildings/**`, `works/**`, `research/**` | **M1 isle map, M2 power/rail overlay** | lobby e2e: card hidden with the gate off, shown and creates with `patchType: 'clockwork-isle'`; `line-layout` masks; render-budget e2e on `/island.html?patch=clockwork` (draw calls ≤ 88 **TUNE**, Cozy 75 and Wild 82 unchanged); text table scan |
| **C5** | `#874: windmill, sorter, depot, bench and beacon on the map and in the Build sheet` | C0, C2, C3 (APIs), #909 merged | `apps/client/src/procedural/buildings/building-models.ts` (new cases: `windmill`, `sorter`, `rail-depot`, `research-bench`, `clockwork-beacon`), `building-config.ts` rows, `apps/client/src/map/blade-field.ts` (new: windmill blades as one thin-instanced mesh rotated in the vertex shader from the terrain clock, speed by `wind`; still under reduced motion), `apps/client/src/works/` clockwork cards (unpowered badge "Needs a wire to a Windmill ⚡", wind chip), `apps/client/src/research/` (new: bench sheet, node cards, countdown), `buildings-guide-model.ts` rows | `lines/**`, `map/wind-layer.ts`, `lobby/**` | **M3 three machines** (Windmill L1/L2, Sorter, Depot with cart; lit/out/unpowered looks; Bench and Beacon in the same frame) | model tests (one look per id and level, triangle cap, blade count), card text scan, research sheet model tests, e2e: build a Windmill on a dev Clockwork homestead, wire a Sorter, see "unpowered" clear |
| **C6** | `#874: two tech squishies, isle spawn tables and the Clockwork balance sim` | C0, C1, #908 merged | `packages/shared/src/data/species-wave-3.ts` (new, 2 species) + spread in `species.ts`, `data/server/spawn-tables.ts` (clockwork tables with `patchTypes`), `apps/server/src/modules/spawns/` filter by the map's patch type, re-pins of the battle content hash in `schemas/christmas.test.ts` and `schemas/boss-bar.test.ts` (**only** in this lane, after #908), `packages/shared/scripts/sim/clockwork{,-config,-cli}.ts` + `sim:clockwork` scripts, `reports/sim/clockwork-report.md` | boss species, `species-wave-1/2.ts` | **M4 two tech squishies** | `species.test.ts` bands and avoided words; spawn tables reference real patch types and only clockwork tables name the new species; a Cozy and a Wild map never roll them (server test); sim guards: a casual kid builds a Windmill by day 3 and a Sorter by day 7, Spark never runs negative, Parts income ≥ Parts spend over 14 days, engaged kid's Beacon by day 10 **TUNE** |
| **C7** (coordinator) | `Chore: Clockwork Isle on` | all above, Dec 1 e2e | `.env.prod.example` / compose default `HP_CLOCKWORK_ISLE`, `changes/874-clockwork-isle.md`, `tests/e2e/clockwork.spec.ts` fresh-patch smoke (make a Clockwork Isle, see wind, lay a wire) | — | — | e2e smoke on iPhone viewport |

**Parallel plan:** C0 alone. Then **C1, C2, C3, C6** together (shared/server, disjoint files; C6's species data starts at once, its spawn filter and hash re-pin wait for #908). **C4** starts when C1 merges (its lobby card and line field can start against `testClockworkIsle()` in the lane's own branch of C1 if C1 is late, but it opens its PR after C1). **C5** starts when C2 and C3 merge; its models and the blade shader start as soon as M3 is approved, against mocked views. C7 after a fresh-patch e2e on Dec 1.

### 3.1 Mockup frames (before any client PR)

A Sonnet mockup lane starts the moment the plan is OK (it writes no code) and publishes frames to the Mockup Board, section "Clockwork Isle". The owner settles names here (Q4 and the species names).

| Frame | Shows | Unblocks |
|---|---|---|
| **M1 isle map** | far and zoomed iPhone 15 frames of the island: Wild Isle terrains, brass-and-wood town, wind tint (3 strengths) on land, night with a Beacon's warm cone, no dev HUD | C4 |
| **M2 power/rail overlay** | a wire chain from a Windmill to a Sorter (lit vs unlit wire), a rail line with sleepers from a far tile to a Depot with a cart, the Build sheet's Wire and Rail cards, the "Needs a wire" badge | C4, C5 |
| **M3 three machines** | Windmill L1 and L2 (blades, wind chip), Sorter (hopper, gears, soft steam), Rail Depot with cart; each lit / out / unpowered; Research Bench and Beacon beside them; vinyl-toy brass, copper, wood, wool (GAME_DESIGN §19) | C5 |
| **M4 two tech squishies** | Gearbit and Bulbun idle and in battle; part sheet (gear ears, bulb nose, wind-up key) | C6 |

## 4. Timeline to Dec 1 (UTC; the owner is in ET)

| When | Gate | What |
|---|---|---|
| Nov 28 ~04:00 | plan draft posted | this comment; owner questions out via supervisor 55 |
| Nov 28 ~06:00 | **G1 plan OK** (supervisor; owner answers may land later, see the fork table) | start **C0** (Opus) and the **mockup lane** (Sonnet) |
| Nov 28 ~12:00 | #909 merged (expected); C0 merges `main`, regenerates 0072 | |
| Nov 28 ~14:00 | **G2 contracts merged** (Opus + Fable review) | start **C1, C2, C3, C6** |
| Nov 29 ~02:00 | **G3 mockups M1–M4 OK** (owner, evening ET Nov 28) | C4 and C5 may open PRs once their server deps merge; names settled |
| Nov 29 ~16:00 | C1, C3, C6 merged; C2 merged (the biggest lane; split C2a lines + power / C2b rails + depot if it passes ~$20) | start **C4**, then **C5** when C2 and C3 are in |
| Nov 30 ~20:00 | **G4 lanes merged**; `pnpm sim:clockwork` report posted | C4, C5 captures render-checked and on the Board |
| Dec 1 ~02:00 | **G5 balance sim OK** (owner reads the report) | |
| Dec 1 ~14:00 | **G6 e2e on a fresh Clockwork patch** green; `HP_CLOCKWORK_ISLE=testers`, owner plays | C7 flips to `on` on the owner's word |

Slack is about half a day. If G2 slips past Nov 28 18:00, cut C6's species to data-only (no spawn filter) and move the Depot from C2 to Wave 2; the acceptance list still holds except "isle-only" spawns.

### Fork table (open owner questions; plan both branches, mark the fork)

| Q | Recommended | If the owner picks otherwise | What changes |
|---|---|---|---|
| 1 Christmas coupling | **(2) season-neutral.** The isle lands Dec 1, before Christmas, and kids play it over the holidays anyway. Coupling it to #37 lanes (maps `view`, boss, presents) multiplies collisions in the only three days we have. | (1) frosty headline | Wave 1 unchanged in code (Christmas snow already falls on every map via `season=christmas`); Wave 2 adds "winter wind" weather and a Workshop recipe for Presents. Names in the text tables may get a frosty edge at the mockup step. |
| 2 Automation depth | **(1) haul and sort only.** Machines eat Spark and raw goods and make finished goods; only squishies and Keepers gather. Keeps the care loop. | (2) machines gather commons | Wave 2 adds a `gear-gatherer` works row whose `makes` follows the tile's terrain yield at 50 % of a squishy's pace **TUNE**; needs one engine change in `production.ts` (terrain-keyed makes). Not in Wave 1 either way. |
| 3 Power model | **(1) wires.** Visible, plannable, reuses `canalReach`; the "aha" is connecting things. | (2) radius: `POWER_RULES.model = 'radius'`, C4 drops the Wire build card and `line-field` wires (rails stay); C2's `powerReach` takes the radius branch (both are in the data switch, so the contracts and tables don't change). (3) per-machine windmill: `model = 'none'`; `needsPower` means "owns a Windmill on the patch"; the Wire card is dropped. | C4 scope only; C0 and C2 are the same PRs. |
| 4 Name | **Clockwork Isle** (code id `clockwork-isle` is fixed now; the display name lives in text tables and can change at the mockup step). | Tinker Isle, Gearwild, other | text tables and `changes/` only |
| 5 Existing patches; three patches | **Existing patches stay exactly as they are** (the Wild Isle rule). **Yes to three patches**: there is no per-Keeper patch cap in code today, so nothing changes. | a cap of two | a cap would be a new `maps` rule, out of Wave 1 |

C0 does not wait for these answers: every C0 row is expand-only and gated, and the forks above change lane scope, not contracts.

## 5. Risks

- **Care-loop hollowing.** Machines never gather (Q2 (1)); the Sorter's input is what squishies gathered; Spark is made by a Windmill on *land squishies hold*; a gatherer on a rail-joined tile gets the Depot's higher cap, so more squishies at work means more hauled home. Wave 2 adds "happy squishies make machines run faster" (contentment → `pacePercent` bonus) once the sim shows the baseline.
- **Mobile performance.** No new terrain; wires, rails, blades and arrows are each one thin-instanced mesh with motion in the vertex shader off the existing terrain clock (the BulbField precedent), no per-frame JS; carts don't move in Wave 1. Budget `CLOCKWORK_BUDGET` draw calls ≤ 88 **TUNE** (Wild Isle is 82), checked in e2e on `/island.html?patch=clockwork`; low tier draws blades still; reduced motion stops them.
- **Secrets server-side.** Spawn tables with `patchTypes`, scrap-heap finds and the wind sub-seed derivation stay behind `@heartpatch/shared/server` or in the generator; `tiles.wind` is a public 1–3 value, never the seed. `server-data-boundary.test.ts` and `check-client-bundle.mjs` guard it; `maps.test.ts` keeps "never shows the seed".
- **Atomic depot moves.** Depot banking runs inside the settle transaction with `lockGrantRows` in owner-then-item order; the test forces a failing second grant and asserts nothing banked.
- **Collisions with running Christmas lanes.** `maps/service.ts`: #910 (X5a) edits the `view` block and the file's tail, the upcoming 2c tree lane will too; C0 touches only the create branch near line 414 and adds a new switch file, and merges `main` before regenerating. `milestones.ts`: #913 and XM own it; Wave 1 adds **no** milestone (Wave 2: a "Tinkerer" track). `schemas/data/buildings.ts`, `data/buildings.ts`, `building-models.ts`, `buildings-guide-model.ts`: #909 (2a) owns them now, so C0 and C5 branch after #909 merges. Battle content hash pins in `christmas.test.ts` and `boss-bar.test.ts`: #908 (X3) re-pins them; only C6 re-pins again, after #908.
- **Enum value added in the same release it's used.** `ALTER TYPE … ADD VALUE` is committed before any row uses it, and the gate (`off`) means no row exists until the operator flips it, the same as Wild Isle's 0059. Note it in the PR body.
- **Three days.** C2 is the lane most likely to hit the $20 cost stop; the brief should pre-authorize the C2a/C2b split. Every lane posts a `Lane handoff` on #874 if it stops short.

## 6. Data drafts (owner settles names at the mockup step; every number is TUNE)

### Buildings (all `patchTypes: ['clockwork-isle']`, `maxPerTile: 1`, `slot: 'ring'` unless noted)

| id | kind | placement | what it does | levels (cost → effect) |
|---|---|---|---|---|
| `windmill` | works, `wind: true` | `owned` (any owned tile; wind matters) | makes 4 Spark / h at wind 2; `windPace` 1: 75 %, 2: 100 %, 3: 150 % | L1 `{ timber: 12, stone: 6, parts: 4 }` pace 100 storage 24 h upkeep 0; L2 `{ timber: 24, stone: 12, parts: 10 }` pace 150 storage 48 h |
| `research-bench` | research | homestead | runs one research node at a time | L1 `{ timber: 10, stone: 8, parts: 6 }` pace 100; L2 `{ timber: 20, stone: 16, parts: 12, blueprints: 1 }` pace 150 |
| `rail-depot` | depot | homestead | rail-joined gatherers deliver straight to the bag | L1 `{ timber: 14, parts: 8 }` waitingCycles 12; L2 `{ timber: 28, parts: 16, blueprints: 1 }` waitingCycles 24 |
| `sorter` | works, `needsPower`, `requiresResearch: 'sorting'` | homestead | eats `{ spark: 1, greens: 2 }` → makes 3 Treats / 15 min (the pot recipe, hands-free) | L1 `{ timber: 8, parts: 10, blueprints: 1 }` pace 100 storage 24 h upkeep 0; L2 `{ timber: 16, parts: 20, blueprints: 2 }` pace 150 |
| `clockwork-beacon` | lights, `needsPower`, `requiresResearch: 'bright-bulbs'`, `safeRadius: 2`, every night | homestead | powered light the Hollow Man keeps away from, no fuel | L1 `{ stone: 10, glimmer: 1, parts: 12, blueprints: 2 }` |

Lines (`POWER_RULES.wire`, `RAIL_RULES.levels`): Wire `{ parts: 1 }` per tile, `maxRun` 6; Rail L1 `{ timber: 2, parts: 1 }` reach 2 speed 125 %; Rail L2 `{ timber: 4, stone: 2, parts: 2 }` reach 3 speed 150 %. Taking a line down gives back half, like roads.

### Research tree (tier 1 Wave 1, tier 2 Wave 2)

| id | tier | requires | cost | time | grants | unlocks |
|---|---|---|---|---|---|---|
| `sorting` | 1 | — | `{ parts: 6, spark: 4 }` | 2 h | `{ blueprints: 2 }` | Sorter |
| `bright-bulbs` | 1 | — | `{ parts: 8, spark: 6 }` | 3 h | `{ blueprints: 2 }` | Clockwork Beacon |
| `tidy-rails` | 1 | — | `{ parts: 6, spark: 2 }` | 2 h | `{ blueprints: 1 }` | Rail L2, Depot L2 |
| `pressing` | 2 | sorting | `{ parts: 14, spark: 10 }` | 6 h | `{ blueprints: 3 }` | Press (Greens → Pies without a Keeper) |
| `stargazing` | 2 | bright-bulbs | `{ parts: 16, spark: 12 }` | 8 h | `{ blueprints: 3 }` | Observatory |
| `clockwork-time` | 2 | tidy-rails | `{ parts: 16, spark: 12 }` | 8 h | `{ blueprints: 3 }` | Clock Tower |
| `warm-glass` | 2 | sorting | `{ parts: 12, spark: 8 }` | 6 h | `{ blueprints: 2 }` | Greenhouse II |
| `patching-up` | 2 | tidy-rails | `{ parts: 12, spark: 8 }` | 6 h | `{ blueprints: 2 }` | Repair Shop |
| `jars-of-light` | 2 | bright-bulbs | `{ parts: 18, spark: 14 }` | 10 h | `{ blueprints: 3 }` | Battery + Solar Pane |

### Species (6 isle-only + 1 Mythic; Wave 1 ships the first two)

| name (draft) | element / feeling | hook | rarity | wave |
|---|---|---|---|---|
| **Gearbit** | Spark / Joy | gear ears that spin when it's happy | Common | 1 |
| **Bulbun** | Light / Cozy | a bunny with a soft bulb nose that glows at dusk | Common | 1 |
| **Tickwhirl** | Spark / Silly | a wind-up key tail; it spins when tickled | Uncommon | 2 |
| **Coilcub** | Spark / Brave | spring legs, bounces onto rails | Uncommon | 2 |
| **Steamuffin** | Fire / Sleepy | puffs tiny soft steam clouds when it yawns | Rare | 2 |
| **Clinkaroo** | Stone / Spooky | a tin-can kangaroo that goes "clink" then giggles | Rare | 2 |
| **Grandfather Tock** | Spark / Cozy | the clock-tower owl; the isle's Mythic end-game, like the Forest Chihuahua (#341) | Mythic, secret | 2 |

Evolutions: Gearbit → Cogwhirl, Bulbun → Lanternbun (names pun-friendly, STYLE_GUIDE §4). Spawn tables: Gearbit on `meadow`/`hills` of a Clockwork Isle every day; Bulbun on `forest`/`coast` at `dusk` and `night` (terrain and time only; a Beacon lure is Wave 2).

## 7. Kid-facing text (STYLE_GUIDE)

- Patch card: ⚙️ **Clockwork Isle** — "Wind, wires and workshops. For clever Keepers!"
- Unpowered: "Needs a wire to a Windmill ⚡" · cut off: "Lay wires from land that's joined up to home!" · research going: "Tinkering… ready in 2h" · done: "Ta-da! New blueprints in your bag 📜" · Beacon: "The Beacon hums. The Hollow Man keeps his distance."
- No avoided words; "machine", "workshop", "tinker" are fine. `player-words.test.ts` scans every `*_TEXT` table.

## 8. Decisions to record (after merge, by the coordinator)

1. Clockwork Isle is a third `patch_type`, `clockwork-isle`, chosen at creation, never changed; behind `HP_CLOCKWORK_ISLE`.
2. Wires and rails are per-tile lines (`tile_lines`), not edge features; one of each kind per tile.
3. Power is a reach rule (`PowerRules.model`), Spark is a bag resource made and eaten by `works` rows; unpowered time is a timestamp.
4. Machines never gather in Wave 1; only squishies and Keepers do.
5. The Beacon is a `lights` row with `needsPower` and no `glowNights` (every night).
6. Wave 1 adds no milestone, no new terrain and no weather on the isle.
