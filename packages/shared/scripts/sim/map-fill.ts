import { GAME_DATA } from '../../src/data/index.js';
import { heartSeedOf } from '../../src/hollow/index.js';
import { hexDistance, hexKey, hexNeighbors, type HexKey } from '../../src/hex/index.js';
import { generateMap, type MapTile } from '../../src/mapgen/index.js';
import { deriveSeed, Rng } from '../../src/rng/index.js';
import { canFade, landMood, tilesGoingWild, wildPerNight } from '../../src/territory/tending.js';
import type { MapFillRules, MapFillScenario, Seat } from './map-fill-config.js';

/*
 * A deterministic day-by-day map-fill model (owner decision 2026-10-06,
 * design review Q2). Kids share a generated patch. Each day every kid who
 * plays takes turns spending the day's attempts on the easiest neutral tile
 * next to their land (a seeded roll on their win chance), then tends the land
 * that misses them; at nightfall the shared `tilesGoingWild` picks what goes
 * wild again. It follows the shipped data: the map, the attempts and the
 * tending rules, through the same pure functions the server uses.
 *
 * Not modelled (see `MAP_FILL_LIMITS`): battles themselves (the progression
 * model has both kids winning nearly every try), challenges between kids, and
 * the tile cooldown.
 */

export const MAP_FILL_LIMITS = [
  'claims are a seeded roll on a win chance by guardian strength, not engine battles',
  'no challenges between kids, so land changes hands only by going wild',
  'gatherers and guards are folded into how much land a kid tends',
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Day 1 at noon UTC, a Monday; nightfall is 9 hours later. */
const DAY_ONE = Date.parse('2026-10-12T12:00:00Z');
const NIGHTFALL_MS = 9 * 60 * 60 * 1000;
/** A kid tries a tile while their win chance is at least this (%), like the progression model. */
const TRY_TILE_AT = 35;

export interface MapFillDay {
  readonly day: number;
  /** Tiles each seat owns at the end of the day (home ring included). */
  readonly tiles: readonly number[];
  /** Neutral tiles left after the day's claims, before nightfall. */
  readonly neutralLeft: number;
  /** The same, outside Juniper's Gap. */
  readonly neutralLeftOutsideGap: number;
  /** Seats that played today and had an attempt left but no neutral tile next to their land. */
  readonly nothingToClaim: readonly boolean[];
  /** Tiles each seat had go wild at tonight's nightfall. */
  readonly wentWild: readonly number[];
  /** Tiles each seat claimed today that had gone wild before. */
  readonly reclaimed: readonly number[];
}

export interface MapFillRun {
  readonly scenario: MapFillScenario;
  readonly rules: MapFillRules;
  readonly neutral: number;
  readonly days: readonly MapFillDay[];
}

interface Owned {
  owner: number;
  tendedAt: Date;
}

const weekday = (day: number) => ((day - 1) % 7) + 1;
const plays = (seat: Seat, day: number) =>
  (seat.stopsAfterDay === null || day <= seat.stopsAfterDay) &&
  seat.kid.playDays.includes(weekday(day));

export function runMapFill(
  scenario: MapFillScenario,
  rules: MapFillRules,
  config: { readonly rootSeed: string; readonly mapSeed: string; readonly days: number },
): MapFillRun {
  const map = generateMap(GAME_DATA, { seed: config.mapSeed, playerCount: scenario.mapSeats });
  const tiles: readonly MapTile[] = map.tiles;
  const byKey = new Map(tiles.map((t) => [hexKey(t), t]));
  const seats = scenario.seats;
  const seeds = seats.map((_, s) => heartSeedOf(tiles.filter((t) => t.homeSlot === s)));
  const seedByOwner = new Map(seeds.map((seed, s) => [String(s), seed]));
  const owned = new Map<HexKey, Owned>();
  for (const t of tiles) {
    if (t.homeSlot !== null && t.homeSlot < seats.length) {
      owned.set(hexKey(t), { owner: t.homeSlot, tendedAt: new Date(DAY_ONE) });
    }
  }
  const neutral = tiles.filter((t) => t.homeSlot === null);
  const neutralLeft = () => neutral.filter((t) => !owned.has(hexKey(t)));
  const wentWildBefore = new Set<HexKey>();
  const rng = Rng.fromSeed(deriveSeed(config.rootSeed, scenario.id, rules.label));
  const tending = rules.tending;

  const days: MapFillDay[] = [];
  for (let day = 1; day <= config.days; day++) {
    const noon = new Date(DAY_ONE + (day - 1) * DAY_MS);
    const playing = seats.map((seat) => plays(seat, day));
    const nothingToClaim = seats.map(() => false);
    const reclaimed = seats.map(() => 0);
    const done = seats.map((_, s) => !playing[s]);
    const tried = new Set<HexKey>();

    for (let attempt = 0; attempt < rules.attemptsPerDay; attempt++) {
      seats.forEach((seat, s) => {
        if (done[s]) return;
        const mine = new Set([...owned].filter(([, o]) => o.owner === s).map(([k]) => k));
        const seed = seeds[s] ?? null;
        const target = neutralLeft()
          .filter((t) => !tried.has(hexKey(t)))
          .filter((t) => hexNeighbors(t).some((n) => mine.has(hexKey(n))))
          .map((t) => ({ t, win: seat.kid.winPercent[(t.guardianStrength ?? 1) - 1] ?? 0 }))
          .sort(
            (x, y) =>
              y.win - x.win ||
              (seed ? hexDistance(x.t, seed) - hexDistance(y.t, seed) : 0) ||
              x.t.q - y.t.q ||
              x.t.r - y.t.r,
          )[0];
        if (!target || target.win < TRY_TILE_AT) {
          if (!target && attempt === 0) nothingToClaim[s] = true;
          done[s] = true;
          return;
        }
        const key = hexKey(target.t);
        tried.add(key);
        if (rng.int(1, 100) <= target.win) {
          owned.set(key, { owner: s, tendedAt: noon });
          if (wentWildBefore.has(key)) reclaimed[s] = (reclaimed[s] ?? 0) + 1;
        }
      });
    }
    const left = neutralLeft();

    // Tending: whoever played today and sees land missing them taps Visit,
    // which tends all of their land.
    if (tending) {
      seats.forEach((seat, s) => {
        if (!playing[s] || !seat.kid.visits) return;
        const seed = seeds[s] ?? null;
        const mine = [...owned].filter(([, o]) => o.owner === s);
        const missed = mine.some(([k, o]) => {
          const t = byKey.get(k);
          return t && canFade(t, seed, tending) && landMood(o.tendedAt, noon, tending) !== 'happy';
        });
        if (missed) for (const [, o] of mine) o.tendedAt = noon;
      });
    }

    // Nightfall: land untended long enough goes wild again.
    const wentWild = seats.map(() => 0);
    if (tending) {
      const night = new Date(noon.getTime() + NIGHTFALL_MS);
      const candidates = [...owned].flatMap(([k, o]) => {
        const t = byKey.get(k);
        return t
          ? [
              {
                q: t.q,
                r: t.r,
                homeSlot: t.homeSlot,
                ownerUserId: String(o.owner),
                tendedAt: o.tendedAt,
              },
            ]
          : [];
      });
      const going = tilesGoingWild(
        candidates,
        seedByOwner,
        night,
        wildPerNight(tending, rules.pvpMode),
        tending,
      );
      for (const g of going) {
        owned.delete(hexKey(g));
        wentWildBefore.add(hexKey(g));
        const s = Number(g.ownerUserId);
        wentWild[s] = (wentWild[s] ?? 0) + 1;
      }
    }

    days.push({
      day,
      tiles: seats.map((_, s) => [...owned.values()].filter((o) => o.owner === s).length),
      neutralLeft: left.length,
      neutralLeftOutsideGap: left.filter((t) => t.terrain !== 'junipers-gap').length,
      nothingToClaim,
      wentWild,
      reclaimed,
    });
  }
  return { scenario, rules, neutral: neutral.length, days };
}
