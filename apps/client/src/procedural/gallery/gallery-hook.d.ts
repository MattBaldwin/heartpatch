import type { SquishMove } from '../config.js';
import type { SquishySpecies } from '../params.js';
import type { SquishyFieldStats } from '../squishy-field.js';

declare global {
  interface Window {
    /** Dev-only hook for the gallery e2e test (see gallery-main.ts). */
    __heartpatchGallery?: {
      /** Field stats once the scene has drawn, else null. */
      stats(): SquishyFieldStats | null;
      /** Look ids shown, one per squishy, in grid order. */
      shown(): string[];
      /** Bodies and parts on screen, and every body and part in the registry. */
      coverage(): {
        bodies: string[];
        parts: string[];
        registryBodies: string[];
        registryParts: string[];
      };
      /** Unknown body or part ids reported while building. */
      missing(): string[];
      /** `paramsHash` for any species and instance id. */
      paramsHash(species: SquishySpecies, instanceId: string): string;
      /** `paramsHash` of the squishy at grid index `i`. */
      squishyHash(i: number): string | null;
      /** CSS-pixel canvas position of squishy `i`'s middle. */
      screenPoint(i: number): { x: number; y: number } | null;
      /** Grid index of the squishy last tapped, or null. */
      lastTapped(): number | null;
      /** True while squishy `i` is playing a move. */
      playing(i: number): boolean;
      /** Plays a move on every squishy. */
      play(move: SquishMove): void;
      /** True while anything is moving (breathing or a move). */
      animating(): boolean;
    };
  }
}
