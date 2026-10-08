import {
  deriveSeed,
  GAME_DATA,
  GROWTH_RULES,
  hexKey,
  isTradingPost,
  JOURNEY_RULES,
  journeyFor,
  journeyTeam,
  postReach,
  tradingPostLabels,
  type Hex,
  type JourneyRules,
  type PostView,
  type PublicUser,
  type ReachTile,
  type StartJourneyRequest,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import { spawnWindowId } from '../../lib/time.js';
import type { BattlesService, JourneyBattlePort, StartResult } from '../battles/service.js';
import { createTerritoryRepo } from '../territory/repo.js';
import { createJourneysRepo } from './repo.js';

/*
 * Journeys to trading posts (#270; owner decisions 2 and 3 on #30). A post
 * that isn't connected to your land is visited by winning a journey
 * showdown: trail squishies whose level and number grow with the distance
 * from your nearest land (`JOURNEY_RULES`, uncapped). A win opens a visit pass
 * for `visitMinutes`; a loss costs nothing. A journey uses no daily try and
 * starts no tile cooldown, and trail squishies can't be befriended.
 */

// Kid-readable messages (style guide §6).
const MESSAGES = {
  notAPost: "There's no trading post there.",
  noLand: 'Claim some land first, then set off!',
  connected: 'Your land reaches this post. No journey needed!',
  open: 'This post is already open for you! 🏮',
  needJourney: 'This post is far from your land. Win a journey to visit it! 🧭',
} as const;

export interface JourneysService {
  /** Sets off on a journey to the post at (q, r), or resumes the battle going. */
  start: (user: PublicUser, mapId: string, request: StartJourneyRequest) => Promise<StartResult>;
}

export interface JourneysServiceOptions {
  battles: Pick<BattlesService, 'startJourney'>;
  /** Tests pass their own rules. */
  rules?: JourneyRules;
}

/** The map's secret seed; hand-authored maps fall back to their id (like spawns). */
const seedOf = (seed: string | null, mapId: string) =>
  seed ?? deriveSeed('hand-authored-map', mapId);

export function createJourneysService(options: JourneysServiceOptions): JourneysService {
  const rules = options.rules ?? JOURNEY_RULES;

  return {
    start: (user, mapId, request) =>
      options.battles.startJourney(user, mapId, async (tx, { map, at }) => {
        const territory = createTerritoryRepo(tx);
        const repo = createJourneysRepo(tx);
        // Read without locks: tiles only change through tile battles, which
        // never touch a post, and a reach that held when the journey started
        // is honoured (#30 contract §6).
        const tiles = await territory.listTiles(mapId);
        const post = tiles.find((t) => t.q === request.q && t.r === request.r);
        if (!post || !isTradingPost(post)) throw new AppError('NOT_FOUND', MESSAGES.notAPost);
        const reach = postReach(post, tiles, user.id);
        if (!reach) throw new AppError('CONFLICT', MESSAGES.noLand);
        if (reach.kind === 'connected') throw new AppError('CONFLICT', MESSAGES.connected);
        const passes = await repo.visitPasses(mapId, user.id, at);
        if (passes.some((p) => p.postTileId === post.id)) {
          throw new AppError('CONFLICT', MESSAGES.open);
        }
        const { distance } = reach;
        const { level, teamSize } = journeyFor(distance, rules, GROWTH_RULES.maxLevel);
        // Fixed per post, player and window (tech spec §8 "No rerolls"): a
        // retry in the same window meets the same team. Never revealed.
        const window = spawnWindowId(at, map.timeZone, rules.windowHours);
        const seed = deriveSeed(
          seedOf(await repo.mapSeed(mapId), mapId),
          'journey',
          post.q,
          post.r,
          user.id,
          window,
        );
        const trail = journeyTeam({ seed, distance }, rules, GROWTH_RULES.maxLevel);
        return {
          side: { controller: { type: 'ai', policy: 'wild' }, squishies: trail },
          tile: { q: post.q, r: post.r },
          started: async (startTx, battle): Promise<NewGameEvent[]> => {
            const journey = await createJourneysRepo(startTx).insertJourney({
              mapId,
              userId: user.id,
              postTileId: post.id,
              battleId: battle.id,
              distance,
              level,
              teamSize,
              startedAt: battle.startedAt,
            });
            return [
              {
                mapId,
                type: 'journey.started',
                actorUserId: user.id,
                payload: {
                  userId: user.id,
                  journeyId: journey.id,
                  battleId: battle.id,
                  q: post.q,
                  r: post.r,
                  distance,
                  level,
                  teamSize,
                },
              },
            ];
          },
        };
      }),
  };
}

/**
 * The battles service's hook for a journey's end (tech spec §7 step 5b: the
 * battle, then this row, then squishies, then `maps`). A win opens the visit
 * pass: `visit_until = ended_at + visitMinutes`.
 */
export function createJourneyBattlePort(rules: JourneyRules = JOURNEY_RULES): JourneyBattlePort {
  const end = async (
    tx: Executor,
    battleId: string,
    outcome: 'won' | 'lost' | 'no-contest',
    at: Date,
  ): Promise<NewGameEvent[]> => {
    const repo = createJourneysRepo(tx);
    const journey = await repo.lockJourneyByBattle(battleId);
    if (journey?.outcome !== 'active') return [];
    const visitUntil =
      outcome === 'won' ? new Date(at.getTime() + rules.visitMinutes * 60_000) : null;
    await repo.endJourney(journey.id, outcome, at, visitUntil);
    return [
      {
        mapId: journey.mapId,
        type: 'journey.ended',
        actorUserId: journey.userId,
        payload: {
          userId: journey.userId,
          journeyId: journey.id,
          battleId,
          q: journey.q,
          r: journey.r,
          result: outcome,
          visitUntil: visitUntil?.toISOString() ?? null,
        },
      },
    ];
  };
  return {
    // The player is always side `a` (battles `PLAYER_SIDE`); a draw is no win.
    ended: (tx, battle, winner, at) => end(tx, battle.id, winner === 'a' ? 'won' : 'lost', at),
    noContest: (tx, battle, at) => end(tx, battle.id, 'no-contest', at),
  };
}

/**
 * The viewer's trading posts for `MapView.posts` (#270), in index order: how
 * they reach each one (the shared `postReach`), the journey's level and team
 * size, and their visit pass while it's good.
 */
export async function listPostViews(
  tx: Executor,
  input: {
    mapId: string;
    userId: string;
    tiles: readonly (ReachTile & { readonly terrain: string })[];
    at: Date;
    rules?: JourneyRules;
  },
): Promise<PostView[]> {
  const rules = input.rules ?? JOURNEY_RULES;
  const labels = tradingPostLabels(input.tiles, GAME_DATA.mapGen.tradingPosts);
  if (labels.size === 0) return [];
  const passes = await createJourneysRepo(tx).visitPasses(input.mapId, input.userId, input.at);
  const passAt = new Map(passes.map((p) => [hexKey(p), p.visitUntil]));
  return input.tiles
    .filter(isTradingPost)
    .flatMap((post) => {
      const label = labels.get(hexKey(post));
      if (!label) return [];
      const reach = postReach(post, input.tiles, input.userId);
      const journey =
        reach?.kind === 'journey' ? journeyFor(reach.distance, rules, GROWTH_RULES.maxLevel) : null;
      return [
        {
          q: post.q,
          r: post.r,
          index: label.index,
          reach: reach?.kind ?? null,
          distance: reach?.kind === 'journey' ? reach.distance : null,
          level: journey?.level ?? null,
          teamSize: journey?.teamSize ?? null,
          visitUntil: passAt.get(hexKey(post))?.toISOString() ?? null,
        },
      ];
    })
    .sort((a, b) => a.index - b.index);
}

/**
 * Every post command checks this first (#270): the post is connected to the
 * player's land, or they hold a visit pass for it. Throws `NOT_FOUND` for a
 * tile that isn't a post and `FORBIDDEN` when a journey is needed. Reads
 * without locks (#30 contract §6): a reach or pass that held when the command
 * started is honoured.
 */
export async function requirePostAccess(
  tx: Executor,
  input: { mapId: string; userId: string; post: Hex; at: Date },
): Promise<void> {
  const tiles = await createTerritoryRepo(tx).listTiles(input.mapId);
  const post = tiles.find((t) => t.q === input.post.q && t.r === input.post.r);
  if (!post || !isTradingPost(post)) throw new AppError('NOT_FOUND', MESSAGES.notAPost);
  if (postReach(post, tiles, input.userId)?.kind === 'connected') return;
  const passes = await createJourneysRepo(tx).visitPasses(input.mapId, input.userId, input.at);
  if (passes.some((p) => p.postTileId === post.id)) return;
  throw new AppError('FORBIDDEN', MESSAGES.needJourney);
}
