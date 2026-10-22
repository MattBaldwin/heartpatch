import { z } from 'zod';
import { HexSchema } from '../hex/index.js';
import { ClothingDropSourceSchema } from './data/clothing.js';
import { CommunityKindIdSchema } from './data/communities.js';
import { RelightDepthSchema } from './data/memory-puzzles.js';
import { ContentIdSchema, RaritySchema } from './data/common.js';
import { PvpModeSchema } from './maps.js';
import { BattleEndReasonSchema, BattleKindSchema, BattleSideIdSchema } from './battle.js';
import { BuildingSpotSchema, PlacedBuildingSchema } from './buildings.js';
import { HexEdgeSchema, PlacedFenceSchema } from './fences.js';
import { MoodIdSchema } from './data/care.js';
import { ToolIdSchema } from './data/explore.js';
import { HollowStageSchema, WalkKindSchema } from './hollow-stage.js';
import { RaidOutcomeSchema } from './raids.js';
import { TradeKindSchema, TradeLineSchema } from './trading.js';
import { ChallengeKindSchema } from './challenges.js';
import { LocalDateSchema } from './time.js';
import { TrickOrTreatPrizeSchema } from './trick-or-treat.js';
import { JourneyKindSchema } from './journeys.js';

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

const MapSettingsSchema = z.strictObject({
  pvpMode: PvpModeSchema,
  /** The owner's trading switch (#271), when it's what changed (or on any newer update). */
  tradingEnabled: z.boolean().optional(),
  /** The owner's friendly-battle switch (#29), when it's what changed (or on any newer update). */
  friendlyChallenges: z.boolean().optional(),
});
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
/** An ask's two players (#29): who asked whom, and what kind of ask. */
const ChallengePair = {
  challengeId: z.uuid(),
  kind: ChallengeKindSchema,
  fromUserId: z.uuid(),
  toUserId: z.uuid(),
};
const ChallengeAnsweredSchema = z.strictObject({
  ...ChallengePair,
  answer: z.enum(['yes', 'not-now']),
  battleId: z.uuid().nullable(),
});
const ChallengeCancelledSchema = z.strictObject({
  ...ChallengePair,
  reason: z.enum(['cancelled', 'expired', 'switched-off']),
});
/**
 * "Defend now?" (#29-C): a challenger (`fromUserId`) started a battle for the
 * land of a defender who's online (`toUserId`).
 */
const DefensePair = {
  challengeId: z.uuid(),
  battleId: z.uuid(),
  fromUserId: z.uuid(),
  toUserId: z.uuid(),
};
const DefensePromptedSchema = z.strictObject({ ...DefensePair, expiresAt: z.iso.datetime() });
const DefenseAnsweredSchema = z.strictObject({
  ...DefensePair,
  /**
   * `yes`: the defender plays live. Otherwise their defense style plays:
   * `not-now`, `expired` (no answer in time), or `called-off` (the
   * challenger gave up while waiting, which counts as leaving).
   */
  answer: z.enum(['yes', 'not-now', 'expired', 'called-off']),
});
/** A live battle's two players (#29): who is on side `a` and side `b`. */
const LivePair = { battleId: z.uuid(), aUserId: z.uuid(), bUserId: z.uuid() };
const TurnSchema = z.number().int().min(0);
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
  /** A member named their home (#306 PR 0): its flag on the map shows it. */
  'member.named': {
    internal: z.strictObject({ userId: z.uuid(), name: z.string() }),
    public: z.object({ userId: z.uuid(), name: z.string() }),
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
   * "Battle me?" (#29): one player asked another. Only the two players hear
   * it (`twoPlayerView`); everyone else sees the battle start, if it does.
   */
  'challenge.sent': {
    internal: z.strictObject(ChallengePair),
    public: z.object(ChallengePair),
  },
  /** The ask was answered: "Battle!" (`yes`, with its battle) or "Not now!". Only the two players. */
  'challenge.answered': {
    internal: ChallengeAnsweredSchema,
    public: z.object(ChallengeAnsweredSchema.shape),
  },
  /**
   * The ask went away unanswered: the asker said "Never mind", it floated
   * away (`expired`), or the owner switched friendly battles off. Only the two players.
   */
  'challenge.cancelled': {
    internal: ChallengeCancelledSchema,
    public: z.object(ChallengeCancelledSchema.shape),
  },
  /**
   * Live battles (#29): one player picked this turn. Never what they picked:
   * the pick stays hidden in `live_battles` until the turn plays. Only the
   * battle's two players hear it (`livePairView`).
   */
  'battle.picked': {
    internal: z.strictObject({ ...LivePair, side: BattleSideIdSchema, turn: TurnSchema }),
    public: z.object({ ...LivePair, side: BattleSideIdSchema, turn: TurnSchema }),
  },
  /**
   * A live battle moved on (#29): `turn` is the engine's turn count after the
   * step (a turn played, someone was sent out, or the battle ended). The two
   * players fetch the battle for what happened; no choice is ever in here.
   */
  'battle.turned': {
    internal: z.strictObject({ ...LivePair, turn: TurnSchema }),
    public: z.object({ ...LivePair, turn: TurnSchema }),
  },
  /**
   * A cheer in a live battle (#29): a quick-message or emoji id from
   * `QUICK_MESSAGES`, never text. Only the two players hear it.
   */
  'battle.cheered': {
    internal: z.strictObject({ ...LivePair, side: BattleSideIdSchema, messageId: ContentIdSchema }),
    public: z.object({ ...LivePair, side: BattleSideIdSchema, messageId: ContentIdSchema }),
  },
  /**
   * "Defend now?" (#29-C): a rival challenged the land of a defender whose
   * app is open, and the battle waits for their answer until `expiresAt`.
   * Only the two players hear it (`twoPlayerView`).
   */
  'defense.prompted': {
    internal: DefensePromptedSchema,
    public: z.object(DefensePromptedSchema.shape),
  },
  /** How "Defend now?" ended (see `answer`). Only the two players. */
  'defense.answered': {
    internal: DefenseAnsweredSchema,
    public: z.object(DefenseAnsweredSchema.shape),
  },
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
   * The patch line (#391): a player befriended a wild squishy whose tier tells
   * the whole patch (`RARE_FIND_TIERS[…].patchLine`, Legendary only in Phase
   * 1). Members who have met that kind themselves (`metBy`, internal) hear its
   * name; everyone else hears only its tier, so a kind someone hasn't met
   * keeps its surprise (CLAUDE.md rule 6). Secret kinds never send one. The
   * player who befriended it hears nothing (their card already cheered).
   */
  'squishy.celebrated': {
    internal: z.strictObject({
      battleId: z.uuid(),
      userId: z.uuid(),
      speciesId: ContentIdSchema,
      rarity: RaritySchema,
      metBy: z.array(z.uuid()),
    }),
    public: z.object({
      userId: z.uuid(),
      rarity: RaritySchema,
      speciesId: ContentIdSchema.optional(),
    }),
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
   * Hollowed Communities (#306) came to an older map: the boot pass marked
   * these wild tiles as grey villages. New maps are made with theirs and
   * write none. Never the cellar key's tile (CLAUDE.md rule 6).
   */
  'community.placed': {
    internal: z.strictObject({
      communities: z
        .array(
          z.strictObject({
            communityId: z.uuid(),
            name: z.string(),
            kind: CommunityKindIdSchema,
            tiles: z.array(z.strictObject(coords)).min(1),
          }),
        )
        .min(1),
    }),
    public: z.object({
      communities: z.array(
        z.object({
          communityId: z.uuid(),
          name: z.string(),
          kind: CommunityKindIdSchema,
          tiles: z.array(z.object(coords)),
        }),
      ),
    }),
  },
  /**
   * Someone put a piece back on a grey village tile (#306 PR 3): the
   * village's progress for everyone. Public, like the land it becomes.
   */
  'community.mended': {
    internal: z.strictObject({
      communityId: z.uuid(),
      userId: z.uuid(),
      ...coords,
      piecesDone: z.number().int().min(1),
      piecesNeeded: z.number().int().min(1),
    }),
    public: z.object({
      communityId: z.uuid(),
      userId: z.uuid(),
      ...coords,
      piecesDone: z.number().int(),
      piecesNeeded: z.number().int(),
    }),
  },
  /** That piece was the tile's last: it's restored, and its restorer claimed it (#306 PR 3). */
  'tile.restored': {
    internal: z.strictObject({ communityId: z.uuid(), userId: z.uuid(), ...coords }),
    public: z.object({ communityId: z.uuid(), userId: z.uuid(), ...coords }),
  },
  /**
   * The village is won (#306 PR 3): one Keeper restored and holds every tile.
   * Its Heart Seed is planted on the square, and `ring` is the tiles that
   * became their home tiles (a tile someone else holds stays theirs).
   */
  'community.restored': {
    internal: z.strictObject({
      communityId: z.uuid(),
      userId: z.uuid(),
      square: z.strictObject(coords),
      ring: z.array(z.strictObject(coords)).min(1),
      name: z.string(),
    }),
    public: z.object({
      communityId: z.uuid(),
      userId: z.uuid(),
      square: z.object(coords),
      ring: z.array(z.object(coords)),
      name: z.string(),
    }),
  },
  /** A won village's Keeper named it (#306 PR 3): its flag shows the name to everyone. */
  'community.named': {
    internal: z.strictObject({ communityId: z.uuid(), userId: z.uuid(), name: z.string() }),
    public: z.object({ communityId: z.uuid(), userId: z.uuid(), name: z.string() }),
  },
  /**
   * A won village's Keeper collected its morning gift (#306 PR 3b: the Old
   * Well, the Bakery): the square stops offering it until the next morning.
   */
  'community.gift': {
    internal: z.strictObject({
      communityId: z.uuid(),
      userId: z.uuid(),
      items: z.record(ContentIdSchema, z.number().int().min(1)),
    }),
    public: z.object({ communityId: z.uuid(), userId: z.uuid() }),
  },
  /**
   * A won village's Keeper dug up its cellar key on the tile its map
   * pointed to (#306 PR 2c). Only they hear of it; where it was stays
   * internal (rule 6).
   */
  'key.found': {
    internal: z.strictObject({ communityId: z.uuid(), userId: z.uuid(), ...coords }),
    public: z.object({ communityId: z.uuid(), userId: z.uuid() }),
  },
  /** They opened the hidden cellar under the square with it (#306 PR 2c). Only they hear of it. */
  'cellar.opened': {
    internal: z.strictObject({ communityId: z.uuid(), userId: z.uuid() }),
    public: z.object({ communityId: z.uuid(), userId: z.uuid() }),
  },
  /**
   * They won the far road and arrived in this season's far Hollow (#306 PR
   * 6): their own, fresh every season. Only they hear of it.
   */
  'journey.arrived': {
    internal: z.strictObject({
      userId: z.uuid(),
      journeyId: z.uuid(),
      season: ContentIdSchema,
      year: z.number().int(),
    }),
    public: z.object({ userId: z.uuid(), season: ContentIdSchema }),
  },
  /**
   * They searched every spot in this season's far Hollow (#306 PR 6): the
   * joy is all back. `lorePage` is the season's guaranteed page, found by
   * that last search's `explore.searched` (null when they had every one).
   * Members hear who did it.
   */
  'journey.completed': {
    internal: z.strictObject({
      userId: z.uuid(),
      season: ContentIdSchema,
      year: z.number().int(),
      lorePage: ContentIdSchema.nullable(),
    }),
    public: z.object({ userId: z.uuid(), season: ContentIdSchema }),
  },
  /**
   * A trade offer or a gift was sent at a trading post (#271). What it holds
   * stays internal; only the two players hear of it (`twoPlayerView`).
   */
  'trade.offered': {
    internal: z.strictObject({
      offerId: z.uuid(),
      kind: TradeKindSchema,
      fromUserId: z.uuid(),
      toUserId: z.uuid(),
      noteId: z.string().nullable(),
      give: z.array(TradeLineSchema),
      want: z.array(TradeLineSchema),
    }),
    public: z.object({
      offerId: z.uuid(),
      kind: TradeKindSchema,
      fromUserId: z.uuid(),
      toUserId: z.uuid(),
    }),
  },
  /**
   * The patch-mate said yes or no to a trade offer (#271). The two players
   * hear which; everyone else hears only that a trade happened ("Lee and Sam
   * traded!"), never what moved, and nothing of a "no thanks".
   */
  'trade.answered': {
    internal: z.strictObject({
      offerId: z.uuid(),
      kind: TradeKindSchema,
      fromUserId: z.uuid(),
      toUserId: z.uuid(),
      answer: z.enum(['accepted', 'declined']),
    }),
    public: z.object({
      offerId: z.uuid().optional(),
      fromUserId: z.uuid(),
      toUserId: z.uuid(),
      answer: z.enum(['accepted', 'declined']),
    }),
  },
  /**
   * An open offer was called off (#271): its sender cancelled it, the owner
   * turned trading off, or one of the two left the patch. Its things went
   * straight back. Only the two players hear of it.
   */
  'trade.cancelled': {
    internal: z.strictObject({
      offerId: z.uuid(),
      fromUserId: z.uuid(),
      toUserId: z.uuid(),
      reason: z.enum(['cancelled', 'trading-off', 'left']),
    }),
    public: z.object({
      offerId: z.uuid(),
      fromUserId: z.uuid(),
      toUserId: z.uuid(),
      reason: z.enum(['cancelled', 'trading-off', 'left']),
    }),
  },
  /** An offer nobody answered in time went back to its sender (#271). Only the two players hear of it. */
  'trade.expired': {
    internal: z.strictObject({ offerId: z.uuid(), fromUserId: z.uuid(), toUserId: z.uuid() }),
    public: z.object({ offerId: z.uuid(), fromUserId: z.uuid(), toUserId: z.uuid() }),
  },
  /** A gift was picked up (#271): members hear "Sam got a gift from Lee 🎁", never what. */
  'gift.collected': {
    internal: z.strictObject({ offerId: z.uuid(), fromUserId: z.uuid(), toUserId: z.uuid() }),
    public: z.object({ fromUserId: z.uuid(), toUserId: z.uuid() }),
  },
  /** A player picked up what waited in their mailbox (#271). Only they hear it (`ownerOnlyView`). */
  'mailbox.collected': {
    internal: z.strictObject({
      userId: z.uuid(),
      mailboxIds: z.array(z.uuid()).min(1),
      offerIds: z.array(z.uuid()).min(1),
    }),
    public: z.object({ userId: z.uuid(), mailboxIds: z.array(z.uuid()) }),
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
      /** The far road to the far Hollow (#306 PR 6) sets off from the post at (q, r). */
      kind: JourneyKindSchema.optional(),
    }),
    public: z.object({
      userId: z.uuid(),
      ...coords,
      distance: z.number().int().min(1),
      kind: JourneyKindSchema.optional(),
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
      /** The far road (#306 PR 6): a win is an arrival in the far Hollow, never a visit pass. */
      kind: JourneyKindSchema.optional(),
    }),
    public: z.object({
      userId: z.uuid(),
      ...coords,
      result: z.enum(['won', 'lost', 'no-contest']),
      visitUntil: z.iso.datetime().nullable(),
      kind: JourneyKindSchema.optional(),
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
  /**
   * A player relit a grey village tile's path (#306 PR 2b, Relight): once a
   * tile each. `depth`, `attempt` and `moves` (how many) say which try and
   * how long it took; the moves themselves were checked by replaying them
   * on the try's board, rebuilt from the Hollow's seed, and aren't kept.
   * `lorePage` is the server-only page it gave (the lore consumer grants
   * it); a Rekindled piece is its own `clothing.found`. Members see who
   * fixed which kind of thing where, and a `notable` find's kind.
   */
  'explore.puzzled': {
    internal: z.strictObject({
      userId: z.uuid(),
      ...coords,
      terrain: z.string(),
      communityId: z.uuid(),
      /** The solve: the ledger's `refId` for its items. */
      solveId: z.uuid(),
      skin: ContentIdSchema,
      depth: RelightDepthSchema,
      attempt: z.number().int().min(1),
      moves: z.number().int().min(0),
      lorePage: ContentIdSchema.nullable(),
      items: z.record(z.string(), z.number().int().min(1)),
      notable: ExploreNotableSchema.nullable(),
    }),
    public: z.object({
      userId: z.uuid(),
      ...coords,
      skin: ContentIdSchema,
      notable: ExploreNotableSchema.nullable(),
    }),
  },
  /**
   * A player started clearing one of their homesteads (#242): members see
   * "clearing here, ready at …" on the tile. The tool and drop stay internal.
   */
  'clearing.started': {
    internal: z.strictObject({
      clearId: z.uuid(),
      userId: z.uuid(),
      ...coords,
      tool: z.string(),
      drop: z.record(z.string(), z.number().int().min(1)),
      readyAt: z.iso.datetime(),
    }),
    public: z.object({ userId: z.uuid(), ...coords, readyAt: z.iso.datetime() }),
  },
  /**
   * A tile finished clearing (#242): it's cleared land now, its spot gone.
   * `from` is the terrain it was. What it dropped stays internal.
   */
  'tile.cleared': {
    internal: z.strictObject({
      clearId: z.uuid(),
      userId: z.uuid(),
      ...coords,
      terrain: z.string(),
      from: z.string(),
      drop: z.record(z.string(), z.number().int().min(1)),
    }),
    public: z.object({ userId: z.uuid(), ...coords, terrain: z.string(), from: z.string() }),
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
  /**
   * A Keeper built their house's next level (#381). The whole patch hears it
   * (coordinator call): "Lee's house grew to level 3! 🏠". The cost stays
   * internal.
   */
  'house.built': {
    internal: z.strictObject({
      userId: z.uuid(),
      level: z.number().int().min(2),
      cost: z.record(z.string(), z.number().int().min(1)),
    }),
    public: z.object({ userId: z.uuid(), level: z.number().int().min(2) }),
  },
  /**
   * A squishy moved into a room of its Keeper's house, into another room, or
   * out (`roomId` null) (#381). The patch hears who and where it lives now;
   * the room it left stays internal.
   */
  'resident.moved': {
    internal: z.strictObject({
      userId: z.uuid(),
      squishyId: z.uuid(),
      roomId: ContentIdSchema.nullable(),
      /** The room it left, if it lived in one. */
      fromRoomId: ContentIdSchema.nullable(),
    }),
    public: z.object({
      userId: z.uuid(),
      squishyId: z.uuid(),
      roomId: ContentIdSchema.nullable(),
    }),
  },
  /**
   * A Keeper trick-or-treated at a patch-mate's home (#515). The visitor hears
   * the treat; the host hears who came, never what they got; nobody else
   * hears it (`trickVisitedView`). `hostHeartdust` is the host's thank-you.
   */
  'trick.visited': {
    internal: z.strictObject({
      visitId: z.uuid(),
      visitorUserId: z.uuid(),
      hostUserId: z.uuid(),
      /** The patch's local day of the visit. */
      day: LocalDateSchema,
      lantern: z.boolean(),
      trick: z.boolean(),
      prize: TrickOrTreatPrizeSchema,
      hostHeartdust: z.number().int().min(0),
    }),
    public: z.object({
      visitId: z.uuid(),
      visitorUserId: z.uuid(),
      hostUserId: z.uuid(),
      day: LocalDateSchema,
      /** Only in the visitor's view. */
      prize: TrickOrTreatPrizeSchema.optional(),
    }),
  },
  /**
   * A Keeper opened today's gift from a resident (#381 PR H). Only the Keeper
   * hears it (`ownerOnlyView`); the patch never sees what's in their house.
   */
  'house.gift': {
    internal: z.strictObject({
      userId: z.uuid(),
      giftId: z.uuid(),
      /** The patch's local day the gift belongs to. */
      day: LocalDateSchema,
      /** Null once the giver's squishy row is deleted. */
      giverSquishyId: z.uuid().nullable(),
      itemId: ContentIdSchema,
      count: z.number().int().min(1),
    }),
    public: z.object({
      userId: z.uuid(),
      day: LocalDateSchema,
      itemId: ContentIdSchema,
      count: z.number().int().min(1),
    }),
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
   * A resource building's output landed in its owner's bag (#601): a settle,
   * or its take-down. Members see the building was busy; what it made stays
   * internal.
   */
  'building.produced': {
    internal: z.strictObject({
      userId: z.uuid(),
      buildingRowId: z.uuid(),
      buildingId: ContentIdSchema,
      q: z.number().int(),
      r: z.number().int(),
      items: z.record(z.string(), z.number().int().min(1)),
    }),
    public: z.object({
      userId: z.uuid(),
      buildingRowId: z.uuid(),
      q: z.number().int(),
      r: z.number().int(),
    }),
  },
  /**
   * A resource building or the Warehouse fell asleep (#601): its morning's
   * upkeep wasn't covered. Members see it nap; the coins stay internal.
   */
  'building.paused': {
    internal: z.strictObject({
      userId: z.uuid(),
      buildingRowId: z.uuid(),
      q: z.number().int(),
      r: z.number().int(),
      reason: z.enum(['upkeep']),
      /** The map-local morning it couldn't pay. */
      day: LocalDateSchema,
    }),
    public: z.object({
      userId: z.uuid(),
      buildingRowId: z.uuid(),
      q: z.number().int(),
      r: z.number().int(),
    }),
  },
  /** A napping building woke up (#601): its owner's Heart Coins cover a morning again. Free. */
  'building.resumed': {
    internal: z.strictObject({
      userId: z.uuid(),
      buildingRowId: z.uuid(),
      q: z.number().int(),
      r: z.number().int(),
    }),
    public: z.object({
      userId: z.uuid(),
      buildingRowId: z.uuid(),
      q: z.number().int(),
      r: z.number().int(),
    }),
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
      /** It grew into a branch form, not its step's default (#32); absent means it didn't. */
      branch: z.boolean().optional(),
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
