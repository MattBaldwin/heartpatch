import type { WsEventMessage } from '@heartpatch/shared';
import type { AudioDebug } from '../audio/audio.js';
import type { BattleDebug, BattleDevControls } from '../battle/battle-screen.js';
import type { HollowDebug } from '../hollow/hollow-screen.js';
import type { LandDebug } from '../land/land-screen.js';
import type { ExploreDebug } from '../explore/explore-screen.js';
import type { HomeDebug } from '../home/home-screen.js';
import type { InventoryDebug } from '../inventory/inventory-screen.js';
import type { CatalogDebug } from '../catalog/catalog-screen.js';
import type { CareDebug } from '../care/care-sheet.js';
import type { ChatDebug } from '../chat/chat-screen.js';
import type { FriendlyDebug } from '../friendly/friendly-screen.js';
import type { CloseUpDebug } from '../close-up/close-up-screen.js';
import type { HouseDebug } from '../house/house-screen.js';
import type { CommunityActions } from '../hollowed/community-actions.js';
import type { RestoreSheetDebug } from '../hollowed/restore-sheet.js';
import type { FarHollowSheetDebug } from '../hollowed/far-hollow-sheet.js';
import type { CrookedDebug } from '../far-hollow/house/crooked-screen.js';
import type { CommunityFlags } from '../hollowed/community-flags.js';
import type { MapDebug } from '../map/map-screen.js';
import type { WeatherStats } from '../weather/weather-layer.js';
import type { RaidReportDebug } from '../raids/raid-report.js';
import type { TerritoryDebug } from '../territory/territory-screen.js';
import type { TileBuildDebug } from '../building/tile-build.js';
import type { RoadsDebug } from '../roads/roads-screen.js';
import type { FenceDebug } from '../fences/fence-screen.js';
import type { TutorialDebug } from '../tutorial/tutorial-screen.js';
import type { KeeperDebug } from '../ui/keeper/keeper-screen.js';
import type { CinematicDebug } from '../cinematics/cinematic-screen.js';
import type { WardrobeDebug } from '../ui/wardrobe/wardrobe-screen.js';
import type { HeartCoinsDebug } from '../heart-coins/heart-coins.js';
import type { LorebookDebug } from '../lore/lorebook.js';
import type { MilestoneCelebrationDebug } from '../milestones/milestone-celebration.js';
import type { DefensePromptDebug } from '../battle/defense-prompt.js';
import type { WhatsNewDebug } from '../whats-new/whats-new.js';
import type { StarterDebug } from '../starters/starter-screen.js';
import type { TraysDebug } from '../ui/trays/trays.js';
import type { RecipeBookDebug } from '../recipes/recipe-book.js';
import type { JobsDebug } from '../squishies/jobs/index.js';
import type { RosterDebug } from '../squishies/roster/roster-sheet.js';
import type { JourneyDebug } from '../trading/journey-screen.js';
import type { TrickOrTreatDebug } from '../trick-or-treat/trick-or-treat-screen.js';
import type { PostFlags } from '../trading/post-flags.js';
import type { PostDebug } from '../trading/post-screen.js';
import type { MapCameraState } from './camera/map-camera.js';
import type { FrameCap, QualityTier } from './config.js';
import type { GlCounts } from './gl-counters.js';
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
       * The post-process budget e2e (#501), on the squishy gallery only:
       * `hold` switches the governor off at a tier and render scale (applied
       * at the next frame); `gl` counts this context's WebGL objects and
       * program links from the first call (null on WebGPU); `targets` counts
       * the engine's live render targets.
       */
      qualityDev?(): {
        hold(tier: QualityTier, renderScale: number): void;
        gl(): GlCounts | null;
        targets(): number;
      } | null;
      /** The stage's frame cap (explore, `?cap30=1`; #501), or null when it draws on demand. */
      frameCap?(): FrameCap | null;
      /** Test scenes built since the page loaded (a map↔explore switch builds none, #501 G). */
      testScenes?(): number;
      /** `RenderQuality.expectHitch` calls on this stage (a find makes two, #501 G). */
      hitchesExpected?(): number;
      /**
       * The open map as drawn (id, tile and tint counts, selection), or null.
       * Only the game page has it (not dev pages like the squishy gallery).
       */
      map?(): MapDebug | null;
      /** What the Wild Isle weather layer draws now (#621): counts, ambient mode, refills. */
      weather?(): WeatherStats;
      /**
       * Map controls for e2e (#295): `select` opens a tile's panel as a tap
       * would, without hunting for it on a slow software-rendered canvas.
       * False when the tile isn't on the open map.
       */
      mapDev?(): {
        select(q: number, r: number): boolean;
        /** Selects a tile and glides the camera there at once (captures, #515). */
        show(q: number, r: number): boolean;
        /** Plays one live event into the open map, as if the server sent it (#242). */
        replay(event: WsEventMessage): void;
      };
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
      /** The battle clock's controls under `?battle-clock=manual` (captures), else null. */
      battleDev?(): BattleDevControls | null;
      /** The Keeper picker: mode, the pick shown, the saved Keeper, the preview's hash (#42). */
      keeper?(): KeeperDebug | null;
      /** The opening cinematic (#46): mode, time, shot, caption, skip and what's on screen, or null. */
      cinematic?(): CinematicDebug | null;
      /** The open map's bag, gathers and the tile panel's gather action (#17), or null. */
      inventory?(): InventoryDebug | null;
      /** Tries left, squishies on watch and the tile panel's land action (#15), or null. */
      territory?(): TerritoryDebug | null;
      /** The fence sheet (#203): its step and the bag it read, or null off a map. */
      fences?(): FenceDebug | null;
      tileBuild?(): TileBuildDebug;
      /** Wild Isle roads the client has, and how many it drew per level (#621). */
      roads?(): RoadsDebug;
      /** Cut-off land drawn by look, and whether the "Some land is cut off!" card shows (#621). */
      stranded?(): { grace: number; fading: number; card: boolean };
      /** Each hex's centre and six corners on screen, in CSS pixels (dev tooling). */
      outlines?(hexes: readonly { q: number; r: number }[]): { x: number; y: number }[][];
      /** The night, the morning report, squishies in the Hollow and his visits (#21), or null. */
      hollow?(): HollowDebug | null;
      /** Land that misses you (owner decision 2026-10-06). */
      land?(): LandDebug | null;
      /** The raid report (#16): my defense style, raids, unseen, open or not; or null. */
      raids?(): RaidReportDebug | null;
      /** The home base (#18): open or not, its buildings, squishies and wander hops, or null. */
      home?(): HomeDebug | null;
      /** Exploring a tile of mine up close (#199), or null off a patch. */
      explore?(): ExploreDebug | null;
      /** The care sheet (#19): the squishy shown, its mood and level, celebrations, or null. */
      care?(): CareDebug | null;
      /** The close-up view (#20): phase, detail, the squishy's screen spot, care sent and held, or null. */
      closeUp?(): CloseUpDebug | null;
      house?(): HouseDebug | null;
      /** The open squishy catalog (seen, friends, names on the cards), or null. */
      catalog?(): CatalogDebug | null;
      /** The wardrobe: open, tab, filter, what's tried on and worn, presets, the preview's hash (#43). */
      wardrobe?(): WardrobeDebug | null;
      /** Heart Coins (#601): the patch read, its balance, and the sheet's page while open. */
      heartCoins?(): HeartCoinsDebug;
      /** Squishy jobs: the job board and team picker (open, jobs, team, ready work). */
      jobs?(): JobsDebug;
      /** The Squishies roster (#375): open, rows shown, sort, filter, the open row. */
      roster?(): RosterDebug;
      /**
       * Trading posts on the map (#269): flags on screen, gold rings, and the posts my land reaches;
       * named homes' flags and every flag's box (#306), to check none overlap.
       */
      posts?(): Pick<PostFlags, 'shown' | 'rings' | 'onScreen' | 'connected' | 'homes' | 'boxes'>;
      /** Journeys to trading posts (#270): the tile panel's preview and open visit passes. */
      journey?(): JourneyDebug;
      /** The far Hollow's sheet (#306 PR 6). */
      farHollow?(): FarHollowSheetDebug;
      /** The Crooked House screen (#306 6c). */
      farHollowHouse?(): CrookedDebug;
      /** Opens the far Hollow sheet without a trading post (e2e: its "Go inside"). */
      farHollowDev?(): {
        openSheet(): void;
        place(x: number, z: number): void;
        look(doorId: string): void;
      };
      /** Trick-or-treat (#515): whether it's on, each patch-mate's door, the last treat's toast. */
      trickOrTreat?(): TrickOrTreatDebug;
      /** A trading post's screen (#271): tab, picks, offers and mailbox counts. */
      post?(): PostDebug;
      /**
       * Hollowed villages (#306): their flags on screen (words and boxes, to check none overlap)
       * and the village block in the open tile panel; each village's square, to select it.
       */
      communities?(): {
        flags: CommunityFlags['shown'];
        panel: CommunityActions['debug'];
        /** The restore sheet and naming card (#306 PR 3). */
        restore: RestoreSheetDebug;
        villages: {
          id: string;
          name: string;
          square: { q: number; r: number };
          reach: string | null;
          restored: number;
          ownerUserId: string | null;
        }[];
      };
      starter?(): StarterDebug | null;
      lore?(): LorebookDebug;
      /** The milestone celebration (#44): the card showing and how many wait. */
      milestones?(): MilestoneCelebrationDebug;
      defense?(): DefensePromptDebug;
      /** Quick messages (#23): the sheet, the feed and the bubbles over the map, or null. */
      chat?(): ChatDebug | null;
      /** Friendly battles (#29): who's here, the asks. */
      friendly?(): FriendlyDebug | null;
      /** Sound (#25): unlock state, engine, the loop wanted and playing, the last cue, levels. */
      audio?(): AudioDebug;
      /** What's new (#220): whether the sheet is open, why it opened and how many entries it lists. */
      whatsNew?(): WhatsNewDebug;
      /** The patch line (#391): the line showing, how many wait, and whether it's held back now. */
      patchLine?(): { showing: string | null; waiting: number; busy: boolean };
    };
  }
}
