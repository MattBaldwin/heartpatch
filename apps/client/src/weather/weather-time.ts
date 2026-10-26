/** Milliseconds `timeZone` is ahead of UTC at the instant `ms`. */
export function zoneOffsetMs(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(ms));
  const at = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    at('year'),
    at('month') - 1,
    at('day'),
    at('hour'),
    at('minute'),
    at('second'),
  );
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The instant a map-local day (`YYYY-MM-DD`) begins in `timeZone`; daylight saving included. */
export function dayStartMs(day: string, timeZone: string): number {
  const guess = Date.parse(`${day}T00:00:00Z`);
  const first = guess - zoneOffsetMs(guess, timeZone);
  return guess - zoneOffsetMs(first, timeZone);
}

/** The map-local date (`YYYY-MM-DD`) at `ms`. */
export function localDay(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(ms));
}
