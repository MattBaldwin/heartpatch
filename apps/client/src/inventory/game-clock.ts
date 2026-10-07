// The game clock as the server tells it (tech spec §7 "Dev time override"):
// every inventory reply carries the server's `now`, and countdowns run on that,
// so a phone whose clock is off (or a dev server set to Halloween) still
// shows the right time left. Pure: the device clock is passed in.

export class GameClock {
  /** Server time minus device time, in ms. */
  private offsetMs = 0;
  private readonly device: () => number;

  constructor(device: () => number = () => Date.now()) {
    this.device = device;
  }

  /** A reply said the server's time is `serverNow` (ISO). */
  sync(serverNow: string): void {
    const at = Date.parse(serverNow);
    if (Number.isFinite(at)) this.offsetMs = at - this.device();
  }

  /** The game's time now, in ms since the epoch. */
  now(): number {
    return this.device() + this.offsetMs;
  }

  /** Ms until an ISO time (0 once it's passed). */
  msUntil(iso: string): number {
    return Math.max(0, Date.parse(iso) - this.now());
  }
}

/**
 * Time left, short and kid-readable: "45s", "4:05", "1h 5m". Rounded up, so
 * it never shows "0s" before the thing is really ready.
 */
export function formatTimeLeft(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${String(hours)}h ${String(minutes)}m`;
  if (minutes > 0) return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
  return `${String(seconds)}s`;
}

/**
 * How long until something comes back, rounded up to the minute (#201):
 * "3h 20m", "1h 05m", "5h", "25m", or "less than a minute". Rounded up, so
 * it never says a thing is back before it is.
 */
export function formatWait(ms: number): string {
  if (ms < 60_000) return 'less than a minute';
  const minutes = Math.ceil(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)}m`;
  if (rest === 0) return `${String(hours)}h`;
  return `${String(hours)}h ${String(rest).padStart(2, '0')}m`;
}

/**
 * A countdown to `until` on the game clock: the wait to show, and whether it
 * has run out, so the screen asks the server again. `asked` is the `until`
 * it already asked about (null: none), so it asks once per countdown.
 */
export function countdownAt(
  clock: Pick<GameClock, 'msUntil'>,
  until: string,
  asked: string | null,
): { wait: string; ask: boolean } {
  const left = clock.msUntil(until);
  return { wait: formatWait(left), ask: left <= 0 && asked !== until };
}
