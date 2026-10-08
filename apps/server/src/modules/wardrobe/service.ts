import {
  CLOTHING,
  CLOTHING_BY_ID,
  OUTFIT_PRESETS,
  SQUISHY_SLOT,
  STARTER_CLOTHING,
  sortWearing,
  wearingProblem,
  type OutfitPreset,
  type PublicUser,
  type SavePresetRequest,
  type SetAccessoryResponse,
  type Wardrobe,
  type WearingProblem,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { assertAllowedText } from '../../lib/filter.js';
import type { Clock } from '../../lib/time.js';
import { requireMember } from '../maps/members.js';
import {
  createWardrobeRepo,
  insertClothing,
  WORN,
  type NewClothing,
  type OutfitRow,
  type WardrobeTxRepo,
} from './repo.js';

/*
 * The wardrobe (design doc §23; issue #43). Account-level (tech spec §4): one
 * wardrobe per player, and their Keeper wears the same clothes on every map.
 * The client sends what to wear; the server checks every piece (known, a
 * Keeper item, one per slot, owned) before storing it. A costume hides the
 * other pieces while it's on (#42's rule); they stay worn underneath. Clothing
 * is cosmetic only and never touches battles.
 */

const STARTERS = new Set(STARTER_CLOTHING);
const CATALOG_ORDER = new Map(CLOTHING.map((item, i) => [item.id, i]));

// Kid-readable messages (style guide §6).
const MESSAGES = {
  unknown: "We don't know that piece of clothing.",
  notKeeper: "That's for squishies! Try it on one of them.",
  twice: "You're already wearing that!",
  sameSlot: 'One at a time in each spot! Take the other one off first.',
  notOwned: "You don't have that one yet. Keep exploring!",
  noPreset: "There's no outfit saved there yet.",
  noSquishy: "We couldn't find that squishy.",
  notAccessory: "That one's for Keepers, not squishies!",
  hollowed: 'That squishy is in the Hollow. Rescue them first, then dress them up!',
  inTrade: 'That squishy is waiting at a trading post right now. 📬',
} as const;

const problemMessage = (problem: WearingProblem): string => {
  switch (problem.kind) {
    case 'unknown':
      return MESSAGES.unknown;
    case 'not-keeper':
      return MESSAGES.notKeeper;
    case 'twice':
      return MESSAGES.twice;
    case 'same-slot':
      return MESSAGES.sameSlot;
  }
};

/**
 * Gives a player a piece of clothing inside the caller's transaction: a found
 * piece, a purchase, a milestone's or the tutorial's. At most one piece per
 * `(source, refId)`, so a retried grant stores nothing; true if this call
 * stored it. Writes no game event. Lock order (tech spec §7): no row locks
 * of its own (its `users` foreign key only key-shares the row).
 */
export function grantClothing(tx: Executor, piece: NewClothing): Promise<boolean> {
  return insertClothing(tx, piece);
}

export interface WardrobeService {
  get: (user: PublicUser) => Promise<Wardrobe>;
  /** Wears exactly `wearing` (equip and unequip in one). */
  wear: (user: PublicUser, wearing: readonly string[]) => Promise<Wardrobe>;
  /** Saves an outfit into preset `preset` (1–3), replacing what was there. */
  savePreset: (user: PublicUser, preset: number, body: SavePresetRequest) => Promise<Wardrobe>;
  /** Wears a saved outfit. */
  wearPreset: (user: PublicUser, preset: number) => Promise<Wardrobe>;
  /** Puts an accessory on one of the player's squishies, or takes it off (null). */
  setAccessory: (
    user: PublicUser,
    mapId: string,
    squishyId: string,
    itemId: string | null,
  ) => Promise<SetAccessoryResponse>;
  /** Dev/test only: hands the player pieces of clothing. */
  devGrant: (user: PublicUser, items: readonly string[]) => Promise<Wardrobe>;
}

export interface WardrobeServiceOptions {
  db: Executor;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
}

export function createWardrobeService(options: WardrobeServiceOptions): WardrobeService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const store = createWardrobeRepo(db);
  const published = (mapIds: readonly string[]) => {
    for (const mapId of mapIds) void options.publish?.(mapId);
  };

  /** Item id → pieces owned, starter items included (one each). */
  const ownedBy = async (
    repo: { countOwned: (u: string) => Promise<Map<string, number>> },
    userId: string,
  ) => {
    const owned = await repo.countOwned(userId);
    for (const id of STARTERS) owned.set(id, (owned.get(id) ?? 0) + 1);
    return owned;
  };

  /** A valid, owned outfit in slot order; throws a kid-readable error otherwise. */
  const checkWearing = (wearing: readonly string[], owned: ReadonlyMap<string, number>) => {
    const problem = wearingProblem(wearing, CLOTHING_BY_ID);
    if (problem) throw new AppError('VALIDATION_FAILED', problemMessage(problem));
    if (wearing.some((id) => !owned.has(id))) throw new AppError('FORBIDDEN', MESSAGES.notOwned);
    return sortWearing(wearing, CLOTHING_BY_ID);
  };

  const snapshot = async (
    repo: Pick<WardrobeTxRepo, 'countOwned' | 'listOutfits'>,
    userId: string,
  ) => {
    const [owned, rows] = await Promise.all([ownedBy(repo, userId), repo.listOutfits(userId)]);
    return toWardrobe(owned, rows);
  };

  /**
   * Stores the worn set and, if it changed, tells every map the player is on
   * (`outfit.changed`, one per map). Runs in the caller's transaction; returns
   * the maps to publish to.
   *
   * Each append row-locks that map's `maps` row until commit (tech spec §7,
   * "Lock order": `maps` last, several rows of one kind in id order), so the
   * maps go in ascending id order (`activeMapIds` sorts them). Two players
   * on the same maps dressing at once then queue on the lowest one instead of
   * each holding a map the other is waiting for (a deadlock).
   */
  const putOn = async (repo: WardrobeTxRepo, userId: string, wearing: string[]) => {
    // Never dressed is the same as wearing nothing.
    const current = (await repo.lockWorn(userId))?.wearing ?? [];
    if (sameList(current, wearing)) return [];
    await repo.saveOutfit(userId, { preset: WORN, name: null, wearing }, now());
    const mapIds = await repo.activeMapIds(userId);
    for (const mapId of mapIds) {
      await repo.appendEvent({
        mapId,
        type: 'outfit.changed',
        actorUserId: userId,
        payload: { userId, wearing },
      });
    }
    return mapIds;
  };

  const wear = async (user: PublicUser, wearing: readonly string[]) => {
    const { wardrobe, mapIds } = await store.transaction(async (repo) => {
      const owned = await ownedBy(repo, user.id);
      const mapIds = await putOn(repo, user.id, checkWearing(wearing, owned));
      return { wardrobe: await snapshot(repo, user.id), mapIds };
    });
    published(mapIds);
    return wardrobe;
  };

  return {
    get: (user) => snapshot(store, user.id),

    wear,

    savePreset: async (user, preset, body) => {
      if (body.name !== null) assertAllowedText(body.name, 'name');
      return store.transaction(async (repo) => {
        const wearing = checkWearing(body.wearing, await ownedBy(repo, user.id));
        await repo.saveOutfit(user.id, { preset, name: body.name, wearing }, now());
        return snapshot(repo, user.id);
      });
    },

    wearPreset: async (user, preset) => {
      const saved = (await store.listOutfits(user.id)).find((o) => o.preset === preset);
      if (!saved || preset === WORN) throw new AppError('NOT_FOUND', MESSAGES.noPreset);
      return wear(user, saved.wearing);
    },

    setAccessory: async (user, mapId, squishyId, itemId) => {
      if (itemId !== null) {
        const item = CLOTHING_BY_ID.get(itemId);
        if (!item) throw new AppError('VALIDATION_FAILED', MESSAGES.unknown);
        if (item.slot !== SQUISHY_SLOT) {
          throw new AppError('VALIDATION_FAILED', MESSAGES.notAccessory);
        }
      }
      return store.transaction(async (repo, tx) => {
        await requireMember(tx, user, mapId);
        const squishy = await repo.lockSquishy(squishyId);
        if (squishy?.mapId !== mapId || squishy.ownerUserId !== user.id) {
          throw new AppError('NOT_FOUND', MESSAGES.noSquishy);
        }
        if (squishy.state === 'in-trade') throw new AppError('CONFLICT', MESSAGES.inTrade);
        if (squishy.state !== 'active') throw new AppError('CONFLICT', MESSAGES.hollowed);
        if (itemId !== null && !(await ownedBy(repo, user.id)).has(itemId)) {
          throw new AppError('FORBIDDEN', MESSAGES.notOwned);
        }
        await repo.setAccessory(squishyId, user.id, itemId, now());
        return { squishyId, accessory: itemId };
      });
    },

    devGrant: async (user, items) => {
      const unknown = items.find((id) => !CLOTHING_BY_ID.has(id));
      if (unknown) throw new AppError('VALIDATION_FAILED', MESSAGES.unknown);
      return store.transaction(async (repo, tx) => {
        const at = now();
        for (const itemId of items) {
          await grantClothing(tx, {
            userId: user.id,
            itemId,
            source: 'dev-grant',
            refId: null,
            mapId: null,
            at,
          });
        }
        return snapshot(repo, user.id);
      });
    },
  };
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

function toWardrobe(owned: ReadonlyMap<string, number>, rows: readonly OutfitRow[]): Wardrobe {
  const order = (id: string) => CATALOG_ORDER.get(id) ?? CATALOG_ORDER.size;
  const presets: OutfitPreset[] = rows
    .filter((r) => r.preset !== WORN && r.preset <= OUTFIT_PRESETS)
    .map((r) => ({ preset: r.preset, name: r.name, wearing: r.wearing }));
  return {
    owned: [...owned]
      // A piece retired from the catalog stays stored but isn't shown.
      .filter(([itemId]) => CLOTHING_BY_ID.has(itemId))
      .sort(([a], [b]) => order(a) - order(b))
      .map(([itemId, count]) => ({ itemId, count })),
    wearing: rows.find((r) => r.preset === WORN)?.wearing ?? [],
    presets,
  };
}
