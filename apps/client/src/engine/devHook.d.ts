import type { GroundPoint } from './camera/cameraMath.js';
import type { QualitySnapshot } from './quality/renderQuality.js';

declare global {
  interface Window {
    /** Dev-only test hook (see main.ts); undefined in production builds. */
    __heartpatch?: {
      renderer(): string | null;
      quality(): QualitySnapshot | null;
      camera(): { target: GroundPoint; distance: number; flinging: boolean } | null;
    };
  }
}
