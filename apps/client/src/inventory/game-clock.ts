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
