import {
  CLOTHING_BY_ID,
  EXPLORE_RULES,
  GAME_DATA,
  TERRAINS,
  type ExploreTileResponse,
  type ItemCounts,
  type PublicSearchSpot,
  type SearchSpotResponse,
  type SpotInteraction,
  type ToolId,
  type WorldPoint,
} from '@heartpatch/shared';
import { itemName } from '../inventory/bag-view.js';
import { itemIcon } from '../inventory/item-icons.js';
import { EXPLORE_VIEW } from './explore-config.js';

// What the explore view says and where the Keeper may walk (#199). Pure, so
// every case is unit-tested; copy follows docs/STYLE_GUIDE.md. The server
// rolls every find (CLAUDE.md rule 1): nothing here guesses what a spot holds.

/** Player-facing text (style guide §6, §9). */
export const EXPLORE_TEXT = {
  explore: 'Explore',
  back: 'Back',
  withTeam: (names: readonly string[]) =>
    names.length === 0
      ? 'Exploring with your Keeper'
      : `Exploring with ${listOf(names.slice(0, 3))}`,
  walkHint: 'Tap the ground or drag to walk. Find a sparkle!',
  nothingNear: 'Walk up to a sparkle to search it!',
  allDone: 'You searched every spot here! ✨',
  ta: 'Ta-da!',
  worm: 'Just a wiggly worm! 🪱 Nothing else this time.',
  teamLearned: 'Your team learned something!',
  lorePage: 'A lore page!',
  clothing: 'Something to wear!',
  keepGoing: 'Keep exploring',
  recipeBook: 'Open recipe book',
  somethingElse: 'Explore something else here',
  makeOne: 'Make one in the recipe book, then come back.',
  tileExplored: (name: string) => `You explored every spot in this ${name}! ✨`,
  joinedHome: 'It joined your home! 🏡 Its gatherers bring back a little extra now.',
  pausedHome: 'This homestead is napping zZ. Win back the land between it and home to wake it up!',
  easy: 'Easy way',
  searching: 'Searching…',
  explored: '✨ Fully explored',
} as const;

/** Each tool in words: what it's for, and what one use of it is called. */
export const TOOL_WORDS: Readonly<
  Record<ToolId, { icon: string; verb: string; one: string; many: string; needs: string }>
> = {
  shovel: { icon: '🪏', verb: 'Dig', one: 'dig', many: 'digs', needs: 'to dig there' },
  net: { icon: '🥅', verb: 'Scoop', one: 'scoop', many: 'scoops', needs: 'to scoop there' },
  rope: { icon: '🪢', verb: 'Climb', one: 'climb', many: 'climbs', needs: 'to climb up there' },
  lantern: { icon: '🪔', verb: 'Light', one: 'cave', many: 'caves', needs: 'to peek in there' },
};

/** The action button for a spot: its icon and verb. */
export function actionFor(spot: Pick<PublicSearchSpot, 'kind' | 'tool'>): {
  readonly icon: string;
  readonly label: string;
  readonly interaction: SpotInteraction;
} {
  const kind = EXPLORE_RULES.spotKinds.find((k) => k.id === spot.kind);
  const interaction: SpotInteraction = kind?.interaction ?? 'lift';
  if (spot.tool) {
    const words = TOOL_WORDS[spot.tool];
    return { icon: words.icon, label: words.verb, interaction };
  }
  return interaction === 'shake'
    ? { icon: '🌳', label: 'Shake', interaction }
    : { icon: '🪨', label: 'Lift', interaction };
}

/** "7 of 12 found 🔍", or "All 12 found! ✨" once the tile is done. */
export function progressLine(progress: { searched: number; total: number }): string {
  if (progress.total > 0 && progress.searched >= progress.total) {
    return `All ${String(progress.total)} found! ✨`;
  }
  return `${String(progress.searched)} of ${String(progress.total)} found 🔍`;
}

/** "12 scoops left", "1 dig left", or "Resting zZ" when it's used up. */
export function usesLine(tool: ToolId, uses: number): string {
  if (uses <= 0) return 'Resting zZ';
  const words = TOOL_WORDS[tool];
  return `${String(uses)} ${uses === 1 ? words.one : words.many} left`;
}

/** A tool's name from the rules (the Bag's name for the same item). */
export function toolName(tool: ToolId): string {
  return EXPLORE_RULES.tools.find((t) => t.id === tool)?.name ?? itemName(tool);
}

/** How many uses one tool has when it's new. */
export function toolUses(tool: ToolId): number {
  return EXPLORE_RULES.tools.find((t) => t.id === tool)?.uses ?? 1;
}

/** "You need a Rope to climb up there!" */
export function needLine(tool: ToolId): string {
  return `You need a ${toolName(tool)} ${TOOL_WORDS[tool].needs}!`;
}

/** The tool just wore out: "Your Shovel needs a rest! …" (owner decision 2026-10-06). */
export function restLine(tool: ToolId): string {
  return `Your ${toolName(tool)} needs a rest! Craft a new one 🛠️`;
}

/** One ingredient of a tool's recipe, with how many the bag has. */
export interface NeedRow {
  readonly id: string;
  readonly text: string;
  readonly enough: boolean;
}

/** The recipe that makes a tool, as rows: "🌿 Greens 1/4". Empty if no recipe makes it. */
export function toolRecipeRows(tool: ToolId, bag: ItemCounts): NeedRow[] {
  const recipe = GAME_DATA.recipes.find((r) => r.output.resource === tool);
  if (!recipe) return [];
  return Object.entries(recipe.inputs).map(([id, need]) => {
    const have = Math.min(bag[id] ?? 0, need);
    return {
      id,
      text: `${itemIcon(id)} ${itemName(id)} ${String(have)}/${String(need)}`,
      enough: have >= need,
    };
  });
}

/** The terrain's name for the header ("Meadow"). */
export function terrainName(terrain: string): string {
  return TERRAINS.find((t) => t.id === terrain)?.name ?? 'Your land';
}

/** The find card's headline, by what the Keeper did ("You dug up…"). */
export function foundHeadline(interaction: SpotInteraction): string {
  switch (interaction) {
    case 'dig':
      return 'You dug up…';
    case 'scoop':
      return 'You scooped up…';
    case 'climb':
      return 'Up on the ledge you found…';
    case 'light':
      return 'Deep in the cave you found…';
    case 'shake':
      return 'Down fell…';
    case 'lift':
      return 'Under there you found…';
  }
}

/** One line of the find card. */
export interface FindLine {
  readonly kind: 'item' | 'lore' | 'clothing' | 'none';
  readonly text: string;
}

/** What a search found, as card lines (items, a lore page, something to wear, or a worm). */
export function findLines(found: SearchSpotResponse): FindLine[] {
  const lines: FindLine[] = Object.entries(found.found)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => ({ kind: 'item', text: `${itemIcon(id)} ${itemName(id)} ×${String(n)}` }));
  if (found.lore) {
    lines.push({ kind: 'lore', text: `📜 ${EXPLORE_TEXT.lorePage} “${found.lore.title}”` });
  }
  if (found.clothing) {
    const piece = CLOTHING_BY_ID.get(found.clothing);
    lines.push({ kind: 'clothing', text: `👒 ${piece?.name ?? EXPLORE_TEXT.clothing}` });
  }
  if (lines.length === 0) lines.push({ kind: 'none', text: EXPLORE_TEXT.worm });
  return lines;
}

/** "Puddlepuff +6 XP" for each team squishy that learned something. */
export function xpLines(
  xp: SearchSpotResponse['xp'],
  names: Readonly<Record<string, string>>,
): string[] {
  return xp
    .filter((x) => x.xp > 0)
    .map((x) => `${names[x.squishyId] ?? 'Your squishy'} +${String(x.xp)} XP`);
}

/** The tile with one more spot done and the bag after a search (no refetch needed). */
export function afterSearch(
  tile: ExploreTileResponse,
  found: SearchSpotResponse,
): ExploreTileResponse {
  const tools = { ...tile.tools };
  if (found.tool) tools[found.tool.id] = found.tool.usesLeft;
  return {
    ...tile,
    spots: tile.spots.map((s) => (s.index === found.spot ? { ...s, done: true } : s)),
    progress: found.progress,
    homestead: found.homestead,
    tools,
  };
}

/** The tool a spot needs that the bag has no uses of, or null when the Keeper can search it. */
export function missingTool(
  spot: Pick<PublicSearchSpot, 'tool'>,
  tools: Partial<Record<ToolId, number>>,
): ToolId | null {
  if (spot.tool === null) return null;
  return (tools[spot.tool] ?? 0) > 0 ? null : spot.tool;
}

// ── Walking ───────────────────────────────────────────────────────────────
// Tile-local units: `hexToWorld` at size 1, so a corner is 1 from the middle.
// Tiles are pointy-topped: corners up and down the z axis, flat sides left
// and right at x = ±√3/2.

const SQRT3_2 = Math.sqrt(3) / 2;

/**
 * The nearest point to `p` inside the tile, `margin` in from its edge. The
 * hex is three pairs of parallel sides; pulling the point in along each
 * side's normal in turn lands it inside.
 */
export function clampToTile(p: WorldPoint, margin: number = EXPLORE_VIEW.edgeMargin): WorldPoint {
  const limit = SQRT3_2 - margin;
  let { x, z } = p;
  // Twice round: in a corner, pulling in along one side can push past the next.
  for (const angle of [0, Math.PI / 3, (2 * Math.PI) / 3, 0, Math.PI / 3, (2 * Math.PI) / 3]) {
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    const d = x * nx + z * nz;
    if (d > limit) {
      x -= (d - limit) * nx;
      z -= (d - limit) * nz;
    } else if (d < -limit) {
      x -= (d + limit) * nx;
      z -= (d + limit) * nz;
    }
  }
  return { x, z };
}

/** True when `p` is inside the tile, `margin` in from its edge (with a hair of slack). */
export function insideTile(p: WorldPoint, margin: number = EXPLORE_VIEW.edgeMargin): boolean {
  const c = clampToTile(p, margin);
  return (c.x - p.x) * (c.x - p.x) + (c.z - p.z) * (c.z - p.z) < 1e-9;
}

/** The nearest spot not searched yet within `reach` of the Keeper, or null. */
export function nearestSpot<T extends Pick<PublicSearchSpot, 'x' | 'z' | 'done'>>(
  at: WorldPoint,
  spots: readonly T[],
  reach: number = EXPLORE_VIEW.reach,
): T | null {
  let best: T | null = null;
  let bestD = reach * reach;
  for (const s of spots) {
    if (s.done) continue;
    const d = (s.x - at.x) * (s.x - at.x) + (s.z - at.z) * (s.z - at.z);
    if (d <= bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/** One step of `distance` from `from` towards `to` (stopping on it), kept inside the tile. */
export function stepToward(from: WorldPoint, to: WorldPoint, distance: number): WorldPoint {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d <= distance || d === 0) return clampToTile(to);
  return clampToTile({ x: from.x + (dx / d) * distance, z: from.z + (dz / d) * distance });
}

/**
 * Where a walk to a spot stops: just short of it on the Keeper's side, so
 * the Keeper stands beside the rock rather than on it.
 */
export function standBeside(from: WorldPoint, spot: WorldPoint): WorldPoint {
  const dx = from.x - spot.x;
  const dz = from.z - spot.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const keep = EXPLORE_VIEW.reach * 0.6;
  if (d <= keep) return clampToTile(from);
  return clampToTile({ x: spot.x + (dx / d) * keep, z: spot.z + (dz / d) * keep });
}

/**
 * The floating joystick (owner decision 2026-10-07): the drag from where the
 * finger landed, as a direction on the ground scaled 0–1. Screen up walks
 * away from the camera (+z); a drag inside the dead zone stands still.
 */
export function joystickVector(
  dx: number,
  dy: number,
  radius: number = EXPLORE_VIEW.joystick.radius,
  deadZone: number = EXPLORE_VIEW.joystick.deadZone,
): WorldPoint {
  const d = Math.sqrt(dx * dx + dy * dy);
  const amount = Math.min(1, d / radius);
  if (amount <= deadZone || d === 0) return { x: 0, z: 0 };
  const speed = (amount - deadZone) / (1 - deadZone);
  return { x: (dx / d) * speed, z: (-dy / d) * speed };
}

function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}
