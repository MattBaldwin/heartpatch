import {
  CLOTHING_BY_ID,
  isKeeperClothing,
  type ClothingPiece,
  type WardrobeSlot,
} from '@heartpatch/shared';

/**
 * How clothing attaches to a Keeper (design doc §23): every base has a
 * socket per wardrobe slot (`KeeperParams.sockets`), and an item is a few
 * primitive pieces placed in its socket's units. A socket knows the size of
 * the body part it sits on, so one item fits every base: nothing is made per
 * body type. The items themselves are shared clothing data (`CLOTHING`, #43).
 */

/** One primitive of an item, in its socket's units (`ClothingPieceSchema`). */
export type KeeperItemPiece = ClothingPiece;

export interface KeeperItem {
  readonly id: string;
  readonly slot: WardrobeSlot;
  readonly pieces: readonly KeeperItemPiece[];
}

/**
 * The Keeper clothing for worn item ids, in the order given. Ids this client
 * doesn't know (a newer server) and squishy accessories are skipped, so an
 * outdated client still draws the Keeper.
 */
export function keeperItems(wearing: readonly string[]): KeeperItem[] {
  return wearing.flatMap((id) => {
    const item = CLOTHING_BY_ID.get(id);
    return item && isKeeperClothing(item)
      ? [{ id: item.id, slot: item.slot, pieces: item.visual.pieces }]
      : [];
  });
}
