import type { BattleSceneStats } from '../../battle/battle-scene.js';

declare global {
  interface Window {
    /** Dev-only hook for the roster sheet scripts (see roster-main.ts). */
    __roster?: {
      /** True once the scene has drawn enough frames to screenshot. */
      ready(): boolean;
      stats(): BattleSceneStats | null;
    };
  }
}
