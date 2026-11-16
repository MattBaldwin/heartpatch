import {
  addDays,
  fuelSpace,
  HOME_BASE_RULES,
  POST_SHOP,
  POST_SHOP_BY_ID,
  type BuyRequest,
  type BuyResponse,
  type Hex,
  type PostShop,
  type PostShopItem,
  type PostShopItemId,
  type PublicUser,
  type ShopGot,
  type ShopItemView,
  type ShopView,
} from '@heartpatch/shared';
import { uuidv7 } from 'uuidv7';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import {
  instantOfLocalDate,
  localDate,
  mapLocalTime,
  nextLocalMidnight,
  type Clock,
} from '../../lib/time.js';
import { createBuildingsRepo } from '../buildings/repo.js';
import { fuelFires, lockMyFires } from '../buildings/service.js';
import { createFencesRepo } from '../fences/repo.js';
import { lockMyWornFences, mendFence } from '../fences/service.js';
import { createHeartCoinsRepo } from '../heart-coins/repo.js';
import { spendHeartCoins } from '../heart-coins/service.js';
import { grantItems, lockGrantRows } from '../inventory/service.js';
import { requirePostAccess } from '../journeys/service.js';
import { requireMember } from '../maps/members.js';
import { createPostShopRepo, markLureUsed, SHOP_REASON, type PurchaseRow } from './repo.js';

/*
 * The trading post's Shop (#729; owner decisions 2026-11-15): a Rare Lure,
 * a Heart Charm pack, a Potion crate, Night supplies and a Fence patch kit
 * (729b), bought with Heart Coins at a post
 * the player can use (connected, or a journey's visit pass, as Sell). Prices
 * and caps are shared data (`POST_SHOP`); caps are per player per patch on
 * the patch's own day, and "a week" is the last 7 patch days including
 * today. Server-authoritative and atomic (CLAUDE.md rules 1 and 7): one
 * transaction checks the cap under the Heart Coin balance lock, takes the
 * coins against the purchase id, writes the purchase row and gives what was
 * bought, or does none of it. Night supplies fuels my fires and the Fence
 * patch kit mends my fences through the buildings' and fences' own code,
 * with no item cost; one that would change nothing is refused before any
 * coin moves, and one that changes at least one fire or fence is charged
 * in full (729b). Works with trading off (coins never trade).
 * Not on the Tutorial Glade, which has no posts and pays no Heart Coins.
 */

// Kid-readable messages (style guide §6).
const MESSAGES = {
  cappedToday: "That's today's! Come back tomorrow for another. 🌙",
  cappedWeek: (days: number) =>
    days <= 1
      ? "That's two lures this week! Your next one is ready tomorrow. ✨"
      : `That's two lures this week! Your next one is ready in ${String(days)} days. ✨`,
  suppliesWeek: (days: number) =>
    days <= 1
      ? "That's this week's supplies! More tomorrow. 🔥"
      : `That's this week's supplies! More in ${String(days)} days. 🔥`,
  holdingOne: 'You already have a lure waiting! Go find a squishy first. ✨',
  noFires: 'No fires to stock yet 🔥',
  firesFull: 'Your fires are all stocked up! 🔥',
  noFences: 'No fences to fix yet 🪵',
  fencesFine: 'Your fences are all fine! 🪵',
  tryAgain: 'Hmm, try that again!',
} as const;

/** The patch-day count of a week cap: today and the 6 days before it. */
const WEEK_DAYS = 7;

export interface PostShopService {
  /** The Shop at the post at (q, r): prices, what's left under each cap, and my balance. */
  view: (user: PublicUser, mapId: string, post: Hex) => Promise<ShopView>;
  /** Buys one item at the post at (q, r). */
  buy: (user: PublicUser, mapId: string, request: BuyRequest) => Promise<BuyResponse>;
}

export interface PostShopServiceOptions {
  db: Executor;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
  /** Tests pass other prices and caps; the game uses `POST_SHOP`. */
  shop?: PostShop;
}

/** One item's public card, plus how many patch days until a week cap opens. */
interface ItemCard {
  view: ShopItemView;
  capDays: number;
}

/** One item's cap and hold against my recent purchases, at patch day `today`. */
function itemView(
  item: PostShopItem,
  rows: readonly PurchaseRow[],
  map: { timeZone: string },
  at: Date,
  today: string,
): ItemCard {
  const since = item.cap.per === 'day' ? today : addDays(today, -(WEEK_DAYS - 1));
  const counted = rows.filter((r) => r.itemId === item.id && r.day >= since);
  const left = Math.max(0, item.cap.count - counted.length);
  const held = item.held !== undefined && rows.some((r) => r.itemId === item.id && !r.consumedAt);
  // When one more fits: tomorrow for a day cap; for a week cap, the morning
  // the oldest counted purchase is 7 patch days old.
  const oldest = counted[0];
  const opensOn =
    left > 0 || item.cap.per === 'day' || !oldest ? null : addDays(oldest.day, WEEK_DAYS);
  const nextAt =
    left > 0
      ? null
      : opensOn
        ? instantOfLocalDate({ date: opensOn, minute: 0 }, map.timeZone)
        : nextLocalMidnight(at, map.timeZone);
  return {
    view: {
      id: item.id,
      price: item.price,
      left,
      nextAt: nextAt?.toISOString() ?? null,
      status: held ? 'held' : left > 0 ? 'buy' : 'capped',
    },
    capDays: opensOn ? daysFrom(today, opensOn) : 1,
  };
}

/** Whole patch days from `from` to `to`. */
function daysFrom(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function createPostShopService(options: PostShopServiceOptions): PostShopService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const shop = options.shop ?? POST_SHOP;
  const itemOf = (id: PostShopItemId) =>
    options.shop ? shop.find((i) => i.id === id) : POST_SHOP_BY_ID.get(id);

  /** The Shop at `at`, read through `exec` (inside or outside a transaction). */
  async function viewOf(
    exec: Executor,
    map: { id: string; timeZone: string },
    userId: string,
    at: Date,
  ): Promise<{ view: ShopView; cards: ItemCard[] }> {
    const today = localDate(at, map.timeZone);
    const [rows, balance] = await Promise.all([
      createPostShopRepo(exec).recent(map.id, userId, addDays(today, -(WEEK_DAYS - 1))),
      createHeartCoinsRepo(exec).balance(map.id, userId),
    ]);
    const cards = shop.map((item) => itemView(item, rows, map, at, today));
    return {
      view: {
        items: cards.map((c) => c.view),
        lureHeld: rows.some((r) => r.itemId === 'rare-lure' && !r.consumedAt),
        balance,
      },
      cards,
    };
  }

  return {
    view: async (user, mapId, post) => {
      const { map } = await requireMember(db, user, mapId, ['multiplayer']);
      const at = now();
      await requirePostAccess(db, { mapId, userId: user.id, post, at });
      return (await viewOf(db, map, user.id, at)).view;
    },

    buy: async (user, mapId, request) => {
      const item = itemOf(request.itemId);
      if (!item) throw new AppError('NOT_FOUND');
      await requireMember(db, user, mapId, ['multiplayer']);
      const result = await createPostShopRepo(db).transaction(async (repo, tx) => {
        const at = now();
        const owner = { mapId, userId: user.id };
        const { map } = await requireMember(tx, user, mapId, ['multiplayer']);
        // 1. At a post I can use: connected, or a visit pass (#270).
        await requirePostAccess(tx, { mapId, userId: user.id, post: request, at });
        const purchaseId = uuidv7();
        const local = mapLocalTime(at, map.timeZone);

        // 2. What a supply works on, before the bag and the balance (tech
        // spec §7): my fires (step 8), or my fences' tiles (6) then the
        // segments (8). Night supplies adds what fits in each fire.
        const buildings = createBuildingsRepo(tx);
        const fences = createFencesRepo(tx);
        const fuel =
          item.effect.kind === 'fuel-all'
            ? await nightSupplies(buildings, owner, item.effect.nights, local)
            : null;
        const mend =
          item.effect.kind === 'repair-fences'
            ? await lockMyWornFences(fences, mapId, user.id)
            : null;

        // 2b. The bag rows a pack fills (tech spec §7 step 11), before the balance.
        const items = item.effect.kind === 'items' ? item.effect.items : null;
        if (items) await lockGrantRows(tx, mapId, [{ userId: user.id, items }]);

        // 3. My Heart Coin balance on the patch (step 12b), then the caps
        // under it: one player's purchases on a patch take turns here, so a
        // double tap can't slip two past a cap.
        await createHeartCoinsRepo(tx).lockBalance(mapId, user.id);
        const card = (await viewOf(tx, map, user.id, at)).cards.find((c) => c.view.id === item.id);
        if (!card) throw new AppError('NOT_FOUND');
        if (card.view.status === 'held') throw new AppError('CONFLICT', MESSAGES.holdingOne);
        if (card.view.status === 'capped') {
          throw new AppError(
            'CONFLICT',
            item.cap.per === 'day'
              ? MESSAGES.cappedToday
              : item.effect.kind === 'lure'
                ? MESSAGES.cappedWeek(card.capDays)
                : MESSAGES.suppliesWeek(card.capDays),
          );
        }
        // Nothing for it to do: refused before any coin moves.
        if (fuel && fuel.plan.size === 0) {
          throw new AppError(
            'CONFLICT',
            fuel.fires.length === 0 ? MESSAGES.noFires : MESSAGES.firesFull,
          );
        }
        if (mend?.worn.length === 0) {
          throw new AppError(
            'CONFLICT',
            mend.owned === 0 ? MESSAGES.noFences : MESSAGES.fencesFine,
          );
        }

        // 4. Pay against the purchase (`CONFLICT` "Not enough Heart Coins"
        // and nothing written if short), then the row and what it gives.
        const balance = await spendHeartCoins(tx, {
          source: 'shop',
          refId: purchaseId,
          mapId,
          userId: user.id,
          amount: item.price,
          at,
        });
        await repo.insert({
          id: purchaseId,
          mapId,
          userId: user.id,
          itemId: item.id,
          price: item.price,
          day: localDate(at, map.timeZone),
          createdAt: at,
        });
        if (items) await grantItems(tx, owner, items, SHOP_REASON, purchaseId, at);
        let got: ShopGot = items ? { kind: 'items', items } : { kind: 'lure' };
        if (fuel) {
          const nights = await fuelFires(
            { setFuel: buildings.setFuel, appendEvent: repo.appendEvent },
            { ...owner, local, at },
            fuel.fires,
            fuel.plan,
          );
          got = { kind: 'fuel-all', fires: fuel.plan.size, nights };
        }
        if (mend) {
          for (const { row, fence } of mend.worn) {
            await mendFence(
              { setHp: fences.setHp, appendEvent: repo.appendEvent },
              owner,
              row,
              fence,
              {},
            );
          }
          got = { kind: 'repair-fences', fences: mend.worn.length };
        }

        // 5. The buyer's other devices hear of it (step 13, last).
        await repo.appendEvent({
          mapId,
          type: 'post.bought',
          actorUserId: user.id,
          payload: { userId: user.id, purchaseId, itemId: item.id, price: item.price, balance },
        });
        return {
          bought: { itemId: item.id, price: item.price, got },
          balance,
          shop: (await viewOf(tx, map, user.id, at)).view,
        };
      });
      void options.publish?.(mapId);
      return result;
    },
  };
}

/**
 * Night supplies' plan: my fires, locked (step 8), and up to `nights` for
 * each, only what fits (`fuelSpace`); a full fire gets none.
 */
async function nightSupplies(
  buildings: Parameters<typeof lockMyFires>[0],
  owner: { mapId: string; userId: string },
  nights: number,
  local: ReturnType<typeof mapLocalTime>,
) {
  const fires = await lockMyFires(buildings, owner.mapId, owner.userId);
  const plan = new Map<string, number>();
  for (const { row, fire } of fires) {
    const adding = Math.min(nights, fuelSpace(fire, row.fuelledThrough, local, HOME_BASE_RULES));
    if (adding > 0) plan.set(row.id, adding);
  }
  return { fires, plan };
}

/**
 * Uses the player's held lure on the wild battle just started, inside its
 * transaction (tech spec §7 step 5d). A lure already used (a double tap
 * raced this one) is `CONFLICT`, which rolls the battle back: a lured
 * squishy is never fought unpaid.
 */
export async function consumeLure(
  tx: Executor,
  lureId: string,
  battleId: string,
  at: Date,
): Promise<void> {
  if (!(await markLureUsed(tx, lureId, battleId, at))) {
    throw new AppError('CONFLICT', MESSAGES.tryAgain);
  }
}
