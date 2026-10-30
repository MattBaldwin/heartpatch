import { deriveSeed, hashString, Rng, type Seed } from '../rng/index.js';
import type { LongNightSecrets } from '../schemas/data/long-night-secrets.js';
import type { LongNightRules } from '../schemas/data/long-night.js';
import type { SpawnTable } from '../schemas/data/spawn-tables.js';
import type { LocalDate } from '../schemas/time.js';

// Juniper's Gap after a Long Night (#727). Server-only (CLAUDE.md rule 6):
// exported from `@heartpatch/shared/server` alone, beside the table it rolls.

/**
 * A Keeper's Juniper's Gap encounter after a Long Night the patch held: one
 * species from the Gap table, rolled at resolve. Every Keeper on the patch
 * at nightfall gets one, graced ones too; a Keeper who joins mid-Night waits
 * for the next (owner answer Q3), which the caller sees by who was there.
 * Deterministic for a seed (secret, from the map seed); the Hollow Man's own
 * strike seed stays `deriveSeed(seed, 'hollow-strength', night, userId)`.
 */
export function rollGapEncounter(
  mapSeed: Seed,
  night: LocalDate,
  userId: string,
  table: Pick<SpawnTable, 'entries'>,
): string {
  const rng = Rng.fromSeed(deriveSeed(mapSeed, 'long-night-gap', night, userId));
  return rng.weighted(table.entries).species;
}

/**
 * The Long Night's content hash for `long_nights.content_hash`: the public
 * rules, the secrets and the Gap table, so a stored Night can tell which
 * rules it ran under (like `battleContentHash`). Object keys are sorted, so
 * reordering a data file changes nothing.
 */
export function longNightContentHash(
  rules: LongNightRules,
  secrets: LongNightSecrets,
  table: Pick<SpawnTable, 'entries'>,
): string {
  const sorted = <T extends object>(o: T) =>
    Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return hashString(
    JSON.stringify({
      rules: sorted(rules),
      secrets: sorted(secrets),
      gap: table.entries.map(({ species, weight }) => [species, weight]),
    }),
  );
}
