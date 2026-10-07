import type { HearthfireBuilding } from '../schemas/data/buildings.js';
import type { HomeBaseRules } from '../schemas/data/home-base.js';
import type { LocalDate } from '../schemas/time.js';
import { addDays, daysBetween } from './local-date.js';

// Hearthfire fuel (design doc §14, tech spec §7 "Hearthfire fuel is a date,
// not a counter"). A fire stores `fuelledThrough`: the last map-local night
// its fuel covers. Nothing is ever decremented, so a nightfall run twice
// can't burn fuel twice, and an idle fire costs nothing (CLAUDE.md rule 4).
// Pure: the server turns the clock into map-local time (DST included) and
// passes it in.

/** A moment in map-local wall-clock time. */
export interface MapLocalTime {
  readonly date: LocalDate;
  /** Minutes after local midnight, 0–1439. */
  readonly minute: number;
}

/** The fuel state stored on a Hearthfire row. Null: never fuelled. */
export type FuelledThrough = LocalDate | null;

export interface HearthfireState {
  /** The next nightfall that hasn't happened yet (after nightfall: tomorrow's). */
  readonly tonight: LocalDate;
  /** Nights of fuel left, tonight included (0 when it's out). */
  readonly nightsLeft: number;
  /** True if it has fuel for tonight: it will burn and protect at the next nightfall. */
  readonly lit: boolean;
}

type FuelRules = Pick<HearthfireBuilding, 'maxFuelNights'>;
type NightRules = Pick<HomeBaseRules, 'nightfallMinute'>;

/** The night the next nightfall belongs to, as its map-local date. */
export function tonightOf(local: MapLocalTime, rules: NightRules): LocalDate {
  return local.minute < rules.nightfallMinute ? local.date : addDays(local.date, 1);
}

/** Does fuel stored through `fuelledThrough` cover `night`? What nightfall (#21) asks. */
export function protectsNight(fuelledThrough: FuelledThrough, night: LocalDate): boolean {
  return fuelledThrough !== null && fuelledThrough >= night;
}

/** Nights left, tonight included; 0 when the fire is out. */
function nightsLeftOf(fuelledThrough: FuelledThrough, tonight: LocalDate): number {
  if (fuelledThrough === null) return 0;
  return Math.max(0, daysBetween(tonight, fuelledThrough) + 1);
}

/** Whether the fire is lit for the next nightfall, and how many nights it has left. */
export function hearthfireState(
  fuelledThrough: FuelledThrough,
  local: MapLocalTime,
  rules: NightRules,
): HearthfireState {
  const tonight = tonightOf(local, rules);
  const nightsLeft = nightsLeftOf(fuelledThrough, tonight);
  return { tonight, nightsLeft, lit: nightsLeft > 0 };
}

/** How many more nights of fuel fit right now. */
export function fuelSpace(
  fire: FuelRules,
  fuelledThrough: FuelledThrough,
  local: MapLocalTime,
  rules: NightRules,
): number {
  const { nightsLeft } = hearthfireState(fuelledThrough, local, rules);
  return Math.max(0, fire.maxFuelNights - nightsLeft);
}

/**
 * Adds `nights` of fuel (tech spec §7): `max(fuelledThrough, tonight − 1) +
 * nights`, capped at `tonight − 1 + maxFuelNights`. Throws if `nights`
 * isn't a positive whole number; the caller checks `fuelSpace` first.
 */
export function addFuel(
  fire: FuelRules,
  fuelledThrough: FuelledThrough,
  local: MapLocalTime,
  nights: number,
  rules: NightRules,
): LocalDate {
  if (!Number.isSafeInteger(nights) || nights < 1) {
    throw new RangeError(`addFuel(): nights must be a whole number >= 1, got ${nights}`);
  }
  const tonight = tonightOf(local, rules);
  const lastNight = addDays(tonight, -1);
  const from = fuelledThrough !== null && fuelledThrough > lastNight ? fuelledThrough : lastNight;
  const cap = addDays(lastNight, fire.maxFuelNights);
  const next = addDays(from, nights);
  return next > cap ? cap : next;
}

/** One fire as "Fuel all fires" sees it (#202). */
export interface FuelAllFire {
  readonly id: string;
  readonly fuelResource: string;
  readonly fuelPerNight: number;
  /** Nights it has left now, tonight included. */
  readonly nightsLeft: number;
  /** Nights that still fit (`fuelSpace`). */
  readonly space: number;
}

/**
 * How many nights "Fuel all fires" gives each fire (#202, owner-approved):
 * one night at a time to the fire with the fewest nights (ties by id), until
 * every fire is full or the bag can't pay for another night. So a short bag
 * keeps as many fires lit as it can. `have` is the bag's count per resource.
 * Fires that get nothing are left out.
 */
export function planFuelAll(
  fires: readonly FuelAllFire[],
  have: Readonly<Record<string, number>>,
): Map<string, number> {
  const left = { ...have };
  const nights = new Map<string, number>();
  const added = (id: string) => nights.get(id) ?? 0;
  for (;;) {
    let next: FuelAllFire | null = null;
    for (const fire of fires) {
      if (added(fire.id) >= fire.space) continue;
      if ((left[fire.fuelResource] ?? 0) < fire.fuelPerNight) continue;
      const level = fire.nightsLeft + added(fire.id);
      const best = next === null ? Infinity : next.nightsLeft + added(next.id);
      if (level < best || (level === best && next !== null && fire.id < next.id)) next = fire;
    }
    if (next === null) return nights;
    nights.set(next.id, added(next.id) + 1);
    left[next.fuelResource] = (left[next.fuelResource] ?? 0) - next.fuelPerNight;
  }
}
