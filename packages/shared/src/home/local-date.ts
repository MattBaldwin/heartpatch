import { LocalDateSchema, type LocalDate } from '../schemas/time.js';

// Calendar arithmetic on map-local dates (`YYYY-MM-DD`), integer-only so it's
// identical on every engine and never touches the clock or a time zone: the
// server turns an instant into a map-local date first (tech spec §4).

/** Days since 1970-01-01 for a proleptic Gregorian date (H. Hinnant's days_from_civil). */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(days: number): { year: number; month: number; day: number } {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

/** Day number of a local date (days since 1970-01-01). Throws on a malformed date. */
export function localDateToDays(date: LocalDate): number {
  const [year, month, day] = LocalDateSchema.parse(date).split('-').map(Number);
  return daysFromCivil(year ?? 0, month ?? 0, day ?? 0);
}

/** The local date for a day number. */
export function localDateFromDays(days: number): LocalDate {
  const { year, month, day } = civilFromDays(days);
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** `date` moved by `days` (negative goes back). */
export function addDays(date: LocalDate, days: number): LocalDate {
  return localDateFromDays(localDateToDays(date) + days);
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return localDateToDays(to) - localDateToDays(from);
}
