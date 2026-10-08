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
import { TOOL_WORDS } from '../inventory/tool-uses.js';
import { EXPLORE_VIEW } from './explore-config.js';

export { TOOL_WORDS, usesLine } from '../inventory/tool-uses.js';

// What the explore view says and where the Keeper may walk (#199). Pure, so
// every case is unit-tested; copy follows docs/STYLE_GUIDE.md. The server
// rolls every find (CLAUDE.md rule 1): nothing here guesses what a spot holds.

/** Player-facing text (style guide §6, §9). */
export const EXPLORE_TEXT = {
  explore: 'Explore',
  back: 'Back',
  /** Under the joystick (#291). */
  walkHint: 'Or drag anywhere, or tap to walk',
  /** The big button with nothing in front of the Keeper. */
  nothingNear: 'Find a glint',
  allDone: 'All found!',
  ta: 'Ta-da!',
  worm: 'Just a wiggly worm! 🪱',
  lorePage: 'A lore page!',
  clothing: 'Something to wear!',
  recipeBook: 'Open recipe book',
  tileExplored: (name: string) => `You explored every spot in this ${name}! ✨`,
  joinedTitle: (name: string) => `${name} joined your home!`,
  joinedHome: 'Its gatherers bring back a little extra now.',
  homestead: '🏡 Homestead: part of your home. Its gatherers bring back a little extra!',
  bigSplash: 'Big splash! 💦',
  pausedHome: 'This homestead is napping zZ. Win back the land between it and home to wake it up!',
  easy: 'Easy way',
  notNow: 'Not now',
  yay: 'Yay!',
  searching: 'Searching…',
  explored: '✨ Fully explored',
  /** The header chip with no tool in hand. */
  hands: 'Hands',
  /** The bag in the header, where finds land. */
  bag: 'Your bag',
  /** The lantern (#291, board g). */
  grab: 'Grab it',
  lanternHint: 'Walk your light around. Look for a glint!',
  glint: 'A glint!',
} as const;

/**
 * Line icons drawn as SVG (#291, like the boards' button icons): the tools
 * and the things a Keeper lifts. Newer emoji (🪏 is Emoji 16, 🪢 and 🪨 are
 * Emoji 13) show as an empty box on older iPhones, so these never use them.
 * 24 × 24 stroke paths for `strokeIcon`.
 */
export const ICON_PATHS = {
  shovel: 'M4 20l9-9 M13 11l3-3 4 4-3 3z M3 21l2-2',
  net: 'M4 20l7.2-7.2 M9.5 9a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0-11 0 M12 6.5l6 5 M12 11.5l6-5',
  rope: 'M12 5a7 7 0 1 0 7 7 M12 9a3 3 0 1 0 3 3 M19 12v8',
  lantern: 'M12 2.5v2 M9.5 4.5h5 M8 7h8 M9 7v11h6V7 M12 10.5v4 M7 20h10',
  rock: 'M4 18l2.5-6 4-4 5 1.5 3.5 4 1 4.5Z',
  log: 'M6 8h12a4 4 0 0 1 0 8H6 M6 8a4 4 0 0 0 0 8a4 4 0 0 0 0-8 M6 11v2',
} as const;

export type IconName = keyof typeof ICON_PATHS;

/** True when `icon` names an SVG icon (else it's an emoji or text). */
export function isIconName(icon: string): icon is IconName {
  return Object.hasOwn(ICON_PATHS, icon);
}

/** Each tool's icon (SVG). */
export const TOOL_ICONS: Readonly<Record<ToolId, IconName>> = {
  shovel: 'shovel',
  net: 'net',
  rope: 'rope',
  lantern: 'lantern',
};

/** Each hand-searched spot's icon on the big button: the flower bed is flowers, not a tree. */
const HAND_ICONS: Readonly<Record<string, string>> = {
  tree: '🌳',
  'flower-bed': '🌷',
  'pumpkin-row': '🎃',
  'hollow-log': 'log',
  rock: 'rock',
};

/** The action button for a spot: its icon (an `ICON_PATHS` name or an emoji) and verb. */
export function actionFor(spot: Pick<PublicSearchSpot, 'kind' | 'tool'>): {
  readonly icon: string;
  readonly label: string;
  readonly interaction: SpotInteraction;
} {
  const kind = EXPLORE_RULES.spotKinds.find((k) => k.id === spot.kind);
  const interaction: SpotInteraction = kind?.interaction ?? 'lift';
  if (spot.tool) {
    return { icon: TOOL_ICONS[spot.tool], label: TOOL_WORDS[spot.tool].verb, interaction };
  }
  const icon = HAND_ICONS[spot.kind] ?? (interaction === 'shake' ? '🌳' : 'rock');
  return { icon, label: interaction === 'shake' ? 'Shake' : 'Lift', interaction };
}

/** "7 of 12 found 🔍", or "All 12 found! ✨" once the tile is done. */
export function progressLine(progress: { searched: number; total: number }): string {
  if (progress.total > 0 && progress.searched >= progress.total) {
    return `All ${String(progress.total)} found! ✨`;
  }
  return `${String(progress.searched)} of ${String(progress.total)} found 🔍`;
}

/** A tool's name from the rules (the Bag's name for the same item). */
export function toolName(tool: ToolId): string {
  return EXPLORE_RULES.tools.find((t) => t.id === tool)?.name ?? itemName(tool);
}

/** How many uses one tool has when it's new. */
export function toolUses(tool: ToolId): number {
  return EXPLORE_RULES.tools.find((t) => t.id === tool)?.uses ?? 1;
}

/** A spot kind's name in a sentence: "mound", "hollow log". */
export function spotName(kind: string): string {
  return (EXPLORE_RULES.spotKinds.find((k) => k.id === kind)?.name ?? 'spot').toLowerCase();
}

/** The missing-tool hint (#291, board h): "This mound needs a Shovel!" */
export function needsHere(kind: string, tool: ToolId): string {
  return `This ${spotName(kind)} needs a ${toolName(tool)}!`;
}

/**
 * The header chip's short text (#291): just the uses left ("18"), or "zZ"
 * once the tool rests; empty for hands. `toolChip` is its spoken label.
 */
export function toolChipShort(tool: ToolId | null, uses: number): string {
  if (tool === null) return '';
  return uses <= 0 ? 'zZ' : String(uses);
}

/** The header chip (#291): "Shovel · 18 digs", "Shovel · Resting zZ", or "Hands". */
export function toolChip(tool: ToolId | null, uses: number): string {
  if (tool === null) return EXPLORE_TEXT.hands;
  if (uses <= 0) return `${toolName(tool)} · Resting zZ`;
  const words = TOOL_WORDS[tool];
  return `${toolName(tool)} · ${String(uses)} ${uses === 1 ? words.one : words.many}`;
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

/**
 * The hint's recipe line: "Make one: 🪵 Timber 2/2 · 🪨 Stone 1/2". Without
 * the bag yet, just what it takes: "🪵 Timber ×2".
 */
export function makeOneLine(rows: readonly NeedRow[], counted: boolean): string {
  const parts = rows.map((row) => (counted ? row.text : row.text.replace(/ \d+\/(\d+)$/, ' ×$1')));
  return parts.length === 0 ? '' : `Make one: ${parts.join(' · ')}`;
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

/**
 * A rare find gets the full card (#291, board i): a lore page, something to
 * wear, a notable find, or the search that finished the tile. Everything
 * else is a small toast while the world keeps going.
 */
export function findShowsCard(found: SearchSpotResponse): boolean {
  return found.lore !== null || found.clothing !== null || found.notable !== null || found.explored;
}

/** The find toast (#291, board c): "+2 Timber · +1 Stone", then "Puddlepuff +6 XP". */
export function findToast(
  found: SearchSpotResponse,
  names: Readonly<Record<string, string>>,
  bigSplash = false,
): { readonly main: string; readonly extra: string } {
  const items = Object.entries(found.found)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `+${String(n)} ${itemName(id)}`);
  const main = items.length === 0 ? EXPLORE_TEXT.worm : items.join(' · ');
  const extra = [...xpLines(found.xp, names)];
  if (found.tool && found.tool.usesLeft === 0) extra.push(restLine(found.tool.id));
  return { main: bigSplash ? `${EXPLORE_TEXT.bigSplash} ${main}` : main, extra: extra.join(' · ') };
}

/** How many things a search put in the bag (the bag's "+2"). */
export function foundCount(found: SearchSpotResponse): number {
  return Object.values(found.found).reduce((sum, n) => sum + Math.max(0, n), 0);
}

/** The rare card's title: the tile joining home, the tile done, or the rare thing found. */
export function rareTitle(found: SearchSpotResponse, terrain: string): string {
  if (found.explored && found.homestead === 'joined') {
    return EXPLORE_TEXT.joinedTitle(terrainName(terrain));
  }
  if (found.explored) return EXPLORE_TEXT.tileExplored(terrainName(terrain));
  if (found.lore) return EXPLORE_TEXT.lorePage;
  if (found.clothing) return EXPLORE_TEXT.clothing;
  return EXPLORE_TEXT.ta;
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

/** One step of `distance` from `from` towards `to` (stopping on it), kept inside the tile. */
export function stepToward(from: WorldPoint, to: WorldPoint, distance: number): WorldPoint {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d <= distance || d === 0) return clampToTile(to);
  return clampToTile({ x: from.x + (dx / d) * distance, z: from.z + (dz / d) * distance });
}

/**
 * The joystick (owner decision 2026-10-07; always shown, #291): the drag from where the
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
