import {
  CLOTHING_BY_ID,
  GAME_DATA,
  HEART_COIN_RULES,
  isTradableResource,
  linePrice,
  recipeBookPages,
  recipeKeep,
  SELL_RULES,
  unlockedPageKeys,
  type PublicUser,
  type RarityOf,
  type SellBasketRequest,
  type SellBasketResponse,
  type SellLine,
  type SellRequest,
  type SellRules,
  type SellView,
} from '@heartpatch/shared';
import { uuidv7 } from 'uuidv7';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import type { Clock } from '../../lib/time.js';
import { createHeartCoinsRepo } from '../heart-coins/repo.js';
import { creditHeartCoins, heartCoinsView } from '../heart-coins/service.js';
import { createInventoryRepo } from '../inventory/repo.js';
import { consumeItems, lockGrantRows } from '../inventory/service.js';
import { requirePostAccess } from '../journeys/service.js';
import { requireMember } from '../maps/members.js';
import { createPostSellRepo, SELL_REASON } from './repo.js';

/*
 * Selling extras to the trading post for Heart Coins (#601 PR 3; #320 part
 * 1, owner decisions 2026-10-22; baskets #655): a basket of lines, each
 * whole lots of a resource or crafted item from the bag or spare pieces of a
 * clothing item, at a post the player can use
 * (connected, or a journey's visit pass, #270). Prices are shared data
 * (`SELL_RULES`); the day's cap is Heart Coins' own (`dailyCaps.sell`, the
 * patch's day). Never sold: tools and anything else that stays with its
 * Keeper, `neverSold` items, account-bound and milestone clothing (not
 * `tradable`), the last free copy of a piece, a piece a patch-mate's open
 * offer names, and the most one open recipe uses of an item, so a craft
 * always stays possible. Server-authoritative and atomic (CLAUDE.md rules 1
 * and 7): one transaction takes every line's items and pieces and pays the
 * Heart Coins once, all against one sale id, or moves nothing: a basket
 * past the cap, or with any line refused, is refused whole before anything
 * moves. Works with trading off: nobody else is
 * involved. No undo (the client confirms first) and no game event: nobody
 * else sees a sale. Not on the Tutorial Glade, which pays no Heart Coins.
 */

const RECIPE_PAGES = recipeBookPages().filter((p) => p.kind === 'recipe');
const ITEMS = new Map(GAME_DATA.resources.map((r) => [r.id, r]));
const nameOf = (id: string) => ITEMS.get(id)?.name ?? CLOTHING_BY_ID.get(id)?.name ?? id;

// Kid-readable messages (style guide §6).
const MESSAGES = {
  notBought: "The post doesn't buy that one. It's a keeper!",
  keep: (keep: number, itemId: string) =>
    `Hang on to ${String(keep)} ${nameOf(itemId)} for your recipes! Try selling a little less.`,
  lastCopy: "That's your only one! The post only takes spares.",
  wanted: 'A patch-mate asked for that one in a trade! Answer their offer first.',
  capped: "You've sold enough for today! Come back tomorrow. 🌙",
  wontFit: "Some of that won't fit today. Let's look again!",
  dup: "Each thing goes in the basket once. Let's look again!",
} as const;

export interface PostSellService {
  /** What I could sell at a post on this patch, and today's selling against the cap. */
  view: (user: PublicUser, mapId: string) => Promise<SellView>;
  /** One basket sold at the post at (q, r): every line or none, against one sale id. */
  sellBasket: (
    user: PublicUser,
    mapId: string,
    request: SellBasketRequest,
  ) => Promise<SellBasketResponse>;
}

export interface PostSellServiceOptions {
  db: Executor;
  clock?: Clock;
  /** Tests pass other prices; the game uses `SELL_RULES`. */
  rules?: SellRules;
}

/** A piece's rarity if the post buys it (tradable clothing only). */
const rarityOf: RarityOf = (itemId) => {
  const piece = CLOTHING_BY_ID.get(itemId);
  return piece?.tradable ? piece.rarity : undefined;
};

/** A basket line priced from the data alone. */
type PricedLine = SellLine & { quantity: number; coins: number };

/** What a line sells and pays, from the data alone (`VALIDATION_FAILED` if the post won't buy it). */
function priceOf(rules: SellRules, line: SellLine): PricedLine {
  // `linePrice` checks the price list and `neverSold`; a tuned list never sells a tool.
  const item = line.kind === 'item' ? ITEMS.get(line.itemId) : undefined;
  const bought = line.kind === 'clothing' || (item !== undefined && isTradableResource(item));
  const price = bought ? linePrice(rules, rarityOf, line) : null;
  if (!price || price.coins < 1) throw new AppError('VALIDATION_FAILED', MESSAGES.notBought);
  return { ...line, ...price };
}

/** A legacy one-line sale (#655, accepted for one release) as a one-line basket. */
export function legacyBasket(request: SellRequest): SellBasketRequest {
  const { q, r, itemId } = request;
  const line: SellLine =
    request.kind === 'item'
      ? { kind: 'item', itemId, lots: request.lots }
      : { kind: 'clothing', itemId, count: 1 };
  return { kind: 'basket', q, r, lines: [line] };
}

export function createPostSellService(options: PostSellServiceOptions): PostSellService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const rules = options.rules ?? SELL_RULES;

  /** What the post leaves of each item for the account's open recipe pages. */
  async function keepsOf(exec: Executor, userId: string) {
    const open = unlockedPageKeys(
      RECIPE_PAGES,
      await createInventoryRepo(exec).everCollected(userId),
    );
    return (itemId: string) => recipeKeep(itemId, RECIPE_PAGES, open);
  }

  /** The Sell tab at `at`, read through `exec` (inside or outside a transaction). */
  async function viewOf(
    exec: Executor,
    map: { id: string; timeZone: string },
    userId: string,
    at: Date,
  ): Promise<SellView> {
    const [coins, bag, copies, keep] = await Promise.all([
      heartCoinsView(exec, map, userId, at),
      createInventoryRepo(exec).list({ mapId: map.id, userId }),
      createPostSellRepo(exec).freeCopies(userId),
      keepsOf(exec, userId),
    ]);
    const items = Object.keys(rules.items).flatMap((itemId) => {
      const have = bag[itemId] ?? 0;
      return have > 0 ? [{ itemId, have, keep: keep(itemId) }] : [];
    });
    const clothing = [...copies]
      .filter(([itemId, n]) => n >= 2 && CLOTHING_BY_ID.get(itemId)?.tradable === true)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([itemId, n]) => ({ itemId, copies: n }));
    return {
      balance: coins.balance,
      soldToday: coins.today.sell,
      cap: coins.caps.sell,
      resetsAt: coins.resetsAt,
      items,
      clothing,
    };
  }

  return {
    view: async (user, mapId) => {
      const { map } = await requireMember(db, user, mapId, ['multiplayer']);
      return viewOf(db, map, user.id, now());
    },

    sellBasket: async (user, mapId, request) => {
      if (
        new Set(request.lines.map((l) => `${l.kind}:${l.itemId}`)).size !== request.lines.length
      ) {
        throw new AppError('VALIDATION_FAILED', MESSAGES.dup);
      }
      const lines = request.lines.map((line) => priceOf(rules, line));
      const quantity = lines.reduce((n, l) => n + l.quantity, 0);
      const coins = lines.reduce((n, l) => n + l.coins, 0);
      // More than any day pays: it can never fit, so it never reaches the locks.
      if (coins > HEART_COIN_RULES.dailyCaps.sell) {
        throw new AppError('VALIDATION_FAILED', MESSAGES.wontFit);
      }
      await requireMember(db, user, mapId, ['multiplayer']);
      return createPostSellRepo(db).transaction(async (repo, tx) => {
        const at = now();
        const owner = { mapId, userId: user.id };
        const { map } = await requireMember(tx, user, mapId, ['multiplayer']);
        // 1. At a post I can use: connected, or a visit pass (#270).
        await requirePostAccess(tx, { mapId, userId: user.id, post: request, at });
        const saleId = uuidv7();

        // 2. Every piece of every clothing line, in one id-ordered lock across
        // the items (tech spec §7 step 10b), then which an open offer names:
        // read under the piece locks, which an offer's line takes too.
        const sold: string[] = [];
        const clothing = lines.filter((l) => l.kind === 'clothing');
        if (clothing.length > 0) {
          const free = (
            await repo.lockPieces(
              user.id,
              clothing.map((l) => l.itemId),
            )
          ).filter((p) => p.heldByOfferId === null);
          const wanted = await repo.inOpenOffers(free.map((p) => p.id));
          for (const line of clothing) {
            const mine = free.filter((p) => p.itemId === line.itemId);
            // At least one free copy stays, wanted or not.
            if (mine.length - line.quantity < 1) throw new AppError('CONFLICT', MESSAGES.lastCopy);
            // Never one an open offer names: its trade would go through
            // without it. The newest spares go; the first found or bought stays.
            const spare = mine.filter((p) => !wanted.has(p.id));
            if (spare.length < line.quantity) throw new AppError('CONFLICT', MESSAGES.wanted);
            sold.push(...spare.slice(-line.quantity).map((p) => p.id));
          }
        }

        // 3. Every bag row an item line takes, in one lock (step 11), then the
        // keep per item. Short is `consumeItems`' "You need 1 more…" below;
        // enough, but not with the keep left over, is this.
        const items: Record<string, number> = {};
        for (const l of lines) if (l.kind === 'item') items[l.itemId] = l.quantity;
        if (Object.keys(items).length > 0) {
          await lockGrantRows(tx, mapId, [{ userId: user.id, items }]);
          const bag = await createInventoryRepo(tx).list(owner);
          const keepOf = await keepsOf(tx, user.id);
          for (const [itemId, take] of Object.entries(items)) {
            const have = bag[itemId] ?? 0;
            const keep = keepOf(itemId);
            if (have >= take && have - take < keep) {
              throw new AppError('CONFLICT', MESSAGES.keep(keep, itemId));
            }
          }
        }

        // 4. My Heart Coin balance on the patch (step 12b, after the pieces and
        // the bag), then today's selling under it: two sales at once take
        // turns here, so the cap holds, and a basket past it moves nothing.
        await createHeartCoinsRepo(tx).lockBalance(mapId, user.id);
        const day = await heartCoinsView(tx, map, user.id, at);
        if (day.today.sell + coins > day.caps.sell) {
          const room = day.caps.sell - day.today.sell;
          throw new AppError('CONFLICT', room > 0 ? MESSAGES.wontFit : MESSAGES.capped);
        }

        // 5. Take it all, then pay once, both against the sale.
        await repo.deletePieces(sold);
        if (Object.keys(items).length > 0) {
          await consumeItems(tx, owner, items, SELL_REASON, saleId, at);
        }
        const paid = await creditHeartCoins(tx, {
          source: 'sell',
          refId: saleId,
          mapId,
          userId: user.id,
          amount: coins,
          at,
        });
        // Room was checked under the same lock, and the sale id is new.
        if (paid.credited !== coins) {
          throw new Error(`post-sell: paid ${String(paid.credited)} of ${String(coins)}`);
        }
        return {
          sold: {
            lines: lines.map((l) => ({
              kind: l.kind,
              itemId: l.itemId,
              quantity: l.quantity,
              coins: l.coins,
            })),
            quantity,
            coins,
          },
          sell: await viewOf(tx, map, user.id, at),
        };
      });
    },
  };
}
