import { GAME_DATA, type KeeperStats, type PatchCrown, type PatchStats } from '@heartpatch/shared';

// What the patch stats sheet says (#573), worked out from the server's
// numbers so it's unit-tested apart from the DOM. Cozy and celebratory
// (style guide §1): a crown per category, no ranking, and nobody is "last".

/** Each crown's emoji and name (owner decision 2026-10-19). */
export const CROWNS: Readonly<Record<PatchCrown, { emoji: string; label: string }>> = {
  land: { emoji: '🏰', label: 'Most land' },
  befriended: { emoji: '🐾', label: 'Most befriended' },
  builder: { emoji: '🛠️', label: 'Best builder' },
  brightest: { emoji: '🏮', label: 'Brightest' },
  collector: { emoji: '🌈', label: 'Collector' },
};

/** Shown where a number isn't counted yet (villages, until #306 PR 3). */
export const SOON = 'soon';

export interface StatLine {
  readonly emoji: string;
  readonly label: string;
  readonly value: string;
}

export interface KeeperCard {
  readonly userId: string;
  readonly name: string;
  readonly mine: boolean;
  readonly homeSlot: number | null;
  readonly crowns: readonly { emoji: string; label: string }[];
  /** A cheer for a Keeper with no crown yet, never a rank. */
  readonly cheer: string | null;
  readonly lines: readonly StatLine[];
  /** "Hearthfire ×2", most first; empty with nothing built. */
  readonly buildings: readonly string[];
}

export interface StatsPage {
  readonly totals: readonly StatLine[];
  readonly keepers: readonly KeeperCard[];
}

const count = (n: number | null): string => (n === null ? SOON : String(n));

const buildingName = (id: string): string =>
  GAME_DATA.buildings.find((b) => b.id === id)?.name ?? id;

function keeperCard(k: KeeperStats, userId: string | null): KeeperCard {
  const mine = k.user.id === userId;
  return {
    userId: k.user.id,
    name: mine ? `${k.user.username} (you)` : k.user.username,
    mine,
    homeSlot: k.homeSlot,
    crowns: k.crowns.map((c) => CROWNS[c]),
    cheer: k.crowns.length === 0 ? 'Just getting started!' : null,
    lines: [
      { emoji: '🏰', label: 'Land', value: count(k.tiles) },
      { emoji: '🌾', label: 'Homesteads', value: count(k.homesteads) },
      { emoji: '🏮', label: 'Lit tiles', value: count(k.lit) },
      { emoji: '🐾', label: 'Befriended', value: count(k.befriended) },
      { emoji: '🌈', label: 'Kinds', value: count(k.species) },
      { emoji: '🏘️', label: 'Hollows', value: count(k.villages) },
    ],
    buildings: k.buildings.map((b) => `${buildingName(b.buildingId)} ×${String(b.count)}`),
  };
}

/** The sheet's page for these stats, as `userId` sees it. */
export function statsPage(stats: PatchStats, userId: string | null): StatsPage {
  const { totals } = stats;
  return {
    totals: [
      { emoji: '🏡', label: 'Claimed', value: count(totals.claimed) },
      { emoji: '🌿', label: 'Wild left', value: count(totals.wild) },
      { emoji: '🏮', label: 'Lit', value: count(totals.lit) },
      { emoji: '🏘️', label: 'Hollows restored', value: count(totals.villages) },
    ],
    keepers: stats.keepers.map((k) => keeperCard(k, userId)),
  };
}
