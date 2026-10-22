import {
  HOLLOW_RULES,
  planResume,
  planUpkeep,
  resumeSinceMs,
  upkeepMornings,
  upkeepOrder,
  type LocalDate,
  type UpkeepPlanEntry,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { mapLocalTime } from '../../lib/time.js';
import { uuidV5 } from '../../lib/uuid-v5.js';
import { trySpendHeartCoins } from '../heart-coins/service.js';
import { createHeartCoinsRepo } from '../heart-coins/repo.js';
import { canWorkAt, homesteadPauseOf, morningAt, upkeepOf } from './production.js';
import { createBuildingsRepo, type BuildingRow, type ProductionUpdate } from './repo.js';

/*
 * Morning upkeep (#601, owner decisions 2026-10-22 Q4–Q6), charged lazily in
 * the settle: there is no morning job (CLAUDE.md rule 4). Every morning
 * since a building's `upkeep_paid_through`, in date order, each of the
 * player's upkeep buildings in charge order (the kid's own, then highest
 * level, oldest, the Warehouse last) pays its level's Heart Coins, or pauses
 * at that morning if the balance is short. A napping (cut-off) or dormant
 * (out-of-season) building, or one paused already, owes nothing. The
 * ledger key is the building's morning, so a repeated settle charges once.
 * A paused building wakes free once the balance covers a morning (Q6).
 */

/**
 * Fixed namespace for an upkeep charge's `heart_coin_ledger.ref_id`: uuid v5
 * of `<building row id>/<morning>`, one charge per building per morning.
 * Never change it.
 */
const UPKEEP_REF_NAMESPACE = '6c1f4f0e-3b8a-4d52-9a7e-2f5b8c0d1e47';

/** The ledger ref of a building's morning upkeep. */
export const upkeepRefId = (buildingRowId: string, day: LocalDate): string =>
  uuidV5(`${buildingRowId}/${day}`, UPKEEP_REF_NAMESPACE);

/** The player's upkeep buildings as `upkeepOrder` reads them, in charge order. */
export function inChargeOrder(rows: readonly BuildingRow[]): BuildingRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return upkeepOrder(
    rows.flatMap((row) => {
      const upkeep = upkeepOf(row);
      if (upkeep === null || (row.kind !== 'resource' && row.kind !== 'warehouse')) return [];
      return [
        {
          id: row.id,
          kind: row.kind,
          level: row.level,
          upkeep,
          placedAtMs: row.placedAt.getTime(),
          rank: row.upkeepRank,
        },
      ];
    }),
  ).flatMap((e) => byId.get(e.id) ?? []);
}

/** A building whose state the settle changed, and how. */
export interface ChangedRow {
  row: BuildingRow;
  update: ProductionUpdate;
}

/** What the morning charge did. */
export interface UpkeepCharge {
  /** Every upkeep building as it is now (in memory), in charge order. */
  rows: BuildingRow[];
  /** The player's Heart Coins on the patch after it, or null when they have no upkeep buildings. */
  balance: number | null;
  /** `building.paused`, one per building that fell asleep. */
  events: NewGameEvent[];
}

const pausedEvent = (row: BuildingRow, day: LocalDate): NewGameEvent<'building.paused'> => ({
  mapId: row.mapId,
  type: 'building.paused',
  actorUserId: row.ownerUserId,
  payload: {
    userId: row.ownerUserId,
    buildingRowId: row.id,
    q: row.q,
    r: row.r,
    reason: 'upkeep',
    day,
  },
});

/**
 * Charges every morning a player's upkeep buildings owe, inside the caller's
 * transaction. The caller has locked the rows (step 8, id order) and every
 * inventory row it will grant (step 11); this takes the player's Heart Coin
 * balance (step 12b), so the plan is made against the locked balance and a
 * charge can't overdraw. Writes each row's `paused_at` and
 * `upkeep_paid_through`; output up to a pause is the caller's to bank.
 */
export async function chargeUpkeep(
  tx: Executor,
  map: { id: string; timeZone: string },
  userId: string,
  rows: readonly BuildingRow[],
  at: Date,
): Promise<UpkeepCharge> {
  const ordered = inChargeOrder(rows);
  if (ordered.length === 0) return { rows: [], balance: null, events: [] };
  const { timeZone } = map;
  const minute = HOLLOW_RULES.morningMinute;
  const balance = await createHeartCoinsRepo(tx).lockBalance(map.id, userId);
  const now = mapLocalTime(at, timeZone);
  const entries: UpkeepPlanEntry[] = ordered.map((row) => ({
    id: row.id,
    kind: row.kind === 'warehouse' ? 'warehouse' : 'resource',
    level: row.level,
    upkeep: upkeepOf(row) ?? 0,
    placedAtMs: row.placedAt.getTime(),
    rank: row.upkeepRank,
    paused: row.pausedAt !== null,
    mornings: upkeepMornings(
      {
        placed: mapLocalTime(row.placedAt, timeZone),
        settledThrough: row.upkeepPaidThrough,
        now,
      },
      minute,
    ),
    canWork: (day) => canWorkAt(row, morningAt(day, minute, timeZone), timeZone),
  }));
  const plan = planUpkeep(balance, entries);
  const repo = createBuildingsRepo(tx);
  const events: NewGameEvent[] = [];
  const after = new Map(ordered.map((r) => [r.id, r]));
  for (const step of plan.steps) {
    const row = after.get(step.id);
    if (!row) continue;
    if (step.kind === 'paid') {
      const paid = await trySpendHeartCoins(tx, {
        source: 'upkeep',
        refId: upkeepRefId(row.id, step.day),
        mapId: map.id,
        userId,
        amount: step.coins,
        at,
      });
      // Planned against the locked balance: it always covers.
      if (paid === null) throw new Error(`chargeUpkeep: ${row.id} short on ${step.day}`);
    } else if (step.kind === 'paused') {
      after.set(row.id, { ...row, pausedAt: morningAt(step.day, minute, timeZone) });
      events.push(pausedEvent(row, step.day));
    }
  }
  // Every morning planned is settled, paid or not, so none is charged back.
  for (const entry of entries) {
    const last = entry.mornings.at(-1);
    const row = after.get(entry.id);
    if (last === undefined || !row) continue;
    const next = { ...row, upkeepPaidThrough: last };
    after.set(row.id, next);
    await repo.setProduction(row.id, { upkeepPaidThrough: last, pausedAt: row.pausedAt });
  }
  return { rows: ordered.map((r) => after.get(r.id) ?? r), balance: plan.balance, events };
}

/**
 * Wakes the paused buildings the balance now covers (owner decision Q6), in
 * charge order, for free: the next morning charges as usual. A resource
 * building carries on its part-done cycle (`resumeSinceMs`); call this after
 * its output up to the pause is banked, with `rows` as they are then.
 * Returns the rows as they are now and a `building.resumed` per one woken.
 */
export async function resumeUpkeep(
  tx: Executor,
  rows: readonly BuildingRow[],
  balance: number | null,
  at: Date,
): Promise<{ rows: BuildingRow[]; events: NewGameEvent[] }> {
  if (balance === null) return { rows: [...rows], events: [] };
  const paused = inChargeOrder(rows.filter((r) => r.pausedAt !== null));
  const woken = planResume(
    balance,
    paused.map((row) => ({ id: row.id, upkeep: upkeepOf(row) ?? 0 })),
  );
  const repo = createBuildingsRepo(tx);
  const events: NewGameEvent[] = [];
  const after = new Map(rows.map((r) => [r.id, r]));
  for (const { id } of woken) {
    const row = after.get(id);
    if (!row?.pausedAt) continue;
    // Known edge (bounded by one cycle): a homestead cut off and joined back
    // within the part-done cycle before the pause is left out by
    // `resumeSinceMs` and again by `productionAt`, which reads the same
    // latest cut-off. Only the latest cut-off is kept (`workPauseOf`).
    const producedSince =
      row.producedSince === null
        ? null
        : new Date(
            resumeSinceMs(
              row.producedSince.getTime(),
              row.pausedAt.getTime(),
              at.getTime(),
              homesteadPauseOf(row),
            ),
          );
    after.set(id, { ...row, pausedAt: null, producedSince });
    await repo.setProduction(id, { pausedAt: null, producedSince });
    events.push({
      mapId: row.mapId,
      type: 'building.resumed',
      actorUserId: row.ownerUserId,
      payload: { userId: row.ownerUserId, buildingRowId: row.id, q: row.q, r: row.r },
    });
  }
  return { rows: rows.map((r) => after.get(r.id) ?? r), events };
}
