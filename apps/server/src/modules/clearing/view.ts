import type { Clearing } from '@heartpatch/shared';
import type { ClearRow } from './repo.js';

/** A clear as the bag and the tile panel show it. */
export function toClearing(row: ClearRow): Clearing {
  return {
    id: row.id,
    q: row.q,
    r: row.r,
    tool: row.tool,
    drop: row.drop,
    startedAt: row.startedAt.toISOString(),
    readyAt: row.readyAt.toISOString(),
  };
}
