import {
  HomeNameSchema,
  NAMING_RULES,
  type BuildableKind,
  type HomeNaming,
  type MapView,
  type PublicTile,
} from '@heartpatch/shared';
import { findHomeBases } from '../map/map-layout.js';

// Naming your home (#306 PR 0): what the home sheet's row, the name card, the
// map's home flags and the Heart Seed's tile title say. Pure, so every case
// is unit-tested; the server checks the gate and the name again (CLAUDE.md
// rule 1). Copy follows docs/STYLE_GUIDE.md.

/** Each buildable kind's name on the locked card's chips. Typed, so a new kind needs one. */
export const KIND_NAMES: Readonly<Record<BuildableKind, string>> = {
  hearthfire: 'Hearthfire',
  habitat: 'Habitat',
  'training-grounds': 'Training Grounds',
  fence: 'Fence',
  factory: 'Crafting Factory',
};

export const HOME_NAME_TEXT = {
  // The home sheet's row.
  row: 'Name your home',
  locked: '🔒',
  unlocked: '🏡',
  grew: '🌱 Your Heart Seed grew! New name?',
  // The locked row's progress, in words a kid reads at a glance.
  rowBuildings: (built: number, all: number) => `${String(built)} of ${String(all)} buildings`,
  rowSquishies: (caught: number, need: number) => `${String(caught)} of ${String(need)} squishies`,
  // The nudge when naming is ready: a badge on the peek bar's handle, and a line on the Heart Seed's tile.
  handleNudge: '✨ Name your home!',
  handleNudgeLabel: 'Name your home is ready. Show more to find it.',
  seedLine: '✨ You can name your home! Open Home, then More.',
  // The locked card.
  lockedKicker: 'YOUR HOME · LOCKED 🔒',
  lockedTitle: 'Name your home 🔒',
  lockedLine: (need: number) =>
    `Build one of each and catch ${String(need)} squishies to name your home!`,
  kindsLine: (built: number, all: number) =>
    `Buildings: ${String(built)} of ${String(all)} kinds built`,
  caughtLine: (caught: number, need: number) =>
    `Squishies caught: ${String(caught)} of ${String(need)}`,
  caughtLabel: (caught: number, need: number) =>
    `${String(caught)} of ${String(need)} squishies caught`,
  caughtNote:
    "Caught means won in a battle. Your starter and gifts don't count, but they still love you.",
  keepGoing: 'Keep going! 💪',
  // The unlocked card.
  unlockedKicker: 'YOUR HOME · UNLOCKED ✨',
  unlockedTitle: 'Name your home 🏡',
  unlockedLine: (need: number) =>
    `One of each built and ${String(need)} squishies caught. What's your home called?`,
  grewLine: 'Your Heart Seed grew! Want a new name?',
  label: 'Home name',
  placeholder: 'Type a name…',
  ideas: 'Name ideas',
  note: (max: number) =>
    `Tap an idea, or type your own. Up to ${String(max)} letters. Pick a new name whenever your Heart Seed grows!`,
  nameIt: 'Name it! 🏡',
  notNow: 'Not now',
  // Named, with no new name open yet.
  namedKicker: 'YOUR HOME ✨',
  namedLine: 'When your Heart Seed grows, you can pick a new name! 🌱',
  back: 'Back',
  // After naming.
  named: (name: string) => `Ta-da! Welcome to ${name}! 🏡`,
} as const;

/** "🏡 Puddle Corner": a named home's flag on the map, and its row at home. */
export function homeFlagLabel(name: string): string {
  return `🏡 ${name}`;
}

/** "Puddle Corner · Heart Seed 🌱": a named home's Heart Seed tile in the tile panel. */
export function seedTitle(name: string): string {
  return `${name} · Heart Seed 🌱`;
}

/**
 * The home sheet's "Name your home" row: locked with the progress
 * ("Name your home 🔒 · 3 of 5 buildings · 7 of 10 squishies"), ready ("Name your home 🏡"), or the
 * name itself once named. Every number comes from the server's gate.
 */
export function nameRowLabel(naming: HomeNaming): string {
  const { title, detail } = nameRowParts(naming);
  return detail === null ? title : `${title} · ${detail}`;
}

/** The row's words in two lines: the title, and (locked only) the progress under it. */
export function nameRowParts(naming: HomeNaming): { title: string; detail: string | null } {
  if (naming.name !== null) return { title: homeFlagLabel(naming.name), detail: null };
  if (!naming.unlocked) {
    const built = naming.kinds.filter((k) => k.built).length;
    return {
      title: `${HOME_NAME_TEXT.row} ${HOME_NAME_TEXT.locked}`,
      detail: `${HOME_NAME_TEXT.rowBuildings(built, naming.kinds.length)} · ${HOME_NAME_TEXT.rowSquishies(naming.caught, naming.need)}`,
    };
  }
  return { title: `${HOME_NAME_TEXT.row} ${HOME_NAME_TEXT.unlocked}`, detail: null };
}

/** The row's badge: a named home whose Heart Seed grew may take a new name. */
export function nameRowBadge(naming: HomeNaming): string | null {
  return naming.name !== null && naming.renameOpen ? HOME_NAME_TEXT.grew : null;
}

/**
 * Whether to nudge the player toward the row (the peek bar's badge, the Heart
 * Seed tile's line): naming is open and nothing has been picked yet, or a
 * grown Heart Seed has opened a rename.
 */
export function nameReady(naming: HomeNaming | undefined): boolean {
  return naming !== undefined && naming.unlocked && (naming.name === null || naming.renameOpen);
}

/** Which card the row opens. */
export type NameCard = 'locked' | 'name' | 'named';

export function nameCard(naming: HomeNaming): NameCard {
  if (!naming.unlocked) return 'locked';
  return naming.renameOpen ? 'name' : 'named';
}

/**
 * A few cozy home-name ideas per terrain (#306), the first ones first.
 * None use the established place names (style guide §4).
 */
export const TERRAIN_IDEAS: Readonly<Record<string, readonly string[]>> = {
  meadow: ['Sunny Patch', 'Daisy Nook'],
  forest: ['Acorn Corner', 'Mossy Nook'],
  'old-forest': ['Fern Hideaway', 'Owl Glen'],
  hills: ['Breezy Hilltop', 'Bumpy Burrow'],
  mountains: ['Pebble Peak', 'Cloudy Cliff'],
  lake: ['Puddle Corner', 'Splashy Cove'],
  'pumpkin-fields': ['Pumpkin Nook', 'Gourd Garden'],
  clearing: ['Stumpy Spot', 'Snug Clearing'],
};

/** Ideas for land the table doesn't know. */
const FALLBACK_IDEAS = ['Sunny Patch', 'Cozy Corner', 'Snug Nook'];

/** A name the server's rules would take (trimmed, short enough, friendly letters), or null. */
function fits(name: string, maxLength: number): string | null {
  const parsed = HomeNameSchema.safeParse(name);
  return parsed.success && parsed.data.length <= maxLength ? parsed.data : null;
}

/**
 * Three tap-to-fill ideas (#306): "<Keeper>'s Meadow" first, then two from
 * the home ring's land, most common first. Every idea fits `maxLength` and
 * the name rules; one that doesn't is skipped for the next, so a long
 * username still gets three. Usernames' underscores read as spaces.
 */
export function nameIdeas(
  keeperName: string | null,
  terrains: readonly string[],
  maxLength: number = NAMING_RULES.maxLength,
): string[] {
  const ideas: string[] = [];
  const add = (name: string): boolean => {
    const ok = fits(name, maxLength);
    if (ok === null || ideas.includes(ok) || ideas.length >= 3) return false;
    ideas.push(ok);
    return true;
  };
  const keeper = keeperName?.replace(/_+/g, ' ').trim() ?? '';
  // A long name gets the shorter "Nook" instead.
  if (keeper && !add(`${keeper}'s Meadow`)) add(`${keeper}'s Nook`);
  const counts = new Map<string, number>();
  for (const t of terrains) counts.set(t, (counts.get(t) ?? 0) + 1);
  const order = [...counts.keys()].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
  // One idea per terrain first, so two kinds of land give one each.
  const lists = order.map((t) => TERRAIN_IDEAS[t] ?? FALLBACK_IDEAS);
  for (let i = 0; i < 2; i++) {
    for (const list of lists) {
      const idea = list[i];
      if (idea) add(idea);
    }
  }
  for (const name of FALLBACK_IDEAS) add(name);
  return ideas;
}

/** My home ring's terrains (not the Heart Seed's), from the map view. */
export function ringTerrains(view: MapView | null, me: string | null): string[] {
  if (!view || me === null) return [];
  const seed = findHomeBases(view.tiles).find((h) => h.seed.ownerUserId === me)?.seed;
  if (!seed) return [];
  return view.tiles
    .filter((t) => t.homeSlot === seed.homeSlot && !(t.q === seed.q && t.r === seed.r))
    .map((t) => t.terrain);
}

/** A named home's flag: whose it is, its words and its Heart Seed tile. */
export interface HomeFlag {
  readonly userId: string;
  readonly label: string;
  readonly tile: PublicTile;
}

/** Every named member's home flag (#306), over their Heart Seed, in member order. */
export function homeFlags(view: MapView): HomeFlag[] {
  const seeds = new Map<string, PublicTile>();
  for (const h of findHomeBases(view.tiles)) {
    if (h.seed.ownerUserId !== null) seeds.set(h.seed.ownerUserId, h.seed);
  }
  return view.members.flatMap((m) => {
    const tile = seeds.get(m.user.id);
    return m.homeName && tile
      ? [{ userId: m.user.id, label: homeFlagLabel(m.homeName), tile }]
      : [];
  });
}

/** A named home's name if `tile` is its Heart Seed, else null (the tile panel's title). */
export function seedName(view: MapView, tile: PublicTile): string | null {
  if (tile.homeSlot === null || tile.ownerUserId === null) return null;
  const flag = homeFlags(view).find(
    (f) => f.userId === tile.ownerUserId && f.tile.q === tile.q && f.tile.r === tile.r,
  );
  if (!flag) return null;
  return view.members.find((m) => m.user.id === flag.userId)?.homeName ?? null;
}

/** Whether `tile` is a Heart Seed (the middle of a home ring) in `view`. */
export function isSeedTile(view: MapView, tile: PublicTile): boolean {
  return findHomeBases(view.tiles).some((h) => h.seed.q === tile.q && h.seed.r === tile.r);
}
