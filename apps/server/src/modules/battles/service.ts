import {
  applyBattleAction,
  BattleRuleError,
  ClientBattleViewSchema,
  clientBattleView,
  createBattleContent,
  GAME_DATA,
  gameplayOverrides,
  getSpecies,
  startBattle,
  type BattleAction,
  type BattleActionRequest,
  type BattleContent,
  type BattleSetup,
  type BattleSideId,
  type BattleSquishySetup,
  type BattleState,
  type Move,
  type OwnedSquishy,
  type PlayerBattle,
  type PublicUser,
  type Species,
} from '@heartpatch/shared';
import { SERVER_GAME_DATA, serverBattleData } from '@heartpatch/shared/server';
import type { Executor } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import { AppError } from '../../lib/errors.js';
import { newSeed } from '../../lib/rng.js';
import type { Clock } from '../../lib/time.js';
import { createMapsRepo, type MapRow } from '../maps/repo.js';
import { DEV_WILD_LEVEL } from './limits.js';
import { createBattlesRepo, type BattleRow, type BattlesTxRepo } from './repo.js';

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
}

export interface WildEncounterContext {
  mapId: string;
  userId: string;
  mapKind: MapRow['kind'];
  now: Date;
}

export interface BattlesService {
  /** The player's battle to resume on this map, or null. */
  current: (user: PublicUser, mapId: string) => Promise<PlayerBattle | null>;
  get: (user: PublicUser, battleId: string) => Promise<PlayerBattle>;
  /**
   * Picks a fight with whatever wild squishy is around (`findWildEncounter`),
   * or resumes the battle already going (`created: false`).
   */
  startWild: (user: PublicUser, mapId: string) => Promise<StartResult>;
  /** Starts a wild battle against a given team (spawns, and the dev route). */
  startAgainst: (user: PublicUser, mapId: string, encounter: WildEncounter) => Promise<StartResult>;
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
}

// Kid-readable messages (style guide §6).
const MESSAGES = {
  notFound: "We couldn't find that battle.",
  noMap: "We couldn't find that patch.",
  noTeam: 'You need a squishy friend first!',
  nobodyAround: 'No wild squishies around right now. Try again soon!',
  over: 'That battle is already over.',
  movedOn: 'The battle moved on. Take another look!',
  badChoice: "That's not a move you can make right now. Try another!",
  unknownSpecies: "We don't know that squishy.",
} as const;

export function defaultBattleContent(): BattleContent {
  return createBattleContent(serverBattleData(GAME_DATA, SERVER_GAME_DATA));
}

/** Ids every client already has: the public data tables. */
const PUBLIC_SPECIES = new Set(GAME_DATA.species.map((s) => s.id));
const PUBLIC_MOVES = new Set(GAME_DATA.moves.map((m) => m.id));

export function createBattlesService(options: BattlesServiceOptions): BattlesService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const content = options.content ?? defaultBattleContent();
  /** After commit only (apps/server/README.md, "Live sync"). */
  const published = (mapId: string) => {
    void options.publish?.(mapId);
  };
  const store = createBattlesRepo(db);

  /** The map, for an active member. NOT_FOUND otherwise, so maps can't be probed. */
  const requireMember = async (tx: Executor, user: PublicUser, mapId: string) => {
    const maps = createMapsRepo(tx);
    const [map, membership] = await Promise.all([
      maps.findMap(mapId),
      maps.membership(mapId, user.id),
    ]);
    if (!map || membership?.status !== 'active') throw new AppError('NOT_FOUND', MESSAGES.noMap);
    return map;
  };

  /**
   * Rows the client may not have: species and moves outside the public tables
   * (a secret squishy the player just met), so it can draw and name them.
   */
  const defsFor = (state: BattleState): { speciesDefs: Species[]; moveDefs: Move[] } => {
    const speciesDefs = new Map<string, Species>();
    const moveDefs = new Map<string, Move>();
    for (const side of [state.sides.a, state.sides.b]) {
      for (const squishy of side.squishies) {
        if (!PUBLIC_SPECIES.has(squishy.speciesId)) {
          speciesDefs.set(squishy.speciesId, getSpecies(content, squishy.speciesId));
        }
        for (const id of squishy.moves) {
          const move = content.moves.get(id);
          if (move && !PUBLIC_MOVES.has(id)) moveDefs.set(id, move);
        }
      }
    }
    return { speciesDefs: [...speciesDefs.values()], moveDefs: [...moveDefs.values()] };
  };

  const toPlayerBattle = (row: BattleRow): PlayerBattle => ({
    id: row.id,
    mapId: row.mapId,
    kind: row.kind,
    status: row.status,
    mySide: PLAYER_SIDE,
    // Parsed on the way out too, so a view can never carry `rng` (rule 6).
    view: ClientBattleViewSchema.parse(clientBattleView(row.state)),
    ...defsFor(row.state),
    // The seed predicts every roll, so it stays secret until the end (tech spec §8).
    seed: row.status === 'active' ? null : row.seed,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
  });

  /** The battle, if it's this player's. */
  const requireOwn = (row: BattleRow | null, user: PublicUser): BattleRow => {
    if (!row || row.playerUserId !== user.id) throw new AppError('NOT_FOUND', MESSAGES.notFound);
    return row;
  };

  /**
   * The content was re-tuned while this battle ran: its stored state can't be
   * stepped with today's rules, so it ends as no contest (COORDINATOR §9).
   * Nothing is won or lost. Wild battles cost no attempt; a kind that does
   * (tile guardians, #14) refunds it here.
   */
  const endNoContest = async (repo: BattlesTxRepo, row: BattleRow, at: Date): Promise<void> => {
    await repo.finish(row.id, {
      status: 'no-contest',
      actions: row.actions,
      state: row.state,
      result: null,
      log: [...row.state.log],
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

  /** An active battle whose content has moved on is ended before it's shown. */
  const resolved = async (row: BattleRow): Promise<BattleRow> => {
    if (row.status !== 'active' || row.contentHash === content.contentHash) return row;
    const ended = await store.transaction(async (repo) => {
      const locked = await repo.lockBattle(row.id);
      if (!locked || locked.status !== 'active') return locked;
      await endNoContest(repo, locked, now());
      return repo.findBattle(row.id);
    });
    published(row.mapId);
    if (!ended) throw new AppError('NOT_FOUND', MESSAGES.notFound);
    return ended;
  };

  /** The engine's `BattleAction` for the player's intent; the client never names a side. */
  const toEngineAction = (action: BattleActionRequest['action']): BattleAction => {
    switch (action.type) {
      case 'move':
        return { type: 'turn', choices: { [PLAYER_SIDE]: { type: 'move', move: action.move } } };
      case 'swap':
        return { type: 'turn', choices: { [PLAYER_SIDE]: { type: 'swap', slot: action.slot } } };
      case 'replace':
        return { type: 'replace', side: PLAYER_SIDE, slot: action.slot };
      case 'forfeit':
        return { type: 'forfeit', side: PLAYER_SIDE };
    }
  };

  /** The battle is over: XP for the player's squishies, then the event. */
  const finish = async (
    repo: BattlesTxRepo,
    row: BattleRow,
    actions: BattleAction[],
    state: BattleState,
    at: Date,
  ): Promise<void> => {
    if (state.phase.type !== 'over') throw new Error('finish: the battle is not over');
    const { result } = state.phase;
    const awards = result.xp.filter((award) => award.side === PLAYER_SIDE && award.xp > 0);
    // Base battle XP only (design doc §7); care and habitat multipliers come
    // with care (#19), and levelling with the XP curve. Lock order: squishies,
    // then `maps` via appendEvent.
    await repo.lockSquishies(awards.map((a) => a.squishyId));
    for (const award of awards) await repo.addXp(award.squishyId, award.xp);
    await repo.finish(row.id, {
      status: 'finished',
      actions,
      state,
      result,
      log: [...state.log],
      endedAt: at,
    });
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
        xp: awards.map(({ squishyId, xp }) => ({ squishyId, xp })),
      },
    });
  };

  const startAgainst: BattlesService['startAgainst'] = async (user, mapId, encounter) => {
    const begin = () =>
      store.transaction(async (repo, tx) => {
        const map = await requireMember(tx, user, mapId);
        const active = await repo.findActive(mapId, user.id);
        if (active) return { row: active, created: false };

        const team = await repo.listTeam(mapId, user.id, content.rules.teamSize);
        if (team.length === 0) throw new AppError('CONFLICT', MESSAGES.noTeam);

        // Tutorial maps script the opponent (tech spec §7 `tutorialOverrides`).
        const overrides = gameplayOverrides(map.kind);
        const policy = overrides?.opponent.ai ?? 'wild';
        const wild = encounter.squishies.map((s) =>
          overrides ? { ...s, level: overrides.opponent.level } : s,
        );
        const setup: BattleSetup = {
          seed: newSeed(),
          sides: {
            a: { controller: { type: 'player' }, squishies: team },
            b: { controller: { type: 'ai', policy }, squishies: wild },
          },
        };
        const state = startBattle(content, setup);
        const row = await repo.insertBattle({
          mapId,
          kind: 'wild',
          playerUserId: user.id,
          seed: setup.seed,
          contentHash: content.contentHash,
          setup: setup.sides,
          state,
          startedAt: now(),
        });
        await repo.appendEvent({
          mapId,
          type: 'battle.started',
          actorUserId: user.id,
          payload: {
            battleId: row.id,
            kind: row.kind,
            userId: user.id,
            teamSpecies: team.map((s) => s.speciesId),
            opponentSpecies: wild.map((s) => s.speciesId),
          },
        });
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

  return {
    current: async (user, mapId) => {
      await requireMember(db, user, mapId);
      const row = await store.findActive(mapId, user.id);
      return row ? toPlayerBattle(await resolved(row)) : null;
    },

    get: async (user, battleId) => {
      const row = requireOwn(await store.findBattle(battleId), user);
      return toPlayerBattle(await resolved(row));
    },

    startWild: async (user, mapId) => {
      const map = await requireMember(db, user, mapId);
      const active = await store.findActive(mapId, user.id);
      if (active) return { battle: toPlayerBattle(await resolved(active)), created: false };
      const encounter = await options.findWildEncounter?.({
        mapId,
        userId: user.id,
        mapKind: map.kind,
        now: now(),
      });
      if (!encounter) throw new AppError('NOT_FOUND', MESSAGES.nobodyAround);
      return startAgainst(user, mapId, encounter);
    },

    startAgainst,

    act: async (user, battleId, request) => {
      const { row: next, mapId } = await store.transaction(async (repo) => {
        const row = requireOwn(await repo.lockBattle(battleId), user);
        if (row.status !== 'active') throw new AppError('CONFLICT', MESSAGES.over);
        const at = now();
        if (row.contentHash !== content.contentHash) {
          await endNoContest(repo, row, at);
          return { row: await repo.findBattle(row.id), mapId: row.mapId };
        }
        // A stale or repeated submit (the client acted on an older turn) is
        // refused rather than applied to the turn after. Retries of the same
        // submit are covered by the Idempotency-Key header.
        if (request.turn !== row.state.turn) throw new AppError('CONFLICT', MESSAGES.movedOn);

        const action = toEngineAction(request.action);
        let state: BattleState;
        try {
          state = applyBattleAction(content, row.state, action);
        } catch (err) {
          if (err instanceof BattleRuleError) throw new AppError('CONFLICT', MESSAGES.badChoice);
          throw err;
        }
        const actions = [...row.actions, action];
        if (state.phase.type === 'over') await finish(repo, row, actions, state, at);
        else await repo.saveProgress(row.id, { actions, state });
        return { row: await repo.findBattle(row.id), mapId: row.mapId };
      });
      if (!next) throw new AppError('NOT_FOUND', MESSAGES.notFound);
      if (next.status !== 'active') published(mapId);
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
