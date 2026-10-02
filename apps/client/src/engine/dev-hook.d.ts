import type { BattleDebug } from '../battle/battle-screen.js';
import type { CatalogDebug } from '../catalog/catalog-screen.js';
import type { MapDebug } from '../map/map-screen.js';
import type { TutorialDebug } from '../tutorial/tutorial-screen.js';
import type { MapCameraState } from './camera/map-camera.js';
import type { QualitySnapshot } from './quality/render-quality.js';

declare global {
  interface Window {
    /** Dev-only test hook (see main.ts); undefined in production builds. */
    __heartpatch?: {
      renderer(): string | null;
      quality(): QualitySnapshot | null;
      camera(): MapCameraState | null;
      /** Frames drawn so far; stays put while the scene is idle. */
      draws(): number;
      /** True when the render loop's last iteration drew nothing. */
      idle(): boolean;
      /** Draws a few frames, as any untracked change would. */
      invalidate(): void;
      /**
       * The open map as drawn (id, tile and tint counts, selection), or null.
       * Only the game page has it (not dev pages like the squishy gallery).
       */
      map?(): MapDebug | null;
      /** The tutorial's step, spotlight and Sprout (#47), or null when logged out. */
      tutorial?(): TutorialDebug | null;
      /** True while a screen holds automatic updates (pwa/update-hold.ts). */
      updatesHeld?(): boolean;
      /** The open battle as shown (turn, phase, bar energies, pending steps), or null. */
      battle?(): BattleDebug | null;
      /** The open squishy catalog (seen, friends, names on the cards), or null. */
      catalog?(): CatalogDebug | null;
    };
  }
}
