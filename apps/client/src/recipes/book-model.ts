import {
  canMakeNow,
  GAME_DATA,
  hexDistance,
  itemEffects,
  sealedHint,
  shortfall,
  whereToFind,
  type Craft,
  type Hex,
  type ItemCounts,
  type PublicTile,
  type RecipeBookPage,
} from '@heartpatch/shared';
import { bagCrafts, itemName, type BagCraft } from '../inventory/bag-view.js';
import { itemChip, type ItemChip } from '../inventory/item-chips.js';
import { itemIcon } from '../inventory/item-icons.js';
import { buildingIcon, effectChips } from '../home/home-view.js';

// The recipe book's pages as the player reads them (owner decision
// 2026-10-05). Pure: the pages come from shared data, what's unlocked from
// the server (`GET /recipe-book`), the bag and seasons from the inventory.
// "Where to find it" only uses public data (terrains, home ring nodes, gather
// bonuses, recipes); never spawn tables or secrets (CLAUDE.md rule 6).

// Player-facing text (style guide §2, §6).
export const BOOK_TEXT = {
  homeRing: 'your home ring',
  gatherer: (land: string) => `a squishy gathering on ${land}`,
  bonus: (from: string) => `a surprise bonus when you gather ${from}`,
  madeBy: (what: string) => `or make ${what}`,
  nowhere: 'Nobody has found any yet. Keep exploring!',
  onlyAt: (season: string) => `Only at ${season}`,
  makes: (n: number, what: string) =>
    `Makes ${String(n)} ${what}${n > 1 && !what.endsWith('s') ? 's' : ''}`,
  build: 'Build it at home',
  stillNeed: (list: string) => `Still need ${list}`,
  comesBack: (season: string) => `Comes back at ${season}!`,
  sealed: 'Collect something new to open this page.',
  potBusy: 'Your pot is busy! Watch the timer up top.',
} as const;

const SEASON_NAMES = new Map(GAME_DATA.seasons.map((s) => [s.id, s.name]));
const TERRAIN_NAMES = new Map(GAME_DATA.terrains.map((t) => [t.id, t.name]));
const RECIPE_NAMES = new Map(GAME_DATA.recipes.map((r) => [r.id, r.name]));

export const seasonName = (id: string): string => SEASON_NAMES.get(id) ?? id;

/** "a", "a and b", "a, b and c". */
export function listWords(words: readonly string[], joiner = 'and'): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} ${joiner} ${words[words.length - 1] ?? ''}`;
}

const sentence = (text: string): string =>
  text === '' ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;

/**
 * "Forest tiles, Juniper's Gap and your home ring." — where an item turns
 * up, from public data only.
 */
export function whereText(resourceId: string): string {
  const facts = whereToFind(resourceId);
  const places = facts.terrains.map((t) => TERRAIN_NAMES.get(t) ?? t);
  if (facts.homeRing) places.push(BOOK_TEXT.homeRing);
  const parts: string[] = [];
  if (places.length > 0) parts.push(listWords(places));
  // Land that gives it to a gatherer, unless its spots are named already.
  const land = facts.gatheredOn.filter((t) => !facts.terrains.includes(t));
  if (land.length > 0) {
    const gatherer = BOOK_TEXT.gatherer(
      listWords(
        land.map((t) => TERRAIN_NAMES.get(t) ?? t),
        'or',
      ),
    );
    parts.push(parts.length > 0 ? `or ${gatherer}` : gatherer);
  }
  if (facts.bonusFrom.length > 0) {
    const bonus = BOOK_TEXT.bonus(listWords(facts.bonusFrom.map(itemName), 'or'));
    parts.push(parts.length > 0 ? `or ${bonus}` : bonus);
  }
  if (facts.madeBy.length > 0) {
    parts.push(
      BOOK_TEXT.madeBy(
        listWords(
          facts.madeBy.map((r) => RECIPE_NAMES.get(r) ?? r),
          'or',
        ),
      ),
    );
  }
  if (parts.length === 0) return BOOK_TEXT.nowhere;
  return sentence(parts.join(', '));
}

/** "30 sec", "1 min", "5 min". */
export function craftTime(seconds: number): string {
  return seconds < 60 ? `${String(seconds)} sec` : `${String(Math.round(seconds / 60))} min`;
}

export interface IngredientView {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  /** What the bag holds, capped at `need` for the "0/1" display. */
  readonly have: number;
  readonly need: number;
  readonly ok: boolean;
  readonly where: string;
  /** "Only at Halloween", or null. */
  readonly season: string | null;
}

export interface PageView {
  readonly key: string;
  readonly kind: RecipeBookPage['kind'];
  readonly id: string;
  readonly name: string;
  /** How it's made, in italics: a recipe's own line; empty on a building page (#241). */
  readonly flavour: string;
  /** The game's own icon for what it makes. */
  readonly icon: string;
  readonly section: 'make' | 'build';
  /** What it makes: an item id, or the building's id. */
  readonly output: string;
  /**
   * What it's for, shown under the name (#241): the item's or building's
   * description, plus chips worked out from its data. Null when the data has
   * neither.
   */
  readonly effect: PageEffect | null;
  /** The page's season's name ("Halloween"), or null. */
  readonly season: string | null;
  readonly sealed: boolean;
  /** A sealed page's public hint. */
  readonly hint: string;
  /** "Makes 1 Heart Charm · 1 min" / "Build it at home". */
  readonly meta: string;
  readonly ingredients: readonly IngredientView[];
  /** Open, in season, and the bag holds everything. */
  readonly canMake: boolean;
  /** Why it can't be made right now, or null. */
  readonly note: string | null;
  /** Opened since the player last looked (the "New page!" moment). */
  readonly isNew: boolean;
}

export interface PageEffect {
  readonly purpose: string;
  readonly chips: readonly ItemChip[];
}

const BUILDINGS = new Map(GAME_DATA.buildings.map((b) => [b.id, b]));
const RESOURCES = new Map(GAME_DATA.resources.map((r) => [r.id, r]));

/**
 * What a page's thing is for (#241): an item's description and chips, or a
 * building's description and its build-menu chips, word for word.
 */
export function pageEffect(page: RecipeBookPage): PageEffect | null {
  if (page.output.kind === 'building') {
    const building = BUILDINGS.get(page.output.building);
    if (!building) return null;
    return {
      purpose: building.description,
      chips: effectChips(building).map((text) => ({ text, battle: false })),
    };
  }
  const item = RESOURCES.get(page.output.resource);
  if (!item) return null;
  // The page's own ingredients already say what it's made from.
  const effects = itemEffects(item.id).filter((e) => e.kind !== 'made-from');
  return { purpose: item.description, chips: effects.map(itemChip) };
}

export interface BookContext {
  readonly unlocked: ReadonlySet<string>;
  readonly bag: ItemCounts;
  /** Seasons on today on this patch (`InventoryResponse.seasons`). */
  readonly seasons: ReadonlySet<string>;
  /** Open pages the player hasn't looked at yet. */
  readonly unseen: ReadonlySet<string>;
  /**
   * A craft is still cooking on this patch: the server makes one thing at a
   * time, so no recipe page can be made until it's done. A finished one goes
   * in the bag by itself (owner decision 2026-10-06) and frees the pot.
   */
  readonly potBusy: boolean;
}

export function pageView(page: RecipeBookPage, ctx: BookContext): PageView {
  const sealed = !ctx.unlocked.has(page.key);
  const season = page.season === null ? null : seasonName(page.season);
  const inSeason = page.season === null || ctx.seasons.has(page.season);
  const ingredients = Object.entries(page.ingredients).map(([id, need]): IngredientView => {
    const held = ctx.bag[id] ?? 0;
    const facts = whereToFind(id);
    return {
      id,
      name: itemName(id),
      icon: itemIcon(id),
      have: Math.min(held, need),
      need,
      ok: held >= need,
      where: whereText(id),
      season: facts.season === null ? null : BOOK_TEXT.onlyAt(seasonName(facts.season)),
    };
  });
  const missing = shortfall(ctx.bag, page.ingredients);
  const hasAll = canMakeNow(page, ctx.bag);
  const potBusy = ctx.potBusy && page.kind === 'recipe';
  const canMake = !sealed && inSeason && hasAll && !potBusy;
  let note: string | null = null;
  if (!sealed && !inSeason && season) note = BOOK_TEXT.comesBack(season);
  else if (!sealed && hasAll && potBusy) note = BOOK_TEXT.potBusy;
  else if (!sealed && !canMake) {
    note = BOOK_TEXT.stillNeed(
      listWords(Object.entries(missing).map(([id, n]) => `${String(n)} ${itemName(id)}`)),
    );
  }
  const meta =
    page.output.kind === 'item'
      ? `${BOOK_TEXT.makes(page.output.quantity, itemName(page.output.resource))} · ${craftTime(page.seconds ?? 0)}`
      : BOOK_TEXT.build;
  return {
    key: page.key,
    kind: page.kind,
    id: page.id,
    name: page.name,
    // A building's description is its purpose line, so it isn't said twice.
    flavour: page.kind === 'building' ? '' : page.description,
    icon: page.output.kind === 'item' ? itemIcon(page.output.resource) : buildingIcon(page.id),
    section: page.kind === 'recipe' ? 'make' : 'build',
    output: page.output.kind === 'item' ? page.output.resource : page.output.building,
    effect: pageEffect(page),
    season,
    sealed,
    hint: sealedHint(page.key) ?? BOOK_TEXT.sealed,
    meta,
    ingredients,
    canMake,
    note,
    isNew: !sealed && ctx.unseen.has(page.key),
  };
}

/**
 * What's cooking, for the strip across the top of the book: the craft still
 * going that's ready soonest. The server allows one per patch, but the bag's
 * list is what it says, so any number is drawn safely. A finished one isn't
 * shown: it's on its way into the bag. Null when nothing's cooking.
 */
export function cookingView(
  crafts: readonly Craft[],
  msUntil: (iso: string) => number,
): BagCraft | null {
  return bagCrafts(crafts).find((c) => msUntil(c.craft.readyAt) > 0) ?? null;
}

/**
 * The book's ribbon tabs, as data: each picks its pages by section, by what
 * they make (an item's `kind` in the resource table, or exact ids), or makes
 * one tab per season on the pages. A new part of the book (e.g. "Treats &
 * food") is a new row here, with no change to the book itself.
 */
export interface BookTabRule {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly section?: PageView['section'];
  /** Pages whose output item has one of these resource kinds. */
  readonly outputKinds?: readonly string[];
  /** Pages that make one of these ids. */
  readonly outputs?: readonly string[];
  /** One tab per season found on the pages (labelled with its name). */
  readonly perSeason?: boolean;
}

export const BOOK_TABS: readonly BookTabRule[] = [
  { id: 'make', label: 'Make', color: '#ff9ab8', section: 'make' },
  { id: 'build', label: 'Build', color: '#ffc94d', section: 'build' },
  { id: 'season', label: '', color: '#f2a93b', perSeason: true },
];

const RESOURCE_KINDS = new Map(GAME_DATA.resources.map((r) => [r.id, r.kind]));

export interface BookTab {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly matches: (page: PageView) => boolean;
}

/** The tabs this book shows: rules with at least one page, in rule order. */
export function bookTabs(
  pages: readonly PageView[],
  rules: readonly BookTabRule[] = BOOK_TABS,
): BookTab[] {
  return rules
    .flatMap((rule): BookTab[] => {
      if (rule.perSeason) {
        const seasons = [...new Set(pages.flatMap((p) => (p.season ? [p.season] : [])))];
        return seasons.map((s) => ({
          id: `${rule.id}:${s}`,
          label: s,
          color: rule.color,
          matches: (p) => p.season === s,
        }));
      }
      const matches = (p: PageView) =>
        (rule.section === undefined || p.section === rule.section) &&
        (rule.outputKinds === undefined ||
          rule.outputKinds.includes(RESOURCE_KINDS.get(p.output) ?? '')) &&
        (rule.outputs === undefined || rule.outputs.includes(p.output));
      return [{ id: rule.id, label: rule.label, color: rule.color, matches }];
    })
    .filter((tab) => pages.some(tab.matches));
}

/** Open pages whose name or an ingredient's name holds the words typed. Sealed pages stay secret. */
export function searchPages(pages: readonly PageView[], query: string): PageView[] {
  const q = query.trim().toLowerCase();
  const open = pages.filter((p) => !p.sealed);
  if (q === '') return open;
  return open.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.ingredients.some((i) => i.name.toLowerCase().includes(q)),
  );
}

/** The book's pages in order: the cover, contents, recipes, then a last page. */
export function bookOrder(pages: readonly PageView[], canMakeOnly: boolean): string[] {
  const shown = pages.filter((p) => !canMakeOnly || p.canMake).map((p) => p.key);
  return ['cover', 'contents', ...shown, 'end'];
}

/** What's on screen at once: one page on a phone, a two-page spread on a tablet (the cover alone). */
export function bookSpreads(order: readonly string[], twoUp: boolean): string[][] {
  if (!twoUp) return order.map((key) => [key]);
  const spreads: string[][] = [['cover']];
  const rest = order.slice(1);
  for (let i = 0; i < rest.length; i += 2) spreads.push(rest.slice(i, i + 2));
  return spreads;
}

/** The spread showing `key`, or 0 (the cover) when it isn't in the book now. */
export function spreadOf(spreads: readonly string[][], key: string): number {
  const at = spreads.findIndex((s) => s.includes(key));
  return at < 0 ? 0 : at;
}

/**
 * The player's own tile to find `resourceId` on ("Find on map"): one with
 * its node, else one whose gathers can bring it as a bonus; the nearest to
 * their home base first. Null when they have none.
 */
export function findSpot(resourceId: string, tiles: readonly PublicTile[], me: string): Hex | null {
  const mine = tiles.filter((t) => t.ownerUserId === me);
  const home = mine.find((t) => t.homeSlot !== null) ?? null;
  const near = (list: readonly PublicTile[]) =>
    [...list].sort((a, b) => (home ? hexDistance(a, home) - hexDistance(b, home) : 0))[0] ?? null;
  const direct = near(mine.filter((t) => t.nodeResource === resourceId));
  const spot =
    direct ??
    near(
      mine.filter(
        (t) =>
          t.nodeResource !== null && whereToFind(resourceId).bonusFrom.includes(t.nodeResource),
      ),
    );
  return spot ? { q: spot.q, r: spot.r } : null;
}

/**
 * Pages opened since the player last looked. The first look ever counts
 * everything already open as seen, so the starter pages aren't "new".
 */
export function freshPages(
  unlocked: readonly string[],
  seen: ReadonlySet<string> | null,
): { fresh: string[]; seen: Set<string> } {
  if (seen === null) return { fresh: [], seen: new Set(unlocked) };
  return { fresh: unlocked.filter((k) => !seen.has(k)), seen: new Set(seen) };
}
