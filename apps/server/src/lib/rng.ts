import { randomBytes } from 'node:crypto';
import type { Seed } from '@heartpatch/shared';

/**
 * A fresh, unpredictable seed for a map, battle or roll (tech spec §8): 128
 * bits from the OS CSPRNG, base64url-encoded. The only place server code
 * creates seeds; derive per-tile or per-window seeds with `deriveSeed`.
 */
export function newSeed(): Seed {
  return randomBytes(16).toString('base64url');
}
