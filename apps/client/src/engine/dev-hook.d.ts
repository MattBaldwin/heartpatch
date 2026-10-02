import type { MapDebug } from '../map/map-screen.js';
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
    };
  }
}
