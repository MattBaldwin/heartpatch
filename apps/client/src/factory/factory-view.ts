import {
  affordableRuns,
  FACTORY_RULES,
  factoryDone,
  factoryNextAtMs,
  GAME_DATA,
  inSeason,
  needMoreText,
  recipePageKey,
  shortfall,
  stopRuns,
  timesItems,
  type FactoryBatch,
  type FactoryView,
  type ItemCounts,
  type Landed,
  type Recipe,
} from '@heartpatch/shared';
import { itemName } from '../inventory/bag-view.js';
import { formatTimeLeft, formatWait } from '../inventory/game-clock.js';
import { itemIcon } from '../inventory/item-icons.js';

// What the Crafting Factory says and offers (#294, owner-approved mockup of
// 2026-10-08; copy follows docs/STYLE_GUIDE.md). Pure, so every case is
// unit-tested; the server caps each batch and works out the timers again
// (CLAUDE.md rule 1). Counts and countdowns run on the game clock.

const RECIPES = new Map(GAME_DATA.recipes.map((r) => [r.id, r]));
const SEASON_NAMES = new Map(GAME_DATA.seasons.map((s) => [s.id, s.name]));
const FACTORY = GAME_DATA.buildings.find((b) => b.kind === 'factory');

// Player-facing text (style guide §6, §9).
export const FACTORY_TEXT = {
  name: 'Crafting Factory',
  about: (slots: number) =>
    `Makes lots of things at once, even while you're away! Room for ${String(slots)} batches.`,
  startBatch: '＋ Start a batch',
  stop: 'Stop',
  locked: (level: number, slots: number) =>
    `🔒 Level ${String(level)} makes room for ${String(slots)} batches`,
  nextIn: (next: string, all: string) => `Next one in ${next} · all done in ${all}`,
  each: (what: string) => `${what} each`,
  allDone: 'All done! Into your bag they go ✨',
  pickTitle: 'What shall we make?',
  howMany: 'How many?',
  fewer: 'One fewer',
  more: 'One more',
  max: (n: number) => `Max ${String(n)}`,
  canMake: (n: number) => `You can make ${String(n)}`,
  uses: (cost: string, time: string) => `Uses ${cost} now · all done in ${time}`,
  start: 'Start batch',
  back: 'Back',
  noRecipes: 'Nothing to make yet. Gather a little more and come back!',
  started: (n: number, icon: string) => `Off it goes! ${String(n)} ${icon} on the way.`,
  stopTitle: 'Stop this batch?',
  stopKeep: (n: number, name: string) =>
    n === 0 ? `Nothing's made yet.` : `You keep the ${String(n)} ${name} already made.`,
  stopBack: (n: number, what: string) =>
    `${String(n)} ${n === 1 ? "isn't" : "aren't"} finished yet (the one being made too). You get back ${what}.`,
  stopYes: 'Stop batch',
  keepGoing: 'Keep going',
  stopped: (back: string) => (back ? `Stopped. You got back ${back}.` : 'Stopped.'),
  queueIn: '🏭 Queue in Factory',
  queue: '🏭 Queue',
  full: (left: string) => `Factory's full! One finishes in ${left}.`,
  bothHint: 'Make it: one now in your pot. Factory: lots at once!',
  strip: (going: number, slots: number) => `${String(going)} of ${String(slots)} going`,
  stripTitle: '🏭 Factory',
  welcomeTitle: 'Welcome back!',
  welcomeLine: 'Your Factory was busy while you were away.',
  stillGoing: (name: string, done: number, total: number) =>
    `${name}: ${String(done)} of ${String(total)} done. Still going!`,
  ok: 'Okay!',
  seeFactory: 'See Factory',
  sproutTip: "Ooh, a Factory! It makes lots of things while you're away.",
} as const;

/** A recipe's name, or what it makes when the recipe is gone from the data. */
export function recipeName(recipeId: string): string {
  return RECIPES.get(recipeId)?.name ?? 'Something';
}

/** The picture for what a recipe makes. */
export function recipeIcon(recipeId: string): string {
  const recipe = RECIPES.get(recipeId);
  return recipe ? itemIcon(recipe.output.resource) : '✨';
}

/** "2 🪵 · 1 🍪" for one run's cost. */
export function costIcons(cost: ItemCounts): string {
  return Object.entries(cost)
    .map(([id, n]) => `${String(n)} ${itemIcon(id)}`)
    .join(' · ');
}

const timingOf = (b: FactoryBatch) => ({
  total: b.total,
  itemSeconds: b.itemSeconds,
  startedAtMs: Date.parse(b.startedAt),
});

/** One batch going, as the queue panel and the strips show it. */
export interface BatchRow {
  readonly batch: FactoryBatch;
  readonly name: string;
  readonly icon: string;
  /** Made by now (the bag gets them on the next settle). */
  readonly done: number;
  readonly total: number;
  /** 0–100, for the bar. */
  readonly percent: number;
  /** Every one is made. */
  readonly finished: boolean;
  /** When the next one finishes (ISO), or null once all are made. */
  readonly nextAt: string | null;
  /** "+3 🍪 each" when one run makes more than one thing, else ''. */
  readonly each: string;
}

/** Every batch going, oldest first, worked out at `nowMs` on the game clock. */
export function batchRows(view: FactoryView, nowMs: number): BatchRow[] {
  return view.batches.map((batch) => {
    const t = timingOf(batch);
    const done = Math.max(batch.done, factoryDone(t, nowMs));
    const next = factoryNextAtMs(t, nowMs);
    const output = RECIPES.get(batch.recipeId)?.output;
    return {
      batch,
      name: recipeName(batch.recipeId),
      icon: recipeIcon(batch.recipeId),
      done,
      total: batch.total,
      percent: Math.round((100 * done) / batch.total),
      finished: done >= batch.total,
      nextAt: next === null ? null : new Date(next).toISOString(),
      each:
        output && output.quantity > 1
          ? FACTORY_TEXT.each(`+${String(output.quantity)} ${itemIcon(output.resource)}`)
          : '',
    };
  });
}

/** Batches still making something (a finished one frees its spot on the next settle). */
export const goingCount = (view: FactoryView, nowMs: number): number =>
  batchRows(view, nowMs).filter((r) => !r.finished).length;

/** A free batch spot right now? */
export const hasRoom = (view: FactoryView, nowMs: number): boolean =>
  goingCount(view, nowMs) < view.slots;

/** When the soonest batch spot frees up (its last one finishes), for "Factory's full!". */
export function soonestFreeMs(view: FactoryView, nowMs: number): number {
  const left = view.batches.map((b) => Date.parse(b.doneAt) - nowMs).filter((ms) => ms > 0);
  return left.length === 0 ? 0 : Math.min(...left);
}

/** The next level's extra batch spot, for the locked row ("🔒 Level 3 …"), or null at the top. */
export function nextLevelRoom(view: FactoryView): { level: number; slots: number } | null {
  if (FACTORY?.kind !== 'factory') return null;
  const next = FACTORY.levels[view.level];
  return next ? { level: view.level + 1, slots: next.queues } : null;
}

/** "Next one in 0:42 · all done in 6m" (empty once it's all made). */
export function batchTimeLine(row: BatchRow, nowMs: number): string {
  if (row.finished || row.nextAt === null) return FACTORY_TEXT.allDone;
  const next = formatTimeLeft(Date.parse(row.nextAt) - nowMs);
  const all = formatWait(Date.parse(row.batch.doneAt) - nowMs);
  return FACTORY_TEXT.nextIn(next, all);
}

/** One recipe on the "What shall we make?" list. */
export interface PickRow {
  readonly recipe: Recipe;
  readonly icon: string;
  /** "2 🪵 · 1 🍪 · 1 min each". */
  readonly line: string;
  /** How many the bag can pay for (capped at `FACTORY_RULES.maxBatch`). */
  readonly canMake: number;
  /** Why not, when it can't be picked: "Only around Thanksgiving.", "You need …". */
  readonly note: string | null;
}

/** "1 min", "30 s", "2h": a craft's length, short. */
export function lengthText(seconds: number): string {
  if (seconds < 60) return `${String(seconds)} s`;
  if (seconds < 3600) return `${String(Math.round(seconds / 60))} min`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m === 0 ? `${String(h)}h` : `${String(h)}h ${String(m)}m`;
}

/**
 * The recipes a batch can be (#294): only open recipe-book pages (owner
 * decision 2026-10-08), in data order. Out-of-season ones show, switched
 * off, with when they're back; ones the bag can't pay for say what's missing.
 */
export function pickRows(
  items: ItemCounts,
  seasons: readonly string[],
  isOpen: (pageKey: string) => boolean,
): PickRow[] {
  const on = new Set(seasons);
  return GAME_DATA.recipes
    .filter((recipe) => isOpen(recipePageKey(recipe.id)))
    .map((recipe) => {
      const output =
        recipe.output.quantity > 1
          ? ` → ${String(recipe.output.quantity)} ${itemIcon(recipe.output.resource)}`
          : '';
      const line = `${costIcons(recipe.inputs)}${output} · ${lengthText(recipe.craftSeconds)} each`;
      const canMake = affordableRuns(items, recipe.inputs, FACTORY_RULES.maxBatch);
      let note: string | null = null;
      if (!inSeason(recipe, on)) {
        note = `Only around ${SEASON_NAMES.get(recipe.season ?? '') ?? 'its season'}.`;
      } else if (canMake === 0) {
        note = needMoreText(shortfall(items, recipe.inputs), GAME_DATA.resources);
      }
      return { recipe, icon: itemIcon(recipe.output.resource), line, canMake, note };
    });
}

/** "Uses 20 🪵 · 10 🍪 now · all done in 10 min" for a batch of `count`. */
export function batchPlanLine(recipe: Recipe, count: number): string {
  const cost = Object.entries(timesItems(recipe.inputs, count))
    .map(([id, n]) => `${String(n)} ${itemIcon(id)}`)
    .join(' · ');
  return FACTORY_TEXT.uses(cost, lengthText(recipe.craftSeconds * count));
}

/** What stopping a batch now would do, to say before the kid says yes. */
export interface StopPreview {
  readonly kept: number;
  readonly refund: ItemCounts;
  readonly lines: readonly string[];
}

export function stopPreview(batch: FactoryBatch, nowMs: number): StopPreview {
  const { kept, refunded } = stopRuns(timingOf(batch), nowMs);
  const inputs = RECIPES.get(batch.recipeId)?.inputs ?? {};
  const refund = timesItems(inputs, refunded);
  const name = recipeName(batch.recipeId);
  const back = Object.entries(refund)
    .map(([id, n]) => `${String(n)} ${itemIcon(id)} ${itemName(id)}`)
    .join(', ');
  return {
    kept,
    refund,
    lines: [
      `${recipeIcon(batch.recipeId)} ${FACTORY_TEXT.stopKeep(kept, name)}`,
      ...(refunded > 0 ? [`↩️ ${FACTORY_TEXT.stopBack(refunded, back)}`] : []),
    ],
  };
}

/** The Factory's part of what a settle landed. */
export const factoryLanded = (landed: readonly Landed[]): Landed[] =>
  landed.filter((l) => l.kind === 'factory');

/**
 * Show the welcome-back card (owner decision 2026-10-08): the first settle
 * after `FACTORY_RULES.welcomeBackMinutes` or more away that lands Factory
 * things. Shorter trips get the usual pop-up.
 */
export function showsWelcomeBack(landed: readonly Landed[], awayMs: number): boolean {
  return factoryLanded(landed).length > 0 && awayMs >= FACTORY_RULES.welcomeBackMinutes * 60_000;
}

/** What the welcome-back card lists: everything the Factory landed, added up, as chips. */
export function welcomeChips(landed: readonly Landed[]): string[] {
  const total: ItemCounts = {};
  for (const { items } of factoryLanded(landed)) {
    for (const [id, n] of Object.entries(items)) total[id] = (total[id] ?? 0) + n;
  }
  return Object.entries(total).map(([id, n]) => `${itemIcon(id)} +${String(n)} ${itemName(id)}`);
}
