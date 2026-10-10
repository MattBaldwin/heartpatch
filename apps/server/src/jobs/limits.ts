// Scheduled-job and event-consumer settings (tech spec §7).

/**
 * How often a consumer worker polls, also as the backstop when LISTEN/NOTIFY
 * is on (a backlog drains at this pace, not only on new notifies).
 */
export const CONSUMER_POLL_SECONDS = 1; // TUNE: pg-boss minimum is 0.5

/** Maps a consumer works on at once in this process. */
export const CONSUMER_CONCURRENCY = 4; // TUNE: guess; fits pg-boss's and the app's pools

/** How often the catch-up job wakes consumers that lag (cron). */
export const CATCH_UP_CRON = '* * * * *'; // TUNE: every minute

/** Retries for a consumer job that throws (the next wake-up or catch-up also retries). */
export const CONSUMER_RETRY_LIMIT = 5; // TUNE: guess
export const CONSUMER_RETRY_DELAY_SECONDS = 5; // TUNE: guess, doubles each time

/** How long `stop()` waits for running jobs on shutdown. */
export const JOBS_STOP_TIMEOUT_MS = 10_000; // TUNE:

/** How often the nightfall sweep looks for maps whose night has fallen (cron). */
export const NIGHTFALL_SWEEP_CRON = '* * * * *'; // TUNE: every minute, so night falls within one

/** Maps nightfall runs on at once in this process. */
export const NIGHTFALL_CONCURRENCY = 2; // TUNE: guess; fits pg-boss's and the app's pools

/** Retries for a nightfall that throws (its `hollow_events` row makes them safe). */
export const NIGHTFALL_RETRY_LIMIT = 5; // TUNE: guess
export const NIGHTFALL_RETRY_DELAY_SECONDS = 30; // TUNE: guess, doubles each time

/** How often the `game_events` retention job runs (cron, UTC). */
export const EVENT_RETENTION_CRON = '41 * * * *'; // TUNE: hourly, off the hour

/** Days an event is kept, once no consumer or reconnect replay needs it (#352). */
export const EVENT_RETENTION_DAYS = 30; // TUNE: guess
/** Days a short-lived event (a live battle's picks, turns and cheers; challenges) is kept. */
export const EVENT_RETENTION_SHORT_DAYS = 2; // TUNE: guess

/** Events one retention delete removes; each batch is its own short statement. */
export const EVENT_RETENTION_BATCH = 1000; // TUNE: guess
/** Full batches one retention run deletes, across all maps; the next run carries on. */
export const EVENT_RETENTION_MAX_BATCHES = 50; // TUNE: guess
