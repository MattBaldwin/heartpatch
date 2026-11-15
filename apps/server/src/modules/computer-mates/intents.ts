import { addFuel, deriveSeed, fuelSpace, HOME_BASE_RULES, Rng } from '@heartpatch/shared';
import {
  COMPUTER_MATES,
  mateTeamLevel,
  nextIntent,
  type ComputerMatesSecrets,
  type MateIntent,
  type MateView,
} from '@heartpatch/shared/server';
import type { Database, Transaction } from '../../db/client.js';
import { appendGameEvent, type NewGameEvent } from '../../db/game-events.js';
import { localDate, mapLocalTime, type Clock } from '../../lib/time.js';
import { BUILDING_DATA, toPublicBuilding } from '../buildings/hearthfire.js';
import { createBuildingsRepo } from '../buildings/repo.js';
import { heartSeedOf } from '../maps/depart.js';
import { createMapsRepo } from '../maps/repo.js';
import { createTendingRepo, createTerritoryRepo } from '../territory/repo.js';
import { createComputerMatesRepo, mateTransaction, type MateState } from './repo.js';

const MINUTE_MS = 60 * 1000;
/** The fire a mate lights (#202's Hearthfire, level 1). */
const FIRE_ID = 'hearthfire';
/** A fire stands in its tile's middle (#204). */
const FIRE_SPOT = 0;

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
  /** Whether this member has the patch open right now (the WS hub's `isOnline`). */
  isOnline?: (mapId: string, userId: string) => boolean;
  /** How often `seen` writes a patch's stamp, at most (ms). */
  seenThrottleMs?: number;
}

export interface ComputerMateSteps {
  /** A real member opened the patch: stamps `keepers_seen_at` (throttled in memory). */
  seen: (mapId: string) => Promise<void>;
  /** Mates due a step on warm patches; a patch someone has open now counts as warm. */
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
  const lastSeen = new Map<string, number>();

  const seen = async (mapId: string) => {
    const at = now();
    const last = lastSeen.get(mapId);
    if (last !== undefined && at.getTime() - last < throttle) return;
    lastSeen.set(mapId, at.getTime());
    await createComputerMatesRepo(db).stampSeen(mapId, at);
  };

  const due = async (limit = 200) => {
    const at = now();
    const warmSince = new Date(at.getTime() - rules.warmMinutes * MINUTE_MS);
    const repo = createComputerMatesRepo(db);
    // A kid who has had the patch open longer than warmMinutes still counts.
    const { isOnline } = options;
    if (isOnline) {
      for (const mapId of await repo.coldDueMaps(at, warmSince)) {
        const open = [...(await repo.activePlayerIds(mapId))].some((id) => isOnline(mapId, id));
        if (open) await repo.stampSeen(mapId, at);
      }
    }
    return repo.dueMates(at, warmSince, limit);
  };

  const act = async (userId: string, step: number): Promise<MateStepResult | null> => {
    const at = now();
    const out = await mateTransaction(db, (tx) => stepWithin(tx, userId, step, at, secrets));
    if (out) void options.publish?.(out.mapId);
    return out?.result ?? null;
  };

  return { seen, due, act };
}

async function stepWithin(
  tx: Transaction,
  userId: string,
  step: number,
  at: Date,
  secrets: ComputerMatesSecrets,
): Promise<{ mapId: string; result: MateStepResult } | null> {
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
  };
  const intent = nextIntent(view, persona, rules, Rng.fromSeed(deriveSeed(row.seed, step)));
  const target =
    intent === null ? undefined : tiles.find((t) => t.q === intent.q && t.r === intent.r);

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
    if (intent.kind === 'claim' && holder === null) {
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
  };
}
