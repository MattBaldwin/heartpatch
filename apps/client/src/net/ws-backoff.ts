/** Reconnect delays: exponential, capped, with full jitter. */
export const RECONNECT_BACKOFF = {
  baseMs: 500, // TUNE: guess
  maxMs: 30_000, // TUNE: guess
} as const;

/**
 * Delay before reconnect attempt `attempt` (0 = first): a random time up to
 * `base · 2^attempt`, capped. The jitter spreads a family's phones out after
 * the server restarts, instead of all reconnecting at the same moment.
 */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const { baseMs, maxMs }: { baseMs: number; maxMs: number } = RECONNECT_BACKOFF;
  let ceiling = baseMs;
  for (let i = 0; i < attempt && ceiling < maxMs; i += 1) ceiling *= 2;
  return Math.floor(random() * Math.min(ceiling, maxMs));
}
