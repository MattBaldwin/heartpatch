import type { MapRole, PublicUser } from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { createMapsRepo, type MapRow } from './repo.js';

/** The same words whether the map is missing or just not theirs. */
const NO_MAP = "We couldn't find that patch.";

/**
 * The map and the player's role, for an active member. NOT_FOUND otherwise,
 * so maps can't be probed. Every module that acts on a map checks it this way.
 * `kinds` narrows the maps that count (the maps API itself only manages
 * multiplayer maps); any kind if left out, so game commands work on the
 * Tutorial Glade too. A plain read: it takes no locks.
 */
export async function requireMember(
  tx: Executor,
  user: PublicUser,
  mapId: string,
  kinds?: readonly MapRow['kind'][],
): Promise<{ map: MapRow; role: MapRole }> {
  const maps = createMapsRepo(tx);
  const [map, membership] = await Promise.all([
    maps.findMap(mapId),
    maps.membership(mapId, user.id),
  ]);
  if (!map || (kinds && !kinds.includes(map.kind)) || membership?.status !== 'active') {
    throw new AppError('NOT_FOUND', NO_MAP);
  }
  return { map, role: membership.role };
}
