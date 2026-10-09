import { HOME_BASE_RULES } from '@heartpatch/shared';

/**
 * Map time in e2e (#326). A map's time is the server's game clock read in
 * the map's time zone, and the client makes a patch in the device's zone.
 * So the suite pins map time by picking the browser's `timezoneId`: every
 * spec plays in the late morning, map time, whatever the hour on CI, and the
 * dark-land nudge (the hour before nightfall) never covers a button. A spec
 * that wants dusk opts in with `duskTimeZone` (hollow-dusk.spec.ts).
 */

/** The client's `DUSK_MINUTES` (src/hollow/hollow-config.ts): the nudge's hour. */
const DUSK_MINUTES = 60;
/** By day: well after morning (6:00) and before dusk, with hours to spare. */
const DAY = { from: 10 * 60, to: 16 * 60 };

/**
 * Fixed-offset zones, UTC-12 to UTC+14 (`Etc/GMT-5` is UTC+5), and a few
 * half-hour ones with no daylight saving, so some zone is early in any hour.
 */
const ZONES = [
  ...Array.from({ length: 27 }, (_, i) => i - 12).map((h) =>
    h === 0 ? 'Etc/UTC' : `Etc/GMT${h > 0 ? '-' : '+'}${String(Math.abs(h))}`,
  ),
  'Pacific/Marquesas',
  'Asia/Kabul',
  'Asia/Kolkata',
  'Asia/Yangon',
  'Australia/Darwin',
];

/**
 * The game clock now, in ms. The server's clock starts at `HP_DEV_NOW` when
 * that's set, so the config records its lead once for every worker.
 */
function gameNow(): number {
  return Date.now() + Number(process.env['HP_E2E_CLOCK_LEAD_MS'] ?? '0');
}

/** Minutes past midnight at `at` in `timeZone`. */
function localMinute(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return part('hour') * 60 + part('minute');
}

/** The zone whose map time is in `[from, to)` now, with the most of it left. */
function zoneWithin(from: number, to: number): string {
  const at = gameNow();
  let best: { zone: string; left: number } | null = null;
  for (const zone of ZONES) {
    const minute = localMinute(at, zone);
    if (minute >= from && minute < to && (!best || to - minute > best.left)) {
      best = { zone, left: to - minute };
    }
  }
  if (!best) throw new Error(`No time zone has map time in [${String(from)}, ${String(to)})`);
  return best.zone;
}

/**
 * The suite's time zone (playwright.config.ts): late morning map time. Set
 * once in the main process, so every worker and device shares it.
 */
export function pinMapTime(): string {
  if (process.env['HP_E2E_CLOCK_LEAD_MS'] === undefined) {
    const devNow = process.env['HP_DEV_NOW'];
    process.env['HP_E2E_CLOCK_LEAD_MS'] = String(devNow ? Date.parse(devNow) - Date.now() : 0);
  }
  process.env['HP_E2E_TIME_ZONE'] ??= zoneWithin(DAY.from, DAY.to);
  return process.env['HP_E2E_TIME_ZONE'];
}

/** How much dusk a spec needs: a patch, a claim's showdown, two reloads. */
const DUSK_NEEDED = 10; // minutes

/**
 * A zone where it's dusk on the map now (the hour before nightfall), with
 * at least `DUSK_NEEDED` minutes of it left. Late in an hour no zone may
 * have that much (few zones are off by half an hour): it waits for the next.
 */
export async function duskTimeZone(): Promise<string> {
  const nightfall = HOME_BASE_RULES.nightfallMinute;
  for (;;) {
    try {
      return zoneWithin(nightfall - DUSK_MINUTES, nightfall - DUSK_NEEDED);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
  }
}
