import type { KeeperConfig, WardrobeSlot } from '@heartpatch/shared';
import type { SquishMove } from '../../config.js';
import type { KeeperFieldStats } from '../keeper-field.js';

declare global {
  interface Window {
    /** Dev-only hook for the Keeper gallery e2e test (see keeper-gallery-main.ts). */
    __heartpatchKeepers?: {
      /** Field stats once the scene has drawn, else null. */
      stats(): KeeperFieldStats | null;
      /** Base ids shown, one per Keeper, in grid order. */
      shown(): string[];
      /** Every base in the Keeper data. */
      registryBases(): string[];
      /** Wardrobe slots with pieces on Keeper `i`. */
      slotsWorn(i: number): WardrobeSlot[];
      /** Config ids this client doesn't know, reported while building. */
      missing(): string[];
      /** `keeperHash` for any config wearing the stand-in items for `slots`. */
      keeperHash(config: KeeperConfig, slots: readonly WardrobeSlot[]): string;
      /** `keeperHash` of the Keeper at grid index `i`. */
      hashOf(i: number): string | null;
      /** CSS-pixel canvas position of Keeper `i`'s middle. */
      screenPoint(i: number): { x: number; y: number } | null;
      /** True while Keeper `i` is cheering. */
      playing(i: number): boolean;
      /** Plays a cheer on every Keeper. */
      play(move: SquishMove): void;
      /** True while anything moves. */
      animating(): boolean;
      /** True once every shown mesh's shader has compiled (after a fallback, if one was needed). */
      shadersReady(): boolean;
    };
  }
}
