/**
 * Costume outlook settings (`pnpm sim:costumes`, #261): how often a kid
 * finds or can buy each tier of Halloween costume before the window closes.
 * Like the other sims, the model only reads game data and reports.
 */

/** What one kind of kid does on a day of play, in events that roll a drop table. */
export interface CostumeProfile {
  readonly id: string;
  /** Collected gathers (Keeper and squishies). */
  readonly gathers: number;
  /** Neutral tiles claimed. */
  readonly tileCaptures: number;
  /** Tiles taken from another player. */
  readonly rivalCaptures: number;
  /** Wild battles won. */
  readonly wildWins: number;
  /** Explore finds (#199). */
  readonly exploreFinds: number;
  /** Patch Coins earned (a busy day is about 40–45 under the daily caps, #45). */
  readonly coins: number;
}

export interface CostumeConfig {
  /** The #261 costumes the report covers. */
  readonly costumes: readonly string[];
  /** Days of play from launch to the end of the 2026 Halloween window (Oct 31 – Nov 9). */
  readonly windowDays: number;
  readonly profiles: readonly CostumeProfile[];
}

export const COSTUME_CONFIG: CostumeConfig = {
  costumes: [
    'patch-scarecrow',
    'candy-corn-cutie',
    'star-striker',
    'cozy-mummy',
    'moonbroom-witch',
    'bat-buddy',
    'zippy-hedgehog',
    'glow-moth',
    'marigold-calavera',
    'hollow-man-costume',
  ],
  windowDays: 10,
  // TUNE: guesses until #199's `sim:economy` measures them. Busy: the
  // owner's "busy day" (about 42 coins). Casual: two short sessions.
  profiles: [
    {
      id: 'busy',
      gathers: 12,
      tileCaptures: 2,
      rivalCaptures: 1,
      wildWins: 8,
      exploreFinds: 6,
      coins: 42,
    },
    {
      id: 'casual',
      gathers: 5,
      tileCaptures: 1,
      rivalCaptures: 0,
      wildWins: 3,
      exploreFinds: 2,
      coins: 20,
    },
  ],
};
