import {
  activeSeasons,
  BOUTIQUE_RULES,
  boutiqueStock,
  CLOTHING,
  CLOTHING_BY_ID,
  GAME_DATA,
  inStock,
  type Boutique,
  type BoutiqueItem,
  type BoutiqueStock,
  type BuyClothingResponse,
  type PublicUser,
} from '@heartpatch/shared';
import { uuidv7 } from 'uuidv7';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { localDate, nextLocalMidnight, type Clock } from '../../lib/time.js';
import { createCoinsRepo } from '../coins/repo.js';
import { accountDay, accountTimeZone, spendCoins } from '../coins/service.js';
import { STARTER_CLOTHING_IDS } from '../wardrobe/accessories.js';
import { createWardrobeRepo } from '../wardrobe/repo.js';
import { createWardrobeService, grantClothing } from '../wardrobe/service.js';

/*
 * The Boutique (design doc §23; issue #45): clothing bought with Patch Coins,
 * never real money (CLAUDE.md rule 9). Account-level like the coins and the
 * wardrobe (DECISIONS F): one shop per player, whose racks change at
 * midnight in the account's time zone. The racks are worked out on read from
 * the player's id and the date (shared `boutiqueStock`), so there's no stock
 * table and nothing to rotate (rule 4). A purchase is one transaction under
 * the account's balance lock (rule 7): in stock today, not owned already,
 * enough coins, then the debit and the piece. It writes no game event: the
 * existing ones are per map (`clothing.found` is for finds), and nobody else
 * sees a purchase until it's worn (`outfit.changed`).
 */

// Kid-readable messages (style guide §6).
const MESSAGES = {
  notSold: "The Boutique doesn't sell that one.",
  notToday: "That one isn't on the racks today. Come back tomorrow for something new!",
  owned: "You already have that one! It's in your wardrobe.",
} as const;

export interface BoutiqueService {
  /** Today's racks for the player, with prices, what they own and their coins. */
  get: (user: PublicUser) => Promise<Boutique>;
  /** Buys one piece from today's racks. */
  buy: (user: PublicUser, itemId: string) => Promise<BuyClothingResponse>;
}

export interface BoutiqueServiceOptions {
  db: Executor;
  clock?: Clock;
}

/** The racks on the player's local `date`. */
export function stockFor(userId: string, date: string): BoutiqueStock {
  const seasons = activeSeasons(GAME_DATA.seasons, date).map((s) => s.id);
  return boutiqueStock(CLOTHING, { seed: userId, date, seasons }, BOUTIQUE_RULES);
}

export function createBoutiqueService(options: BoutiqueServiceOptions): BoutiqueService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const wardrobe = createWardrobeService({
    db,
    ...(options.clock ? { clock: options.clock } : {}),
  });

  /** What the shop shows at `at`, read through `tx` (inside or outside a transaction). */
  async function view(tx: Executor, userId: string, at: Date): Promise<Boutique> {
    const coins = createCoinsRepo(tx);
    const timeZone = await accountTimeZone(tx, userId);
    const date = localDate(at, timeZone);
    const stock = stockFor(userId, date);
    const [owned, balance] = await Promise.all([
      createWardrobeRepo(tx).countOwned(userId),
      coins.balance(userId),
    ]);
    const item = (itemId: string): BoutiqueItem => {
      // Only priced pieces reach the racks (`boutiqueStock`).
      const price = CLOTHING_BY_ID.get(itemId)?.boutiquePrice;
      if (price === undefined) throw new Error(`boutique: ${itemId} has no price`);
      return {
        itemId,
        price,
        owned: STARTER_CLOTHING_IDS.has(itemId) || (owned.get(itemId) ?? 0) > 0,
      };
    };
    return {
      date,
      restocksAt: nextLocalMidnight(at, timeZone).toISOString(),
      daily: stock.daily.map(item),
      seasonal: stock.seasonal.map((rack) => ({
        seasonId: rack.seasonId,
        items: rack.items.map(item),
      })),
      coins: { balance },
    };
  }

  return {
    get: async (user) => view(db, user.id, now()),

    buy: async (user, itemId) => {
      const price = CLOTHING_BY_ID.get(itemId)?.boutiquePrice;
      if (price === undefined) throw new AppError('NOT_FOUND', MESSAGES.notSold);
      const boutique = await createCoinsRepo(db).transaction(async (coins, tx) => {
        // 1. The account's balance lock: this player's purchases and credits
        // run one at a time from here, so two taps can't overspend or buy twice.
        await coins.lockBalance(user.id);
        const at = now();
        // 2. On today's racks, by the account's own date (after the lock, so
        // a purchase that waited past midnight checks the new day).
        const date = await accountDay(tx, user.id, at);
        if (!inStock(stockFor(user.id, date), itemId)) {
          throw new AppError('CONFLICT', MESSAGES.notToday);
        }
        // 3. Not owned already (found, or bought before).
        const store = createWardrobeRepo(tx);
        if (
          STARTER_CLOTHING_IDS.has(itemId) ||
          ((await store.countOwned(user.id)).get(itemId) ?? 0) > 0
        ) {
          throw new AppError('CONFLICT', MESSAGES.owned);
        }
        // 4. The debit (CONFLICT, nothing changed, if it's short), and 5. the
        // piece, both for this one purchase.
        const purchaseId = uuidv7();
        await spendCoins(tx, { userId: user.id, refId: purchaseId, amount: price, at });
        await grantClothing(tx, {
          userId: user.id,
          itemId,
          source: 'boutique',
          refId: purchaseId,
          mapId: null,
          at,
        });
        return view(tx, user.id, at);
      });
      return { boutique, wardrobe: await wardrobe.get(user) };
    },
  };
}
