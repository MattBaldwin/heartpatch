import {
  applyBattleAction,
  BattleRuleError,
  itemRefusal,
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
import { DEV_WILD_LEVEL } from './limits.js';
import {
  createBattlesRepo,
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
 * reducer with the battle's own RNG.
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
  /** Applies one player action; the AI side answers inside the same step. */
  act: (user: PublicUser, battleId: string, request: BattleActionRequest) => Promise<PlayerBattle>;
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
  options: { mySide?: BattleSideId; state?: BattleState } = {},
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
  };
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

  const toPlayerBattle = (row: BattleRow): PlayerBattle => playerBattleView(content, row);

  /** The battle, if it's this player's and they're still on its map. */
  const requireOwn = async (
    tx: Executor,
    row: BattleRow | null,
    user: PublicUser,
  ): Promise<{ row: BattleRow; map: MapRow }> => {
    if (!row || row.playerUserId !== user.id) throw new AppError('NOT_FOUND', MESSAGES.notFound);
    const { map } = await requireMember(tx, user, row.mapId);
    return { row, map };
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

  /** An active battle that can't go on (see `settle`) is ended before it's shown. */
  const resolved = async (row: BattleRow): Promise<BattleRow> => {
    if (row.status !== 'active') return row;
    if (row.contentHash === content.contentHash && !(await abandoned(db, row, now()))) return row;
    const ended = await store.transaction(async (repo, tx) => {
      const locked = await repo.lockBattle(row.id);
      if (!locked || locked.status !== 'active') return locked;
      await settle(repo, tx, locked, now());
      return repo.findBattle(row.id);
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
    // Gentle mode's share (owner decision 2026-10-03): challenging a much
    // smaller player pays part of the battle's XP, win or lose.
    const awards = result.xp
      .filter((award) => award.side === PLAYER_SIDE)
      .map((award) => ({ ...award, xp: Math.floor((award.xp * tile.xpPercent) / 100) }))
      .filter((award) => award.xp > 0);
    // Base battle XP × care and habitat, levels and evolution (#19's
    // `applyXp`), under the squishy locks (the order above).
    await repo.lockSquishies(awards.map((a) => a.squishyId));
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
      if (row.status === 'active') return { battle: toPlayerBattle(row), created: false };
    }
    const begin = () =>
      store.transaction(async (repo, tx) => {
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
    return { battle: toPlayerBattle(result.row), created: result.created };
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
      return row ? toPlayerBattle(await resolved(row)) : null;
    },

    get: async (user, battleId) => {
      const { row } = await requireOwn(db, await store.findBattle(battleId), user);
      return toPlayerBattle(await resolved(row));
    },

    startWild: async (user, mapId, request = {}) => {
      const { map } = await requireMember(db, user, mapId);
      const active = await store.findActive(mapId, user.id);
      if (active) return { battle: toPlayerBattle(await resolved(active)), created: false };
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

    act: async (user, battleId, request) => {
      const {
        row: next,
        mapId,
        befriended,
      } = await store.transaction(async (repo, tx) => {
        const { row, map } = await requireOwn(tx, await repo.lockBattle(battleId), user);
        if (row.status !== 'active') throw new AppError('CONFLICT', MESSAGES.over);
        const at = now();
        // Re-tuned content or a tile battle left: it ends instead (see `settle`).
        if (await settle(repo, tx, row, at)) {
          return { row: await repo.findBattle(row.id), mapId: row.mapId, befriended: false };
        }
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
        return { row: await repo.findBattle(row.id), mapId: row.mapId, befriended };
      });
      if (!next) throw new AppError('NOT_FOUND', MESSAGES.notFound);
      // An ended battle wrote events, and so did a guardian befriended mid-battle.
      if (next.status !== 'active' || befriended) published(mapId);
      return toPlayerBattle(next);
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
