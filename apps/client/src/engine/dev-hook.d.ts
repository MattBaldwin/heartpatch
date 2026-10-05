import type { AudioDebug } from '../audio/audio.js';
import type { BattleDebug } from '../battle/battle-screen.js';
import type { HollowDebug } from '../hollow/hollow-screen.js';
import type { HomeDebug } from '../home/home-screen.js';
import type { InventoryDebug } from '../inventory/inventory-screen.js';
import type { CatalogDebug } from '../catalog/catalog-screen.js';
import type { CareDebug } from '../care/care-sheet.js';
import type { ChatDebug } from '../chat/chat-screen.js';
import type { CloseUpDebug } from '../close-up/close-up-screen.js';
import type { MapDebug } from '../map/map-screen.js';
import type { RaidReportDebug } from '../raids/raid-report.js';
import type { TerritoryDebug } from '../territory/territory-screen.js';
import type { TutorialDebug } from '../tutorial/tutorial-screen.js';
import type { KeeperDebug } from '../ui/keeper/keeper-screen.js';
import type { CinematicDebug } from '../cinematics/cinematic-screen.js';
import type { WardrobeDebug } from '../ui/wardrobe/wardrobe-screen.js';
import type { LorebookDebug } from '../lore/lorebook.js';
import type { MilestoneCelebrationDebug } from '../milestones/milestone-celebration.js';
import type { StarterDebug } from '../starters/starter-screen.js';
import type { TraysDebug } from '../ui/trays/trays.js';
import type { RecipeBookDebug } from '../recipes/recipe-book.js';
import type { JobsDebug } from '../squishies/jobs/index.js';
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
      /** The side trays over the map: shown, which is open, the hint, the handles' badges. */
      trays?(): TraysDebug;
      /** The recipe book: open, the pages on screen, unlocked and new pages (owner decision 2026-10-05). */
      recipeBook?(): RecipeBookDebug | null;
      /** The tutorial's step, spotlight and Sprout (#47), or null when logged out. */
      tutorial?(): TutorialDebug | null;
      /** True while a screen holds automatic updates (pwa/update-hold.ts). */
      updatesHeld?(): boolean;
      /** The open battle as shown (turn, phase, bar energies, pending steps), or null. */
      battle?(): BattleDebug | null;
      /** The Keeper picker: mode, the pick shown, the saved Keeper, the preview's hash (#42). */
      keeper?(): KeeperDebug | null;
      /** The opening cinematic (#46): mode, time, shot, caption, skip and what's on screen, or null. */
      cinematic?(): CinematicDebug | null;
      /** The open map's bag, gathers and the tile panel's gather action (#17), or null. */
      inventory?(): InventoryDebug | null;
      /** Tries left, squishies on watch and the tile panel's land action (#15), or null. */
      territory?(): TerritoryDebug | null;
      /** The night, the morning report, squishies in the Hollow and his visits (#21), or null. */
      hollow?(): HollowDebug | null;
      /** The raid report (#16): my defense style, raids, unseen, open or not; or null. */
      raids?(): RaidReportDebug | null;
      /** The home base (#18): open or not, its buildings, squishies and wander hops, or null. */
      home?(): HomeDebug | null;
      /** The care sheet (#19): the squishy shown, its mood and level, celebrations, or null. */
      care?(): CareDebug | null;
      /** The close-up view (#20): phase, detail, the squishy's screen spot, care sent and held, or null. */
      closeUp?(): CloseUpDebug | null;
      /** The open squishy catalog (seen, friends, names on the cards), or null. */
      catalog?(): CatalogDebug | null;
      /** The wardrobe: open, tab, filter, what's tried on and worn, presets, the preview's hash (#43). */
      wardrobe?(): WardrobeDebug | null;
      /** Squishy jobs: the job board and team picker (open, jobs, team, ready work). */
      jobs?(): JobsDebug;
      starter?(): StarterDebug | null;
      lore?(): LorebookDebug;
      /** The milestone celebration (#44): the card showing and how many wait. */
      milestones?(): MilestoneCelebrationDebug;
      /** Quick messages (#23): the sheet, the feed and the bubbles over the map, or null. */
      chat?(): ChatDebug | null;
      /** Sound (#25): unlock state, engine, the loop wanted and playing, the last cue, levels. */
      audio?(): AudioDebug;
    };
  }
}
