import type { Building } from '../schemas/data/buildings.js';
import type { ItemCounts } from '../gathering/index.js';

// Crafting Factory batches (#294, owner decisions 2026-10-08). A batch is
// timestamps, not a ticking loop (CLAUDE.md rule 4): it starts at
// `startedAt`, and one thing finishes every `itemSeconds` after that until
// `total` are made. The server banks what's done on a settle; the client
// counts down with the same maths. Pure, so both sides agree.

/** What a batch's timing needs. */
export interface FactoryTiming {
  readonly total: number;
  readonly itemSeconds: number;
  readonly startedAtMs: number;
}

/** How many of a batch are made by `atMs` (0 to `total`). */
export function factoryDone(batch: FactoryTiming, atMs: number): number {
  const elapsed = atMs - batch.startedAtMs;
  if (!(elapsed > 0)) return 0;
  return Math.min(batch.total, Math.floor(elapsed / (batch.itemSeconds * 1000)));
}

/** When the next one finishes, or null once the whole batch is made. */
export function factoryNextAtMs(batch: FactoryTiming, atMs: number): number | null {
  const done = factoryDone(batch, atMs);
  return done >= batch.total ? null : batch.startedAtMs + (done + 1) * batch.itemSeconds * 1000;
}

/** When the last one finishes. */
export function factoryDoneAtMs(batch: FactoryTiming): number {
  return batch.startedAtMs + batch.total * batch.itemSeconds * 1000;
}

/**
 * How many runs of `inputs` the bag can pay for, up to `cap`. A recipe with
 * no inputs (none ship) is capped only by `cap`.
 */
export function affordableRuns(have: ItemCounts, inputs: ItemCounts, cap: number): number {
  let runs = Math.max(0, Math.floor(cap));
  for (const [id, need] of Object.entries(inputs)) {
    if (need > 0) runs = Math.min(runs, Math.floor((have[id] ?? 0) / need));
  }
  return runs;
}

/** `items` times `runs` (an empty object for 0 runs). */
export function timesItems(items: ItemCounts, runs: number): ItemCounts {
  const out: ItemCounts = {};
  if (runs <= 0) return out;
  for (const [id, n] of Object.entries(items)) if (n > 0) out[id] = n * runs;
  return out;
}

/**
 * Stopping a batch (owner decision 2026-10-08): what's made is kept, and
 * everything not finished comes back, the one being made included. The
 * server also never counts below what it has banked already (`madeBy`); this
 * is the plain maths, for previews.
 */
export function stopRuns(batch: FactoryTiming, atMs: number): { kept: number; refunded: number } {
  const kept = factoryDone(batch, atMs);
  return { kept, refunded: batch.total - kept };
}

/** How many batches a Factory runs at once at `level` (0 for any other building). */
export function factoryQueues(building: Building | undefined, level: number): number {
  if (building?.kind !== 'factory') return 0;
  const i = Math.min(Math.max(Math.floor(level) || 1, 1), building.levels.length) - 1;
  return building.levels[i]?.queues ?? 0;
}
