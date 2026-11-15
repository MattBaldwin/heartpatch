import type { BattleRewards } from '@heartpatch/shared';

// What a battle paid, in the result card's words (#728; style guide §2):
// short, warm, "you", and never "You earned 💛 0". The server sends the
// credited coins (after the daily caps), so a card never promises coins a
// cap held back.

export const REWARD_TEXT = {
  earnedXp: (name: string, xp: number) => `${name} earned ${String(xp)} XP!`,
  /** A teammate that sat on the bench (#732): its share, never the percent. */
  cheeredXp: (name: string, xp: number) =>
    `${name} cheered from the side and earned ${String(xp)} XP!`,
  /** The challenger's card, a win that paid (#728). */
  earned: (coins: string) => `You earned ${coins}.`,
  /** A held defence, live (#728). */
  held: (coins: string) => `Held! You earned ${coins}.`,
  heldScooted: (name: string) => `${name} scooted home. XP still counts, coins don't.`,
  /** A win the daily battle-coin cap held back (`battleCoins`). */
  pouchFull: 'Coin pouch full for today. XP still counts!',
  friendlyWon: (coins: string) => `+${coins} for the\u00a0win!`,
  friendlyLost: 'Good game! Everyone learned something.',
  friendlyPairCap: (name: string) => `You've won your coins from ${name} today. XP still counts!`,
  friendlyGaveUp: 'No coins for a give-up. XP still counts!',
} as const;

/** "3 Patch Coins and 💛 3", or just the one that was credited. */
export function coinsText(coins: { patch: number; heart: number }): string {
  // No-break spaces keep "3 Patch Coins", "💛 3" and "the win!" whole on a phone.
  const patch = `${String(coins.patch)}\u00a0Patch\u00a0${coins.patch === 1 ? 'Coin' : 'Coins'}`;
  const heart = `💛\u00a0${String(coins.heart)}`;
  if (coins.heart === 0) return patch;
  if (coins.patch === 0) return heart;
  return `${patch} and ${heart}`;
}

/** Any coins credited at all. */
function paid(coins: BattleRewards['coins']): coins is { patch: number; heart: number } {
  return coins !== null && coins.patch + coins.heart > 0;
}

/**
 * One "Pebblesnooze earned 12 XP!" line per squishy that earned, with its
 * evolving meter. Bench rows (#732) get a "cheered from the side" line and
 * come after the fighters; a row without `bench` (a fighter, or a battle
 * stored before #732) reads as before.
 */
export function xpLines(
  awards: readonly {
    squishyId: string;
    xp: number;
    evolvingBefore?: number | null;
    evolvingAfter?: number | null;
    bench?: boolean;
  }[],
  nameOf: (squishyId: string) => string,
): { lines: string[]; evolving: ({ before: number; after: number } | null)[] } {
  const paidXp = awards.filter((award) => award.xp > 0);
  // The server already lists bench rows last; keep that order whatever it sends.
  const earned = [
    ...paidXp.filter((award) => award.bench !== true),
    ...paidXp.filter((award) => award.bench === true),
  ];
  return {
    lines: earned.map((award) =>
      (award.bench === true ? REWARD_TEXT.cheeredXp : REWARD_TEXT.earnedXp)(
        nameOf(award.squishyId),
        award.xp,
      ),
    ),
    // Each one's evolving meter, before and after (#205), from the server.
    evolving: earned.map((award) =>
      award.evolvingBefore != null && award.evolvingAfter != null
        ? { before: award.evolvingBefore, after: award.evolvingAfter }
        : null,
    ),
  };
}

/**
 * The coin line under a battle's XP (#728), or null when there's nothing
 * to say. `rewards` is my side's, as the server reshapes it for side `b`.
 * - `challenger`: my tile, wild or other solo battle; only coins that paid.
 * - `defender`: my land held live: the coins, or why there were none.
 * - `friendly`: a friendly battle, won or lost; `scooted` means someone
 *   gave up (my own give-up gets no line: its title says it).
 */
export function coinLine(input: {
  role: 'challenger' | 'defender' | 'friendly';
  rewards: BattleRewards | null;
  outcome: 'won' | 'lost' | 'draw' | 'none';
  scooted: boolean;
  opponent: string;
}): string | null {
  const { role, rewards, outcome, scooted, opponent } = input;
  if (role === 'friendly' && outcome === 'lost') return scooted ? null : REWARD_TEXT.friendlyLost;
  if (outcome !== 'won' || !rewards) return null;
  if (role === 'challenger')
    return paid(rewards.coins) ? REWARD_TEXT.earned(coinsText(rewards.coins)) : null;
  switch (rewards.unpaid) {
    case 'scooted':
      return role === 'defender' ? REWARD_TEXT.heldScooted(opponent) : REWARD_TEXT.friendlyGaveUp;
    case 'pair-cap':
      return role === 'friendly' ? REWARD_TEXT.friendlyPairCap(opponent) : null;
    case 'guardians':
      return null;
    case null:
      break;
  }
  if (rewards.coins === null) return null;
  if (!paid(rewards.coins)) return REWARD_TEXT.pouchFull;
  const coins = coinsText(rewards.coins);
  return role === 'defender' ? REWARD_TEXT.held(coins) : REWARD_TEXT.friendlyWon(coins);
}
