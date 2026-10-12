import type { Landed } from '@heartpatch/shared';
import { itemName, landedLine, landedText, landedTotals, trainedText } from './bag-view.js';
import { itemIcon } from './item-icons.js';
import { toolOf } from './tool-uses.js';

// What just landed in the bag, as tidy chips (#419, owner pick 2026-10-12:
// "Fly into a receipt"): a slim banner under the patch's name with one chip
// per thing, and the full list in a card behind "N more". Pure, so it's
// unit-tested without the DOM; away-summary-view.ts draws it.

/** One chip in the banner and one row in the card. */
export type SummaryEntry =
  | {
      readonly kind: 'item';
      readonly id: string;
      /** How many: items, or whole tools for an explore tool (#199). */
      readonly amount: number;
      readonly icon: string;
      readonly name: string;
      /** The chip's short words: "+3". */
      readonly chip: string;
      /** The whole thing in words: "🪨 +3 Stone" (a tool: "⛏️ A new Shovel"). */
      readonly line: string;
    }
  | {
      readonly kind: 'trained';
      /** Each squishy the Training Grounds trained, with its XP. */
      readonly squishies: readonly { readonly name: string; readonly xp: number }[];
      /** All their XP added up, for the one chip. */
      readonly xp: number;
    };

// Player-facing text (style guide §6).
export const AWAY_TEXT = {
  /** The banner's tag after a while away, and otherwise. */
  tagAway: 'Welcome back!',
  tagNow: 'In your Bag!',
  more: (n: number) => `${String(n)} more`,
  cardTagAway: 'While you were away…',
  cardTagNow: 'Into your Bag!',
  cardTitle: 'Your patch kept busy!',
  training: 'Training Grounds',
  xp: (n: number) => `+${String(n)} XP`,
  nice: 'Nice!',
  /**
   * The Home tab's peek line until the Bag is opened. One line however much
   * landed, so a gatherer's next landing doesn't peek out again.
   */
  bagNews: 'New things in your Bag!',
} as const;

/**
 * The chips for what landed: the Training Grounds first (one chip for every
 * squishy trained), then the items in the bag's order, added up.
 */
export function summaryEntries(
  landed: readonly Pick<Landed, 'items'>[],
  trained: readonly { readonly name: string; readonly xp: number }[],
): SummaryEntry[] {
  const entries: SummaryEntry[] = [];
  if (trained.length > 0) {
    entries.push({
      kind: 'trained',
      squishies: trained.map(({ name, xp }) => ({ name, xp })),
      xp: trained.reduce((sum, t) => sum + t.xp, 0),
    });
  }
  for (const [id, count] of landedTotals(landed)) {
    // A tool counts uses (#199): its chip says how many tools, as its line does.
    const tool = toolOf(id);
    const tools = tool && count % tool.uses === 0 ? count / tool.uses : null;
    const amount = tools ?? count;
    entries.push({
      kind: 'item',
      id,
      amount,
      icon: itemIcon(id),
      name: itemName(id),
      chip: `+${String(amount)}`,
      line: landedLine(id, count),
    });
  }
  return entries;
}

/** The whole summary in one sentence, for screen readers (and the e2e). */
export function summarySentence(
  landed: readonly Pick<Landed, 'items'>[],
  trained: readonly { readonly name: string; readonly xp: number }[],
): string {
  return [landedText(landed), trainedText(trained)].filter((t) => t !== '').join(' ');
}

/** How many things landed, for the Home tab's line (a tool counts as one thing per tool). */
export function summaryCount(entries: readonly SummaryEntry[]): number {
  return entries.reduce((sum, e) => sum + (e.kind === 'item' ? e.amount : 0), 0);
}

/** A point on screen, in CSS pixels. */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** How far a chip's path bows to the side, as a share of the trip (TUNE: a gentle curve). */
const FLIGHT_BOW = 0.18;

/**
 * Where a flying chip is along its trip (PR 2 of #419): a gentle curve from
 * where it landed to its place in the banner, `steps + 1` points from start to
 * end. It bows a little to the side but always heads for its target: every
 * point is closer to it than the one before, so no chip swings off the other way.
 */
export function flightPath(from: ScreenPoint, to: ScreenPoint, steps: number): ScreenPoint[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // A little to one side, like a toss; chips heading left mirror chips heading right.
  const side = dx >= 0 ? 1 : -1;
  const control = {
    x: from.x + dx / 2 + side * -dy * FLIGHT_BOW,
    y: from.y + dy / 2 + side * dx * FLIGHT_BOW,
  };
  const points: ScreenPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    points.push({
      x: a * from.x + b * control.x + c * to.x,
      y: a * from.y + b * control.y + c * to.y,
    });
  }
  return points;
}

/** A chip's size on screen, in CSS pixels. */
export interface ChipSize {
  readonly width: number;
  readonly height: number;
}

/** Where flying chips may pop up: on screen, and below the banner they fly to. */
export interface PopArea {
  readonly top: number;
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * Where each flying chip pops up (#419): its own spot, unless that would
 * cover a chip already placed (two from one tile, or neighbouring tiles on a
 * small phone, where tiles are narrower than chips). Then it takes the
 * nearest free spot around it (beside, above or below, a chip apart), kept
 * inside `area` so it stays on screen and under the banner. If nowhere near
 * is free it keeps its own spot: a brief overlap beats a chip off screen.
 */
export function spreadStarts(
  spots: readonly ScreenPoint[],
  sizes: readonly ChipSize[],
  gap: number,
  area: PopArea,
): ScreenPoint[] {
  const placed: { at: ScreenPoint; size: ChipSize }[] = [];
  const covers = (at: ScreenPoint, size: ChipSize) =>
    placed.some(
      (p) =>
        Math.abs(p.at.x - at.x) < (p.size.width + size.width) / 2 + gap &&
        Math.abs(p.at.y - at.y) < (p.size.height + size.height) / 2 + gap,
    );
  const inside = (at: ScreenPoint, size: ChipSize) =>
    at.x - size.width / 2 >= area.left &&
    at.x + size.width / 2 <= area.right &&
    at.y - size.height / 2 >= area.top &&
    at.y + size.height / 2 <= area.bottom;
  for (const [i, spot] of spots.entries()) {
    const size = sizes[i] ?? { width: 0, height: 0 };
    const stepX = size.width + gap;
    const stepY = size.height + gap;
    // Nearest first: up to three chips away each way.
    const candidates: ScreenPoint[] = [];
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        candidates.push({ x: spot.x + dx * stepX, y: spot.y + dy * stepY });
      }
    }
    candidates.sort(
      (a, b) => Math.hypot(a.x - spot.x, a.y - spot.y) - Math.hypot(b.x - spot.x, b.y - spot.y),
    );
    const at = candidates.find((c) => inside(c, size) && !covers(c, size)) ?? spot;
    placed.push({ at, size });
  }
  return placed.map((p) => p.at);
}

/** How far apart chips leave (#419): `each` apart, but all within `total` however many fly. */
export function staggerMs(chips: number, each: number, total: number): number {
  return chips <= 1 ? 0 : Math.min(each, total / (chips - 1));
}

/** Whether a point is on a screen `width` × `height` (a tile's middle, before it gives a chip). */
export function onScreen(at: ScreenPoint, width: number, height: number): boolean {
  return at.x >= 0 && at.x <= width && at.y >= 0 && at.y <= height;
}
