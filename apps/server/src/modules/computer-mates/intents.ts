import {
  addFuel,
  attackTargetProblem,
  deriveSeed,
  fuelSpace,
  HOME_BASE_RULES,
  hexDistance,
  isTileFenced,
  LIVE_BATTLE_RULES,
  Rng,
  stancePolicy,
  TERRITORY_RULES,
  tradeValuer,
  type TradeLine,
  type ValuedLine,
} from '@heartpatch/shared';
import {
  challengesLeft,
  COMPUTER_MATES,
  inQuietHours,
  mateTeamLevel,
  nextIntent,
  type ComputerMatesSecrets,
  type ComputerPersonaTuning,
  type MateIncomingOffer,
  type MateIntent,
  type MateTradingView,
  type MateView,
} from '@heartpatch/shared/server';
import type { Database, Executor, Transaction } from '../../db/client.js';
import { appendGameEvent, type NewGameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import { localDate, localDayStart, mapLocalTime, type Clock } from '../../lib/time.js';
import { createBattlesRepo } from '../battles/repo.js';
import type { BattlesService } from '../battles/service.js';
import { BUILDING_DATA, toPublicBuilding } from '../buildings/hearthfire.js';
import { createBuildingsRepo } from '../buildings/repo.js';
import { heartSeedOf } from '../maps/depart.js';
import { createMapsRepo } from '../maps/repo.js';
import {
  createTendingRepo,
  createTerritoryRepo,
  type TerritoryTileRow,
} from '../territory/repo.js';
import { createFencesRepo } from '../fences/repo.js';
import type { ComputerChallenge, TerritoryService } from '../territory/service.js';
import { createTradesRepo } from '../trades/repo.js';
import { createTradesService } from '../trades/service.js';
import { createComputerMatesRepo, mateTransaction, type MateState } from './repo.js';

const MINUTE_MS = 60 * 1000;
/** Patches `seen` remembers before it sweeps out stale entries. */
const SEEN_MAX = 10_000;
/** The fire a mate lights (#202's Hearthfire, level 1). */
const FIRE_ID = 'hearthfire';
/** A fire stands in its tile's middle (#204). */
const FIRE_SPOT = 0;
const WEEK_MS = 7 * 24 * 60 * MINUTE_MS;
// Kid-readable messages (style guide §6). A refused mate challenge is never
// shown to a kid (the step just does something else); it's here so every
// refusal reads the same way.
const MESSAGES = {
  noChallenge: 'A computer friend can’t challenge that tile right now.',
};

/**
 * What a mate's trade and gift choices read (#386d): the kids' open offers
 * to it (valued with every species known: server-side only), the caps'
 * counts, and the kids it may send to with their tradable items.
 */
async function tradingView(
  tx: Transaction,
  input: { mapId: string; userId: string; kidIds: readonly string[]; timeZone: string; at: Date },
): Promise<MateTradingView> {
  const { mapId, userId, kidIds, at } = input;
  const repo = createTradesRepo(tx);
  const enabled = await repo.tradingEnabled(mapId);
  const open = (await repo.openOffersOf(mapId, userId)).filter((o) => o.expiresAt > at);
  const toMe = open
    .filter((o) => o.toUserId === userId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1));
  const lines = await repo.linesOf(toMe.map((o) => o.id));
  const pets = new Map(
    (
      await repo.squishiesByIds(
        lines.flatMap((l) => (l.line.kind === 'squishy' ? [l.line.squishyId] : [])),
      )
    ).map((p) => [p.id, p]),
  );
  const pieces = new Map(
    (
      await repo.piecesByIds(
        lines.flatMap((l) => (l.line.kind === 'clothing' ? [l.line.clothingId] : [])),
      )
    ).map((p) => [p.id, p]),
  );
  const valued = (line: TradeLine): ValuedLine => {
    if (line.kind === 'item') return line;
    if (line.kind === 'clothing') {
      return { kind: 'clothing', itemId: pieces.get(line.clothingId)?.itemId ?? '' };
    }
    const pet = pets.get(line.squishyId);
    return { kind: 'squishy', speciesId: pet?.speciesId ?? null, level: pet?.level ?? 1 };
  };
  const incoming: MateIncomingOffer[] = toMe.map((o) => {
    const side = (which: 'give' | 'want') =>
      lines.filter((l) => l.offerId === o.id && l.side === which).map((l) => l.line);
    return {
      id: o.id,
      kind: o.kind,
      waitedMinutes: (at.getTime() - o.createdAt.getTime()) / MINUTE_MS,
      giveValue: tradeValuer.sideValue(side('give').map(valued)),
      wantValue: tradeValuer.sideValue(side('want').map(valued)),
      wantsItemsOnly: side('want').every((l) => l.kind === 'item'),
      wantItemIds: side('want').flatMap((l) => (l.kind === 'item' ? [l.itemId] : [])),
    };
  });
  const counts = await repo.computerTradeCounts(
    mapId,
    userId,
    localDayStart(at, input.timeZone),
    new Date(at.getTime() - WEEK_MS),
  );
  const busy = new Set(open.filter((o) => o.fromUserId === userId).map((o) => o.toUserId));
  const kids = [];
  for (const kidId of [...kidIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (busy.has(kidId) || !(await repo.isActiveMember(mapId, kidId))) continue;
    kids.push({ userId: kidId, bag: await repo.bagOf(mapId, kidId) });
  }
  return { enabled, incoming, ...counts, kids };
}

/** What one step did (tests and logs). */
export interface MateStepResult {
  intent: MateIntent['kind'] | null;
  /** The intent's tile was taken, moved on, or refused under the locks: the step only tended. */
  applied: boolean;
  catchUp: boolean;
  tended: number;
  fuelled: number;
  levelled: number;
}

export interface ComputerMateStepsOptions {
  db: Database;
  clock?: Clock;
  secrets?: ComputerMatesSecrets;
  publish?: (mapId: string) => Promise<void>;
  /** Patches someone has open right now (the WS hub's in-memory `openMaps`): no DB scan. */
  openMaps?: () => Iterable<string>;
  /** How often `seen` writes a patch's stamp, at most (ms). */
  seenThrottleMs?: number;
  /** Where a failed stamp in `due` is reported; the sweep goes on without it. */
  log?: { error: (obj: object, msg: string) => void };
  /** A challenge on a kid's tile (#386e) starts through territory's own `prepare`. */
  territory?: Pick<TerritoryService, 'attackAsComputer'>;
  /** The mate's battle is played out, or its live deadlines settled, on each step (#386e). */
  battles?: Pick<BattlesService, 'settleComputer'>;
  /** The "Defend now?" window (#29-C): a challenge's next step comes right after it. */
  defensePromptSeconds?: number;
  /**
   * Is this kid's app open on this patch right now (`wsHub.isOnline`)? A
   * mate challenges only a kid who is (#823 ruling). Without one, nobody
   * is, so mates never challenge.
   */
  isOnline?: (mapId: string, userId: string) => boolean;
}

export interface ComputerMateSteps {
  /** A real member opened the patch: stamps `keepers_seen_at` (throttled in memory). */
  seen: (mapId: string) => Promise<void>;
  /** Mates due a step on warm patches; a patch someone has open now (`openMaps`) counts as warm. */
  due: (limit?: number) => Promise<{ userId: string; step: number }[]>;
  /** One step: a retry, a duplicate or a departed mate's step does nothing (null). */
  act: (userId: string, step: number) => Promise<MateStepResult | null>;
}

/**
 * Computer patch-mates act (#386c, plan §1 C–E, §5, §6). Every step is one
 * transaction: the mate's own row first (step 3a), then tiles (6), the
 * guard's `tile_defenders`, buildings (8), squishies (10), `maps` last (13).
 * It tends their land, keeps their fires full, sets their team's levels to
 * the owner's Partner level plus the persona's offset, then applies the one
 * intent the shared policy picks. They cost nothing: a fire is placed and
 * fuelled without a bill (plan §6, difference 2), and a wild claim skips the
 * battle (difference 1) but keeps every rule `attackTargetProblem` has.
 */
export function createComputerMateSteps(options: ComputerMateStepsOptions): ComputerMateSteps {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const secrets = options.secrets ?? COMPUTER_MATES;
  const { rules } = secrets;
  const throttle = options.seenThrottleMs ?? 3 * MINUTE_MS;
  const isOnline = options.isOnline ?? (() => false);
  const lastSeen = new Map<string, number>();

  const seen = async (mapId: string) => {
    const at = now();
    const last = lastSeen.get(mapId);
    if (last !== undefined && at.getTime() - last < throttle) return;
    // Bounded: entries past the throttle are no use, so drop them now and then.
    // If more than SEEN_MAX patches are all inside the window this scan runs on
    // every call and the map still grows; fine at our scale (one entry per open
    // patch), revisit with an LRU if that ever stops being true.
    if (lastSeen.size >= SEEN_MAX) {
      for (const [id, t] of lastSeen) if (at.getTime() - t >= throttle) lastSeen.delete(id);
    }
    lastSeen.set(mapId, at.getTime());
    try {
      await createComputerMatesRepo(db).stampSeen(mapId, at);
    } catch (err) {
      // Not stamped: let the next call try again instead of waiting out the window.
      lastSeen.delete(mapId);
      throw err;
    }
  };

  const due = async (limit = 200) => {
    const at = now();
    const warmSince = new Date(at.getTime() - rules.warmMinutes * MINUTE_MS);
    // A kid who has had the patch open longer than warmMinutes still counts:
    // the hub's open patches are stamped (throttled), so cold patches cost nothing.
    // One failed stamp mustn't skip the sweep: log it and carry on.
    for (const mapId of options.openMaps?.() ?? []) {
      try {
        await seen(mapId);
      } catch (err: unknown) {
        options.log?.error({ err, mapId }, 'computer mates: stamping an open patch failed');
      }
    }
    const repo = createComputerMatesRepo(db);
    return repo.dueMates(at, warmSince, limit);
  };

  const act = async (userId: string, step: number): Promise<MateStepResult | null> => {
    const at = now();
    const out = await mateTransaction(db, (tx) =>
      stepWithin(tx, userId, step, at, secrets, isOnline),
    );
    if (!out) return null;
    void options.publish?.(out.mapId);
    // Its battle (#386e), each in its own transactions after the step's:
    // a battle start takes the seat first (tech spec §7 step 0), never
    // after the step's row locks, so it can't run inside the step.
    const going = (await options.battles?.settleComputer(out.mapId, userId)) ?? false;
    if (!out.challenge || going || !options.territory) return out.result;
    const applied = await challenge(out.mapId, userId, out.challenge, at);
    return { ...out.result, applied };
  };

  /**
   * A challenge on a kid's tile (plan §1 D, §6): territory's `attackAsComputer`,
   * every raid rule a kid's has plus the mates' own, rechecked under the
   * tile lock and the patch's challenge lock. A refusal does nothing. One
   * nobody is asked to defend plays out at once; while "Defend now?" waits,
   * the mate's next step comes just after the window, to play it out then.
   */
  const challenge = async (
    mapId: string,
    userId: string,
    target: { q: number; r: number; persona: ComputerPersonaTuning },
    at: Date,
  ): Promise<boolean> => {
    const territory = options.territory;
    if (!territory) return false;
    const computer = computerChallenge(target.persona, rules, isOnline);
    try {
      const started = await territory.attackAsComputer(
        // Only its id is read (its seat, member row and side a).
        { id: userId, username: '' },
        mapId,
        { q: target.q, r: target.r },
        computer,
      );
      if (!started.created) return false;
    } catch (err) {
      if (err instanceof AppError) return false;
      throw err;
    }
    const going = (await options.battles?.settleComputer(mapId, userId)) ?? false;
    if (going) {
      const window = options.defensePromptSeconds ?? LIVE_BATTLE_RULES.defensePromptSeconds;
      await createComputerMatesRepo(db).wakeBy(
        userId,
        new Date(at.getTime() + window * 1000 + MINUTE_MS),
      );
    }
    return true;
  };

  return { seen, due, act };
}

async function stepWithin(
  tx: Transaction,
  userId: string,
  step: number,
  at: Date,
  secrets: ComputerMatesSecrets,
  isOnline: (mapId: string, userId: string) => boolean,
): Promise<{
  mapId: string;
  result: MateStepResult;
  /** A challenge to start once the step commits (#386e). */
  challenge?: { q: number; r: number; persona: ComputerPersonaTuning };
} | null> {
  const { rules } = secrets;
  const mates = createComputerMatesRepo(tx);
  // Step 3a: the mate's row. Departing (switch off, a friend's seat) sets
  // `next_act_at` null under the same lock, so a queued step finds it here.
  const row = await mates.lockMate(userId);
  if (!row || row.nextActAt === null || row.step !== step || row.nextActAt > at) return null;
  const persona = secrets.personas.find((p) => p.id === row.personaId);
  const map = await createMapsRepo(tx).findMap(row.mapId);
  if (!persona || !map) return null;
  const mapId = map.id;

  // Rule C: after a gap, a few quiet steps (claims and tending only).
  const state: MateState = { ...row.state };
  const lagMinutes = (at.getTime() - row.nextActAt.getTime()) / MINUTE_MS;
  let catchUp = false;
  if ((state.catchUpLeft ?? 0) > 0) {
    catchUp = true;
    state.catchUpLeft = (state.catchUpLeft ?? 1) - 1;
  } else if (lagMinutes > rules.stepMinutes.max + rules.warmMinutes) {
    const steps = Math.min(
      rules.catchUpSteps,
      Math.floor(lagMinutes / Math.max(1, rules.stepMinutes.max)),
    );
    if (steps > 0) {
      catchUp = true;
      state.catchUpLeft = steps - 1;
    }
  }
  const today = localDate(at, map.timeZone);
  if (state.claimDay !== today) {
    state.claimDay = today;
    state.claims = 0;
  }

  // The view, read before the locks; everything the intent needs is checked again under them.
  const territory = createTerritoryRepo(tx);
  const buildingsRepo = createBuildingsRepo(tx);
  const tiles = await territory.listTiles(mapId);
  const mateIds = new Set((await mates.personasOn(mapId)).keys());
  const homes = new Map<string, { q: number; r: number }[]>();
  for (const t of tiles) {
    if (t.homeSlot === null || t.ownerUserId === null || mateIds.has(t.ownerUserId)) continue;
    homes.set(t.ownerUserId, [...(homes.get(t.ownerUserId) ?? []), { q: t.q, r: t.r }]);
  }
  const owned = await buildingsRepo.listOwned(mapId, userId);
  const fires = owned.filter((b) => b.kind === 'hearthfire');
  const onMap = await buildingsRepo.listOnMap(mapId);
  const posts = await territory.myDefenders(mapId, userId);
  const team = await mates.teamOf(mapId, userId);
  const posted = new Set(posts.flatMap((p) => p.squishyIds));
  const contested = await mates.openAttackTileIds(mapId);
  const view: MateView = {
    userId,
    tiles,
    kids: [...homes].map(([kid, home]) => ({ userId: kid, heartSeed: heartSeedOf(home) })),
    seats: map.maxPlayers,
    claimsToday: state.claims ?? 0,
    catchUp,
    fires: fires.map((f) => ({ q: f.q, r: f.r })),
    built: onMap.map((b) => ({ q: b.q, r: b.r })),
    guarded: posts.map((p) => ({ q: p.q, r: p.r })),
    freeSquishies: team.filter((s) => s.state === 'active' && !posted.has(s.id)).length,
    contested: tiles.filter((t) => contested.has(t.id)).map((t) => ({ q: t.q, r: t.r })),
    ...(catchUp
      ? {}
      : {
          challenge: {
            pvpMode: map.pvpMode,
            thisWeek: await mates.challengesSince(mapId, new Date(at.getTime() - WEEK_MS)),
            localHour: Math.floor(mapLocalTime(at, map.timeZone).minute / 60),
            busy: (await createBattlesRepo(tx).findActive(mapId, userId)) !== null,
            shielded: await shieldedKids(tx, mapId, [...homes.keys()], at),
            online: [...homes.keys()].filter((kid) => isOnline(mapId, kid)),
            fenced: await fencedKidTiles(tx, mapId, tiles, homes),
          },
          trading: await tradingView(tx, {
            mapId,
            userId,
            kidIds: [...homes.keys()],
            timeZone: map.timeZone,
            at,
          }),
        }),
  };
  const intent = nextIntent(view, persona, rules, Rng.fromSeed(deriveSeed(row.seed, step)));
  const tileIntent = intent && 'q' in intent ? intent : null;
  const target =
    tileIntent === null
      ? undefined
      : tiles.find((t) => t.q === tileIntent.q && t.r === tileIntent.r);

  // Step 6: their outer land (to tend) and the intent's tile, one id-ordered lock.
  const outerIds = tiles
    .filter((t) => t.ownerUserId === userId && t.homeSlot === null)
    .map((t) => t.id);
  const tending = createTendingRepo(tx);
  const locked = new Map(
    (await tending.lockTiles([...new Set([...outerIds, ...(target ? [target.id] : [])])])).map(
      (t) => [t.id, t.ownerUserId],
    ),
  );
  const events: NewGameEvent[] = [];
  let applied = false;
  if (intent && target) {
    const holder = locked.get(target.id);
    // Re-checked under the lock: still wild, nobody battling for it (a
    // battle's start locks the tile first), and still next to the mate's land.
    const claimable =
      intent.kind === 'claim' &&
      holder === null &&
      !(await mates.openAttackTileIds(mapId)).has(target.id) &&
      attackTargetProblem(
        { ...target, ownerUserId: null },
        (await territory.listTiles(mapId)).map((t) => ({
          ...t,
          ownerUserId: locked.get(t.id) ?? t.ownerUserId,
        })),
        userId,
        'off',
      ) === null;
    if (claimable) {
      await territory.setOwner(target.id, userId);
      // Claiming land tends it, and it's safe on its first night (#277), as a won battle's capture.
      await tending.claim(mapId, target.id, at);
      locked.set(target.id, userId);
      state.claims = (state.claims ?? 0) + 1;
      events.push({
        mapId,
        type: 'tile.claimed',
        actorUserId: userId,
        payload: { userId, q: target.q, r: target.r, terrain: target.terrain, computer: true },
      });
      applied = true;
    }
  }
  const mine = [...locked].filter(([, owner]) => owner === userId).map(([id]) => id);
  await tending.tend(mapId, mine, at);

  // Step 6 (`tile_defenders`), written after the squishy locks below, as `setDefenders`.
  // Step 8: their fires, kept full; a new fire on a tile still theirs.
  const local = mapLocalTime(at, map.timeZone);
  const fire = BUILDING_DATA.get(FIRE_ID);
  let fuelled = 0;
  if (fire?.kind === 'hearthfire') {
    for (const row of await buildingsRepo.lockFires(mapId, userId)) {
      const space = fuelSpace(fire, row.fuelledThrough, local, HOME_BASE_RULES);
      if (space <= 0) continue;
      await buildingsRepo.setFuel(
        row.id,
        addFuel(fire, row.fuelledThrough, local, space, HOME_BASE_RULES),
        at,
      );
      fuelled += 1;
    }
    if (intent?.kind === 'fire' && target && locked.get(target.id) === userId) {
      const free = !onMap.some((b) => b.tileId === target.id);
      if (free && target.homeSlot === null) {
        const placed = await buildingsRepo.insertBuilding({
          mapId,
          ownerUserId: userId,
          tileId: target.id,
          buildingId: fire.id,
          kind: fire.kind,
          spot: FIRE_SPOT,
          placedAt: at,
          producedSince: null,
        });
        const fuelledThrough = addFuel(fire, null, local, fire.maxFuelNights, HOME_BASE_RULES);
        await buildingsRepo.setFuel(placed.id, fuelledThrough, at);
        const shown = { ...placed, fuelledThrough };
        events.push({
          mapId,
          type: 'building.placed',
          actorUserId: userId,
          payload: {
            userId,
            building: { ...toPublicBuilding(shown, local), q: placed.q, r: placed.r },
            cost: {},
          },
        });
        applied = true;
      }
    }
  }

  // Step 9b–11: a trade or gift, through trades' own cores (plan §6), in a
  // savepoint so a refusal (a kid's squishy got busy, the offer was answered
  // a moment ago) undoes only the trade and the step still tends. The
  // mate's team joins the trade's one squishy lock (step 10), so the team
  // lock below takes nothing new after the inventory rows (11).
  const trade = intent && !('q' in intent) ? intent : null;
  if (trade) {
    // The step's own tuning: the caps it recounts under the patch lock.
    const trades = createTradesService({
      db: tx,
      clock: () => at,
      computerRules: secrets.rules,
    });
    const tradeEvents: NewGameEvent[] = [];
    try {
      await mateTransaction(tx, async (sp) => {
        if (trade.kind === 'answer-offer') {
          await trades.answerAsComputer(sp, tradeEvents, {
            mapId,
            mateId: userId,
            offerId: trade.offerId,
            answer: trade.answer,
            alsoLock: team.map((s) => s.id),
          });
        } else {
          const items = (lines: readonly { itemId: string; quantity: number }[]) =>
            lines.map((l) => ({ kind: 'item' as const, ...l }));
          await trades.sendAsComputer(sp, tradeEvents, {
            mapId,
            mateId: userId,
            request: {
              kind: trade.kind === 'offer' ? 'trade' : 'gift',
              toUserId: trade.toUserId,
              give: items(trade.give),
              want: trade.kind === 'offer' ? items(trade.want) : [],
              noteId: trade.noteId,
            },
          });
        }
      });
      events.push(...tradeEvents);
      applied = true;
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
    }
  }

  // Step 10: the team (id order), then its levels and a guard's post.
  const squad = await mates.lockTeam(mapId, userId);
  const owner = await createMapsRepo(tx).owner(mapId);
  const partner = (owner ? await territory.defenderFloorLevel(mapId, owner.id) : null) ?? 1;
  const levelled = await mates.setTeamLevel(mapId, userId, mateTeamLevel(partner, persona));
  if (intent?.kind === 'guard' && target && locked.get(target.id) === userId) {
    const guard = squad.find((s) => s.state === 'active' && !posted.has(s.id));
    if (guard && target.homeSlot === null) {
      await territory.replaceDefenders(mapId, target.id, [guard.id], at);
      events.push({
        mapId,
        type: 'defenders.changed',
        actorUserId: userId,
        payload: { userId, q: target.q, r: target.r, count: 1, squishyIds: [guard.id] },
      });
      applied = true;
    }
  }

  // The next step: right away while catching up, else after a seeded pause.
  const pace = Rng.fromSeed(deriveSeed(row.seed, step, 'pace'));
  const wait =
    (state.catchUpLeft ?? 0) > 0 ? 0 : pace.int(rules.stepMinutes.min, rules.stepMinutes.max);
  await mates.advance(userId, step + 1, new Date(at.getTime() + wait * MINUTE_MS), state);
  // Step 13: `maps`, last.
  for (const event of events) await appendGameEvent(tx, event);
  return {
    mapId,
    result: {
      intent: intent?.kind ?? null,
      applied,
      catchUp,
      tended: mine.length,
      fuelled,
      levelled,
    },
    ...(intent?.kind === 'challenge' && {
      challenge: { q: intent.q, r: intent.r, persona },
    }),
  };
}

/** Kids on the patch still inside their new-player shield (the raid rule's own hours). */
async function shieldedKids(
  tx: Transaction,
  mapId: string,
  kidIds: readonly string[],
  at: Date,
): Promise<string[]> {
  const territory = createTerritoryRepo(tx);
  const out: string[] = [];
  for (const kidId of kidIds) {
    const joinedAt = await territory.joinedAt(mapId, kidId);
    const shieldEnds =
      (joinedAt?.getTime() ?? 0) + TERRITORY_RULES.newPlayerShieldHours * 3_600_000;
    if (joinedAt && shieldEnds > at.getTime()) out.push(kidId);
  }
  return out;
}

/**
 * The mates' own challenge rules (plan §1 D), in the attack's start
 * transaction right after its tile lock (step 6): the patch's challenge
 * lock first, so two mates can't both take the week's last challenge,
 * then the weekly cap for the patch's PvP mode, quiet hours, a kid's tile
 * only (never a mate's, never wild), never one already being battled for,
 * never within `kidHomeBuffer` or the never-fade ring of the kid's Heart
 * Seed, and only from a kid holding `minKidTiles` outside home. The raid
 * rules (shield, loss cap, tries, cooldown, PvP Off) are `prepare`'s own.
 */
/** What a mate's challenge adds to a kid's (#386e): its persona's AI and the mates' own rules. */
export function computerChallenge(
  persona: Pick<ComputerPersonaTuning, 'stance'>,
  rules: ComputerMatesSecrets['rules'],
  isOnline: (mapId: string, userId: string) => boolean,
): ComputerChallenge {
  return {
    controller: { type: 'ai', policy: stancePolicy(persona.stance) },
    check: (tx, input) => challengeCheck(tx, input, rules, isOnline),
  };
}

/** Kids' tiles fenced all round (#203): a mate never challenges one (#823 ruling). */
async function fencedKidTiles(
  tx: Executor,
  mapId: string,
  tiles: readonly TerritoryTileRow[],
  kids: ReadonlyMap<string, unknown>,
): Promise<{ q: number; r: number }[]> {
  const segments = (await createFencesRepo(tx).listOnMap(mapId)).filter((f) =>
    kids.has(f.ownerUserId),
  );
  if (segments.length === 0) return [];
  const tileIds = new Set(segments.map((f) => f.tileId));
  return tiles
    .filter((t) => tileIds.has(t.id) && t.ownerUserId !== null && kids.has(t.ownerUserId))
    .filter((t) =>
      isTileFenced(
        t,
        tiles.filter((o) => o.ownerUserId === t.ownerUserId),
        segments,
        tiles,
      ),
    )
    .map((t) => ({ q: t.q, r: t.r }));
}

async function challengeCheck(
  tx: Executor,
  input: Parameters<ComputerChallenge['check']>[1],
  rules: ComputerMatesSecrets['rules'],
  isOnline: (mapId: string, userId: string) => boolean,
): Promise<void> {
  const { map, at, tile, tiles } = input;
  const mates = createComputerMatesRepo(tx);
  await mates.lockChallenges(map.id);
  const refuse = (): never => {
    throw new AppError('CONFLICT', MESSAGES.noChallenge);
  };
  const hour = Math.floor(mapLocalTime(at, map.timeZone).minute / 60);
  if (inQuietHours(hour, rules)) refuse();
  const thisWeek = await mates.challengesSince(map.id, new Date(at.getTime() - WEEK_MS));
  if (challengesLeft({ pvpMode: map.pvpMode, thisWeek }, rules) <= 0) refuse();
  const kidId = tile.ownerUserId ?? refuse();
  if ((await mates.computerIds([kidId])).size > 0) refuse();
  // Only a kid with the patch open right now, and never a fenced tile (#823 rulings).
  if (!isOnline(map.id, kidId)) refuse();
  if (
    (await fencedKidTiles(tx, map.id, tiles, new Map<string, true>([[kidId, true]]))).some(
      (t) => t.q === tile.q && t.r === tile.r,
    )
  ) {
    refuse();
  }
  if ((await mates.openAttackTileIds(map.id)).has(tile.id)) refuse();
  const land = tiles.filter((t) => t.ownerUserId === kidId);
  if (land.filter((t) => t.homeSlot === null).length < rules.minKidTiles) refuse();
  const home = land.filter((t) => t.homeSlot !== null);
  if (home.length === 0) refuse();
  const buffer = Math.max(rules.kidHomeBuffer, TERRITORY_RULES.tending.keepRadius);
  if (hexDistance(tile, heartSeedOf(home)) <= buffer) refuse();
}
