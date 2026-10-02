import type { PartShape, WardrobeSlot } from '@heartpatch/shared';
import type { Vec3 } from '../params.js';

/**
 * How clothing attaches to a Keeper (design doc §23): every base has a
 * socket per wardrobe slot (`KeeperParams.sockets`), and an item is a few
 * primitive pieces placed in its socket's units. A socket knows the size of
 * the body part it sits on, so one item fits every base: nothing is made per
 * body type. Clothing data and real items arrive with the wardrobe (#43),
 * which can move this shape into shared data.
 */

/** One primitive of an item, in its socket's units. */
export interface KeeperItemPiece {
  readonly shape: PartShape;
  /** Centre, from the socket's anchor, in socket sizes (x towards the Keeper's left hand side of the screen is −). */
  readonly at: Vec3;
  /** Size of the primitive, in socket sizes. */
  readonly size: Vec3;
  /** Degrees: pitch (x), yaw (y), roll (z). */
  readonly turn?: Vec3;
  /** sRGB hex. */
  readonly color: string;
}

export interface KeeperItem {
  readonly id: string;
  readonly slot: WardrobeSlot;
  readonly pieces: readonly KeeperItemPiece[];
}

/**
 * Stand-in items, one per slot, that prove every socket on every base (the
 * Keeper gallery and tests). Not content: real clothing is #43's.
 */
export const PLACEHOLDER_ITEMS: readonly KeeperItem[] = [
  {
    id: 'test-party-hat',
    slot: 'hat',
    pieces: [
      { shape: 'cone', at: [0, 0.32, 0], size: [0.55, 0.7, 0.55], color: '#ff7fb0' },
      { shape: 'ellipsoid', at: [0, 0.7, 0], size: [0.14, 0.14, 0.14], color: '#fff3a8' },
    ],
  },
  {
    id: 'test-bow',
    slot: 'hair-accessory',
    pieces: [
      {
        shape: 'teardrop',
        at: [-0.3, 0, 0],
        size: [0.5, 0.6, 0.3],
        turn: [0, 0, 90],
        color: '#ff6f91',
      },
      {
        shape: 'teardrop',
        at: [0.3, 0, 0],
        size: [0.5, 0.6, 0.3],
        turn: [0, 0, -90],
        color: '#ff6f91',
      },
      { shape: 'ellipsoid', at: [0, 0, 0], size: [0.28, 0.3, 0.3], color: '#e24f78' },
    ],
  },
  {
    id: 'test-scarf',
    slot: 'top',
    pieces: [
      { shape: 'ellipsoid', at: [0, 0.42, 0], size: [1.12, 0.26, 1.12], color: '#7fd1b9' },
      { shape: 'capsule', at: [0.22, 0.12, -0.5], size: [0.2, 0.45, 0.1], color: '#7fd1b9' },
    ],
  },
  {
    id: 'test-tutu',
    slot: 'bottom',
    pieces: [{ shape: 'ellipsoid', at: [0, 0, 0], size: [1.45, 0.5, 1.45], color: '#ffc4e1' }],
  },
  {
    id: 'test-boots',
    slot: 'shoes',
    pieces: [{ shape: 'ellipsoid', at: [0, 0.12, 0], size: [1.15, 1.25, 1.1], color: '#ffd166' }],
  },
  {
    id: 'test-backpack',
    slot: 'back',
    pieces: [
      { shape: 'capsule', at: [0, 0, 0.45], size: [0.8, 0.8, 0.5], color: '#ffa552' },
      { shape: 'ellipsoid', at: [0, -0.12, 0.72], size: [0.5, 0.35, 0.2], color: '#ffd8a8' },
    ],
  },
  {
    id: 'test-lantern',
    slot: 'held',
    pieces: [
      { shape: 'capsule', at: [0, 0.35, 0], size: [0.12, 0.5, 0.12], color: '#6b4430' },
      { shape: 'ellipsoid', at: [0, -0.05, 0], size: [0.5, 0.6, 0.5], color: '#ffe48a' },
      { shape: 'cone', at: [0, 0.3, 0], size: [0.45, 0.25, 0.45], color: '#6b4430' },
    ],
  },
  {
    id: 'test-ghost-sheet',
    slot: 'costume',
    pieces: [
      { shape: 'teardrop', at: [0, 0.05, 0], size: [1.15, 1.12, 1.15], color: '#f8f4ff' },
      { shape: 'ellipsoid', at: [-0.13, 0.25, -0.52], size: [0.1, 0.13, 0.05], color: '#3b2a3f' },
      { shape: 'ellipsoid', at: [0.13, 0.25, -0.52], size: [0.1, 0.13, 0.05], color: '#3b2a3f' },
    ],
  },
];
