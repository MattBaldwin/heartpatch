import { hexToWorld, type FarHollowTileSummary, type FarHollowView } from '@heartpatch/shared';

// The far Hollow (#306 PR 6, plan Q7, owner decision 7), in words and
// places. Pure, so every case is unit-tested. The server works out the
// layout, the progress and the season (CLAUDE.md rule 1); this only says it.

export const FAR_HOLLOW_TEXT = {
  /** The trading post panel's button. */
  open: 'The far Hollow 🕯️',
  title: (name: string) => `${name} 🕯️`,
  kicker: (season: string) => `${season} season`,
  awayLead:
    'A grey Hollow far past the last post, all your own this season. Win the far road to get there, and bring its colour back!',
  road: (teamSize: number, level: number) =>
    `Trail squishies: ${String(teamSize)}, about level ${String(level)}`,
  roadStakes: "Tuckered out? Nothing's lost. Just try again.",
  start: 'Take the far road 🧭',
  fromPost: 'The far road starts at any trading post you can visit. 🏮',
  arrivedLead: 'Your own far Hollow! Search every spot to bring the colour back.',
  progress: (searched: number, total: number) =>
    `${String(searched)} of ${String(total)} spots found 🔍`,
  tileLabel: (terrain: string, searched: number, total: number) =>
    `${terrain}: ${String(searched)} of ${String(total)} found`,
  tapTile: 'Tap a tile to explore it.',
  night: 'Too spooky after dark! Come back in the morning 🌙',
  doneTitle: 'All the joy is back! 🌈',
  doneLead: 'Every tile of the far Hollow glows again. You did that!',
  fresh: (season: string, date: string) => `A fresh far Hollow comes with ${season} on ${date} ✨`,
  freshSoon: 'A fresh far Hollow comes next season ✨',
  close: 'Close',
  // The far road's result card (the journey card's shape).
  wonTitle: 'You made it to the far Hollow!',
  wonSub: "It's yours to explore all season.",
  wonDone: 'Explore it 🕯️',
  // The last spot's card in the explore view.
  cardTitle: 'All the joy is back! 🌈',
  cardLine: 'You found every spot in the far Hollow.',
  cardNext: 'A brand-new one comes next season!',
} as const;

/** Where I am with this season's far Hollow. */
export type FarHollowState = 'away' | 'arrived' | 'complete';

export function farHollowState(
  view: Pick<FarHollowView, 'arrived' | 'completedAt'>,
): FarHollowState {
  if (!view.arrived) return 'away';
  return view.completedAt === null ? 'arrived' : 'complete';
}

/** Every spot of the far Hollow, found and all. */
export function farHollowProgress(
  tiles: readonly Pick<FarHollowTileSummary, 'searched' | 'total'>[],
): {
  searched: number;
  total: number;
} {
  return tiles.reduce(
    (sum, t) => ({ searched: sum.searched + t.searched, total: sum.total + t.total }),
    { searched: 0, total: 0 },
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A map-local date (`YYYY-MM-DD`) the short way: "Dec 1". */
export function shortDate(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${MONTHS[(month ?? 1) - 1] ?? ''} ${String(day ?? 1)}`;
}

/** The "fresh next season" line, once the joy is all back. */
export function freshLine(next: FarHollowView['nextSeason']): string {
  return next
    ? FAR_HOLLOW_TEXT.fresh(next.name, shortDate(next.startsOn))
    : FAR_HOLLOW_TEXT.freshSoon;
}

/** One tile's place on the sheet's little map, as a share of the map's width and height (0–100). */
export interface FarHollowSpot {
  readonly index: number;
  readonly left: number;
  readonly top: number;
}

/**
 * Where each tile sits on the sheet's little map: the far Hollow's own hex
 * layout (pointy-top, like the patch), fitted into a box with room for half
 * a tile on every side, as percentages. Also the box's width over height, so
 * the map keeps the layout's shape.
 */
export function farHollowSpots(tiles: readonly Pick<FarHollowTileSummary, 'index' | 'q' | 'r'>[]): {
  spots: FarHollowSpot[];
  aspect: number;
  /** One tile's width and height, as a share of the map's (0–100). */
  tile: { width: number; height: number };
} {
  if (tiles.length === 0) return { spots: [], aspect: 1, tile: { width: 0, height: 0 } };
  const points = tiles.map((t) => ({ index: t.index, ...hexToWorld(t, 1) }));
  const xs = points.map((p) => p.x);
  const zs = points.map((p) => p.z);
  // A tile is √3 wide and 2 tall at size 1: half of each as room round the edge.
  const minX = Math.min(...xs) - Math.sqrt(3) / 2;
  const maxX = Math.max(...xs) + Math.sqrt(3) / 2;
  const minZ = Math.min(...zs) - 1;
  const maxZ = Math.max(...zs) + 1;
  const width = maxX - minX;
  const height = maxZ - minZ;
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    // +z is away from the camera on the patch, so it's up here.
    spots: points.map((p) => ({
      index: p.index,
      left: round(((p.x - minX) / width) * 100),
      top: round(((maxZ - p.z) / height) * 100),
    })),
    aspect: round(width / height),
    tile: { width: round((Math.sqrt(3) / width) * 100), height: round((2 / height) * 100) },
  };
}

/** Each far-Hollow terrain's little picture on the sheet's map. */
export const FAR_HOLLOW_TERRAIN_EMOJI: Readonly<Record<string, string>> = {
  meadow: '🌼',
  forest: '🌲',
  hills: '⛰️',
  'old-forest': '🍄',
};
