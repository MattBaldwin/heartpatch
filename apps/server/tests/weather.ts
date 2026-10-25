// Test helper (Wild Isle weather, #621): a patch turned into a Wild Isle,
// and storm plans written straight into `weather_days` with a front id
// picked so the seeded knock roll for one building hits (or misses), since
// building ids are random in every run.
import {
  deriveSeed,
  Rng,
  WEATHER_RULES,
  type Hex,
  type LocalDate,
  type WeatherFront,
} from '@heartpatch/shared';
import type { Executor } from '../src/db/client.js';

/** Turns a patch into a Wild Isle (W1-3 makes them for real) and gives back its secret seed. */
export async function makeWildIsle(db: Executor, mapId: string): Promise<string> {
  await db.execute(`update maps set patch_type = 'wild-isle' where id = '${mapId}'`);
  const [row] = [
    ...(await db.execute<{ seed: string }>(`select seed from maps where id = '${mapId}'`)),
  ];
  if (!row?.seed) throw new Error('makeWildIsle: the patch has no seed');
  return row.seed;
}

const hitsAt = (seed: string, frontId: string, buildingRowId: string, percent: number) =>
  Rng.fromSeed(deriveSeed(seed, 'knock', frontId, buildingRowId)).chance(percent);

/**
 * A front id that knocks `buildingRowId` about (at the plain storm odds, so
 * at any higher odds too), or that misses it even with the flood bonus.
 */
export function frontIdThat(
  hits: boolean,
  seed: string,
  buildingRowId: string,
  prefix = 'storm',
): string {
  const { knockPercent, floodBonusPercent } = WEATHER_RULES.effects.storm;
  for (let n = 0; n < 1000; n++) {
    const id = `${prefix}-${String(n)}`;
    const hit = hits
      ? hitsAt(seed, id, buildingRowId, knockPercent)
      : !hitsAt(seed, id, buildingRowId, knockPercent + floodBonusPercent);
    if (hit) return id;
  }
  throw new Error('frontIdThat: no front id found');
}

/** A storm front sitting still over `tile` from `from` to `to`. */
export function stormOver(id: string, tile: Hex, from: Date, to: Date, radius = 1): WeatherFront {
  return {
    id,
    kind: 'storm',
    from: { q: tile.q, r: tile.r },
    to: { q: tile.q, r: tile.r },
    startAt: from.toISOString(),
    endAt: to.toISOString(),
    radius,
  };
}

/** Writes a day's plan over whatever is stored (a clear day when `fronts` is empty). */
export async function putPlan(
  db: Executor,
  mapId: string,
  day: LocalDate,
  fronts: readonly WeatherFront[],
): Promise<void> {
  const kind = fronts[0]?.kind ?? 'clear';
  const json = JSON.stringify(fronts).replaceAll("'", "''");
  await db.execute(
    `insert into weather_days (map_id, day, kind, fronts) values ('${mapId}', '${day}', '${kind}', '${json}'::jsonb)
     on conflict (map_id, day) do update set kind = excluded.kind, fronts = excluded.fronts`,
  );
}
