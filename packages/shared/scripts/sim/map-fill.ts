import { GAME_DATA } from '../../src/data/index.js';
import { heartSeedOf } from '../../src/hollow/index.js';
import { hexDistance, hexKey, hexNeighbors, type HexKey } from '../../src/hex/index.js';
import { generateMap, type MapTile } from '../../src/mapgen/index.js';
import { deriveSeed, Rng } from '../../src/rng/index.js';
import {
  borderEdges,
  exposedSegments,
  isTileFenced,
  weakestSegment,
  type HexEdge,
} from '../../src/territory/fences.js';
import { dailyLossCap } from '../../src/territory/index.js';
import { canFade, landMood, tilesGoingWild, wildPerNight } from '../../src/territory/tending.js';
import { TERRITORY_RULES } from '../../src/data/territory.js';
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
 * With `challenges` (#203), a kid with nothing neutral to claim spends the
 * rest of the day's attempts challenging a rival's land next to theirs:
 * unfenced first, then the weakest fence. With `fences`, kids put up
 * segments on their borders that face a rival, and a fenced tile takes two
 * parts: break the weakest exposed segment, then beat the guard, in one go
 * when the kid brings two or more squishies. Gentle's daily loss cap and a
 * day's rest per tile (the cooldown, as kids play once a day) apply.
 *
 * Not modelled (see `MAP_FILL_LIMITS`): battles themselves (the progression
 * model has both kids winning nearly every try).
 */

export const MAP_FILL_LIMITS = [
  'claims, guard fights and fence fights are seeded rolls on a win chance, not engine battles',
  'a kid plays once a day, so the 4-hour tile cooldown is a day',
  'fences cost a fixed number of segments a play day, not modelled Emberwood',
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
  /** Tiles each seat won from a rival today (#203's model). */
  readonly captured: readonly number[];
  /** Fence segments broken today, and fence fights the fence won. */
  readonly fenceBreaks: number;
  readonly fenceHolds: number;
  /** Each seat's outer tiles that are fenced at the end of the day. */
  readonly fenced: readonly number[];
}

/** A fence segment in the model: its tile, edge and energy left (%). */
interface Segment {
  q: number;
  r: number;
  edge: HexEdge;
  hp: number;
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
  /** Fence segments, by `"q,r"`: always the tile owner's. */
  const segments = new Map<HexKey, Segment[]>();
  const ownerOf = (key: HexKey) => owned.get(key)?.owner ?? null;
  const tilesOf = (s: number) =>
    [...owned].filter(([, o]) => o.owner === s).flatMap(([k]) => byKey.get(k) ?? []);
  const fencedFor = (t: MapTile, s: number) =>
    isTileFenced(t, tilesOf(s), segments.get(hexKey(t)) ?? []);

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
    const captured = seats.map(() => 0);
    let fenceBreaks = 0;
    let fenceHolds = 0;

    // Challenges (#203's model): a kid with nothing neutral next to them
    // spends the rest of today's tries on a rival's land.
    if (rules.challenges) {
      const lossCap = dailyLossCap(TERRITORY_RULES, rules.pvpMode);
      const lostToday = seats.map(() => 0);
      seats.forEach((seat, s) => {
        if (!playing[s] || !nothingToClaim[s]) return;
        for (let attempt = 0; attempt < rules.attemptsPerDay; attempt++) {
          const mine = tilesOf(s);
          const mineKeys = new Set(mine.map(hexKey));
          const targets = tiles
            .filter((t) => {
              const owner = ownerOf(hexKey(t));
              return (
                owner !== null &&
                owner !== s &&
                t.homeSlot === null &&
                !tried.has(hexKey(t)) &&
                (lostToday[owner] ?? 0) < lossCap &&
                hexNeighbors(t).some((n) => mineKeys.has(hexKey(n)))
              );
            })
            .flatMap((t) => {
              const owner = ownerOf(hexKey(t));
              if (owner === null) return [];
              const fenced = rules.fences !== null && fencedFor(t, owner);
              const wall = fenced
                ? weakestSegment(exposedSegments(t, segments.get(hexKey(t)) ?? [], mine))
                : null;
              return [{ t, owner, wall }];
            })
            .sort(
              (x, y) => (x.wall?.hp ?? 0) - (y.wall?.hp ?? 0) || x.t.q - y.t.q || x.t.r - y.t.r,
            );
          const target = targets[0];
          if (!target) break;
          const key = hexKey(target.t);
          tried.add(key);
          let fightGuard = true;
          if (target.wall && rules.fences) {
            // Part one: break the fence. A weaker segment is easier.
            const chance = Math.min(
              100,
              Math.floor((rules.fences.breakPercent * 100) / Math.max(1, target.wall.hp)),
            );
            if (rng.int(1, 100) <= chance) {
              const list = segments.get(key) ?? [];
              segments.set(
                key,
                list.filter((g) => g !== target.wall),
              );
              fenceBreaks += 1;
              // Part two in the same challenge needs a second squishy.
              fightGuard = seat.kid.team >= 2;
            } else {
              target.wall.hp = Math.max(1, target.wall.hp - rules.fences.holdLossPercent);
              fenceHolds += 1;
              fightGuard = false;
            }
          }
          if (fightGuard && rng.int(1, 100) <= seat.kid.guardWinPercent) {
            owned.set(key, { owner: s, tendedAt: noon });
            segments.delete(key);
            captured[s] = (captured[s] ?? 0) + 1;
            lostToday[target.owner] = (lostToday[target.owner] ?? 0) + 1;
          }
        }
      });
    }

    // Fences (#203's model): repair what was knocked, then fence the tiles
    // that face a rival, the ones closest to fenced first.
    if (rules.fences) {
      seats.forEach((seat, s) => {
        if (!playing[s]) return;
        for (const list of tilesOf(s).map((t) => segments.get(hexKey(t)) ?? [])) {
          for (const g of list) g.hp = 100;
        }
        let budget = seat.kid.fencesPerDay;
        const mine = tilesOf(s);
        const facing = mine
          .filter((t) => t.homeSlot === null)
          .filter((t) =>
            hexNeighbors(t).some((n) => {
              const o = ownerOf(hexKey(n));
              return o !== null && o !== s;
            }),
          )
          .map((t) => {
            const have = new Set((segments.get(hexKey(t)) ?? []).map((g) => g.edge));
            return { t, open: borderEdges(t, mine).filter((e) => !have.has(e)) };
          })
          .filter((x) => x.open.length > 0)
          .sort((x, y) => x.open.length - y.open.length || x.t.q - y.t.q || x.t.r - y.t.r);
        for (const { t, open } of facing) {
          for (const edge of open) {
            if (budget <= 0) return;
            const key = hexKey(t);
            segments.set(key, [...(segments.get(key) ?? []), { q: t.q, r: t.r, edge, hp: 100 }]);
            budget -= 1;
          }
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
        segments.delete(hexKey(g));
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
      captured,
      fenceBreaks,
      fenceHolds,
      fenced: seats.map(
        (_, s) =>
          tilesOf(s).filter(
            (t) =>
              t.homeSlot === null && (segments.get(hexKey(t)) ?? []).length > 0 && fencedFor(t, s),
          ).length,
      ),
    });
  }
  return { scenario, rules, neutral: neutral.length, days };
}
