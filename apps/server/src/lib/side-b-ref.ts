import { uuidV5 } from './uuid-v5.js';

/**
 * Fixed namespace for side `b`'s coin `ref_id` (#728): uuid v5 of the
 * battle id. Both coin ledgers are unique on `(source, ref_id)` with no user
 * column, so side `b`'s `battle` credit (a held defence's Keeper, a friendly
 * battle's side-`b` winner) can't reuse the battle id (side `a`'s key); this
 * one is as stable, so a retried finish credits nothing twice.
 */
const SIDE_B_REF_NAMESPACE = '9d3a6f12-4c7b-4e85-a1d0-5b8e2c7f4a36';

/** Side `b`'s coin `ref_id` for a battle (#728): stable, and never the battle id itself. */
export const sideBRefId = (battleId: string): string => uuidV5(battleId, SIDE_B_REF_NAMESPACE);
