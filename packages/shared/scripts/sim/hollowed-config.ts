/**
 * Hollowed Communities cost model settings (`pnpm sim:hollowed`, #306).
 * Like the other sims, the model only reads game data and reports; it never
 * changes a table. The kids are `pnpm sim:economy`'s casual and engaged ones.
 */
export interface HollowedConfig {
  /** Map seats whose gathering counts (the economy model's land). */
  readonly seats: number;
  /** The economy model's day whose gathering is a typical day. */
  readonly incomeDay: number;
  /** Of each day's Timber and Stone, the share that goes into restoring, a whole percent. */
  readonly restorePercent: number;
  /** The village tiles' terrain: their pieces' cost and their search spots' kit. */
  readonly terrain: string;
  /** Kids restoring together: alone, and with one helper who plays the same way. */
  readonly teams: readonly { readonly label: string; readonly kids: number }[];
  /** The gate: a casual kid alone restores a village of every size within this many days. */
  readonly gateDays: number;
}

export const HOLLOWED_CONFIG: HollowedConfig = {
  seats: 4,
  incomeDay: 7, // TUNE: the first week's land, when the nearest village is new
  restorePercent: 50, // TUNE: plan v3, half of daily Timber and Stone free for restoring
  terrain: 'meadow', // TUNE: the commonest land; its cost is also `pieceCost.default`
  teams: [
    { label: 'alone', kids: 1 },
    { label: 'with a helper', kids: 2 },
  ],
  gateDays: 14, // TUNE: plan v3, "a casual kid alone within two weeks"
};
