import {
  CLOTHING_BY_ID,
  clothingSalePrice,
  GAME_DATA,
  isTradableResource,
  itemSalePrice,
  itemSaleQuantity,
  recipeBookPages,
  recipeKeep,
  SELL_RULES,
  unlockedPageKeys,
  type PublicUser,
  type SellRequest,
  type SellResponse,
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
 * 1, owner decisions 2026-10-22): whole lots of a resource or crafted item
 * from the bag, or one spare piece of clothing, at a post the player can use
 * (connected, or a journey's visit pass, #270). Prices are shared data
 * (`SELL_RULES`); the day's cap is Heart Coins' own (`dailyCaps.sell`, the
 * patch's day). Never sold: tools and anything else that stays with its
 * Keeper, `neverSold` items, account-bound and milestone clothing (not
 * `tradable`), the last free copy of a piece, a piece a patch-mate's open
 * offer names, and the most one open recipe uses of an item, so a craft
 * always stays possible. Server-authoritative and atomic (CLAUDE.md rules 1
 * and 7): one transaction takes the items (or deletes the piece) and pays
 * the Heart Coins, both against the sale id, and a sale past the cap is
 * refused before anything moves. Works with trading off: nobody else is
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
} as const;

export interface PostSellService {
  /** What I could sell at a post on this patch, and today's selling against the cap. */
  view: (user: PublicUser, mapId: string) => Promise<SellView>;
  /** One sale at the post at (q, r). */
  sell: (user: PublicUser, mapId: string, request: SellRequest) => Promise<SellResponse>;
}

export interface PostSellServiceOptions {
  db: Executor;
  clock?: Clock;
  /** Tests pass other prices; the game uses `SELL_RULES`. */
  rules?: SellRules;
}

/** What a request sells and pays, from the data alone (`VALIDATION_FAILED` if the post won't buy it). */
function priceOf(rules: SellRules, request: SellRequest): { quantity: number; coins: number } {
  if (request.kind === 'item') {
    const item = ITEMS.get(request.itemId);
    const quantity = itemSaleQuantity(rules, request.itemId, request.lots);
    const coins = itemSalePrice(rules, request.itemId, request.lots);
    // The data check refuses these too; a tuned list never sells a tool.
    const bought = item && isTradableResource(item) && !rules.neverSold.includes(request.itemId);
    if (!bought || quantity === null || coins === null) {
      throw new AppError('VALIDATION_FAILED', MESSAGES.notBought);
    }
    return { quantity, coins };
  }
  const piece = CLOTHING_BY_ID.get(request.itemId);
  if (!piece?.tradable) throw new AppError('VALIDATION_FAILED', MESSAGES.notBought);
  return { quantity: 1, coins: clothingSalePrice(rules, piece.rarity) };
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

    sell: async (user, mapId, request) => {
      const { quantity, coins } = priceOf(rules, request);
      await requireMember(db, user, mapId, ['multiplayer']);
      return createPostSellRepo(db).transaction(async (repo, tx) => {
        const at = now();
        const owner = { mapId, userId: user.id };
        const { map } = await requireMember(tx, user, mapId, ['multiplayer']);
        // 1. At a post I can use: connected, or a visit pass (#270).
        await requirePostAccess(tx, { mapId, userId: user.id, post: request, at });
        const saleId = uuidv7();
        const { itemId } = request;

        // 2. What's sold, under its own locks (tech spec §7): the bag row
        // (step 11), or every piece of the item (step 10b, id order).
        let piece: string | null = null;
        if (request.kind === 'item') {
          await lockGrantRows(tx, mapId, [{ userId: user.id, items: { [itemId]: quantity } }]);
          const have = (await createInventoryRepo(tx).list(owner))[itemId] ?? 0;
          const keep = (await keepsOf(tx, user.id))(itemId);
          // Short is `consumeItems`' "You need 1 more…" below; enough, but
          // not with the keep left over, is this.
          if (have >= quantity && have - quantity < keep) {
            throw new AppError('CONFLICT', MESSAGES.keep(keep, itemId));
          }
        } else {
          const free = (await repo.lockPieces(user.id, itemId)).filter(
            (p) => p.heldByOfferId === null,
          );
          if (free.length < 2) throw new AppError('CONFLICT', MESSAGES.lastCopy);
          // Never one an open offer names: its trade would go through without
          // it. Read under the piece locks, which an offer's line takes too.
          const wanted = await repo.inOpenOffers(free.map((p) => p.id));
          // The newest spare goes; the first one found or bought stays.
          piece = free.filter((p) => !wanted.has(p.id)).at(-1)?.id ?? null;
          if (!piece) throw new AppError('CONFLICT', MESSAGES.wanted);
        }

        // 3. My Heart Coin balance on the patch (step 12b, after the bag and
        // the pieces), then today's selling under it: two sales at once take
        // turns here, so the cap holds, and a sale past it moves nothing.
        await createHeartCoinsRepo(tx).lockBalance(mapId, user.id);
        const before = await heartCoinsView(tx, map, user.id, at);
        if (before.today.sell + coins > before.caps.sell) {
          throw new AppError('CONFLICT', MESSAGES.capped);
        }

        // 4. Take it, then pay, both against the sale.
        if (piece) await repo.deletePiece(piece);
        else await consumeItems(tx, owner, { [itemId]: quantity }, SELL_REASON, saleId, at);
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
          sold: { kind: request.kind, itemId, quantity, coins },
          sell: await viewOf(tx, map, user.id, at),
        };
      });
    },
  };
}
