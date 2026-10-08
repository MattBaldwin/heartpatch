import { z } from 'zod';
import { HexSchema } from '../hex/index.js';
import { ClothingDropSourceSchema } from './data/clothing.js';
import { ContentIdSchema } from './data/common.js';
import { PvpModeSchema } from './maps.js';
import { BattleEndReasonSchema, BattleKindSchema, BattleSideIdSchema } from './battle.js';
import { BuildingSpotSchema, PlacedBuildingSchema } from './buildings.js';
import { HexEdgeSchema, PlacedFenceSchema } from './fences.js';
import { MoodIdSchema } from './data/care.js';
import { ToolIdSchema } from './data/explore.js';
import { HollowStageSchema, WalkKindSchema } from './hollow-stage.js';
import { RaidOutcomeSchema } from './raids.js';
import { LocalDateSchema } from './time.js';

/**
 * The game-event type registry (tech spec §5, §7): every `game_events.type`,
 * with two schemas each.
 *
 * - `internal`: the stored `game_events.payload`. May hold server-only detail.
 *   `appendGameEvent` is typed against it and checks every payload with it.
 * - `public`: what live sync may send to the map's members. The server's
 *   `PUBLIC_VIEWS` (apps/server/src/ws/public-views.ts) is built from it, so
 *   every type here is broadcast through its public schema, never raw.
 *
 * Naming: `noun.verb-ed`, lower case (`member.joined`), matching the WebSocket
 * `type` (tech spec §5). Add a type when a module needs one; keep payloads
 * small (ids and coordinates, not whole rows).
 */
interface GameEventSchemas {
  internal: z.ZodType<Record<string, unknown>>;
  /**
   * A plain `z.object` (not strict, loose or a record): live sync parses the
   * stored payload with it, which strips every undeclared field.
   */
  public: z.ZodObject;
}

const MapSettingsSchema = z.strictObject({ pvpMode: PvpModeSchema });
const DepartedSchema = z.strictObject({
  userId: z.uuid(),
  /** Tiles that went back to neutral (their home base and any land they held). */
  releasedTiles: z.number().int().min(0),
});
const DepartedPublicSchema = z.object(DepartedSchema.shape);
const TutorialAdvancedSchema = z.strictObject({
  completedStepId: z.string(),
  stepId: z.string().nullable(),
});
/** A building as stored in an event payload (`PlacedBuilding`, strict). */
const PlacedBuildingStrictSchema = z.strictObject(PlacedBuildingSchema.shape);
/** A fence segment as stored in an event payload (`PlacedFence`, strict). */
const PlacedFenceStrictSchema = z.strictObject(PlacedFenceSchema.shape);
const BattleStartedSchema = z.strictObject({
  battleId: z.uuid(),
  kind: BattleKindSchema,
  userId: z.uuid(),
  /** The player's team and the other side, by species. */
  teamSpecies: z.array(z.string()),
  opponentSpecies: z.array(z.string()),
});
const BattleEndedSchema = z.strictObject({
  battleId: z.uuid(),
  kind: BattleKindSchema,
  userId: z.uuid(),
  /** The side the player controlled. */
  playerSide: BattleSideIdSchema,
  /** Null when the server ended it as no contest. */
  winner: z.union([BattleSideIdSchema, z.literal('draw')]).nullable(),
  reason: z.union([BattleEndReasonSchema, z.literal('no-contest')]),
  turns: z.number().int().min(0),
  /**
   * XP granted to the player's squishies: the battle's base XP × their care
   * and habitat multiplier (design doc §7, #19).
   */
  xp: z.array(z.strictObject({ squishyId: z.uuid(), xp: z.number().int().min(0) })),
});

const TileBattleKindSchema = z.enum(['tile', 'rival-tile']);
const coords = { q: z.number().int(), r: z.number().int() };

/** One Keeper's walk in `hollow.nightfall` (#277). */
const walkSchema = (object: typeof z.object | typeof z.strictObject) =>
  object({
    userId: z.uuid(),
    stage: HollowStageSchema,
    reclaimed: z.array(object(coords)),
    walk: z.array(object({ ...coords, kind: WalkKindSchema })),
  });

/** A find worth telling the patch about (#199): never which items or how many. */
export const ExploreNotableSchema = z.enum(['lore', 'cosmetic', 'heartdust']);
export type ExploreNotable = z.infer<typeof ExploreNotableSchema>;

export const GAME_EVENTS = {
  /** A player made a map and is its owner. Always seq 1. */
  'map.created': {
    internal: z.strictObject({
      name: z.string(),
      timeZone: z.string(),
      pvpMode: PvpModeSchema,
      maxPlayers: z.number().int(),
      /** The owner's home slot and Heart Seed tile. */
      homeSlot: z.number().int().min(0),
      heartSeed: HexSchema,
    }),
    public: z.object({ name: z.string(), pvpMode: PvpModeSchema }),
  },
  /** The owner changed a map setting. */
  'map.updated': { internal: MapSettingsSchema, public: z.object(MapSettingsSchema.shape) },
  /** The owner approved a join request; the player has a home base now. */
  'member.joined': {
    internal: z.strictObject({
      userId: z.uuid(),
      username: z.string(),
      homeSlot: z.number().int().min(0),
      heartSeed: HexSchema,
    }),
    public: z.object({
      userId: z.uuid(),
      username: z.string(),
      homeSlot: z.number().int().min(0),
      heartSeed: HexSchema,
    }),
  },
  /** A member left on their own. */
  'member.left': { internal: DepartedSchema, public: DepartedPublicSchema },
  /** The owner removed a member. */
  'member.removed': { internal: DepartedSchema, public: DepartedPublicSchema },
  /**
   * Tutorial maps only: the player tapped through a talk-only step (Sprout's
   * welcome, graduation). The step engine completes such a step on it.
   */
  'tutorial.acknowledged': {
    internal: z.strictObject({ stepId: z.string() }),
    public: z.object({ stepId: z.string() }),
  },
  /**
   * Tutorial maps only, written by the step engine (a system event): the
   * player finished `completedStepId`. `stepId` is the new current step, or
   * null when the tutorial is done.
   */
  'tutorial.advanced': {
    internal: TutorialAdvancedSchema,
    public: z.object(TutorialAdvancedSchema.shape),
  },
  /**
   * A player started a PvE battle on this map (#13). The species stay in the
   * internal payload: a secret one would otherwise reach members who never
   * met it (CLAUDE.md rule 6).
   */
  'battle.started': {
    internal: BattleStartedSchema,
    public: z.object({ battleId: z.uuid(), kind: BattleKindSchema, userId: z.uuid() }),
  },
  /**
   * A battle ended: won, lost, drawn, run away from, or called off by the
   * server (`no-contest`, when the content was re-tuned mid-battle).
   */
  'battle.ended': { internal: BattleEndedSchema, public: z.object(BattleEndedSchema.shape) },
  /**
   * A player befriended a wild squishy with a Heart Charm (#14). The species
   * stays internal, like `battle.started`'s: a secret one would otherwise
   * reach members who never met it (CLAUDE.md rule 6).
   */
  'squishy.captured': {
    internal: z.strictObject({
      battleId: z.uuid(),
      userId: z.uuid(),
      squishyId: z.uuid(),
      speciesId: ContentIdSchema,
      level: z.number().int().min(1),
    }),
    public: z.object({ userId: z.uuid(), squishyId: z.uuid() }),
  },
  /**
   * A player started gathering a node they own (#17): members see "gathering
   * here, ready at …" on the tile. What it will yield stays internal.
   */
  'gather.started': {
    internal: z.strictObject({
      gatherId: z.uuid(),
      userId: z.uuid(),
      q: z.number().int(),
      r: z.number().int(),
      resource: z.string(),
      readyAt: z.iso.datetime(),
    }),
    public: z.object({
      userId: z.uuid(),
      q: z.number().int(),
      r: z.number().int(),
      readyAt: z.iso.datetime(),
    }),
  },
  /**
   * A player collected a finished gather on a node they own (#17). Members
   * see where (the tile's "gathering here" ends); how much stays internal.
   */
  'resource.gathered': {
    internal: z.strictObject({
      gatherId: z.uuid(),
      userId: z.uuid(),
      q: z.number().int(),
      r: z.number().int(),
      resource: z.string(),
      items: z.record(z.string(), z.number().int().min(1)),
    }),
    public: z.object({
      userId: z.uuid(),
      q: z.number().int(),
      r: z.number().int(),
      resource: z.string(),
    }),
  },
  /** A player collected a finished craft into their bag (#17). */
  'item.crafted': {
    internal: z.strictObject({
      craftId: z.uuid(),
      userId: z.uuid(),
      recipeId: z.string(),
      items: z.record(z.string(), z.number().int().min(1)),
    }),
    public: z.object({ userId: z.uuid(), recipeId: z.string() }),
  },
  /**
   * A Crafting Factory batch started (#294): its inputs were paid, and it
   * finishes at `doneAt`. Only who and what is public.
   */
  'factory.started': {
    internal: z.strictObject({
      queueId: z.uuid(),
      userId: z.uuid(),
      recipeId: z.string(),
      total: z.number().int().min(1),
      doneAt: z.iso.datetime(),
    }),
    public: z.object({ userId: z.uuid(), recipeId: z.string() }),
  },
  /** Things a Factory batch made landed in the bag (#294): once per batch per settle. */
  'factory.crafted': {
    internal: z.strictObject({
      queueId: z.uuid(),
      userId: z.uuid(),
      recipeId: z.string(),
      count: z.number().int().min(1),
      items: z.record(z.string(), z.number().int().min(1)),
    }),
    public: z.object({ userId: z.uuid(), recipeId: z.string() }),
  },
  /**
   * A Factory batch stopped before it finished (#294): the kid stopped it,
   * took the Factory down, or left the patch. What was made was kept;
   * everything not finished came back (`refunded`).
   */
  'factory.stopped': {
    internal: z.strictObject({
      queueId: z.uuid(),
      userId: z.uuid(),
      recipeId: z.string(),
      kept: z.number().int().min(0),
      refunded: z.record(z.string(), z.number().int().min(1)),
      reason: z.enum(['stopped', 'taken-down', 'left']),
    }),
    public: z.object({ userId: z.uuid(), recipeId: z.string() }),
  },
  /**
   * A player started a battle for a tile (#15): a neutral tile's guardians
   * (`defenderUserId` null) or another player's land. It used one of their
   * daily attempts and put the tile on cooldown until `cooldownUntil`.
   * Members see who, where and the cooldown ("Someone challenged your
   * patch!"); the raid log (#16) reads the rest.
   */
  'tile.attacked': {
    internal: z.strictObject({
      attackId: z.uuid(),
      battleId: z.uuid(),
      kind: TileBattleKindSchema,
      attackerUserId: z.uuid(),
      defenderUserId: z.uuid().nullable(),
      ...coords,
      cooldownUntil: z.iso.datetime(),
    }),
    public: z.object({
      attackerUserId: z.uuid(),
      defenderUserId: z.uuid().nullable(),
      ...coords,
      cooldownUntil: z.iso.datetime(),
    }),
  },
  /**
   * A tile changed hands after a won tile battle (#15), in the battle's own
   * transaction: every member's map shows the new owner. Squishies that stood
   * watch there went home (`returnedSquishyIds`). Found clothing (#43) and
   * milestones (#44) read the internal payload; `rewardPercent` is the Gentle
   * mode share of capture rewards (decision B), 100 otherwise.
   */
  'tile.captured': {
    internal: z.strictObject({
      attackId: z.uuid(),
      battleId: z.uuid(),
      kind: TileBattleKindSchema,
      userId: z.uuid(),
      fromUserId: z.uuid().nullable(),
      ...coords,
      terrain: z.string(),
      rewardPercent: z.number().int().min(0).max(100),
      returnedSquishyIds: z.array(z.uuid()),
    }),
    public: z.object({ userId: z.uuid(), fromUserId: z.uuid().nullable(), ...coords }),
  },
  /**
   * Land that misses you (owner decision 2026-10-06, design review Q2): at a
   * nightfall, some of a player's long-untended land went wild again. The
   * tiles are neutral now and their guardians are back. Everyone sees which
   * tiles (land is public); guards on them went home.
   */
  'tile.rewilded': {
    internal: z.strictObject({
      userId: z.uuid(),
      night: LocalDateSchema,
      tiles: z.array(z.strictObject({ ...coords, terrain: z.string() })).min(1),
      returnedSquishyIds: z.array(z.uuid()),
      /** Why (#277): nobody tended it (#194, the default), or the Hollow Man won it back in the dark. */
      cause: z.enum(['untended', 'hollow']).optional(),
    }),
    public: z.object({
      userId: z.uuid(),
      night: LocalDateSchema,
      tiles: z.array(z.object(coords)),
      cause: z.enum(['untended', 'hollow']).optional(),
    }),
  },
  /**
   * Trading posts (#269) came to an older map: the boot pass turned these
   * neutral tiles into posts. New maps are made with theirs and write none.
   * Land is public, so members see the same.
   */
  'post.placed': {
    internal: z.strictObject({ tiles: z.array(z.strictObject(coords)).min(1) }),
    public: z.object({ tiles: z.array(z.object(coords)) }),
  },
  /**
   * A player set off on a journey to a trading post (#270). Only they hear it
   * (`ownerOnlyView`); everyone else already sees `battle.started`.
   */
  'journey.started': {
    internal: z.strictObject({
      userId: z.uuid(),
      journeyId: z.uuid(),
      battleId: z.uuid(),
      ...coords,
      distance: z.number().int().min(1),
      level: z.number().int().min(1),
      teamSize: z.number().int().min(1),
    }),
    public: z.object({
      userId: z.uuid(),
      ...coords,
      distance: z.number().int().min(1),
    }),
  },
  /**
   * A journey ended (#270): won (a visit pass until `visitUntil`), lost
   * (nothing lost but time) or called off as no contest. Only the player
   * hears it (`ownerOnlyView`).
   */
  'journey.ended': {
    internal: z.strictObject({
      userId: z.uuid(),
      journeyId: z.uuid(),
      battleId: z.uuid(),
      ...coords,
      result: z.enum(['won', 'lost', 'no-contest']),
      visitUntil: z.iso.datetime().nullable(),
    }),
    public: z.object({
      userId: z.uuid(),
      ...coords,
      result: z.enum(['won', 'lost', 'no-contest']),
      visitUntil: z.iso.datetime().nullable(),
    }),
  },
  /**
   * A player searched one spot on their own land (#199). One per search, so
   * the Seeker track can count them. What it found stays internal except a
   * `notable` find's kind (patch feed: "Lee found a lore page!"); `lorePage`
   * is the server-only page the lore consumer grants.
   */
  'explore.searched': {
    internal: z.strictObject({
      userId: z.uuid(),
      ...coords,
      terrain: z.string(),
      /** The search: the ledger and found-clothing `refId`. */
      searchId: z.uuid(),
      spot: z.number().int().min(0),
      kind: ContentIdSchema,
      tool: ToolIdSchema.nullable(),
      items: z.record(z.string(), z.number().int().min(1)),
      lorePage: ContentIdSchema.nullable(),
      notable: ExploreNotableSchema.nullable(),
    }),
    public: z.object({
      userId: z.uuid(),
      ...coords,
      kind: ContentIdSchema,
      notable: ExploreNotableSchema.nullable(),
    }),
  },
  /** A player searched every spot on one of their tiles (#199): it's fully explored ✨. */
  'tile.explored': {
    internal: z.strictObject({ userId: z.uuid(), ...coords, terrain: z.string() }),
    public: z.object({ userId: z.uuid(), ...coords, terrain: z.string() }),
  },
  /**
   * Fully explored land joined a player's home as homesteads (#199): it
   * borders their home ring or another of their homesteads.
   */
  'homestead.joined': {
    internal: z.strictObject({ userId: z.uuid(), tiles: z.array(z.strictObject(coords)).min(1) }),
    public: z.object({ userId: z.uuid(), tiles: z.array(z.object(coords)) }),
  },
  /** Homesteads cut off from home by a capture (#199): their gathering naps. */
  'homestead.paused': {
    internal: z.strictObject({ userId: z.uuid(), tiles: z.array(z.strictObject(coords)).min(1) }),
    public: z.object({ userId: z.uuid(), tiles: z.array(z.object(coords)) }),
  },
  /** Paused homesteads joined back up to home (#199). */
  'homestead.resumed': {
    internal: z.strictObject({ userId: z.uuid(), tiles: z.array(z.strictObject(coords)).min(1) }),
    public: z.object({ userId: z.uuid(), tiles: z.array(z.object(coords)) }),
  },
  /**
   * A player changed who stands watch on one of their tiles (#15). Members
   * see how many; which squishies stays internal.
   */
  'defenders.changed': {
    internal: z.strictObject({
      userId: z.uuid(),
      ...coords,
      count: z.number().int().min(0),
      squishyIds: z.array(z.uuid()),
    }),
    public: z.object({ userId: z.uuid(), ...coords, count: z.number().int().min(0) }),
  },
  /**
   * A challenge on a player's land finished and is in their raid log (#16),
   * written by the raid-log consumer after the battle's `battle.ended`.
   * Members see who, where and how it went (the tile events already showed
   * that much). The report itself is fetched when the defender opens the map.
   */
  'raid.resolved': {
    internal: z.strictObject({
      raidId: z.uuid(),
      battleId: z.uuid(),
      attackerUserId: z.uuid(),
      defenderUserId: z.uuid(),
      ...coords,
      outcome: RaidOutcomeSchema,
    }),
    public: z.object({
      raidId: z.uuid(),
      attackerUserId: z.uuid(),
      defenderUserId: z.uuid(),
      ...coords,
      outcome: RaidOutcomeSchema,
    }),
  },
  /**
   * A player put up a building on their home base (#18). Members see it on
   * the map (fires and habitats are public).
   */
  'building.placed': {
    internal: z.strictObject({
      userId: z.uuid(),
      building: PlacedBuildingStrictSchema,
      /** What it cost (internal: other players don't need the bill). */
      cost: z.record(z.string(), z.number().int().min(1)),
    }),
    public: z.object({ userId: z.uuid(), building: PlacedBuildingSchema }),
  },
  /** A player moved one of their buildings to another spot (#18). */
  'building.moved': {
    internal: z.strictObject({
      userId: z.uuid(),
      from: z.strictObject({ q: z.number().int(), r: z.number().int(), spot: BuildingSpotSchema }),
      building: PlacedBuildingStrictSchema,
    }),
    public: z.object({
      userId: z.uuid(),
      from: z.object({ q: z.number().int(), r: z.number().int(), spot: BuildingSpotSchema }),
      building: PlacedBuildingSchema,
    }),
  },
  /**
   * A player took a building down (#18), or it came down with the land
   * under it (#202, `lost`). Its residents moved out.
   */
  'building.removed': {
    internal: z.strictObject({
      userId: z.uuid(),
      buildingRowId: z.uuid(),
      buildingId: z.string(),
      q: z.number().int(),
      r: z.number().int(),
      refund: z.record(z.string(), z.number().int().min(1)),
      /** Squishies that lived there and moved out. */
      movedOut: z.array(z.uuid()),
      /**
       * Why it came down when its owner didn't take it down (#202): its land
       * was won by a rival (`captured`), went wild (`wild`), its owner left
       * the patch (`left`), or it was a fire at home, packed up when the
       * Heart Seed began keeping home safe (`packed`, owner decision 2026-10-07).
       */
      lost: z.enum(['captured', 'wild', 'left', 'packed']).optional(),
    }),
    public: z.object({
      userId: z.uuid(),
      buildingRowId: z.uuid(),
      q: z.number().int(),
      r: z.number().int(),
    }),
  },
  /**
   * A player added fuel to a Hearthfire (#18). Members see it light up; how
   * many nights it has stays internal.
   */
  'building.fueled': {
    internal: z.strictObject({
      userId: z.uuid(),
      building: PlacedBuildingStrictSchema,
      nights: z.number().int().min(1),
      fuelledThrough: LocalDateSchema,
    }),
    public: z.object({ userId: z.uuid(), building: PlacedBuildingSchema }),
  },
  /**
   * A player raised one of their buildings a level (owner decision
   * 2026-10-06): a fire's light reaches further, a habitat or Training
   * Grounds has more room. Members see the new level (and radius); the bill
   * stays internal.
   */
  'building.upgraded': {
    internal: z.strictObject({
      userId: z.uuid(),
      building: PlacedBuildingStrictSchema,
      fromLevel: z.number().int().min(1),
      cost: z.record(z.string(), z.number().int().min(1)),
    }),
    public: z.object({ userId: z.uuid(), building: PlacedBuildingSchema }),
  },
  /**
   * A player fenced edges of one of their tiles (#203): one event per
   * segment. Members see the fence on the map; the bill stays internal.
   */
  'fence.built': {
    internal: z.strictObject({
      userId: z.uuid(),
      fence: PlacedFenceStrictSchema,
      cost: z.record(z.string(), z.number().int().min(1)),
    }),
    public: z.object({ userId: z.uuid(), fence: PlacedFenceSchema }),
  },
  /** A player raised a fence segment a level (#203): more energy, tougher. */
  'fence.upgraded': {
    internal: z.strictObject({
      userId: z.uuid(),
      fence: PlacedFenceStrictSchema,
      fromLevel: z.number().int().min(1),
      cost: z.record(z.string(), z.number().int().min(1)),
    }),
    public: z.object({ userId: z.uuid(), fence: PlacedFenceSchema }),
  },
  /** A player mended a fence segment back to full energy (#203). */
  'fence.repaired': {
    internal: z.strictObject({
      userId: z.uuid(),
      fence: PlacedFenceStrictSchema,
      cost: z.record(z.string(), z.number().int().min(1)),
    }),
    public: z.object({ userId: z.uuid(), fence: PlacedFenceSchema }),
  },
  /**
   * A challenger fought a fence segment and it held (#203): it keeps the
   * energy it lost (owner decision 2026-10-07). `userId` is its owner. Who
   * challenged stays out of the public view (coordinator, #203); the owner's
   * Challenge report names them, as it does for any challenge.
   */
  'fence.damaged': {
    internal: z.strictObject({
      userId: z.uuid(),
      attackerUserId: z.uuid(),
      attackId: z.uuid(),
      battleId: z.uuid(),
      fence: PlacedFenceStrictSchema,
    }),
    public: z.object({ userId: z.uuid(), fence: PlacedFenceSchema }),
  },
  /**
   * A challenger broke a fence segment (#203): it's gone, with nothing back.
   * The land is still its owner's, or a rival's capture destroyed it with
   * the land (owner decision 2026-10-07). `userId` is its owner; who broke it
   * stays out of the public view, and the owner's Challenge report names them.
   */
  'fence.broken': {
    internal: z.strictObject({
      userId: z.uuid(),
      attackerUserId: z.uuid(),
      attackId: z.uuid(),
      battleId: z.uuid(),
      fenceId: z.uuid(),
      buildingId: ContentIdSchema,
      ...coords,
      edge: HexEdgeSchema,
    }),
    public: z.object({ userId: z.uuid(), fenceId: z.uuid(), ...coords, edge: HexEdgeSchema }),
  },
  /**
   * A fence segment came down (#203): its owner took it down for part of
   * its cost back, or it came down with land that went wild or a member who
   * left (`lost`, as buildings do in #202) and gave the same back. `inner`:
   * its owner captured the land beyond it, so it stood on an inner edge
   * (owner decision on #244); public, so their client can say so. A rival's
   * capture destroys the segments on the tile instead (`fence.broken`).
   */
  'fence.removed': {
    internal: z.strictObject({
      userId: z.uuid(),
      fenceId: z.uuid(),
      buildingId: ContentIdSchema,
      ...coords,
      edge: HexEdgeSchema,
      refund: z.record(z.string(), z.number().int().min(1)),
      lost: z.enum(['wild', 'left', 'inner']).optional(),
    }),
    public: z.object({
      userId: z.uuid(),
      fenceId: z.uuid(),
      ...coords,
      edge: HexEdgeSchema,
      lost: z.enum(['wild', 'left', 'inner']).optional(),
    }),
  },
  /** A squishy moved into a habitat, or out of one (`habitatId` null) (#18). */
  'squishy.housed': {
    internal: z.strictObject({
      userId: z.uuid(),
      squishyId: z.uuid(),
      habitatId: z.uuid().nullable(),
      /** The habitat it left, if it lived in one. */
      fromHabitatId: z.uuid().nullable(),
    }),
    public: z.object({
      userId: z.uuid(),
      squishyId: z.uuid(),
      habitatId: z.uuid().nullable(),
    }),
  },
  /**
   * A player cared for one of their squishies (#19): feed, pet or play.
   * Members see who, which action and the squishy's mood; the numbers stay
   * internal. `coins` is what it earned toward the daily care cap (#45 pays
   * Patch Coins out of these).
   */
  'squishy.cared': {
    internal: z.strictObject({
      userId: z.uuid(),
      squishyId: z.uuid(),
      action: ContentIdSchema,
      /** Contentment after the action, and what it added. */
      contentment: z.number().int().min(0).max(100),
      gained: z.number().int().min(0),
      full: z.boolean(),
      coins: z.number().int().min(0),
      /** The account-local day it counted toward. */
      day: LocalDateSchema,
      mood: MoodIdSchema,
    }),
    public: z.object({
      userId: z.uuid(),
      squishyId: z.uuid(),
      action: ContentIdSchema,
      mood: MoodIdSchema,
    }),
  },
  /** A squishy went up one or more levels (#19). */
  'squishy.leveled': {
    internal: z.strictObject({
      userId: z.uuid(),
      squishyId: z.uuid(),
      fromLevel: z.number().int().min(1),
      level: z.number().int().min(1),
      xp: z.number().int().min(0),
    }),
    public: z.object({ userId: z.uuid(), squishyId: z.uuid(), level: z.number().int().min(1) }),
  },
  /**
   * A squishy evolved into its next form (#19, design doc §8). The forms stay
   * internal: a secret form would otherwise reach members who never met it
   * (CLAUDE.md rule 6), as with `squishy.captured`.
   */
  'squishy.evolved': {
    internal: z.strictObject({
      userId: z.uuid(),
      squishyId: z.uuid(),
      fromSpeciesId: ContentIdSchema,
      intoSpeciesId: ContentIdSchema,
      level: z.number().int().min(1),
    }),
    public: z.object({ userId: z.uuid(), squishyId: z.uuid(), level: z.number().int().min(1) }),
  },
  /**
   * A player renamed one of their squishies (#20): the new nickname, or null
   * for the species name again. It passed the server's text filter. Other
   * players' squishy changes that aren't care, growth or housing can join
   * this type later as optional fields.
   */
  'squishy.updated': {
    internal: z.strictObject({
      userId: z.uuid(),
      squishyId: z.uuid(),
      nickname: z.string().nullable(),
      fromNickname: z.string().nullable(),
    }),
    public: z.object({ userId: z.uuid(), squishyId: z.uuid(), nickname: z.string().nullable() }),
  },
  /**
   * Night fell on the map (#21, design doc §14): the Hollow Man came by.
   * Every member sees who lost a squishy to the Hollow; which one stays
   * internal (the owner hears it from `squishy.hollowed`).
   */
  'hollow.nightfall': {
    internal: z.strictObject({
      /** The night, as the map-local date its nightfall falls on. */
      night: LocalDateSchema,
      taken: z.array(z.strictObject({ userId: z.uuid(), squishyId: z.uuid() })),
      /**
       * His walk along each Keeper's border (#277), played as a show from
       * nightfall: public, like land and fires (owner decision 2026-10-08
       * Q7). Optional: nights before #277 have none.
       */
      walks: z.array(walkSchema(z.strictObject)).optional(),
    }),
    public: z.object({
      night: LocalDateSchema,
      /** Players who lost a squishy to the Hollow tonight (`z.object` strips which one). */
      taken: z.array(z.object({ userId: z.uuid() })),
      walks: z.array(walkSchema(z.object)).optional(),
    }),
  },
  /**
   * The Hollow Man took one of a player's squishies to the Hollow (#21). Only
   * its owner gets this live (`PUBLIC_VIEWS` override); others see
   * `hollow.nightfall`.
   */
  'squishy.hollowed': {
    internal: z.strictObject({ userId: z.uuid(), squishyId: z.uuid(), night: LocalDateSchema }),
    public: z.object({ userId: z.uuid(), squishyId: z.uuid(), night: LocalDateSchema }),
  },
  /**
   * A rescue expedition brought a squishy home from the Hollow (#21). Only
   * its owner gets this live (`PUBLIC_VIEWS` override).
   */
  'squishy.rescued': {
    internal: z.strictObject({
      userId: z.uuid(),
      squishyId: z.uuid(),
      battleId: z.uuid(),
      /** Heartdust earned (0 once today's rescue rewards are used up). */
      heartdust: z.number().int().min(0),
    }),
    public: z.object({
      userId: z.uuid(),
      squishyId: z.uuid(),
      heartdust: z.number().int().min(0),
    }),
  },
  /**
   * A player found a piece of clothing (#43): a lucky drop from a gather, a rescue
   * (#21), a tile capture (#84), a won wild battle or an explore find (#261). Clothing is account-level; the event goes on
   * the map where it was found. What caused it stays internal.
   */
  'clothing.found': {
    internal: z.strictObject({
      userId: z.uuid(),
      itemId: ContentIdSchema,
      source: ClothingDropSourceSchema,
      /** The gather, capture, rescue, battle or explore find that found it. */
      refId: z.uuid(),
    }),
    public: z.object({ userId: z.uuid(), itemId: ContentIdSchema }),
  },
  /**
   * A player's Keeper changed clothes (#43). Written on every active map they
   * play on, so members see the new outfit live.
   */
  'outfit.changed': {
    internal: z.strictObject({ userId: z.uuid(), wearing: z.array(ContentIdSchema) }),
    public: z.object({ userId: z.uuid(), wearing: z.array(ContentIdSchema) }),
  },
  /**
   * A member sent a quick message (#23, design doc §17 Phase 1): a preset
   * phrase, emoji or sticker id from `QUICK_MESSAGES`, never typed text.
   * `chatId` is the `quick_messages` row, so clients merge it with the feed.
   */
  'chat.quick': {
    internal: z.strictObject({
      chatId: z.uuid(),
      userId: z.uuid(),
      username: z.string(),
      messageId: ContentIdSchema,
    }),
    public: z.object({
      chatId: z.uuid(),
      userId: z.uuid(),
      username: z.string(),
      messageId: ContentIdSchema,
    }),
  },
  /**
   * A player gave one of their squishies a new job (owner decisions
   * 2026-10-04): `from` / `to` are the work tiles it left and went to, so
   * members' maps can show where squishies are gathering. Members see only
   * whose and where: which squishy and which job stay internal (like
   * `defenders.changed`, never which ones), and nothing it gathers is sent.
   */
  'squishy.assigned': {
    internal: z.strictObject({
      userId: z.uuid(),
      squishyId: z.uuid(),
      job: z.enum(['team', 'guard', 'gatherer', 'training', 'resting']),
      from: z.strictObject(coords).nullable(),
      to: z.strictObject(coords).nullable(),
    }),
    public: z.object({
      userId: z.uuid(),
      from: z.object(coords).nullable(),
      to: z.object(coords).nullable(),
    }),
  },
  /**
   * Training Grounds XP landed (owner decision 2026-10-06): a settle, or a
   * squishy leaving training. Who and how much stays internal, like
   * `work.collected`; levels and evolutions follow as their own events.
   */
  'squishy.trained': {
    internal: z.strictObject({
      userId: z.uuid(),
      trained: z.array(z.strictObject({ squishyId: z.uuid(), xp: z.number().int().min(1) })).min(1),
    }),
    public: z.object({ userId: z.uuid() }),
  },
  /** A player picked their battle team (slot order). Only they hear it (`ownerOnlyView`). */
  'team.picked': {
    internal: z.strictObject({ userId: z.uuid(), squishyIds: z.array(z.uuid()) }),
    public: z.object({ userId: z.uuid(), squishyIds: z.array(z.uuid()) }),
  },
  /**
   * A player's squishy gatherers' finished work went into their bag (a
   * collect, or a gatherer taken off its tile). How much stays internal.
   */
  'work.collected': {
    internal: z.strictObject({
      userId: z.uuid(),
      squishyIds: z.array(z.uuid()),
      items: z.record(z.string(), z.number().int().min(1)),
    }),
    public: z.object({ userId: z.uuid() }),
  },
} satisfies Record<string, GameEventSchemas>;

export type GameEventType = keyof typeof GAME_EVENTS;
export type GameEventPayload<T extends GameEventType> = z.infer<
  (typeof GAME_EVENTS)[T]['internal']
>;
export type PublicGameEventPayload<T extends GameEventType> = z.infer<
  (typeof GAME_EVENTS)[T]['public']
>;

/** Every registered event type: the one list (live sync and consumers use it). */
export const GAME_EVENT_TYPES = Object.keys(GAME_EVENTS) as [GameEventType, ...GameEventType[]];

export const GameEventTypeSchema = z.enum(GAME_EVENT_TYPES);

export function isGameEventType(type: string): type is GameEventType {
  return Object.hasOwn(GAME_EVENTS, type);
}

/** Checks a stored (internal) payload against its type; throws on a mismatch. */
export function parseGameEventPayload<T extends GameEventType>(
  type: T,
  payload: unknown,
): GameEventPayload<T> {
  return GAME_EVENTS[type].internal.parse(payload) as GameEventPayload<T>;
}
