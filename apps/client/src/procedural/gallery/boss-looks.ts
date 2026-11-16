import { SpeciesVisualSchema, type Rarity } from '@heartpatch/shared';
import { ApiRequestError, apiCallFor } from '../../net/api.js';
import type { SquishySpecies } from '../params.js';

/**
 * The dev gallery's mini-boss looks (#234, `gallery.html?bosses`). The boss
 * species are server-only data, so the client can't import them (ESLint and
 * Vite's `forbidServerData` both refuse): it fetches `GET /api/v1/dev/boss-looks`
 * instead, which only exists with `HP_DEV_SQUISHY_GRANTS`, needs a signed-in
 * session and is rate-limited. Each `visual` is parsed with the public
 * `SpeciesVisualSchema`, so a boss look is only ever drawn from public bodies
 * and parts.
 */

export interface BossLook extends SquishySpecies {
  readonly name: string;
  readonly rarity: Rarity;
}

/** The reply's shape, parsed by hand: the client has no direct zod import. */
const bossLooksReply = {
  parse(value: unknown): BossLook[] {
    const looks = (value as { looks?: unknown } | null)?.looks;
    if (!Array.isArray(looks)) throw new Error('boss looks: no "looks" list');
    return looks.map((raw: Record<string, unknown>) => ({
      id: String(raw['id']),
      name: String(raw['name']),
      rarity: raw['rarity'] as Rarity,
      visual: SpeciesVisualSchema.parse(raw['visual']),
    }));
  },
};

/** What the gallery tells the person when the route says no. */
export function bossLooksProblem(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.code === 'UNAUTHENTICATED' || err.code === 'FORBIDDEN')
      return 'Sign in first: open the game on this host, sign in, then reload this page (the boss looks need a session).';
    if (err.code === 'NOT_FOUND')
      return 'No boss looks here: start the server with HP_DEV_SQUISHY_GRANTS=true (dev only).';
    return `Could not load the boss looks: ${err.message}`;
  }
  return `Could not read the boss looks: ${err instanceof Error ? err.message : String(err)}`;
}

/** Every mini-boss's look from the dev route, or the reason it could not be had. */
export async function loadBossLooks(
  fetchImpl: typeof fetch = fetch,
): Promise<{ looks: BossLook[]; problem: null } | { looks: []; problem: string }> {
  try {
    const looks = await apiCallFor(
      '/dev/boss-looks',
      { method: 'GET', schema: bossLooksReply },
      fetchImpl,
    );
    return { looks, problem: null };
  } catch (err) {
    return { looks: [], problem: bossLooksProblem(err) };
  }
}
