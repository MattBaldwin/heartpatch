import {
  CLOTHING_BY_ID,
  FOUND_SETS,
  HOLLOW_RULES,
  HOME_BASE_RULES,
  hollowedOpenAt,
  MEMORY_PUZZLES,
  puzzleSkinFor,
  type HollowedPuzzle,
  type PuzzleSkin,
  type SolvePuzzleResponse,
  type WorldPoint,
} from '@heartpatch/shared';
import { EXPLORE_TEXT } from '../explore/explore-view.js';
import { itemName } from '../inventory/bag-view.js';
import { clothingSlotIcon, itemIcon } from '../inventory/item-icons.js';
import { HOLLOWED_EXPLORE } from './hollowed-config.js';

// Exploring a grey village tile (#306 2a), in words and numbers (copy
// follows docs/STYLE_GUIDE.md: short, warm, a little spooky, never scary).
// Pure, so every case is unit-tested; the scene and the screen draw these.

export const HOLLOWED_TEXT = {
  /** The explore header's title on a grey village tile. */
  title: (name: string) => `${name} 🕯️`,
  /** The joy meter under "3 of 12 found 🔍" in the header (its label; the bar shows it). */
  joy: (joy: number) => `Joy ${String(joy)}% ✨`,
  /** An echo nudged the Keeper back: never hurt, just startled. */
  spooked: 'Boo! An echo spooked you back a step 👻',
  /** Nightfall while exploring a village: back to the map. */
  closed: 'Too spooky after dark! Come back in the morning 🌙',
  // Relight the path (PR 2b): no hints, no peeking (owner decision 2026-10-22).
  /** The big button in front of a broken thing. */
  fix: (skin: PuzzleSkin) => `Fix the ${skin.name}`,
  /** The card's first line: what's broken. */
  broken: (skin: PuzzleSkin) => `A broken ${skin.name} ${skin.emoji}`,
  relight: 'Relight the path',
  moves: (used: number, limit: number) => `Moves ${String(used)} of ${String(limit)}`,
  lit: (lit: number, total: number) => `Lanterns lit ${String(lit)} of ${String(total)}`,
  play: 'Turn the pieces so the light reaches every lantern.',
  echo: "An echo is in the way! The light won't pass a shadow.",
  pickSlot: 'Now tap an empty slot next to it.',
  stuck: 'That piece is stuck. Slide it next to an empty slot first.',
  oneStep: 'It can only slide one step, into the slot beside it.',
  shuffling: 'The Hollow lays out a path…',
  won: 'Every lantern glows! ✨',
  relighting: 'Relighting…',
  pathLit: 'The path is lit! ✨',
  faded: 'The light fades…',
  fadedText: 'The Hollow shuffles a new path of the same size. Try again!',
  giveUp: 'Give up',
  newPath: 'New path',
  tryAgain: 'Try again',
  /** Each cell's name, for screen readers. */
  cell: {
    heart: 'The heart of the Hollow',
    litLantern: 'A lit lantern',
    darkLantern: 'A dark lantern',
    loose: 'A wooden piece: tap to slide',
    pipe: 'A path piece: tap to turn',
    shadow: 'An echo shadow',
    empty: 'An empty slot',
  },
  // The forgotten story (#306), on the heart tile.
  story: 'The forgotten story',
  /** The big button's word while pages are still hidden round the Hollow. */
  pagesFound: (found: number, total: number) => `${String(found)} of ${String(total)} pages found`,
  tornPage: (n: number) => `Torn page ${String(n)}`,
  storyDealing: 'The pages flutter open…',
  storyPlay: 'Read the torn pages, then tap the moments in the order they happened.',
  storyReady: 'All in place? Tell the story!',
  storyTelling: 'Telling the story…',
  storySmudged: (right: number, total: number) =>
    `The ink smudges… ${String(right)} of ${String(total)} were in the right place.`,
  notQuite: 'Not quite…',
  notQuiteText: 'The pages flutter and the ink shifts: the Hollow tells its day a new way.',
  newPages: 'Read the new pages',
  tell: 'Tell the story',
  clear: 'Clear',
  storyWhole: 'The story is whole again! 📜',
  first: 'First',
  last: 'Last',
  /** Each place, for screen readers. */
  place: (n: number, text: string | null) =>
    text ? `${String(n)}: ${text}. Tap to take it back.` : `${String(n)}: empty`,
  lorePage: (title: string) => `📜 A lore page! “${title}”`,
  thanks: 'The Hollow says thank you!',
  addedToLorebook: 'Added to your Lorebook 📖',
} as const;

/**
 * The broken thing's index where the explore view treats it as one more
 * spot (aiming, a tap walking up beside it, the halo): never a real spot's.
 */
export const PUZZLE_INDEX = -1;

/**
 * A grey village tile's broken thing as a spot the Keeper can walk up to,
 * or null when there's none. `done` once I've mended it.
 */
export function puzzleSpot(
  puzzle: HollowedPuzzle | undefined,
): (WorldPoint & { index: number; kind: 'puzzle'; tool: null; done: boolean }) | null {
  if (!puzzle) return null;
  return {
    index: PUZZLE_INDEX,
    kind: 'puzzle',
    tool: null,
    x: puzzle.x,
    z: puzzle.z,
    done: puzzle.solved,
  };
}

/**
 * The heart's story while torn pages are still hidden round the Hollow: my
 * pages so far (the big button shows them), or null once it's awake (#306).
 */
export function storyAsleep(
  puzzle: Pick<HollowedPuzzle, 'kind' | 'pages' | 'solved'>,
): { found: number; total: number } | null {
  if (puzzle.kind !== 'story' || puzzle.solved || !puzzle.pages) return null;
  return puzzle.pages.found < puzzle.pages.total ? puzzle.pages : null;
}

/** A puzzle's skin (its look and words), from `MEMORY_PUZZLES`. */
export function skinOf(puzzle: Pick<HollowedPuzzle, 'skin'>): PuzzleSkin {
  return (
    MEMORY_PUZZLES.skins.find((s) => s.id === puzzle.skin) ?? puzzleSkinFor('', MEMORY_PUZZLES)
  );
}

/** What fixing it gave, one line each (the reward card's list). */
export function puzzleLines(fixed: SolvePuzzleResponse): { text: string; note?: string }[] {
  const lines: { text: string; note?: string }[] = [];
  if (fixed.lore) {
    lines.push({
      text: HOLLOWED_TEXT.lorePage(fixed.lore.title),
      note: HOLLOWED_TEXT.addedToLorebook,
    });
  }
  // Items and a Rekindled piece as the search card shows them.
  for (const [id, n] of Object.entries(fixed.found)) {
    if (n <= 0) continue;
    const set = FOUND_SETS.some((s) => s.finds.includes(id));
    lines.push({
      text: `${itemIcon(id)} ${itemName(id)} ×${String(n)}`,
      ...(set ? { note: EXPLORE_TEXT.setFindNote } : {}),
    });
  }
  if (fixed.clothing) {
    const piece = CLOTHING_BY_ID.get(fixed.clothing);
    const icon = piece ? clothingSlotIcon(piece.slot) : '✨';
    lines.push({ text: `${icon} ${piece?.name ?? EXPLORE_TEXT.clothing}` });
  }
  if (lines.length === 0) lines.push({ text: HOLLOWED_TEXT.thanks });
  return lines;
}

/** Is a grey village shut at `minute` past midnight, map time? (Night: the server refuses too.) */
export function villageShut(minute: number): boolean {
  return !hollowedOpenAt({ date: '', minute }, { ...HOME_BASE_RULES, ...HOLLOW_RULES });
}

/** Where an echo is `seconds` into ambient time: a slow, squashed loop round its point. */
export function echoAt(centre: WorldPoint, seconds: number, out: { x: number; z: number }): void {
  const { orbit, lapSeconds } = HOLLOWED_EXPLORE.echo;
  const a = (seconds / lapSeconds) * Math.PI * 2;
  out.x = centre.x + Math.cos(a) * orbit;
  out.z = centre.z + Math.sin(a) * orbit * 0.6;
}

/** How close an echo spooks the Keeper: half as close with a lantern in hand. */
export function spookReach(lantern: boolean): number {
  const { reach, lantern: share } = HOLLOWED_EXPLORE.echo;
  return lantern ? reach * share : reach;
}

/**
 * The Keeper stepped inside an echo's reach: where it's nudged back to
 * (straight away from the echo, `push` past the reach), or null when it's
 * outside. Never a hurt, one step and a line.
 */
export function spookPush(keeper: WorldPoint, echo: WorldPoint, reach: number): WorldPoint | null {
  const dx = keeper.x - echo.x;
  const dz = keeper.z - echo.z;
  const d = Math.hypot(dx, dz);
  if (d > reach) return null;
  const push = HOLLOWED_EXPLORE.echo.push + (reach - d);
  // Right on top of it: back towards the camera (−z), the way the Keeper came.
  if (d < 1e-6) return { x: keeper.x, z: keeper.z - push };
  return { x: keeper.x + (dx / d) * push, z: keeper.z + (dz / d) * push };
}

/** A joy disc's opening 0–1 at `now`, eased out; one already there is open. */
export function discOpening(since: number | null, now: number): number {
  if (since === null) return 1;
  const k = Math.min(1, Math.max(0, (now - since) / HOLLOWED_EXPLORE.joy.growMs));
  return 1 - (1 - k) * (1 - k);
}

/**
 * Spark `i` of a burst `t` (0–1) in: its offset from the spot (world units)
 * and its size. They rise in an arc and fan out, each a little its own way.
 */
export function sparkAt(
  i: number,
  t: number,
  out: { dx: number; dy: number; dz: number; s: number; a: number },
): void {
  const { count, rise, spread, size } = HOLLOWED_EXPLORE.sparks;
  const a = (i / count) * Math.PI * 2 + 0.3;
  const r = 0.25 + (0.75 * ((i * 7) % 5)) / 5;
  out.a = a;
  out.dx = Math.cos(a) * r * t * spread;
  out.dz = Math.sin(a) * r * t * spread;
  out.dy = rise * (t * (2 - t)) * (0.6 + (0.4 * ((i * 3) % 4)) / 4) + 0.15;
  out.s = size * (0.6 + (0.4 * ((i * 5) % 3)) / 3) * Math.sin(Math.PI * Math.min(1, t * 1.2 + 0.1));
}
