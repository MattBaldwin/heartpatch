import {
  applyBattleAction,
  BattleRuleError,
  itemRefusal,
  legalChoices,
  LIVE_BATTLE_RULES,
  liveTurnAction,
  quickMessageById,
  sidesToAct,
  battleXpPercent,
  befriendedLevel,
  joiningSpecies,
  CAPTURABLE_BATTLE_KINDS,
  CARE_RULES,
  ClientBattleViewSchema,
  COIN_RULES,
  clientBattleView,
  createBattleContent,
  GAME_DATA,
  gameplayOverrides,
  GROWTH_RULES,
  MAP_GEN,
  befriendedBetween,
  otherSide,
  type BattleSquishy,
  startBattle,
  TILE_BATTLE_KINDS,
  type BattleAction,
  type BattleActionRequest,
  type BattleChoice,
  type BattleCheerRequest,
  type LiveBattleRules,
  type LiveBattleView,
  type BattleContent,
  type BattleKind,
  type BattleSetup,
  type BattleSideId,
  type BattleSideSetup,
  type BattleSquishySetup,
  type BattleState,
  type ItemCounts,
  type Hex,
  type Move,
  type OwnedSquishy,
  type PlayerBattle,
  type PublicUser,
  type Species,
  type StartWildBattleRequest,
  setupSpecies,
} from '@heartpatch/shared';
import { SERVER_GAME_DATA, serverBattleData } from '@heartpatch/shared/server';
import type { Executor } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import { newSeed } from '../../lib/rng.js';
import { nextLocalMidnight, type Clock } from '../../lib/time.js';
import { applyXp, appendGrowthEvents, EVOLUTION_STEPS, type Growth } from '../care/service.js';
import { creditCoins } from '../coins/service.js';
import { consumeItems, grantItems, lockGrantRows } from '../inventory/service.js';
import { requireMember } from '../maps/members.js';
import { createMapsRepo } from '../maps/repo.js';
import type { MapRow } from '../maps/repo.js';
import { createSpawnsRepo } from '../spawns/repo.js';
import { rollFoundDrop } from '../wardrobe/drops.js';
import { arenaFor } from './arena.js';
import { liveView, nextDeadline, settleTimeouts } from './live.js';
import { DEV_WILD_LEVEL } from './limits.js';
import {
  createBattlesRepo,
  createLiveBattlesRepo,
  type LiveRow,
  type BattleRow,
  type BattleSpawn,
  type BattlesTxRepo,
  type TeamSquishyRow,
} from './repo.js';

/*
 * PvE battles (design doc §6, tech spec §8, DECISIONS "Battle engine (#11)").
 * The client sends intents; this service runs the shared engine, stores the
 * seed, actions, content hash and resolved log, and hands back
 * `clientBattleView(state)`: never the RNG state, and the seed only once the
 * battle is over. The player is always side `a`; the AI side picks inside the
 * reducer with the battle's own RNG. A live battle (#29) has a player on side
 * `b` too (`live_battles`, `./live.ts`): both pick, then the turn plays.
 */

/** The player's side in every PvE battle; the AI is always `b`. */
export const PLAYER_SIDE = 'a' satisfies BattleSideId;

/** A wild squishy (or guardian team) to fight. Spawns (#14) provide these. */
export interface WildEncounter {
  /** The wild side's team; ids must be unique within the battle (`wild-1`, …). */
  squishies: BattleSquishySetup[];
  /**
   * The tile and spawn window it came from, stored on the battle so a
   * squishy the player befriended, beat, lost to or ran from is gone for them
   * for the rest of the window (#208).
   * Absent for squishies that aren't a tile's spawn (the dev route).
   */
  spawn?: { q: number; r: number; window: string };
}

export interface WildEncounterContext {
  mapId: string;
  userId: string;
  mapKind: MapRow['kind'];
  now: Date;
  /** The tile the player picked, or null for the nearest wild squishy. */
  tile: Hex | null;
}

/**
 * The other side of a tile battle (#15), built by the territory module inside
 * the start transaction, after its raid-rule checks.
 */
export interface TileOpponent {
  kind: Extract<BattleKind, 'tile' | 'rival-tile'>;
  /** The tile fought over: the arena is drawn as its terrain (owner decision 2026-10-04). */
  tile: Hex;
  /** Who plays the other side, and with which squishies. */
  side: BattleSideSetup;
  /**
   * After the battle row, in the same transaction: the attempt log row. The
   * events it returns are appended after `battle.started`.
   */
  started: (tx: Executor, battle: BattleRow) => Promise<NewGameEvent[]>;
  /**
   * Who of the player's team fights, when not all of them (#203): the
   * first squishy alone breaks a fence, and the guard battle after it is
   * fought by the rest. Never empty.
   */
  team?: TeamSquishyRow[];
  /** Turns the battle lasts at most (a fence battle, #203). */
  turnLimit?: number;
}

/**
 * Builds a tile battle's opponent in the start transaction: checks the raid
 * rules under row locks first, and throws `AppError` to refuse (then nothing
 * is used up). Runs only when there's no battle going to resume.
 */
export type PrepareTileBattle = (
  tx: Executor,
  context: { map: MapRow; at: Date; team: readonly TeamSquishyRow[] },
) => Promise<TileOpponent>;

/**
 * The territory module's side of tile battles (#15). The battles service
 * calls it inside its own transactions, so the attempt log and the tile
 * commit with the battle (CLAUDE.md rule 7).
 */
export interface TileBattlePort {
  /** No action for this long and the player has left: it counts as a loss (design doc §11). */
  readonly abandonAfterMs: number;
  /** When the player last acted in this tile battle (its start, at first). */
  lastActionAt: (tx: Executor, battleId: string) => Promise<Date | null>;
  /** The player acted: the abandon timer starts again. */
  acted: (tx: Executor, battleId: string, at: Date) => Promise<void>;
  /**
   * The battle is over (won, lost or left): records it, and on a win the tile
   * changes hands. `battle.state` is its final state (a fence battle, #203,
   * reads the energy its fence has left). Lock order: battle (held), tile, then `maps` via events.
   * Returns events to append after `battle.ended`, the share of the battle's
   * XP to grant (Gentle's `rewardPercent`: owner decision 2026-10-03), and,
   * on a capture, the found-clothing roll for battles to make (#84). The port
   * never rolls it itself: `clothing.found` takes `maps`, and the squishies
   * aren't locked yet.
   */
  ended: (
    tx: Executor,
    battle: BattleRow,
    winner: BattleSideId | 'draw',
    at: Date,
  ) => Promise<TileBattleEnd>;
  /** Called off by the server (DECISIONS #13): the attempt is refunded. */
  noContest: (tx: Executor, battleId: string, at: Date) => Promise<void>;
}

/** What the territory port settled when a tile battle ended. */
export interface TileBattleEnd {
  events: NewGameEvent[];
  xpPercent: number;
  /**
   * A capture's chance of found clothing: the tile, Gentle's share of the
   * chance, and whether the land was taken from another player (#261).
   */
  drop: { tileId: string; percent: number; fromRival?: boolean } | null;
  /**
   * Refunds for the defender's fire the capture took down (#202), for
   * battles to grant after its squishy locks (tech spec §7: inventory after
   * squishies). Empty or missing: nothing to give back.
   */
  refunds?: readonly { userId: string; items: ItemCounts; refId: string }[];
  /**
   * The defender's squishies the capture moves (trainees at Training Grounds
   * that came down with the land, #277), locked with the team's (step 10,
   * one id order) before the refunds.
   */
  squishies?: readonly string[];
  /**
   * Runs after the squishy locks and the refunds, before any XP of the
   * team's: the trainees land what they earned. Returns events to append
   * with `events`.
   */
  afterRefunds?: (tx: Executor, at: Date) => Promise<NewGameEvent[]>;
}

/** The other side of a rescue (#21), built by the hollow module in the start transaction. */
export interface RescueOpponent {
  /** The Hollow's shadow guardians, and who plays them. */
  side: BattleSideSetup;
  /** After the battle row, in the same transaction: the rescue's own row. Events go after `battle.started`. */
  started: (tx: Executor, battle: BattleRow) => Promise<NewGameEvent[]>;
}

/**
 * A rescue expedition (#21, design doc §14): no attempt is used (decision C),
 * and the hollow module settles it from `battle.ended`.
 */
export interface PrepareRescueBattle {
  /**
   * Checks the rescue under row locks and builds the other side; throws
   * `AppError` to refuse (then nothing is used up). Runs only when there's no
   * battle going to resume.
   */
  opponent: (tx: Executor, context: { map: MapRow; at: Date }) => Promise<RescueOpponent>;
  /**
   * Who fights when the player has no active squishy left (all in the
   * Hollow): the squishy being rescued helps, so a rescue is always possible.
   */
  soloTeam: (tx: Executor) => Promise<TeamSquishyRow[]>;
}

/** The other side of a journey (#270), built by the journeys module in the start transaction. */
export interface JourneyOpponent {
  /** The trail squishies, and who plays them. */
  side: BattleSideSetup;
  /** The trading post the journey heads for: the arena is drawn as its terrain. */
  tile: Hex;
  /** After the battle row, in the same transaction: the journey's own row. Events go after `battle.started`. */
  started: (tx: Executor, battle: BattleRow) => Promise<NewGameEvent[]>;
}

/**
 * Checks a journey under the start transaction and builds the other side;
 * throws `AppError` to refuse (then nothing is used up). Runs only when
 * there's no battle going to resume. A journey uses no try and starts no
 * tile cooldown (#270).
 */
export type PrepareJourneyBattle = (
  tx: Executor,
  context: { map: MapRow; at: Date },
) => Promise<JourneyOpponent>;

/**
 * The journeys module's side of a journey's end (#270). The battles service
 * calls it inside its own transactions, right after the battle's lock and
 * before the squishies' (tech spec §7 step 5b), so the visit pass commits with
 * the battle (CLAUDE.md rule 7). It returns events to append after
 * `battle.ended`.
 */
export interface JourneyBattlePort {
  ended: (
    tx: Executor,
    battle: BattleRow,
    winner: BattleSideId | 'draw',
    at: Date,
  ) => Promise<NewGameEvent[]>;
  /** Called off by the server (DECISIONS #13): no pass, nothing lost. */
  noContest: (tx: Executor, battle: BattleRow, at: Date) => Promise<NewGameEvent[]>;
}

/** What a capture try costs (design doc §6): one Heart Charm. */
export const HEART_CHARM = 'heart-charm';

export interface BattlesService {
  /** The player's battle to resume on this map, or null. */
  current: (user: PublicUser, mapId: string) => Promise<PlayerBattle | null>;
  get: (user: PublicUser, battleId: string) => Promise<PlayerBattle>;
  /**
   * Picks a fight with whatever wild squishy is around (`findWildEncounter`),
   * or resumes the battle already going (`created: false`).
   */
  startWild: (
    user: PublicUser,
    mapId: string,
    request?: StartWildBattleRequest,
  ) => Promise<StartResult>;
  /** Starts a wild battle against a given team (spawns, and the dev route). */
  startAgainst: (user: PublicUser, mapId: string, encounter: WildEncounter) => Promise<StartResult>;
  /**
   * Starts a battle for a tile (#15) against what `prepare` builds, or
   * resumes the battle already going (`created: false`).
   */
  startTile: (user: PublicUser, mapId: string, prepare: PrepareTileBattle) => Promise<StartResult>;
  /** Sets off on a rescue (#21) against what `prepare` builds, or resumes the battle going. */
  startRescue: (
    user: PublicUser,
    mapId: string,
    prepare: PrepareRescueBattle,
  ) => Promise<StartResult>;
  /** Sets off on a journey to a trading post (#270) against what `prepare` builds, or resumes the battle going. */
  startJourney: (
    user: PublicUser,
    mapId: string,
    prepare: PrepareJourneyBattle,
  ) => Promise<StartResult>;
  /**
   * Applies one player action; the AI side answers inside the same step. In
   * a live battle (#29) a move or swap is this side's hidden pick, and the
   * turn plays once both sides have picked.
   */
  act: (user: PublicUser, battleId: string, request: BattleActionRequest) => Promise<PlayerBattle>;
  /**
   * Starts a friendly battle between two players on the map (#29): nothing
   * at stake, side `a` asked and side `b` said yes. Each brings their team.
   * `started` runs in the same transaction (the challenge's answer, #29-B)
   * and its events follow `battle.started`. Returns the battle's id.
   */
  startFriendly: (input: {
    mapId: string;
    aUserId: string;
    bUserId: string;
    started?: (tx: Executor, battle: BattleRow) => Promise<NewGameEvent[]>;
  }) => Promise<string>;
  /** A cheer in a live battle (#29): a quick message or emoji id, never text. */
  cheer: (user: PublicUser, battleId: string, request: BattleCheerRequest) => Promise<void>;
  /** Dev/test only: a squishy for the player on this map. */
  grantSquishy: (
    user: PublicUser,
    mapId: string,
    squishy: { speciesId?: string; level?: number },
  ) => Promise<OwnedSquishy>;
  /** Species the server can battle with (public and secret), for the dev route. */
  knownSpecies: () => readonly Species[];
}

export interface StartResult {
  battle: PlayerBattle;
  created: boolean;
}

export interface BattlesServiceOptions {
  db: Executor;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
  /**
   * The content battles are played with. Defaults to public plus secret data
   * (`serverBattleData`), so the hash covers every row that can change an
   * outcome. Tests pass pinned content.
   */
  content?: BattleContent;
  /** What's around to fight (#14). Without one, there are no wild squishies. */
  findWildEncounter?: (context: WildEncounterContext) => Promise<WildEncounter | null>;
  /** Tile battles' attempt log and captures (#15, `modules/territory`). */
  tileBattles?: TileBattlePort;
  /** Journeys' visit passes (#270, `modules/journeys`). */
  journeys?: JourneyBattlePort;
  /**
   * Is this player's app open on this map right now (`wsHub.isOnline`)? A
   * live battle gives a side that isn't one away-grace before the AI picks
   * for it (#29). Without one, everybody counts as here.
   */
  isOnline?: (mapId: string, userId: string) => boolean;
  /** Live battles' timings (#29); tests shorten them. */
  liveRules?: LiveBattleRules;
}

/** The other side of a new battle, as `startWith` takes it. */
interface Opponent {
  kind: BattleKind;
  side: BattleSideSetup;
  spawn: BattleSpawn | null;
  /** Where the battle happens; null for the player's Heart Seed (see `arenaFor`). */
  tile: Hex | null;
  started?: (tx: Executor, battle: BattleRow) => Promise<NewGameEvent[]>;
  /** Who of the team fights, when not all of them (`TileOpponent.team`). */
  team?: TeamSquishyRow[];
  turnLimit?: number;
}

// Kid-readable messages (style guide §6).
const MESSAGES = {
  notFound: "We couldn't find that battle.",
  noTeam: 'You need a squishy friend first!',
  allBusy: 'Everyone is busy with a job! Pick a team first.',
  nobodyAround: 'No wild squishies around right now. Try again soon!',
  over: 'That battle is already over.',
  movedOn: 'The battle moved on. Take another look!',
  badChoice: "That's not a move you can make right now. Try another!",
  unknownSpecies: "We don't know that squishy.",
  noCapture: "You can't use a Heart Charm here.",
  notAPotion: "That's not something you can use in a battle.",
  hadOne: 'You already had one of those this battle! Try another.',
  noPotionsLive: 'No potions in a battle with a friend. Just you and your squishies!',
  notLive: 'Cheers are for battles with a friend!',
  unknownCheer: "We don't know that cheer.",
  busy: 'Someone is already in a battle. Try again in a bit!',
  notYourself: "You can't battle yourself, silly!",
  friendlyTutorial: 'Friendly battles happen on a patch with friends!',
  friendlyOff: 'Friendly battles are switched off on this patch.',
  noFriendlyTeam: 'Everyone needs a squishy friend to battle!',
} as const;

export function defaultBattleContent(): BattleContent {
  return createBattleContent(serverBattleData(GAME_DATA, SERVER_GAME_DATA));
}

/** Ids every client already has: the public data tables. */
const PUBLIC_SPECIES = new Set(GAME_DATA.species.map((s) => s.id));
const PUBLIC_MOVES = new Set(GAME_DATA.moves.map((m) => m.id));

/**
 * Rows the client may not have: species and moves outside the public tables
 * (a secret squishy the player just met), so it can draw and name them.
 */
function defsFor(
  content: BattleContent,
  state: BattleState,
): { speciesDefs: Species[]; moveDefs: Move[] } {
  const speciesDefs = new Map<string, Species>();
  const moveDefs = new Map<string, Move>();
  for (const side of [state.sides.a, state.sides.b]) {
    for (const squishy of side.squishies) {
      // A species dropped from the data since (an old battle) is left out;
      // the client names it "Mystery squishy" rather than the read failing.
      const species = content.species.get(squishy.speciesId);
      if (species && !PUBLIC_SPECIES.has(species.id)) speciesDefs.set(species.id, species);
      for (const id of squishy.moves) {
        const move = content.moves.get(id);
        if (move && !PUBLIC_MOVES.has(id)) moveDefs.set(id, move);
      }
    }
  }
  return { speciesDefs: [...speciesDefs.values()], moveDefs: [...moveDefs.values()] };
}

/**
 * What a client sees of a battle: `clientBattleView` of `state` (the row's
 * current state unless given), from `mySide`. The battle's own player is
 * always side `a`; the raid log's replay (#16) shows a finished challenge to
 * the defender, side `b`.
 */
export function playerBattleView(
  content: BattleContent,
  row: BattleRow,
  options: { mySide?: BattleSideId; state?: BattleState; live?: LiveBattleView } = {},
): PlayerBattle {
  const state = options.state ?? row.state;
  return {
    id: row.id,
    mapId: row.mapId,
    kind: row.kind,
    status: row.status,
    mySide: options.mySide ?? PLAYER_SIDE,
    // Parsed on the way out too, so a view can never carry `rng` (rule 6).
    view: ClientBattleViewSchema.parse(clientBattleView(state)),
    ...defsFor(content, state),
    // The seed predicts every roll, so it stays secret until the end (tech spec §8).
    seed: row.status === 'active' ? null : row.seed,
    // The player's own rewards; a defender watching the replay doesn't get them.
    rewards: (options.mySide ?? PLAYER_SIDE) === PLAYER_SIDE ? row.rewards : null,
    // A battle from before arenas were stored plays on the home terrain, by day.
    terrain: row.arena?.terrain ?? MAP_GEN.homeTerrain,
    timeOfDay: row.arena?.timeOfDay ?? 'day',
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    ...(options.live && { live: options.live }),
  };
}

/** The same move or the same swap: a pick against `legalChoices`, field by field. */
function sameChoice(a: BattleChoice, b: BattleChoice): boolean {
  if (a.type === 'move' && b.type === 'move') return a.move === b.move;
  if (a.type === 'swap' && b.type === 'swap') return a.slot === b.slot;
  return false;
}

export function createBattlesService(options: BattlesServiceOptions): BattlesService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const content = options.content ?? defaultBattleContent();
  /** After commit only (apps/server/README.md, "Live sync"). */
  const published = (mapId: string) => {
    void options.publish?.(mapId);
  };
  const store = createBattlesRepo(db);

  const liveRules = options.liveRules ?? LIVE_BATTLE_RULES;
  const isOnline = options.isOnline ?? (() => true);

  /** Who `userId` is in `row`: side `a`, side `b` of a live battle (#29), or nobody. */
  interface Seat {
    side: BattleSideId;
    live: LiveRow | null;
  }
  const seatOf = async (tx: Executor, row: BattleRow, userId: string): Promise<Seat | null> => {
    const live = await createLiveBattlesRepo(tx).find(row.id);
    if (row.playerUserId === userId) return { side: PLAYER_SIDE, live };
    return live?.bUserId === userId ? { side: 'b', live } : null;
  };

  /** The battle as `seat`'s player sees it, with a live battle's turn state. */
  const toPlayerBattle = (row: BattleRow, seat?: Seat | null): PlayerBattle => {
    const side = seat?.side ?? PLAYER_SIDE;
    const live = seat?.live;
    return playerBattleView(content, row, {
      mySide: side,
      ...(live && {
        live: liveView(
          live,
          side,
          side === PLAYER_SIDE ? live.bUserId : row.playerUserId,
          row.status === 'active',
        ),
      }),
    });
  };

  /** The battle, if this player is in it and still on its map. */
  const requireOwn = async (
    tx: Executor,
    row: BattleRow | null,
    user: PublicUser,
  ): Promise<{ row: BattleRow; map: MapRow; seat: Seat }> => {
    const seat = row ? await seatOf(tx, row, user.id) : null;
    if (!row || !seat) throw new AppError('NOT_FOUND', MESSAGES.notFound);
    const { map } = await requireMember(tx, user, row.mapId);
    return { row, map, seat };
  };

  /** The player whose app plays `side` of a live battle. */
  const userOnSide = (row: BattleRow, live: LiveRow, side: BattleSideId): string =>
    side === PLAYER_SIDE ? row.playerUserId : live.bUserId;

  /** `battle.turned`: the live battle moved on; only its two players hear it. */
  const appendTurned = (repo: BattlesTxRepo, row: BattleRow, live: LiveRow, turn: number) =>
    repo.appendEvent({
      mapId: row.mapId,
      type: 'battle.turned',
      actorUserId: null,
      payload: { battleId: row.id, aUserId: row.playerUserId, bUserId: live.bUserId, turn },
    });

  /** A live battle's deadline passed and nobody has settled it yet. */
  const liveDue = (row: BattleRow, live: LiveRow | null, at: Date): live is LiveRow =>
    live !== null &&
    live.active &&
    row.status === 'active' &&
    at.getTime() >= live.deadlineAt.getTime();

  /**
   * Settles a locked live battle's passed deadlines (`settleTimeouts`): the
   * AI picks for whoever ran out of time, and the turns play. Returns the
   * battle as it is now. Lock order: the battle (held), then its
   * `live_battles` row, which the battle lock covers.
   */
  const settleLive = async (
    repo: BattlesTxRepo,
    tx: Executor,
    row: BattleRow,
    live: LiveRow,
    at: Date,
    options: { deferTurned?: boolean } = {},
  ): Promise<BattleRow> => {
    if (!liveDue(row, live, at)) return row;
    const step = settleTimeouts({
      content,
      seed: row.seed,
      state: row.state,
      live,
      at,
      rules: liveRules,
      isOnline: (side) => isOnline(row.mapId, userOnSide(row, live, side)),
    });
    await createLiveBattlesRepo(tx).save(row.id, step.live);
    if (step.actions.length === 0) return row;
    const actions = [...row.actions, ...step.actions];
    if (step.state.phase.type === 'over') {
      await finish(repo, tx, row, actions, step.state, at);
    } else {
      await repo.saveProgress(row.id, { actions, state: step.state });
    }
    // `maps` comes last (lock order step 13): when an action follows in this
    // transaction (it may finish the battle and lock squishies), the caller
    // appends `battle.turned` after it instead.
    if (!options.deferTurned || step.state.phase.type === 'over') {
      await appendTurned(repo, row, live, step.state.turn);
    }
    return (await repo.findBattle(row.id)) ?? row;
  };

  /**
   * The content was re-tuned while this battle ran: its stored state can't be
   * stepped with today's rules, so it ends as no contest (COORDINATOR §9).
   * Nothing is won or lost. Wild battles cost no attempt; tile battles (#15)
   * refund theirs here.
   */
  const endNoContest = async (
    repo: BattlesTxRepo,
    tx: Executor,
    row: BattleRow,
    at: Date,
  ): Promise<void> => {
    if (TILE_BATTLE_KINDS.has(row.kind)) await options.tileBattles?.noContest(tx, row.id, at);
    // A journey's row (#270) right after the battle's lock (step 5b).
    const journeyEvents =
      row.kind === 'journey' ? ((await options.journeys?.noContest(tx, row, at)) ?? []) : [];
    await createLiveBattlesRepo(tx).end(row.id);
    await repo.finish(row.id, {
      status: 'no-contest',
      actions: row.actions,
      state: row.state,
      result: null,
      log: [...row.state.log],
      rewards: null,
      endedAt: at,
    });
    await repo.appendEvent({
      mapId: row.mapId,
      type: 'battle.ended',
      actorUserId: null,
      payload: {
        battleId: row.id,
        kind: row.kind,
        userId: row.playerUserId,
        playerSide: PLAYER_SIDE,
        winner: null,
        reason: 'no-contest',
        turns: row.state.turn,
        xp: [],
      },
    });
    for (const event of journeyEvents) await repo.appendEvent(event);
  };

  /**
   * A tile battle the player left: no action for the abandon time (design doc
   * §11 "Leaving"). Timestamps, not a timer (CLAUDE.md rule 4): it's noticed
   * on the next read or action, and counts as a loss then.
   */
  const abandoned = async (tx: Executor, row: BattleRow, at: Date): Promise<boolean> => {
    const port = options.tileBattles;
    if (!port || row.status !== 'active' || !TILE_BATTLE_KINDS.has(row.kind)) return false;
    const last = await port.lastActionAt(tx, row.id);
    return last !== null && at.getTime() - last.getTime() > port.abandonAfterMs;
  };

  /**
   * Ends a locked active battle that can't go on: re-tuned content (no
   * contest) or a tile battle left (a forfeit, so a loss). True if it ended.
   */
  const settle = async (
    repo: BattlesTxRepo,
    tx: Executor,
    row: BattleRow,
    at: Date,
  ): Promise<boolean> => {
    if (row.contentHash !== content.contentHash) {
      await endNoContest(repo, tx, row, at);
      return true;
    }
    if (await abandoned(tx, row, at)) {
      const action: BattleAction = { type: 'forfeit', side: PLAYER_SIDE };
      const state = applyBattleAction(content, row.state, action);
      await finish(repo, tx, row, [...row.actions, action], state, at);
      return true;
    }
    return false;
  };

  /**
   * An active battle that can't go on (see `settle`) is ended before it's
   * shown, and a live battle's passed deadlines are settled (`settleLive`).
   */
  const resolved = async (row: BattleRow): Promise<BattleRow> => {
    if (row.status !== 'active') return row;
    const live = await createLiveBattlesRepo(db).find(row.id);
    if (
      row.contentHash === content.contentHash &&
      !(await abandoned(db, row, now())) &&
      !liveDue(row, live, now())
    ) {
      return row;
    }
    const ended = await store.transaction(async (repo, tx) => {
      const locked = await repo.lockBattle(row.id);
      if (!locked || locked.status !== 'active') return locked;
      const at = now();
      if (await settle(repo, tx, locked, at)) return repo.findBattle(row.id);
      const lockedLive = await createLiveBattlesRepo(tx).find(row.id);
      return lockedLive ? settleLive(repo, tx, locked, lockedLive, at) : locked;
    });
    published(row.mapId);
    if (!ended) throw new AppError('NOT_FOUND', MESSAGES.notFound);
    return ended;
  };

  /**
   * The engine's `BattleAction` for the player's intent; the client never
   * names a side. `sureCapture`: a Heart Charm always works here (tutorial).
   */
  const toEngineAction = (
    action: BattleActionRequest['action'],
    sureCapture: boolean,
  ): BattleAction => {
    switch (action.type) {
      case 'move':
        return { type: 'turn', choices: { [PLAYER_SIDE]: { type: 'move', move: action.move } } };
      case 'swap':
        return { type: 'turn', choices: { [PLAYER_SIDE]: { type: 'swap', slot: action.slot } } };
      case 'replace':
        return { type: 'replace', side: PLAYER_SIDE, slot: action.slot };
      case 'forfeit':
        return { type: 'forfeit', side: PLAYER_SIDE };
      case 'item':
        return {
          type: 'turn',
          choices: { [PLAYER_SIDE]: { type: 'item', item: action.item } },
        };
      case 'capture':
        return {
          type: 'turn',
          choices: {
            [PLAYER_SIDE]: sureCapture ? { type: 'capture', sure: true } : { type: 'capture' },
          },
        };
    }
  };

  /** Credits each of a finished battle's coin rewards to its player (`creditCoins`). */
  const payCoins = async (
    tx: Executor,
    row: BattleRow,
    at: Date,
    rewards: readonly { source: 'battle' | 'capture'; amount: number }[],
  ): Promise<void> => {
    for (const reward of rewards) {
      await creditCoins(tx, {
        ...reward,
        refId: row.id,
        userId: row.playerUserId,
        mapId: row.mapId,
        at,
      });
    }
  };

  /** Who a step befriended from the other side (#279). */
  const befriendedIn = (before: BattleState, after: BattleState) =>
    befriendedBetween(before, after, otherSide(PLAYER_SIDE));

  /**
   * Befriended squishies join the player (design doc §6, #279), and the
   * catalog marks each species caught. A wild one joins as it was in the
   * battle; a land guardian one evolution back from the form it fought as
   * (owner decision 2026-10-08, `joiningSpecies`), in that species' element
   * and with the guardian's feeling. Either way, below its next evolution
   * (owner decision 2026-10-06, `GROWTH_RULES.befriendBelowEvolution`).
   * Before any event (they take `maps`).
   */
  const welcome = async (
    repo: BattlesTxRepo,
    tx: Executor,
    row: BattleRow,
    befriended: readonly BattleSquishy[],
    at: Date,
  ): Promise<OwnedSquishy[]> => {
    const friends: OwnedSquishy[] = [];
    for (const friend of befriended) {
      const speciesId = TILE_BATTLE_KINDS.has(row.kind)
        ? joiningSpecies(friend.speciesId, EVOLUTION_STEPS)
        : friend.speciesId;
      friends.push(
        await repo.insertSquishy({
          mapId: row.mapId,
          ownerUserId: row.playerUserId,
          speciesId,
          element:
            speciesId === friend.speciesId
              ? friend.element
              : (content.species.get(speciesId)?.element ?? friend.element),
          feeling: friend.feeling,
          level: befriendedLevel(speciesId, friend.level, EVOLUTION_STEPS, GROWTH_RULES),
          contentment: CARE_RULES.startContentment,
          at,
        }),
      );
      await createSpawnsRepo(tx).markCaught(row.mapId, row.playerUserId, speciesId, at);
    }
    return friends;
  };

  /** `squishy.captured` for a new friend: the catalog, milestones and members hear of it. */
  const appendCaptured = (repo: BattlesTxRepo, row: BattleRow, friend: OwnedSquishy) =>
    repo.appendEvent({
      mapId: row.mapId,
      type: 'squishy.captured',
      actorUserId: row.playerUserId,
      payload: {
        battleId: row.id,
        userId: row.playerUserId,
        squishyId: friend.id,
        speciesId: friend.speciesId,
        level: friend.level,
      },
    });

  /** The battle is over: XP for the player's squishies, then the events. */
  const finish = async (
    repo: BattlesTxRepo,
    tx: Executor,
    row: BattleRow,
    actions: BattleAction[],
    state: BattleState,
    at: Date,
  ): Promise<void> => {
    if (state.phase.type !== 'over') throw new Error('finish: the battle is not over');
    const { result } = state.phase;
    // A tile battle (#15): the attempt is settled and a win takes the tile,
    // in this transaction. Lock order: battle, tile, squishies, then `maps`.
    const tile =
      TILE_BATTLE_KINDS.has(row.kind) && options.tileBattles
        ? await options.tileBattles.ended(tx, { ...row, state }, result.winner, at)
        : { events: [], xpPercent: 100, drop: null };
    // A journey (#270): its row after the battle's lock and before the
    // squishies' (tech spec §7 step 5b); a win opens the visit pass.
    const journeyEvents =
      row.kind === 'journey' && options.journeys
        ? await options.journeys.ended(tx, { ...row, state }, result.winner, at)
        : [];
    // A live battle's turn state goes (#29): side `b` is free to battle again.
    await createLiveBattlesRepo(tx).end(row.id);
    // Gentle mode's share (owner decision 2026-10-03): challenging a much
    // smaller player pays part of the battle's XP, win or lose. A friendly
    // battle (#29) has nothing at stake: no XP for either side.
    const awards = result.xp
      .filter((award) => award.side === PLAYER_SIDE && row.kind !== 'friendly')
      .map((award) => ({ ...award, xp: Math.floor((award.xp * tile.xpPercent) / 100) }))
      .filter((award) => award.xp > 0);
    // Base battle XP × care and habitat, levels and evolution (#19's
    // `applyXp`), under the squishy locks (the order above).
    // A capture's moved squishies (#277's trainees) join the same id-ordered lock.
    await repo.lockSquishies([
      ...new Set([...awards.map((a) => a.squishyId), ...(tile.squishies ?? [])]),
    ]);
    // The daily falloff (owner decision 2026-10-06): a squishy that has
    // already won `fullWinsPerDay` battles today gets a share of the XP.
    const wins = await repo.winsToday(
      row.mapId,
      row.playerUserId,
      awards.map((a) => a.squishyId),
      at,
    );
    let fellOff = false;
    for (const award of awards) {
      const percent = battleXpPercent(wins.get(award.squishyId) ?? 0, GROWTH_RULES);
      if (percent < 100) fellOff = true;
      award.xp = Math.floor((award.xp * percent) / 100);
    }
    // A captured tile's fire comes back to its old owner (#202): their
    // inventory rows (step 11) after the squishy locks, before any XP writes
    // `species_seen`.
    const refunds = tile.refunds ?? [];
    if (refunds.length > 0) {
      await lockGrantRows(tx, row.mapId, refunds);
      for (const { userId, items, refId } of refunds) {
        await grantItems(tx, { mapId: row.mapId, userId }, items, 'build-refund', refId);
      }
    }
    const landEvents = tile.afterRefunds ? await tile.afterRefunds(tx, at) : [];
    // When full XP comes back (#201): wins count from the patch's midnight.
    const map = fellOff ? await createMapsRepo(tx).findMap(row.mapId) : null;
    const fullXpResetAt = map ? nextLocalMidnight(at, map.timeZone).toISOString() : null;
    const grown: Growth[] = [];
    for (const award of awards) {
      if (award.xp <= 0) continue;
      const growth = await applyXp(tx, award.squishyId, award.xp, at);
      if (growth) grown.push(growth);
    }
    // Befriended in this last step (design doc §6, #279): each one joins
    // the player. Ones befriended earlier in a guardian battle joined then.
    const friends = await welcome(repo, tx, row, befriendedIn(row.state, state), at);
    const captured = row.kind === 'wild' ? (friends[0] ?? null) : null;
    // Patch Coins (#45): a win, and a befriended squishy or a claimed tile,
    // each once per battle. Gentle's share scales them like the XP and the
    // find. After the squishy and `species_seen` locks, before the events.
    await payCoins(tx, row, at, [
      {
        source: 'battle',
        amount:
          result.winner === PLAYER_SIDE
            ? Math.floor((COIN_RULES.battleWin[row.kind] * tile.xpPercent) / 100)
            : 0,
      },
      {
        // A befriended wild squishy, or a claimed tile (befriending its
        // guardians on the way pays nothing more, #279).
        source: 'capture',
        amount: captured
          ? COIN_RULES.capture.wild
          : tile.drop
            ? Math.floor((COIN_RULES.capture.tile * tile.drop.percent) / 100)
            : 0,
      },
    ]);
    await repo.finish(row.id, {
      status: 'finished',
      actions,
      state,
      result,
      log: [...state.log],
      rewards: {
        xp: grown.map(({ squishyId, xp, evolvingBefore, evolvingAfter }) => ({
          squishyId,
          xp,
          evolvingBefore,
          evolvingAfter,
        })),
        percent: tile.xpPercent,
        fullXpResetAt,
      },
      endedAt: at,
    });
    // A capture may turn up a piece of clothing (#84), rolled here rather
    // than in the port: after the squishy locks above, since its
    // `clothing.found` is this transaction's first event and takes `maps`.
    // Taking a rival's land finds more (#261). A won wild battle rolls its
    // own table (#261). One piece per battle, however often a finish is retried.
    if (tile.drop) {
      await rollFoundDrop(tx, {
        source: 'capture',
        refId: row.id,
        userId: row.playerUserId,
        mapId: row.mapId,
        tileId: tile.drop.tileId,
        percent: tile.drop.percent,
        rival: tile.drop.fromRival === true,
        at,
      });
    } else if (row.kind === 'wild' && result.winner === PLAYER_SIDE) {
      await rollFoundDrop(tx, {
        source: 'battle',
        refId: row.id,
        userId: row.playerUserId,
        mapId: row.mapId,
        tileId: null,
        at,
      });
    }
    await repo.appendEvent({
      mapId: row.mapId,
      type: 'battle.ended',
      actorUserId: row.playerUserId,
      payload: {
        battleId: row.id,
        kind: row.kind,
        userId: row.playerUserId,
        playerSide: PLAYER_SIDE,
        winner: result.winner,
        reason: result.reason,
        turns: result.turns,
        xp: grown.map(({ squishyId, xp }) => ({ squishyId, xp })),
      },
    });
    await appendGrowthEvents(repo.appendEvent, grown);
    for (const friend of friends) await appendCaptured(repo, row, friend);
    for (const event of tile.events) await repo.appendEvent(event);
    for (const event of landEvents) await repo.appendEvent(event);
    for (const event of journeyEvents) await repo.appendEvent(event);
  };

  /**
   * One player's intent in a live battle (#29), on the locked battle with its
   * deadlines already settled. A move or swap is this side's hidden pick: it
   * waits (`battle.picked`, which never says what) until the other side
   * picks, then the turn plays (`battle.turned`). A side may change its pick
   * until then. Sending someone out and giving up apply at once. No potions
   * and no Heart Charms: nothing from the bag in a battle with a friend.
   */
  const actLive = async (
    repo: BattlesTxRepo,
    tx: Executor,
    row: BattleRow,
    live: LiveRow,
    side: BattleSideId,
    request: BattleActionRequest,
    at: Date,
  ): Promise<void> => {
    const liveRepo = createLiveBattlesRepo(tx);
    const intent = request.action;
    // Picking for yourself brings your away-grace back.
    const graceUsed = { ...live.graceUsed, [side]: false };
    let action: BattleAction;
    switch (intent.type) {
      case 'item':
        throw new AppError('CONFLICT', MESSAGES.noPotionsLive);
      case 'capture':
        throw new AppError('CONFLICT', MESSAGES.noCapture);
      case 'forfeit':
        action = { type: 'forfeit', side };
        break;
      case 'replace':
        action = { type: 'replace', side, slot: intent.slot };
        break;
      case 'move':
      case 'swap': {
        const choice: BattleChoice =
          intent.type === 'move'
            ? { type: 'move', move: intent.move }
            : { type: 'swap', slot: intent.slot };
        const legal =
          row.state.phase.type === 'turn' &&
          sidesToAct(row.state).includes(side) &&
          legalChoices(row.state, side).some((c) => sameChoice(c, choice));
        if (!legal) throw new AppError('CONFLICT', MESSAGES.badChoice);
        const picks = { ...live.picks, [side]: choice };
        const turn = liveTurnAction(row.state, picks);
        if (!turn) {
          await liveRepo.save(row.id, { picks, graceUsed });
          // Changing a pick tells nobody anything new: one event per side per turn.
          if (live.picks[side]) return;
          await repo.appendEvent({
            mapId: row.mapId,
            type: 'battle.picked',
            actorUserId: userOnSide(row, live, side),
            payload: {
              battleId: row.id,
              aUserId: row.playerUserId,
              bUserId: live.bUserId,
              side,
              turn: row.state.turn,
            },
          });
          return;
        }
        action = turn;
        break;
      }
    }
    let state: BattleState;
    try {
      state = applyBattleAction(content, row.state, action);
    } catch (err) {
      if (err instanceof BattleRuleError) throw new AppError('CONFLICT', MESSAGES.badChoice);
      throw err;
    }
    const actions = [...row.actions, action];
    await liveRepo.save(row.id, { picks: {}, deadlineAt: nextDeadline(at, liveRules), graceUsed });
    if (state.phase.type === 'over') {
      await finish(repo, tx, row, actions, state, at);
    } else {
      await repo.saveProgress(row.id, { actions, state });
      // The challenger's own moves keep a tile battle from counting as left.
      if (side === PLAYER_SIDE && TILE_BATTLE_KINDS.has(row.kind)) {
        await options.tileBattles?.acted(tx, row.id, at);
      }
    }
    await appendTurned(repo, row, live, state.turn);
  };

  /**
   * Starts a battle against `opponentFor`'s side, or resumes the one going.
   * A battle going that can't go on (see `settle`) is ended first, and a new
   * one starts. The opponent is built inside the start transaction, after the
   * team check, so a refused start uses nothing up. `soloTeam` fights when
   * the player has nobody free (rescues only): all in the Hollow, or, since
   * squishy jobs, all the rest guarding or gathering.
   */
  const startWith = async (
    user: PublicUser,
    mapId: string,
    opponentFor: (
      tx: Executor,
      map: MapRow,
      at: Date,
      team: readonly TeamSquishyRow[],
    ) => Promise<Opponent>,
    soloTeam?: (tx: Executor) => Promise<TeamSquishyRow[]>,
  ): Promise<StartResult> => {
    await requireMember(db, user, mapId);
    const going = await store.findActive(mapId, user.id);
    if (going) {
      const row = await resolved(going);
      if (row.status === 'active') {
        return { battle: toPlayerBattle(row, await seatOf(db, row, user.id)), created: false };
      }
    }
    const begin = () =>
      store.transaction(async (repo, tx) => {
        // The player's battle seat first (before any row lock): a friendly
        // battle seating them as side `b` can't slip in beside this one.
        await repo.lockBattleSeats(mapId, [user.id]);
        const { map } = await requireMember(tx, user, mapId);
        const active = await repo.findActive(mapId, user.id);
        if (active) return { row: active, created: false };

        // The Glade's tutorial battles keep their team as it was before team
        // picking: its Glade friend stands watch in a step, and still fights.
        const listed = await repo.listTeam(mapId, user.id, content.rules.teamSize, {
          guardsToo: map.kind === 'tutorial',
        });
        const team = listed.length > 0 ? listed : ((await soloTeam?.(tx)) ?? []);
        if (team.length === 0) {
          // Squishies on watch or gathering don't battle (owner decisions 2026-10-04).
          const busy = await repo.hasActiveSquishy(mapId, user.id);
          throw new AppError('CONFLICT', busy ? MESSAGES.allBusy : MESSAGES.noTeam);
        }

        const at = now();
        const opponent = await opponentFor(tx, map, at, team);
        const fielded = opponent.team ?? team;
        const setup: BattleSetup = {
          seed: newSeed(),
          sides: { a: { controller: { type: 'player' }, squishies: fielded }, b: opponent.side },
          ...(opponent.turnLimit !== undefined && { turnLimit: opponent.turnLimit }),
        };
        const state = startBattle(content, setup);
        const arena = await arenaFor(repo, {
          mapId,
          userId: user.id,
          timeZone: map.timeZone,
          at,
          tile: opponent.tile,
        });
        const row = await repo.insertBattle({
          mapId,
          kind: opponent.kind,
          playerUserId: user.id,
          seed: setup.seed,
          contentHash: content.contentHash,
          setup: setup.sides,
          state,
          startedAt: at,
          spawn: opponent.spawn,
          arena,
        });
        const events = (await opponent.started?.(tx, row)) ?? [];
        // Meeting a squishy fills in its catalog page (design doc §21).
        await createSpawnsRepo(tx).markSeen(
          mapId,
          user.id,
          setupSpecies(opponent.side.squishies),
          row.startedAt,
        );
        await repo.appendEvent({
          mapId,
          type: 'battle.started',
          actorUserId: user.id,
          payload: {
            battleId: row.id,
            kind: row.kind,
            userId: user.id,
            teamSpecies: fielded.map((s) => s.speciesId),
            opponentSpecies: setupSpecies(opponent.side.squishies),
          },
        });
        for (const event of events) await repo.appendEvent(event);
        return { row, created: true };
      });
    let result: { row: BattleRow; created: boolean };
    try {
      result = await begin();
    } catch (err) {
      // A double tap raced us to the one-active-battle index: resume that one.
      if (!isUniqueViolation(err)) throw err;
      result = await begin();
    }
    if (result.created) published(mapId);
    return {
      battle: toPlayerBattle(result.row, await seatOf(db, result.row, user.id)),
      created: result.created,
    };
  };

  const startAgainst: BattlesService['startAgainst'] = (user, mapId, encounter) =>
    startWith(user, mapId, (_tx, map) => {
      // Tutorial maps script the opponent (tech spec §7 `tutorialOverrides`).
      const overrides = gameplayOverrides(map.kind);
      const policy = overrides?.opponent.ai ?? 'wild';
      const wild = encounter.squishies.map((s) =>
        overrides ? { ...s, level: overrides.opponent.level } : s,
      );
      return Promise.resolve({
        kind: 'wild',
        side: { controller: { type: 'ai', policy }, squishies: wild },
        spawn: encounter.spawn ?? null,
        // The tile the wild squishy spawned on; the dev route's has none.
        tile: encounter.spawn ? { q: encounter.spawn.q, r: encounter.spawn.r } : null,
      });
    });

  return {
    current: async (user, mapId) => {
      await requireMember(db, user, mapId);
      const row = await store.findActive(mapId, user.id);
      if (!row) return null;
      const latest = await resolved(row);
      return toPlayerBattle(latest, await seatOf(db, latest, user.id));
    },

    get: async (user, battleId) => {
      const { row } = await requireOwn(db, await store.findBattle(battleId), user);
      const latest = await resolved(row);
      return toPlayerBattle(latest, await seatOf(db, latest, user.id));
    },

    startWild: async (user, mapId, request = {}) => {
      const { map } = await requireMember(db, user, mapId);
      const active = await store.findActive(mapId, user.id);
      if (active) {
        const row = await resolved(active);
        return { battle: toPlayerBattle(row, await seatOf(db, row, user.id)), created: false };
      }
      const encounter = await options.findWildEncounter?.({
        mapId,
        userId: user.id,
        mapKind: map.kind,
        now: now(),
        tile: request.tile ?? null,
      });
      if (!encounter) throw new AppError('NOT_FOUND', MESSAGES.nobodyAround);
      return startAgainst(user, mapId, encounter);
    },

    startAgainst,

    startTile: (user, mapId, prepare) =>
      startWith(user, mapId, async (tx, map, at, team) => {
        const opponent = await prepare(tx, { map, at, team });
        return { ...opponent, spawn: null };
      }),

    startRescue: (user, mapId, prepare) =>
      startWith(
        user,
        mapId,
        async (tx, map, at) => {
          const opponent = await prepare.opponent(tx, { map, at });
          // The Hollow has no tile: the rescue sets off from the Heart Seed.
          return { kind: 'rescue', ...opponent, spawn: null, tile: null };
        },
        prepare.soloTeam,
      ),

    startJourney: (user, mapId, prepare) =>
      startWith(user, mapId, async (tx, map, at) => {
        const opponent = await prepare(tx, { map, at });
        return { kind: 'journey', ...opponent, spawn: null };
      }),

    act: async (user, battleId, request) => {
      const {
        row: next,
        mapId,
        befriended,
        live,
      } = await store.transaction(async (repo, tx) => {
        const {
          row: locked,
          map,
          seat,
        } = await requireOwn(tx, await repo.lockBattle(battleId), user);
        if (locked.status !== 'active') throw new AppError('CONFLICT', MESSAGES.over);
        const at = now();
        // Re-tuned content or a tile battle left: it ends instead (see `settle`).
        if (await settle(repo, tx, locked, at)) {
          return {
            row: await repo.findBattle(locked.id),
            mapId: locked.mapId,
            befriended: false,
            live: true,
          };
        }
        if (seat.live) {
          // A live battle (#29): passed deadlines first, so a late pick
          // can't land on a turn the AI already played.
          const row = await settleLive(repo, tx, locked, seat.live, at, { deferTurned: true });
          if (row.status !== 'active') {
            return { row, mapId: row.mapId, befriended: false, live: true };
          }
          // The AI already played the turn this pick was for: refused, which
          // rolls the settle back too; the next read settles it the same way.
          if (request.turn !== row.state.turn) throw new AppError('CONFLICT', MESSAGES.movedOn);
          const live = (await createLiveBattlesRepo(tx).find(row.id)) ?? seat.live;
          await actLive(repo, tx, row, live, seat.side, request, at);
          // The settle's own `battle.turned`, after the action's writes (`maps` last).
          if (row.actions.length !== locked.actions.length) {
            await appendTurned(repo, row, live, row.state.turn);
          }
          return {
            row: await repo.findBattle(row.id),
            mapId: row.mapId,
            befriended: false,
            live: true,
          };
        }
        const row = locked;
        // A stale or repeated submit (the client acted on an older turn) is
        // refused rather than applied to the turn after. Retries of the same
        // submit are covered by the Idempotency-Key header.
        if (request.turn !== row.state.turn) throw new AppError('CONFLICT', MESSAGES.movedOn);

        if (request.action.type === 'capture') {
          // Only wild squishies and neutral land's guardians (#279) can be
          // befriended: never a rival's squishies or fences. Each try uses a Heart Charm
          // (#17's inventory, ledgered against this battle), in this
          // transaction: a refused step gives it back. Lock order: battle,
          // inventory, a tile battle's tile, squishies, `species_seen`, then
          // `maps` via appendEvent.
          if (!CAPTURABLE_BATTLE_KINDS.has(row.kind))
            throw new AppError('CONFLICT', MESSAGES.noCapture);
          await consumeItems(
            tx,
            { mapId: row.mapId, userId: row.playerUserId },
            { [HEART_CHARM]: 1 },
            'capture',
            row.id,
          );
        } else if (request.action.type === 'item') {
          // A potion (#214) comes out of the bag in this transaction too, so
          // a refused step gives it back. Refusals the engine would make are
          // checked first, so they say why (not "You need 1 more …") and
          // lock no inventory row. None in the bag is CONFLICT from the bag.
          const { item } = request.action;
          const refusal = itemRefusal(content, row.state, PLAYER_SIDE, item);
          if (refusal === 'not-an-item') throw new AppError('CONFLICT', MESSAGES.notAPotion);
          if (refusal === 'used-up') throw new AppError('CONFLICT', MESSAGES.hadOne);
          await consumeItems(
            tx,
            { mapId: row.mapId, userId: row.playerUserId },
            { [item]: 1 },
            'battle-item',
            row.id,
          );
        }
        const sureCapture = gameplayOverrides(map.kind)?.captureAlwaysSucceeds === true;
        const action = toEngineAction(request.action, sureCapture);
        let state: BattleState;
        try {
          state = applyBattleAction(content, row.state, action);
        } catch (err) {
          if (err instanceof BattleRuleError) throw new AppError('CONFLICT', MESSAGES.badChoice);
          throw err;
        }
        const actions = [...row.actions, action];
        let befriended = false;
        if (state.phase.type === 'over') {
          await finish(repo, tx, row, actions, state, at);
        } else {
          await repo.saveProgress(row.id, { actions, state });
          if (TILE_BATTLE_KINDS.has(row.kind)) await options.tileBattles?.acted(tx, row.id, at);
          // A guardian befriended mid-battle joins now (#279), so it's the
          // player's whatever happens next. Its event is the last write.
          const friends = await welcome(repo, tx, row, befriendedIn(row.state, state), at);
          for (const friend of friends) await appendCaptured(repo, row, friend);
          befriended = friends.length > 0;
        }
        return {
          row: await repo.findBattle(row.id),
          mapId: row.mapId,
          befriended,
          live: false,
        };
      });
      if (!next) throw new AppError('NOT_FOUND', MESSAGES.notFound);
      // An ended battle wrote events, and so did a guardian befriended
      // mid-battle; every live step writes one (`battle.picked` or `.turned`).
      if (next.status !== 'active' || befriended || live) published(mapId);
      return toPlayerBattle(next, await seatOf(db, next, user.id));
    },

    startFriendly: async ({ mapId, aUserId, bUserId, started }) => {
      if (aUserId === bUserId) throw new AppError('VALIDATION_FAILED', MESSAGES.notYourself);
      const begin = () =>
        store.transaction(async (repo, tx) => {
          // Both players' battle seats, then their member rows (both in id order).
          await repo.lockBattleSeats(mapId, [aUserId, bUserId]);
          const maps = createMapsRepo(tx);
          // Both member rows, in id order (lock order step 2), so two asks
          // between the same players can't both start a battle.
          for (const userId of [aUserId, bUserId].sort()) {
            if (!(await maps.lockMember(mapId, userId))) {
              throw new AppError('NOT_FOUND', MESSAGES.notFound);
            }
          }
          const map = await maps.findMap(mapId);
          if (!map) throw new AppError('NOT_FOUND', MESSAGES.notFound);
          // The authoritative check, whoever calls: patches with friends only,
          // and only while the owner allows it.
          if (map.kind !== 'multiplayer') throw new AppError('CONFLICT', MESSAGES.friendlyTutorial);
          if (!map.friendlyChallenges) throw new AppError('CONFLICT', MESSAGES.friendlyOff);
          const teams: TeamSquishyRow[][] = [];
          for (const userId of [aUserId, bUserId]) {
            // One battle at a time each, on either side (`findActive` sees both).
            if (await repo.findActive(mapId, userId)) throw new AppError('CONFLICT', MESSAGES.busy);
            const team = await repo.listTeam(mapId, userId, content.rules.teamSize);
            if (team.length === 0) throw new AppError('CONFLICT', MESSAGES.noFriendlyTeam);
            teams.push(team);
          }
          const [aTeam = [], bTeam = []] = teams;
          const at = now();
          const setup: BattleSetup = {
            seed: newSeed(),
            sides: {
              a: { controller: { type: 'player' }, squishies: aTeam },
              b: { controller: { type: 'player' }, squishies: bTeam },
            },
          };
          const state = startBattle(content, setup);
          // At the Keeper who asked's Heart Seed (their home terrain).
          const arena = await arenaFor(repo, {
            mapId,
            userId: aUserId,
            timeZone: map.timeZone,
            at,
            tile: null,
          });
          const row = await repo.insertBattle({
            mapId,
            kind: 'friendly',
            playerUserId: aUserId,
            seed: setup.seed,
            contentHash: content.contentHash,
            setup: setup.sides,
            state,
            startedAt: at,
            spawn: null,
            arena,
          });
          await createLiveBattlesRepo(tx).insert({
            battleId: row.id,
            mapId,
            bUserId,
            deadlineAt: nextDeadline(at, liveRules),
            coverPolicy: { a: liveRules.coverPolicy, b: liveRules.coverPolicy },
          });
          const events = (await started?.(tx, row)) ?? [];
          // Each Keeper meets the other's squishies (the catalog, design doc §21).
          const spawns = createSpawnsRepo(tx);
          await spawns.markSeen(mapId, aUserId, setupSpecies(bTeam), at);
          await spawns.markSeen(mapId, bUserId, setupSpecies(aTeam), at);
          await repo.appendEvent({
            mapId,
            type: 'battle.started',
            actorUserId: aUserId,
            payload: {
              battleId: row.id,
              kind: row.kind,
              userId: aUserId,
              teamSpecies: aTeam.map((s) => s.speciesId),
              opponentSpecies: bTeam.map((s) => s.speciesId),
            },
          });
          for (const event of events) await repo.appendEvent(event);
          return row.id;
        });
      let battleId: string;
      try {
        battleId = await begin();
      } catch (err) {
        // A start that didn't take the seat lock (an older server mid-deploy)
        // reached the one-active-battle index first.
        if (isUniqueViolation(err)) throw new AppError('CONFLICT', MESSAGES.busy);
        throw err;
      }
      published(mapId);
      return battleId;
    },

    cheer: async (user, battleId, request) => {
      const message = quickMessageById(request.messageId);
      if (!message) throw new AppError('VALIDATION_FAILED', MESSAGES.unknownCheer);
      const mapId = await store.transaction(async (repo, tx) => {
        const { row, seat } = await requireOwn(tx, await repo.findBattle(battleId), user);
        if (!seat.live) throw new AppError('CONFLICT', MESSAGES.notLive);
        if (row.status !== 'active') throw new AppError('CONFLICT', MESSAGES.over);
        await repo.appendEvent({
          mapId: row.mapId,
          type: 'battle.cheered',
          actorUserId: user.id,
          payload: {
            battleId: row.id,
            aUserId: row.playerUserId,
            bUserId: seat.live.bUserId,
            side: seat.side,
            messageId: message.id,
          },
        });
        return row.mapId;
      });
      published(mapId);
    },

    grantSquishy: async (user, mapId, squishy) => {
      await requireMember(db, user, mapId);
      const species = squishy.speciesId
        ? content.species.get(squishy.speciesId)
        : [...content.species.values()][0];
      if (!species) throw new AppError('VALIDATION_FAILED', MESSAGES.unknownSpecies);
      return store.insertSquishy({
        mapId,
        ownerUserId: user.id,
        speciesId: species.id,
        element: species.element,
        feeling: species.feeling,
        level: squishy.level ?? 1,
        contentment: CARE_RULES.startContentment,
        at: now(),
      });
    },

    knownSpecies: () => [...content.species.values()],
  };
}

/** The dev route's opponent: a species the server knows, at a fair level. */
export function devEncounter(
  service: Pick<BattlesService, 'knownSpecies'>,
  opponent: { speciesId?: string; level?: number } | undefined,
): WildEncounter {
  const species = opponent?.speciesId
    ? service.knownSpecies().find((s) => s.id === opponent.speciesId)
    : service.knownSpecies()[0];
  if (!species) throw new AppError('VALIDATION_FAILED', MESSAGES.unknownSpecies);
  return {
    squishies: [{ id: 'wild-1', speciesId: species.id, level: opponent?.level ?? DEV_WILD_LEVEL }],
  };
}
