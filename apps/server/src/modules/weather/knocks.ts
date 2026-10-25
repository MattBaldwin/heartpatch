import {
  canBeKnocked,
  deriveSeed,
  frontCover,
  GAME_DATA,
  hexDistance,
  hexNeighbors,
  Rng,
  type Building,
  type Hex,
  type WeatherFront,
  type WeatherRules,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { BUILDING_DATA } from '../buildings/hearthfire.js';
import { createBuildingsRepo, type BuildingRow } from '../buildings/repo.js';
import { frontsBetween, keptFrom, type WeatherMap } from './plans.js';
import { createWeatherRepo } from './repo.js';

/*
 * Storm knocks on a Wild Isle (#621, plan §4 "Storm knocks"). Lazily, at
 * the settle and in the hourly sweep (rule 4: nothing ticks): for each of a
 * player's buildings a storm can knock (shared `canBeKnocked`, never on a
 * home tile), every storm front whose minutes over its tile ended since
 * `weather_checked_through` (null: `placed_at`) gets one roll, seeded by the
 * front and the building (`deriveSeed(mapSeed, 'knock', frontId,
 * buildingRowId)`, server-only, rule 6). The first that hits sets
 * `damaged_at` to when that front left the tile, so its output up to then
 * is kept (production stops there, and the next bank or fix pays it).
 * Rolling a front twice gives the same answer and `weather_checked_through`
 * only moves forward, so the settle and the sweep can both run in any order
 * and knock a building once. Nothing is destroyed; roads aren't buildings.
 */

/** A building a storm knocked about in this pass (`SettleResponse.weather.knocked`). */
export interface Knocked {
  buildingRowId: string;
  buildingId: string;
  q: number;
  r: number;
}

/** What `resolveWeather` did. */
export interface WeatherSettled {
  /** The rows as they are now (knocks and checks written). */
  rows: BuildingRow[];
  knocked: Knocked[];
  /** `building.knocked`, for the caller to append (`maps` last). */
  events: NewGameEvent<'building.knocked'>[];
}

/** A shelter's reach, with when it went up (it shelters only from then). */
export interface Shelter {
  at: Hex;
  radius: number;
  from: readonly ('storm' | 'flood')[];
  placedAtMs: number;
}

/** What one building's roll needs. */
export interface KnockFacts {
  buildingRowId: string;
  tile: Hex;
  /** Rolled through here already (`weather_checked_through ?? placed_at`, never before retention). */
  fromMs: number;
  nowMs: number;
  /** Next to water of a `nearWater` kind (the flood bonus). */
  nearWater: boolean;
}

/** One building's verdict: whether any front was rolled for, and the knock if one hit. */
export interface KnockVerdict {
  rolled: boolean;
  knock: { frontId: string; atMs: number } | null;
}

/**
 * When each storm front left the tile after `fromMs` (the end of its first
 * stretch over it that ends after `fromMs`), if that's by `nowMs`: the
 * fronts to roll for, in the order they left.
 */
export function frontsToRoll(
  fronts: readonly WeatherFront[],
  tile: Hex,
  fromMs: number,
  nowMs: number,
): { front: WeatherFront; atMs: number }[] {
  return fronts
    .filter((f) => f.kind === 'storm')
    .flatMap((front) => {
      const end = frontCover(front, tile).find(([, b]) => b > fromMs)?.[1];
      return end !== undefined && end <= nowMs ? [{ front, atMs: end }] : [];
    })
    .sort((a, b) => a.atMs - b.atMs || (a.front.id < b.front.id ? -1 : 1));
}

/**
 * One building's storm rolls (pure): each front that left its tile since it
 * was last rolled for, in order, until one hits. A shelter standing by then
 * within its radius stops a storm knock (`storm`) or the flood bonus
 * (`flood`).
 */
export function rollKnocks(
  facts: KnockFacts,
  fronts: readonly WeatherFront[],
  shelters: readonly Shelter[],
  rules: Pick<WeatherRules['effects'], 'storm'>,
  mapSeed: string,
): KnockVerdict {
  const due = frontsToRoll(fronts, facts.tile, facts.fromMs, facts.nowMs);
  for (const { front, atMs } of due) {
    const near = shelters.filter(
      (s) => s.placedAtMs <= atMs && hexDistance(s.at, facts.tile) <= s.radius,
    );
    if (near.some((s) => s.from.includes('storm'))) continue;
    const flood = facts.nearWater && !near.some((s) => s.from.includes('flood'));
    const percent = Math.min(
      100,
      rules.storm.knockPercent + (flood ? rules.storm.floodBonusPercent : 0),
    );
    const roll = Rng.fromSeed(deriveSeed(mapSeed, 'knock', front.id, facts.buildingRowId));
    if (roll.chance(percent)) return { rolled: true, knock: { frontId: front.id, atMs } };
  }
  return { rolled: due.length > 0, knock: null };
}

/** Can a storm knock this row about now? Its kind, not weatherproof, not at home, not knocked already. */
export function knockable(row: BuildingRow): boolean {
  const building = BUILDING_DATA.get(row.buildingId);
  return (
    building !== undefined &&
    canBeKnocked(building) &&
    row.homeSlot === null &&
    row.damagedAt === null
  );
}

const WATER_KINDS = new Map(
  GAME_DATA.terrains.flatMap((t) => (t.water ? [[t.id, t.water] as const] : [])),
);

const shelterOf = (building: Building | undefined) =>
  building?.kind === 'shelter' ? building.protects : null;

/**
 * Rolls the storms for `rows` (one player's buildings, locked by the caller
 * at step 8) up to `now`, writing each knock and how far it's rolled. Only
 * plain reads besides those rows: the stored plans (never locked), the
 * map's shelters and the terrain next door.
 */
export async function resolveWeather(
  tx: Executor,
  map: WeatherMap,
  rows: readonly BuildingRow[],
  now: Date,
): Promise<WeatherSettled> {
  const unchanged = { rows: [...rows], knocked: [], events: [] };
  const nowMs = now.getTime();
  const kept = keptFrom(map, now).getTime();
  const fromOf = (row: BuildingRow) =>
    Math.max((row.weatherCheckedThrough ?? row.placedAt).getTime(), kept);
  const candidates = rows.filter((r) => knockable(r) && fromOf(r) < nowMs);
  if (candidates.length === 0) return unchanged;
  const earliest = Math.min(...candidates.map(fromOf));
  const fronts = (await frontsBetween(tx, map, new Date(earliest), now)).filter(
    (f) => f.kind === 'storm',
  );
  const due = candidates.filter(
    (r) => frontsToRoll(fronts, { q: r.q, r: r.r }, fromOf(r), nowMs).length > 0,
  );
  if (due.length === 0) return unchanged;

  const repo = createWeatherRepo(tx);
  const [shelterRows, terrains] = await Promise.all([
    repo.shelters(map.id),
    repo.terrainsAt(
      map.id,
      due.flatMap((r) => hexNeighbors({ q: r.q, r: r.r })),
    ),
  ]);
  const shelters: Shelter[] = shelterRows.flatMap((s) => {
    const protects = shelterOf(BUILDING_DATA.get(s.buildingId));
    return protects
      ? [{ at: { q: s.q, r: s.r }, ...protects, placedAtMs: s.placedAt.getTime() }]
      : [];
  });
  const nearWater = (tile: Hex) =>
    hexNeighbors(tile).some((n) => {
      const water = WATER_KINDS.get(terrains.get(`${String(n.q)},${String(n.r)}`) ?? '');
      return water !== undefined && map.rules.effects.storm.nearWater.includes(water);
    });

  const buildings = createBuildingsRepo(tx);
  const after = new Map(rows.map((r) => [r.id, r]));
  const knocked: Knocked[] = [];
  const events: NewGameEvent<'building.knocked'>[] = [];
  for (const row of due) {
    const tile = { q: row.q, r: row.r };
    const verdict = rollKnocks(
      { buildingRowId: row.id, tile, fromMs: fromOf(row), nowMs, nearWater: nearWater(tile) },
      fronts,
      shelters,
      map.rules.effects,
      map.seed ?? map.id,
    );
    if (!verdict.rolled) continue;
    const damagedAt = verdict.knock ? new Date(verdict.knock.atMs) : null;
    const update = {
      weatherCheckedThrough: now,
      ...(verdict.knock ? { damagedAt, damagedBy: verdict.knock.frontId } : {}),
    };
    await buildings.setWeather(row.id, update);
    after.set(row.id, { ...row, ...update });
    if (!verdict.knock || !damagedAt) continue;
    const hit = { buildingRowId: row.id, buildingId: row.buildingId, q: row.q, r: row.r };
    knocked.push(hit);
    events.push({
      mapId: row.mapId,
      type: 'building.knocked',
      actorUserId: row.ownerUserId,
      payload: {
        userId: row.ownerUserId,
        ...hit,
        frontId: verdict.knock.frontId,
        at: damagedAt.toISOString(),
      },
    });
  }
  return { rows: rows.map((r) => after.get(r.id) ?? r), knocked, events };
}
