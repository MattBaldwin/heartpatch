import {
  EXPLORE_RULES,
  isExplorable,
  type ExploreTileResponse,
  type ItemCounts,
  type KeeperConfig,
  type PublicSearchSpot,
  type PublicTile,
  type PublicUser,
  type SearchSpotResponse,
  type SpotInteraction,
  type ToolId,
  type WorldPoint,
} from '@heartpatch/shared';
import type { Scene } from '@babylonjs/core/scene';
import type { QualityTier } from '../engine/config.js';
import type { SceneBuilder, SceneContent } from '../engine/stage.js';
import { inventoryApi } from '../inventory/inventory-api.js';
import { itemIconNode } from '../inventory/item-icons.js';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import type { TileActions } from '../map/map-screen.js';
import { ApiRequestError } from '../net/api.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { batchUploads } from '../procedural/batch-uploads.js';
import { lodFor } from '../procedural/motion.js';
import { AmbientDriver } from '../map/ambient-driver.js';
import type { AmbientStatus } from '../map/ambient-layout.js';
import { jobsApi, type JobsApi } from '../squishies/jobs/jobs-api.js';
import { faceYaw } from '../procedural/face-yaw.js';
import { el, messageOf } from '../ui/dom.js';
import { iconNode } from '../ui/line-icons.js';
import { EXPLORE_FIND, EXPLORE_VIEW } from './explore-config.js';
import { exploreApi, type ExploreApi } from './explore-api.js';
import { ExploreScene, type ExploreSceneStats } from './explore-scene.js';
import { placeDark, type DarkPaint } from './lantern-dark.js';
import {
  actionFor,
  afterSearch,
  clampToTile,
  EXPLORE_TEXT,
  findLines,
  findShowsCard,
  findToast,
  foundCount,
  joystickVector,
  makeOneLine,
  missingTool,
  needsHere,
  progressLine,
  rareTitle,
  stepToward,
  terrainName,
  toolChip,
  toolChipShort,
  TOOL_ICONS,
  toolRecipeRows,
  HANDS_ICON,
  PLAY_TEXT,
  xpLines,
  restLine,
} from './explore-view.js';
import {
  besideSpot,
  CAVE_STAGE,
  freePoint,
  fromCaveStage,
  lanternGlint,
  LIGHT_REACH,
  LIGHT_RING_SHARE,
  lightCircle,
  slideMove,
  spotAtTap,
  spotInFront,
  toCaveStage,
  yawToward,
} from './explore-world.js';
import {
  interactionProgress,
  startInteraction,
  stepInteraction,
  type InteractionInput,
  type InteractionState,
} from './interactions.js';
import {
  exploreSkyAt,
  exploreWorld,
  isUnderwater,
  localMinuteIn,
  sameLook,
  skyLook,
  type SkyLook,
} from './explore-sky-look.js';
import { safeStorage, type SettingsStorage } from '../audio/audio-settings.js';
import { HOLLOWED_EXPLORE } from '../hollowed/hollowed-config.js';
import { HOLLOWED_TEXT, villageShut } from '../hollowed/hollowed-explore-view.js';
import './explore.css';

// Exploring your land (#199; cozy-sim feel #291, owner mockup 2026-10-08):
// "Explore" on one of my tiles opens it up close. A camera follows my
// Keeper as it walks (the joystick, a drag anywhere, or a tap on the
// ground), sliding round the rocks, trees and mounds that are the search
// spots. The big button offers what's in front of the Keeper, which uses
// the tool right there: a light gesture overlay (each with an easy way)
// while the world stays in view. The server rolls every find (CLAUDE.md
// rule 1); a common find is a toast and a hop into the bag, a rare one the
// full card.

export interface ExploreScreenOptions {
  root: HTMLElement;
  showScene: (build: SceneBuilder | null) => void;
  /** Draws a few frames after a change (`Stage.invalidate`). */
  invalidate: () => void;
  tier: () => QualityTier;
  /** Dev captures: the tier is pinned (`?tier=`), so ambient life never judges itself too slow. */
  pinned?: () => boolean;
  /** Draws one frame (`Stage.requestFrame`): ambient life (#335) paces itself with this. */
  requestFrame?: () => void;
  /**
   * A burst of work is about to land (`RenderQuality.expectHitch`): the
   * governor ignores the frames around a find instead of cutting (#501 G).
   */
  expectHitch?: () => void;
  keeper: () => KeeperConfig | null;
  keeperWearing?: () => readonly string[];
  /**
   * The tile as the map has it (its buildings), or null. Read when a tile
   * opens, before `onOpen` closes the map (#347).
   */
  mapTile: (at: { q: number; r: number }) => PublicTile | null;
  /** Exploring is for patches: never on the Tutorial Glade. */
  isGlade: (mapId: string) => boolean;
  /** The explore view opened: the map, the bag and the lobby step out. */
  onOpen: (mapId: string) => void;
  /**
   * Back to the map, which shows its own scene: the explore scene stays on
   * screen until it does, so the switch builds no test scene in between
   * (#501 G). If no scene comes, call `showScene(null)`.
   */
  onClosed: (mapId: string) => void;
  /** It couldn't open (offline): say why where the player is looking. */
  onProblem: (message: string) => void;
  /** A search landed things in the bag (the bag, recipe book, lore and milestones look again). */
  onFound?: (mapId: string) => void;
  /** "Open recipe book" on the missing-tool hint: leaves exploring and opens it. */
  onRecipeBook?: () => void;
  /** "Open Lorebook" on a find card with a lore page (#307): the book opens at it, over exploring. */
  onLorebook?: (pageId: string) => void;
  api?: ExploreApi;
  jobs?: Pick<JobsApi, 'view'>;
  bag?: (mapId: string) => Promise<ItemCounts>;
  /** Reduced motion: finds skip their flight into the bag. */
  reducedMotion?: () => boolean;
  /** The open patch's time zone, for the sky (#335); null uses the device's. */
  timeZone?: (mapId: string) => string | null;
  /** The clock (tests pin it). */
  now?: () => Date;
  /** Where Sprout remembers the renamed-tools tip (tests pass their own; null: never shown). */
  storage?: SettingsStorage | null;
}

/** Where Sprout remembers it gave the renamed-tools tip (#335), per account. */
const RENAMED_TIP_KEY = (userId: string) => `heartpatch.explore.renamed-tools.${userId}`;

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface ExploreDebug {
  readonly mapId: string;
  readonly open: boolean;
  readonly tile: { readonly q: number; readonly r: number; readonly terrain: string } | null;
  readonly progress: { readonly searched: number; readonly total: number } | null;
  readonly spots: readonly Pick<PublicSearchSpot, 'index' | 'kind' | 'tool' | 'done' | 'x' | 'z'>[];
  readonly keeper: WorldPoint;
  /** The Keeper's heading, radians (0 faces the camera). */
  readonly yaw: number;
  /** The spot in front of the Keeper (the action button's), or null. */
  readonly near: number | null;
  readonly playing: SpotInteraction | null;
  /** The full card: only for rare finds and a finished tile (#291). */
  readonly card: 'rare' | null;
  /** The find toast on screen, or null. */
  readonly toast: string | null;
  /** The tool the spot in front needs and the bag has none of (the hint shows), or null. */
  readonly hint: ToolId | null;
  readonly scene: ExploreSceneStats | null;
  /**
   * Batch uploads since the page opened (`batchUploads`): each makes fresh
   * instance buffers. Explore has no squishies, so here it's the Keeper's:
   * a find's cheer makes none (#501 G).
   */
  readonly batchUploads: number;
  /**
   * Tier changes the scene applied since the page opened (each rebuilds the
   * Keeper at its detail level): a probe that reverts makes two (#501 G).
   */
  readonly tierChanges: number;
  /** Screen point (CSS pixels) of each spot, to tap in tests. */
  spotOnScreen: (index: number) => { x: number; y: number } | null;
  /** Screen point (CSS pixels) of a tile-local point on the ground, to tap in tests. */
  pointOnScreen: (p: WorldPoint) => { x: number; y: number } | null;
}

export interface ExploreScreen {
  /** The map on screen (null: none). */
  setMap: (mapId: string | null) => void;
  setUser: (user: PublicUser | null) => void;
  /** Opens one of my tiles (or a grey village tile my land touches, #306 2a) up close. */
  open: (at: { q: number; r: number }) => Promise<void>;
  /**
   * It's night on the map (the Hollow's night): a grey village shuts, so
   * exploring one goes back to the map with a word why (#306 2a).
   */
  setNight: (night: boolean) => void;
  /** The tile panel's "Explore" on my land. */
  readonly tileActions: TileActions;
  readonly debug: ExploreDebug | null;
  /** Ambient life on the open tile (the `?fps=1` badge, #501 H), or null while closed. */
  readonly ambient: AmbientStatus | null;
}

interface RareCard {
  readonly found: SearchSpotResponse;
  readonly interaction: SpotInteraction;
}

export function createExploreScreen(options: ExploreScreenOptions): ExploreScreen {
  const api = options.api ?? exploreApi;
  const jobs = options.jobs ?? jobsApi;
  const bagOf = options.bag ?? (async (mapId: string) => (await inventoryApi.get(mapId)).items);
  const reducedMotion =
    options.reducedMotion ?? (() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  let user: PublicUser | null = null;
  let mapId: string | null = null;
  let isOpen = false;
  /** Bumped by every map or user change, so a late reply can't land on another map. */
  let generation = 0;
  let tile: ExploreTileResponse | null = null;
  let teamNames: Record<string, string> = {};
  let scene3d: ExploreScene | null = null;
  /** The map's view of the open tile, read as it opened (#347). */
  let mapTileAtOpen: PublicTile | null = null;
  /** Paces the land's (and the water's) ambient life (#335), like the map's: the motion itself is on the GPU. */
  const ambient = new AmbientDriver({
    target: () => (isOpen ? scene3d : null),
    invalidate: options.invalidate,
    tier: options.tier,
    ...(options.requestFrame ? { requestFrame: options.requestFrame } : {}),
  });
  /** Checks the sky once a minute while exploring (#335). */
  let skyTimer: ReturnType<typeof setInterval> | null = null;
  const tipStorage = options.storage === undefined ? safeStorage() : options.storage;
  /**
   * The open patch's time zone, read before `onOpen` closes the map (the
   * map's view is gone after that), and kept for the visit.
   */
  let zone: string | null = null;
  const skyNow = (): SkyLook =>
    skyLook(
      exploreSkyAt(zone, options.now?.() ?? new Date()),
      tile ? exploreWorld(tile.terrain) : 'ground',
    );
  /** The look last shown, so a quiet minute changes and redraws nothing. */
  let skyShown: SkyLook | null = null;
  let lastTier: QualityTier | null = null;
  let keeperAt: WorldPoint = EXPLORE_VIEW.start;
  let yaw: number = EXPLORE_VIEW.startYaw;
  /** Where a tap sent the Keeper (beside a spot, if it tapped one). */
  let walkTo: WorldPoint | null = null;
  /** The closest a tap-walk has got so far, and how long since it got closer (s). */
  let walkBest = Infinity;
  let walkStall = 0;
  /** The spot the player last tapped: the action button offers it once in reach. */
  let aimed: number | null = null;
  /** The drag steering the Keeper: from where (CSS pixels in the ground layer) to where. */
  let stick: { id: number; x0: number; y0: number; x: number; y: number } | null = null;
  let front: PublicSearchSpot | null = null;
  let playing: { spot: PublicSearchSpot; state: InteractionState } | null = null;
  let card: RareCard | null = null;
  let toast: { main: string; extra: string } | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  /** The bag, read for the missing-tool hint's recipe counts (null: not yet). */
  let bag: ItemCounts | null = null;
  let bagAsked = false;
  /** The tool last in hand: the Keeper keeps holding it while it walks. */
  let lastHeld: ToolId | null = null;
  let working = false;
  let opening = false;
  let frame = 0;
  let panel: { container: HTMLElement; tile: PublicTile } | null = null;
  /** Clears an echo's "Boo!" line after a moment. */
  let spookTimer: ReturnType<typeof setTimeout> | null = null;

  // ── DOM ───────────────────────────────────────────────────────────────
  const back = el(
    'button',
    {
      type: 'button',
      class: 'explore-back',
      'data-testid': 'explore-back',
      'aria-label': EXPLORE_TEXT.back,
    },
    '‹',
  );
  back.addEventListener('click', () => {
    close();
  });
  const title = el('h2', { class: 'explore-title', id: 'explore-title' });
  const progress = el('p', { class: 'explore-progress', 'data-testid': 'explore-progress' });
  // A grey village tile's joy (#306 2a): a little gold meter under the
  // progress, so the header stays one row on a phone.
  const joyFill = el('span', { class: 'explore-joy-fill' });
  const joyMeter = el(
    'span',
    {
      class: 'explore-joy',
      role: 'meter',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'data-testid': 'explore-joy',
    },
    joyFill,
  );
  joyMeter.hidden = true;
  // The tool in hand, short ("🪔 20"); its full name and uses are its label.
  const toolIcon = el('span', { class: 'explore-tool-icon', 'aria-hidden': 'true' });
  const toolUses = el('span', { class: 'explore-tool-uses', 'aria-hidden': 'true' });
  const toolLine = el(
    'span',
    { class: 'explore-tool', role: 'img', 'data-testid': 'explore-tool' },
    toolIcon,
    toolUses,
  );
  const bagCount = el('span', { class: 'explore-bag-count', 'data-testid': 'explore-bag-count' });
  const bagChip = el(
    'span',
    { class: 'explore-bag', role: 'img', 'aria-label': EXPLORE_TEXT.bag },
    el('span', { 'aria-hidden': 'true' }, '🎒'),
    bagCount,
  );
  const top = el(
    'header',
    { class: 'explore-top' },
    back,
    el('div', { class: 'explore-names' }, title, progress, joyMeter),
    toolLine,
    bagChip,
  );

  // The whole screen under the HUD takes the touches: walking, and the
  // gestures while a tool is in use.
  const ground = el('div', { class: 'explore-ground', 'data-testid': 'explore-ground' });
  // The lantern's dark (board g): a circle of light round the Keeper.
  const dark = el('div', { class: 'explore-dark', 'aria-hidden': 'true' });
  // Painted once, moved by a composited transform (`placeLantern`, #501 G).
  const darkLight = el('div', { class: 'explore-dark-light' });
  darkLight.style.setProperty('--light-warm', `${String(Math.round(LIGHT_RING_SHARE * 100))}%`);
  dark.append(darkLight);
  dark.hidden = true;
  const glint = el(
    'button',
    {
      type: 'button',
      class: 'explore-glint',
      'data-testid': 'explore-glint',
      'aria-label': EXPLORE_TEXT.glint,
    },
    '✨',
  );
  glint.hidden = true;
  glint.addEventListener('click', grab);

  // The joystick, always there bottom left (board a); a drag anywhere works too.
  const stickBase = el('div', {
    class: 'explore-stick',
    'aria-hidden': 'true',
    'data-testid': 'explore-stick',
  });
  const stickKnob = el('div', { class: 'explore-stick-knob' });
  stickBase.append(stickKnob);
  const walkHint = el('p', { class: 'explore-walk-hint' }, EXPLORE_TEXT.walkHint);

  const note = el('p', { class: 'explore-note', role: 'status', 'data-testid': 'explore-note' });
  const actionIcon = el('span', { class: 'explore-action-icon', 'aria-hidden': 'true' });
  const actionLabel = el('span', { class: 'explore-action-label' });
  const action = el(
    'button',
    { type: 'button', class: 'explore-action', 'data-testid': 'explore-action' },
    actionIcon,
    actionLabel,
  );
  action.addEventListener('click', () => {
    if (playing?.state.kind === 'light') {
      grab();
      return;
    }
    if (front) begin(front);
  });

  // No tool yet (board h): a hint above the button, not a card.
  const need = el('section', { class: 'explore-need', 'data-testid': 'explore-need' });
  need.hidden = true;
  // A tool gesture (boards b, d, e, f, g): a light overlay over the world.
  const play = el('section', { class: 'explore-play', 'data-testid': 'explore-play' });
  play.hidden = true;
  const toastBox = el('div', {
    class: 'explore-toast',
    role: 'status',
    'data-testid': 'explore-toast',
  });
  toastBox.hidden = true;
  // The full card, only for the big moments (board i).
  const sheet = el('section', {
    class: 'explore-sheet',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'explore-sheet-title',
    'data-testid': 'explore-sheet',
  });
  sheet.hidden = true;

  const overlay = el(
    'div',
    { class: 'explore' },
    ground,
    dark,
    glint,
    stickBase,
    walkHint,
    top,
    toastBox,
    note,
    need,
    action,
    play,
    sheet,
  );
  overlay.hidden = true;
  options.root.append(overlay);

  const say = (text: string) => {
    note.textContent = text;
  };

  // ── Walking and gestures ───────────────────────────────────────────────

  const local = (e: PointerEvent) => {
    const rect = ground.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  /** The tool gesture takes the touches (every one but the lantern's, which walks). */
  const gesturing = () => playing !== null && playing.state.kind !== 'light';
  let press: { id: number; x: number; y: number; moved: boolean; gesture: boolean } | null = null;

  /** Where a drag steers from: the joystick's middle if it started on it, else where it landed. */
  function stickOrigin(p: { x: number; y: number }): { x: number; y: number } {
    const base = stickBase.getBoundingClientRect();
    const rect = ground.getBoundingClientRect();
    const cx = base.left + base.width / 2 - rect.left;
    const cy = base.top + base.height / 2 - rect.top;
    const r = base.width / 2;
    return (p.x - cx) ** 2 + (p.y - cy) ** 2 <= r * r ? { x: cx, y: cy } : p;
  }

  ground.addEventListener('pointerdown', (e) => {
    if (!isOpen || card || press || working) return;
    const p = local(e);
    const gesture = gesturing();
    press = { id: e.pointerId, x: p.x, y: p.y, moved: false, gesture };
    try {
      ground.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't be captured; their moves still arrive.
    }
    if (gesture) {
      feed({ type: 'down', x: p.x, y: p.y, t: performance.now() });
      return;
    }
    // A press on the joystick steers at once.
    const origin = stickOrigin(p);
    if (origin.x !== p.x || origin.y !== p.y) {
      press.moved = true;
      stick = { id: e.pointerId, x0: origin.x, y0: origin.y, x: p.x, y: p.y };
      walkTo = null;
      aimed = null;
      showStick();
      wake();
    }
  });
  ground.addEventListener('pointermove', (e) => {
    if (press?.id !== e.pointerId) return;
    const p = local(e);
    if (press.gesture) {
      feed({ type: 'move', x: p.x, y: p.y, t: performance.now() });
      return;
    }
    const dx = p.x - press.x;
    const dy = p.y - press.y;
    if (!press.moved && dx * dx + dy * dy < EXPLORE_VIEW.tapSlop ** 2) return;
    press.moved = true;
    stick = stick
      ? { ...stick, x: p.x, y: p.y }
      : { id: e.pointerId, x0: press.x, y0: press.y, x: p.x, y: p.y };
    walkTo = null;
    aimed = null;
    showStick();
    wake();
  });
  const release = (e: PointerEvent) => {
    if (press?.id !== e.pointerId) return;
    const was = press;
    press = null;
    if (was.gesture) {
      const p = local(e);
      feed({ type: 'up', x: p.x, y: p.y, t: performance.now() });
      return;
    }
    stick = null;
    showStick();
    if (!was.moved && e.type === 'pointerup') tapGround(was.x, was.y);
  };
  ground.addEventListener('pointerup', release);
  ground.addEventListener('pointercancel', release);

  /** The knob follows the drag inside the joystick's ring. */
  function showStick(): void {
    stickBase.classList.toggle('explore-stick-on', stick !== null);
    if (!stick) {
      stickKnob.style.transform = '';
      return;
    }
    const r = EXPLORE_VIEW.joystick.radius;
    const dx = stick.x - stick.x0;
    const dy = stick.y - stick.y0;
    const d = Math.sqrt(dx * dx + dy * dy);
    const k = d > r ? r / d : 1;
    stickKnob.style.transform = `translate(${String(dx * k)}px, ${String(dy * k)}px)`;
  }

  /** A tap on the ground walks there; a tap on a spot walks up beside it. */
  function tapGround(x: number, y: number): void {
    const point = scene3d?.groundAt(x, y);
    if (!point || !tile) return;
    const spot = spotAtTap(point, tile.spots);
    const goal = spot ? besideSpot(keeperAt, spot, scene3d?.colliders ?? []) : clampToTile(point);
    // Never aim inside a rock: the Keeper would bump it forever.
    walkTo = scene3d ? slideMove(goal, goal, scene3d.colliders) : goal;
    walkBest = Infinity;
    walkStall = 0;
    aimed = spot?.index ?? null;
    wake();
  }

  /** Tier changes applied to the scene (`ExploreDebug.tierChanges`). */
  let tierChanges = 0;

  /** Draws every frame while the Keeper walks or something plays, then stops. */
  let lastFrame = 0;
  function wake(): void {
    if (frame === 0 && isOpen) {
      lastFrame = performance.now();
      frame = requestAnimationFrame(tick);
    }
  }

  function tick(now: number): void {
    frame = 0;
    const s = scene3d;
    if (!s || !isOpen) return;
    const tier = options.tier();
    if (tier !== lastTier) {
      lastTier = tier;
      tierChanges++;
      s.setLod(lodFor('closeUp', tier));
      s.setTier(tier);
    }
    const dt = Math.min(EXPLORE_VIEW.maxFrameStep, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    let walking = false;
    const step = EXPLORE_VIEW.walkSpeed * dt;
    let next = keeperAt;
    let heading: number | undefined;
    if (stick && !gesturing()) {
      const v = joystickVector(stick.x - stick.x0, stick.y - stick.y0);
      if (v.x !== 0 || v.z !== 0) {
        next = slideMove(
          keeperAt,
          { x: keeperAt.x + v.x * step, z: keeperAt.z + v.z * step },
          s.colliders,
        );
        // Faces the way the stick points, even pressed against a rock.
        heading = faceYaw(v.x, v.z);
      }
      walking = true; // keep reading the stick while it's held
    } else if (walkTo && !gesturing()) {
      next = slideMove(keeperAt, stepToward(keeperAt, walkTo, step), s.colliders);
      const moved = next.x !== keeperAt.x || next.z !== keeperAt.z;
      if (moved) heading = yawToward(keeperAt, next);
      const left = Math.hypot(next.x - walkTo.x, next.z - walkTo.z);
      const arrived = left < 1e-4;
      // Sliding round a rock is progress; going nowhere for a moment is not.
      if (left < walkBest - 1e-3) {
        walkBest = left;
        walkStall = 0;
      } else {
        walkStall += dt;
      }
      // A tick with no time to walk (the first after a tap, while ambient life
      // keeps frames coming: its frame began before the tap) isn't stuck.
      if (arrived || (!moved && step > 0) || walkStall > EXPLORE_VIEW.walkGiveUp) {
        walkTo = null;
        // Walked up to a tapped spot: turn to it.
        const spot = tile?.spots.find((x) => x.index === aimed);
        if (spot) heading = yawToward(next, spot);
      } else {
        walking = true;
      }
    }
    // A grey village's echo nudges the Keeper back a step (#306 2a): a
    // lantern in hand keeps it at half the distance.
    if (tile?.community && (walking || next !== keeperAt)) {
      const spooked = s.spook(next, now, heldTool() === 'lantern');
      if (spooked) {
        next = slideMove(keeperAt, spooked.to, s.colliders);
        heading = yawToward(next, spooked.echo);
        walkTo = null;
        spook();
      }
    }
    // By value: a slide that pushes back to where it was isn't a move.
    const moved = next.x !== keeperAt.x || next.z !== keeperAt.z;
    const turned = heading !== undefined && heading !== yaw;
    if (moved || turned) {
      keeperAt = next;
      if (heading !== undefined) yaw = heading;
      s.moveKeeper(keeperAt, yaw);
    }
    if (playing?.state.kind === 'light') {
      // The light goes where the Keeper walks.
      if (moved) {
        feed({ type: 'move', ...toCaveStage(playing.spot, keeperAt), t: now });
      }
    } else {
      findFront();
    }
    if (playing) feed({ type: 'tick', t: now });
    const animating = s.step(now);
    renderDark();
    // Only a change redraws: a finger resting on the stick, or pushing
    // against a rock or the tile's edge, moves nothing (the gestures and the
    // lantern's dark are DOM; a tool's swing animates through `step`).
    if (moved || turned || animating) options.invalidate();
    const holding = playing !== null && playing.state.holdSince !== null;
    if (walking || animating || holding) frame = requestAnimationFrame(tick);
  }

  /** An echo's "Boo!" on the note line, for a moment. */
  function spook(): void {
    say(HOLLOWED_TEXT.spooked);
    if (spookTimer !== null) clearTimeout(spookTimer);
    spookTimer = setTimeout(() => {
      spookTimer = null;
      if (note.textContent === HOLLOWED_TEXT.spooked) say('');
    }, HOLLOWED_EXPLORE.spookedMs);
  }

  /** The spot in front drives the action button, the halo and the tool in hand. */
  function findFront(): void {
    const next = tile ? spotInFront(keeperAt, yaw, tile.spots, aimed) : null;
    if (next?.index === front?.index) return;
    front = next;
    scene3d?.highlight(front?.index ?? null);
    render();
  }

  // ── Using a tool ──────────────────────────────────────────────────────

  /** The tool in the Keeper's hand: the one in use, else the one the spot in front takes. */
  function heldTool(): ToolId | null {
    const t = tile;
    if (!t) return null;
    const usable = (tool: ToolId | null) => tool !== null && t.tools[tool] > 0;
    if (playing) return playing.spot.tool;
    if (front && usable(front.tool)) return front.tool;
    return usable(lastHeld) ? lastHeld : null;
  }

  /** The action button: turn to the spot, take the tool out, and start its gesture. */
  function begin(spot: PublicSearchSpot): void {
    const t = tile;
    const s = scene3d;
    if (!t || !s || working || playing || card) return;
    if (missingTool(spot, t.tools)) return; // the hint says how to make one
    const now = performance.now();
    yaw = yawToward(keeperAt, spot);
    walkTo = null;
    stick = null;
    showStick();
    s.moveKeeper(keeperAt, yaw);
    const kind = actionFor(spot).interaction;
    let state: InteractionState;
    if (kind === 'light') {
      // The reducer's stage is a square round the cave; its glint stays on the tile.
      const fresh = startInteraction(kind, CAVE_STAGE, now, seedOf(spot));
      state = { ...fresh, glint: lanternGlint(spot, fresh.glint, s.colliders) };
      state = stepInteraction(state, { type: 'move', ...toCaveStage(spot, keeperAt), t: now });
    } else {
      const rect = ground.getBoundingClientRect();
      state = startInteraction(
        kind,
        { width: rect.width || 390, height: rect.height || 844 },
        now,
        seedOf(spot),
      );
    }
    playing = { spot, state };
    lastHeld = spot.tool ?? lastHeld;
    s.hold(spot.tool);
    // The lantern walks: the camera follows the Keeper and its light, not the cave.
    s.nudge(spot, kind === 'light');
    s.useTool(now);
    buildPlay(kind);
    render();
    wake();
  }

  function feed(input: InteractionInput): void {
    if (!playing) return;
    const before = playing.state;
    const state = stepInteraction(before, input);
    if (state === before) return;
    playing = { ...playing, state };
    // Every scoop, shake or step up the trail swings the tool.
    if (state.count > before.count) scene3d?.useTool(performance.now());
    if (state.done) {
      const { spot } = playing;
      playing = null;
      void search(spot, state.kind, state.bigSplash);
      return;
    }
    renderPlay();
    if (state.kind === 'light') {
      renderAction();
      renderDark();
    }
    if (state.count > before.count || state.holdSince !== null) wake();
  }

  /** The lantern's "Grab it": takes the glint once the light has found it. */
  function grab(): void {
    const p = playing;
    if (p?.state.kind !== 'light' || !p.state.revealed) return;
    feed({ type: 'down', x: p.state.glint.x, y: p.state.glint.y, t: performance.now() });
  }

  function stopPlaying(): void {
    playing = null;
    scene3d?.nudge(null);
    render();
    wake();
  }

  /** A find's burst of work is about to land: the governor and ambient life's judge let it pass. */
  function expectHitch(): void {
    options.expectHitch?.();
    scene3d?.expectHitch();
  }

  async function search(
    spot: PublicSearchSpot,
    interaction: SpotInteraction,
    bigSplash = false,
  ): Promise<void> {
    const id = mapId;
    const t = tile;
    if (!id || !t || working) return;
    const at = generation;
    working = true;
    // The frames round a find (the tool's last swing, the scene update, the
    // cheer, the card or the flying finds) aren't the GPU's pace (#501 G),
    // nor the device's for ambient life (#501 H).
    expectHitch();
    say(EXPLORE_TEXT.searching);
    render();
    wake();
    try {
      const found = await sendCommand(
        {
          newKey: newIdempotencyKey,
          wait: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
          retryAfterMs: COMMAND_RETRY_MS,
        },
        (key) => api.search(id, { q: t.q, r: t.r, spot: spot.index }, key),
        () => at === generation,
      );
      if (at !== generation || !found || tile?.q !== t.q || tile.r !== t.r) return;
      tile = afterSearch(tile, found);
      bag = found.items;
      expectHitch();
      scene3d?.update(tile);
      scene3d?.cheer(performance.now());
      say('');
      if (findShowsCard(found)) {
        card = { found, interaction };
      } else {
        showToast(found, bigSplash);
        fly(spot, found);
      }
      options.onFound?.(id);
    } catch (err) {
      if (at !== generation) return;
      say(messageOf(err));
      // Searched on another device, or the tool ran out: look again.
      if (err instanceof ApiRequestError && err.code === 'CONFLICT') await reload();
    } finally {
      if (at === generation) {
        working = false;
        scene3d?.nudge(null);
        front = null;
        findFront();
        render();
        wake();
      }
    }
  }

  async function reload(): Promise<void> {
    const id = mapId;
    const t = tile;
    if (!id || !t) return;
    const at = generation;
    try {
      const fresh = await api.tile(id, t);
      if (at !== generation) return;
      tile = fresh;
      scene3d?.update(fresh);
    } catch {
      // The note already says what went wrong.
    }
  }

  /** Reads the bag once for the missing-tool hint's counts. */
  async function askBag(): Promise<void> {
    const id = mapId;
    if (!id || bagAsked) return;
    bagAsked = true;
    const at = generation;
    try {
      const items = await bagOf(id);
      if (at !== generation) return;
      bag = items;
      render();
    } catch {
      // The recipe still shows, without counts.
    }
  }

  // ── Finds ─────────────────────────────────────────────────────────────

  /** The small toast (board c): what landed in the bag and who learned something. */
  function showToast(found: SearchSpotResponse, bigSplash: boolean): void {
    toast = findToast(found, teamNames, bigSplash);
    const n = foundCount(found);
    bagCount.textContent = n > 0 ? `+${String(n)}` : '';
    bagChip.classList.toggle('explore-bag-pop', n > 0);
    // The bag bounces as the finds land in it.
    if (n > 0 && !reducedMotion()) {
      bagChip.animate(
        [
          { transform: 'scale(1)' },
          { transform: `scale(${String(EXPLORE_FIND.bagBounce)})`, offset: 0.4 },
          { transform: 'scale(1)' },
        ],
        {
          duration: EXPLORE_FIND.bagBounceMs,
          delay: EXPLORE_FIND.flyMs - 100,
          easing: 'ease-out',
        },
      );
    }
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastTimer = null;
      toast = null;
      bagCount.textContent = '';
      bagChip.classList.remove('explore-bag-pop');
      renderToast();
    }, EXPLORE_FIND.toastMs);
    renderToast();
  }

  /** Each thing found pops out of the spot and bounces into the bag (DOM; no 3D frames). */
  function fly(spot: PublicSearchSpot, found: SearchSpotResponse): void {
    const from = scene3d?.screenOf(spot, 0.4);
    if (!from || reducedMotion()) return;
    const to = bagChip.getBoundingClientRect();
    const ids = Object.entries(found.found)
      .filter(([, n]) => n > 0)
      .flatMap(([id, n]) => Array.from({ length: n }, () => id))
      .slice(0, EXPLORE_FIND.flyMax);
    ids.forEach((id, i) => {
      const item = el(
        'span',
        { class: 'explore-fly', 'aria-hidden': 'true' },
        itemIconNode(id, 'explore-icon'),
      );
      item.style.left = `${String(from.x)}px`;
      item.style.top = `${String(from.y)}px`;
      overlay.append(item);
      const dx = to.left + to.width / 2 - from.x;
      const dy = to.top + to.height / 2 - from.y;
      const spread = (i - (ids.length - 1) / 2) * EXPLORE_FIND.flySpread;
      const anim = item.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0 },
          {
            transform: `translate(calc(-50% + ${String(spread)}px), calc(-50% - ${String(EXPLORE_FIND.flyLift)}px)) scale(1.2)`,
            opacity: 1,
            offset: 0.3,
          },
          {
            transform: `translate(calc(-50% + ${String(dx)}px), calc(-50% + ${String(dy)}px)) scale(0.6)`,
            opacity: 0.9,
          },
        ],
        {
          duration: EXPLORE_FIND.flyMs,
          delay: i * EXPLORE_FIND.flyStagger,
          easing: 'cubic-bezier(0.3, 0.6, 0.4, 1)',
          fill: 'both',
        },
      );
      anim.onfinish = () => {
        item.remove();
      };
    });
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  function render(): void {
    overlay.hidden = !isOpen;
    if (!isOpen || !tile) return;
    const t = tile;
    // A grey village tile (#306 2a): its name, and today's joy after the progress.
    title.textContent = t.community
      ? HOLLOWED_TEXT.title(t.community.name)
      : terrainName(t.terrain);
    // A village's name is longer than a terrain's: on a narrow phone it takes two lines, never cut off.
    title.classList.toggle('explore-title-village', t.community !== undefined);
    // Under a lake, Back brings the Keeper up for air (#335).
    back.setAttribute(
      'aria-label',
      isUnderwater(t.terrain) ? EXPLORE_TEXT.popUp : EXPLORE_TEXT.back,
    );
    progress.textContent = progressLine(t.progress);
    joyMeter.hidden = !t.community;
    if (t.community) {
      const joy = String(t.community.joy);
      joyMeter.setAttribute('aria-valuenow', joy);
      joyMeter.setAttribute('aria-label', HOLLOWED_TEXT.joy(t.community.joy));
      joyMeter.title = HOLLOWED_TEXT.joy(t.community.joy);
      joyFill.style.setProperty('--joy', String(t.community.joy / 100));
    }
    const held = heldTool();
    if (held) lastHeld = held;
    scene3d?.hold(held);
    const uses = held ? t.tools[held] : 0;
    toolIcon.replaceChildren(exploreIcon(held ? TOOL_ICONS[held] : HANDS_ICON));
    toolUses.textContent = toolChipShort(held, uses);
    toolLine.setAttribute('aria-label', toolChip(held, uses));
    toolLine.classList.toggle('explore-tool-hands', held === null);
    overlay.classList.toggle('explore-gesture', gesturing());
    overlay.classList.toggle('explore-carded', card !== null);
    renderAction();
    renderNeed();
    renderPlay();
    renderSheet();
    renderToast();
    renderDark();
  }

  /** The big button (board a): what's in front of the Keeper, or a nudge to find a glint. */
  function renderAction(): void {
    const t = tile;
    if (!t) return;
    action.classList.remove('explore-action-ready', 'explore-action-missing');
    if (playing?.state.kind === 'light') {
      // In step with the glint: both there once the light has found it.
      const found = playing.state.revealed;
      action.disabled = !found || working;
      action.classList.toggle('explore-action-ready', found);
      actionIcon.textContent = '✨';
      actionLabel.textContent = EXPLORE_TEXT.grab;
      return;
    }
    if (!front) {
      const done = t.progress.total > 0 && t.progress.searched >= t.progress.total;
      action.disabled = true;
      actionIcon.textContent = '✨';
      actionLabel.textContent = done ? EXPLORE_TEXT.allDone : EXPLORE_TEXT.nothingNear;
      return;
    }
    const what = actionFor(front);
    const missing = missingTool(front, t.tools) !== null;
    action.disabled = working || missing;
    action.classList.add(missing ? 'explore-action-missing' : 'explore-action-ready');
    actionIcon.replaceChildren(exploreIcon(what.icon));
    actionLabel.textContent = what.label;
  }

  /** No tool yet (board h): the hint above the button, with the recipe from the bag. */
  function renderNeed(): void {
    const t = tile;
    const tool = !playing && !card && front && t ? missingTool(front, t.tools) : null;
    if (!tool || !front) {
      need.hidden = true;
      need.replaceChildren();
      return;
    }
    if (bag === null) void askBag();
    const rows = toolRecipeRows(tool, bag ?? {});
    const nodes: Node[] = [
      el('p', { class: 'explore-need-title' }, needsHere(front.kind, tool)),
      el(
        'p',
        { class: 'explore-need-recipe', 'data-testid': 'explore-recipe' },
        makeOneLine(rows, bag !== null),
      ),
    ];
    if (options.onRecipeBook) {
      const b = el(
        'button',
        { type: 'button', class: 'explore-need-book', 'data-testid': 'explore-recipe-book' },
        `📖 ${EXPLORE_TEXT.recipeBook}`,
      );
      b.addEventListener('click', () => {
        close();
        options.onRecipeBook?.();
      });
      nodes.push(b);
    }
    need.hidden = false;
    need.dataset['tool'] = tool;
    need.replaceChildren(...nodes);
  }

  let playDots: HTMLElement | null = null;

  /** Builds a gesture's overlay once (boards b, d, e, f, g). */
  function buildPlay(kind: SpotInteraction): void {
    const text = PLAY_TEXT[kind];
    play.dataset['kind'] = kind;
    playDots = el('span', { class: 'explore-dots' });
    const playChip = el(
      'div',
      { class: `explore-chip explore-chip-${kind}`, 'data-testid': 'explore-chip' },
      el('span', { class: 'explore-chip-icon', 'aria-hidden': 'true' }, exploreIcon(text.icon)),
      el('span', { class: 'explore-chip-text' }, text.hint),
      playDots,
    );
    const nodes: Node[] = [playChip];
    if (kind === 'climb') {
      const hand = (side: 'left' | 'right', label: string) => {
        const b = el(
          'button',
          {
            type: 'button',
            class: `explore-hand explore-hand-${side}`,
            'data-testid': `explore-${side}`,
          },
          label,
        );
        b.addEventListener('click', () => {
          feed({ type: 'side', side, t: performance.now() });
        });
        return b;
      };
      nodes.push(
        el('div', { class: 'explore-hands' }, hand('left', 'Left'), hand('right', 'Right')),
      );
    }
    const easy = el(
      'button',
      { type: 'button', class: 'explore-easy', 'data-testid': 'explore-easy' },
      `${EXPLORE_TEXT.easy}: ${text.easy}`,
    );
    easy.addEventListener('click', () => {
      feed({ type: 'easy', t: performance.now() });
    });
    if (kind === 'climb' || kind === 'poke' || kind === 'pick' || kind === 'dive') {
      easy.addEventListener('pointerdown', () => {
        feed({ type: 'easy-down', t: performance.now() });
      });
      for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
        easy.addEventListener(type, () => {
          feed({ type: 'easy-up', t: performance.now() });
        });
      }
    }
    const notNow = el(
      'button',
      { type: 'button', class: 'explore-not-now', 'data-testid': 'explore-not-now' },
      EXPLORE_TEXT.notNow,
    );
    notNow.addEventListener('click', stopPlaying);
    nodes.push(el('div', { class: 'explore-play-row' }, easy, notNow));
    if (text.note) nodes.push(el('p', { class: 'explore-play-note' }, text.note));
    play.replaceChildren(...nodes);
  }

  /** Updates the overlay's count (dots, or a hold's fill). */
  function renderPlay(): void {
    const p = playing;
    play.hidden = p === null || card !== null;
    if (!p) return;
    const s = p.state;
    if (playDots) {
      if (s.need > 1) {
        playDots.setAttribute('aria-label', `${String(s.count)} of ${String(s.need)}`);
        playDots.replaceChildren(
          ...Array.from({ length: s.need }, (_, i) =>
            el('span', { class: `explore-dot${i < s.count ? ' explore-dot-on' : ''}` }),
          ),
        );
      } else if (s.kind === 'lift' || s.kind === 'stack') {
        const fill = el('span', { class: 'explore-hold-fill' });
        fill.style.width = `${String(Math.round(interactionProgress(s) * 100))}%`;
        playDots.replaceChildren(el('span', { class: 'explore-hold' }, fill));
      } else {
        playDots.replaceChildren();
      }
    }
  }

  /** The lantern dark's gradient as painted, or null before (or since) it shows. */
  let darkPaint: DarkPaint | null = null;
  /** The light and glint transforms last written, so a still frame writes nothing. */
  let darkMoved = '';
  let glintMoved = '';

  /**
   * Shows or hides the lantern's dark and the glint, on a state change. Where
   * they sit is `placeDark`'s, on the stage's drawn frames only (#501 G), so
   * this asks for one when either shows.
   */
  function renderDark(): void {
    const s = playing?.state;
    const on = s?.kind === 'light' && !(s.revealed && s.light === null) && card === null;
    // The glint shows once the light has found it, as "Grab it" wakes up.
    const showGlint = s?.kind === 'light' && s.revealed && card === null;
    const shown = (on && dark.hidden) || (showGlint && glint.hidden);
    dark.hidden = !on;
    glint.hidden = !showGlint;
    if (!on && darkPaint !== null) {
      // Next time it shows fully dark until a drawn frame places the light.
      darkPaint = null;
      darkMoved = '';
      darkLight.style.removeProperty('width');
      darkLight.style.removeProperty('height');
      darkLight.style.removeProperty('transform');
      darkLight.style.removeProperty('--light-r');
    }
    if (!showGlint && glintMoved !== '') {
      // Hidden again until a drawn frame places it, never left where it was.
      glintMoved = '';
      glint.style.removeProperty('transform');
    }
    if (glintMoved === '') glint.style.visibility = 'hidden';
    if (shown) options.invalidate();
  }

  /**
   * After each drawn frame: the light round the Keeper and the glint follow
   * the picture just drawn, by composited transforms (no repaint per frame,
   * #501 G). The reveal ring on the ground round the Keeper's feet, and the
   * Keeper itself: the drawn light holds both (lightCircle).
   */
  function placeLantern(): void {
    const p = playing;
    const s = p?.state;
    if (!p || s?.kind !== 'light' || !scene3d || (dark.hidden && glint.hidden)) return;
    if (!dark.hidden) {
      const feet = scene3d.screenOf(keeperAt, 0);
      const head = scene3d.screenOf(keeperAt, scene3d.keeperTall);
      const ring: { x: number; y: number }[] = [];
      for (const [dx, dz] of RING_STEPS) {
        const q = scene3d.screenOf(
          { x: keeperAt.x + dx * LIGHT_REACH, z: keeperAt.z + dz * LIGHT_REACH },
          0,
        );
        if (q) ring.push(q);
      }
      const light = feet && head ? lightCircle(ring, feet, head) : null;
      if (light) {
        const placed = placeDark(
          darkPaint,
          { ...light, r: Math.max(40, light.r) },
          { width: window.innerWidth, height: window.innerHeight },
        );
        if (placed.repaint) {
          darkPaint = placed.paint;
          darkLight.style.width = `${String(placed.paint.width)}px`;
          darkLight.style.height = `${String(placed.paint.height)}px`;
          darkLight.style.setProperty('--light-r', `${String(placed.paint.radius)}px`);
        }
        if (placed.transform !== darkMoved) {
          darkMoved = placed.transform;
          darkLight.style.transform = placed.transform;
        }
      }
    }
    if (!glint.hidden) {
      const g = scene3d.screenOf(fromCaveStage(p.spot, s.glint), 0.1);
      const moved = g
        ? `translate3d(${String(Math.round(g.x))}px, ${String(Math.round(g.y))}px, 0) translate(-50%, -50%)`
        : '';
      if (g && moved !== glintMoved) {
        glintMoved = moved;
        glint.style.transform = moved;
        glint.style.removeProperty('visibility');
      }
    }
  }

  function clearToast(): void {
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = null;
    toast = null;
    bagCount.textContent = '';
    bagChip.classList.remove('explore-bag-pop');
  }

  function renderToast(): void {
    toastBox.hidden = toast === null || card !== null;
    if (!toast) {
      toastBox.replaceChildren();
      return;
    }
    toastBox.replaceChildren(
      el('span', { class: 'explore-toast-main' }, toast.main),
      ...(toast.extra ? [el('span', { class: 'explore-toast-extra' }, toast.extra)] : []),
    );
  }

  /** The full card (board i): a rare find, or the tile done and joining home. */
  function renderSheet(): void {
    const c = card;
    const t = tile;
    if (!c || !t) {
      sheet.hidden = true;
      sheet.replaceChildren();
      return;
    }
    const { found } = c;
    const nodes: Node[] = [
      el('p', { class: 'explore-card-progress' }, progressLine(found.progress)),
      el(
        'h3',
        { class: 'explore-sheet-title', id: 'explore-sheet-title' },
        rareTitle(found, t.terrain),
      ),
    ];
    if (found.explored && found.homestead === 'joined') {
      nodes.push(el('p', { class: 'explore-card-line' }, EXPLORE_TEXT.joinedHome));
    }
    const lines = [
      ...findLines(found),
      ...xpLines(found.xp, teamNames).map((text) => ({ text, note: undefined })),
      ...(found.tool && found.tool.usesLeft === 0
        ? [{ text: restLine(found.tool.id), note: undefined }]
        : []),
    ];
    nodes.push(
      el(
        'ul',
        { class: 'explore-finds', 'data-testid': 'explore-finds' },
        ...lines.map((line) =>
          el(
            'li',
            { class: 'explore-find' },
            line.text,
            ...(line.note ? [el('span', { class: 'explore-find-note' }, line.note)] : []),
          ),
        ),
      ),
    );
    // Where the page went: straight into the Lorebook, at that page (#307).
    const lore = found.lore;
    if (lore && options.onLorebook) {
      const openBook = el(
        'button',
        {
          type: 'button',
          class: 'auth-button auth-button-soft explore-lorebook',
          'data-testid': 'explore-lorebook',
        },
        EXPLORE_TEXT.openLorebook,
      );
      openBook.addEventListener('click', () => {
        card = null;
        render();
        options.onLorebook?.(lore.id);
      });
      nodes.push(openBook);
    }
    const yay = el(
      'button',
      { type: 'button', class: 'auth-button explore-yay', 'data-testid': 'explore-yay' },
      EXPLORE_TEXT.yay,
    );
    yay.addEventListener('click', () => {
      card = null;
      render();
    });
    nodes.push(yay);
    sheet.hidden = false;
    sheet.replaceChildren(...nodes);
  }

  // ── Scene ─────────────────────────────────────────────────────────────

  const build = (scene: Scene): SceneContent => {
    if (!tile) throw new Error('no tile to explore');
    lastTier = options.tier();
    const built = new ExploreScene(scene, tile, {
      lod: lodFor('closeUp', lastTier),
      keeper: options.keeper(),
      keeperWearing: options.keeperWearing?.() ?? [],
      mapTile: mapTileAtOpen,
      sky: (skyShown = skyNow()),
      tier: lastTier,
      pinned: options.pinned?.() ?? false,
      reducedMotion,
      redraw: () => {
        options.invalidate();
      },
    });
    // The start can land on a rock: step out before the Keeper is drawn.
    keeperAt = freePoint(keeperAt, built.colliders);
    built.moveKeeper(keeperAt, yaw);
    scene3d = built;
    // The lantern's light and glint move with the frames the stage draws (#501 G).
    scene.onAfterRenderObservable.add(placeLantern);
    scene.onDisposeObservable.addOnce(() => {
      if (scene3d === built) scene3d = null;
    });
    built.hold(heldTool());
    front = null;
    findFront();
    // Swaying grass, butterflies and fireflies (#335): about 30 frames a second, or still.
    const { tier: startTier, reducedMotion: still } = ambient.state;
    built.setAmbient(startTier, still);
    ambient.start();
    return built.content;
  };

  async function open(at: { q: number; r: number }): Promise<void> {
    const id = mapId;
    // A second quick tap on Explore waits for the first.
    if (!id || isOpen || opening) return;
    opening = true;
    try {
      await openTile(id, at);
    } finally {
      opening = false;
    }
  }

  async function openTile(id: string, at: { q: number; r: number }): Promise<void> {
    const ask = generation;
    zone = options.timeZone?.(id) ?? null;
    let fresh: ExploreTileResponse;
    try {
      const [view, board] = await Promise.all([
        api.tile(id, at),
        // The team's names for the find toast: exploring works without them.
        jobs.view(id).catch(() => null),
      ]);
      if (ask !== generation) return;
      fresh = view;
      teamNames = board?.names ?? {};
    } catch (err) {
      if (ask === generation) options.onProblem(messageOf(err));
      return;
    }
    tile = fresh;
    keeperAt = EXPLORE_VIEW.start;
    yaw = EXPLORE_VIEW.startYaw;
    walkTo = null;
    aimed = null;
    stick = null;
    playing = null;
    card = null;
    front = null;
    bag = null;
    bagAsked = false;
    lastHeld = null;
    clearToast();
    isOpen = true;
    say('');
    // The map's view of the tile, before `onOpen` closes the map and its
    // view goes with it (#347: the tile's buildings never reached the scene).
    mapTileAtOpen = options.mapTile(at);
    options.onOpen(id);
    options.showScene(build);
    if (skyTimer !== null) clearInterval(skyTimer);
    skyTimer = setInterval(() => {
      // A grey village shuts at nightfall (#306 2a). The map, and its night
      // watch, are closed while exploring, so the visit checks its own clock.
      if (tile?.community && villageShut(localMinuteIn(zone, options.now?.() ?? new Date()))) {
        shut();
        return;
      }
      const look = skyNow();
      if (skyShown && sameLook(look, skyShown)) return;
      skyShown = look;
      scene3d?.setSky(look);
      options.invalidate();
    }, 60_000);
    render();
    renamedTip(fresh);
  }

  /**
   * Sprout's one-time tip (#335): a kid who had a Net or a Rope hears they
   * are a Snorkel and a Walking Stick now, the first time they explore.
   */
  function renamedTip(view: ExploreTileResponse): void {
    if (!user || !tipStorage || (view.tools.net <= 0 && view.tools.rope <= 0)) return;
    const key = RENAMED_TIP_KEY(user.id);
    try {
      if (tipStorage.getItem(key) !== null) return;
      tipStorage.setItem(key, '1');
    } catch {
      return;
    }
    toast = { main: EXPLORE_TEXT.renamedTip, extra: EXPLORE_TEXT.renamedTipExtra };
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastTimer = null;
      toast = null;
      renderToast();
    }, EXPLORE_FIND.toastMs * 2);
    renderToast();
  }

  function hide(): void {
    isOpen = false;
    ambient.stop();
    if (skyTimer !== null) clearInterval(skyTimer);
    skyTimer = null;
    // A reply still on its way (a search, a bag read) belongs to this visit:
    // it must never land on the next tile opened.
    generation += 1;
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    press = null;
    stick = null;
    walkTo = null;
    playing = null;
    card = null;
    clearToast();
    if (spookTimer !== null) clearTimeout(spookTimer);
    spookTimer = null;
    // A search left behind (another map, logout) never blocks the next visit.
    working = false;
    scene3d = null;
    mapTileAtOpen = null;
    render();
  }

  /** Nightfall on a grey village tile: back to the map with a word why (#306 2a). */
  function shut(): void {
    if (!isOpen || !tile?.community) return;
    close();
    options.onProblem(HOLLOWED_TEXT.closed);
  }

  function close(): void {
    const id = mapId;
    if (!isOpen) return;
    hide();
    if (id) options.onClosed(id);
    else options.showScene(null);
  }

  // ── Tile panel ────────────────────────────────────────────────────────

  function renderTile(): void {
    if (!panel) return;
    const { container, tile: t } = panel;
    const mine = user !== null && t.ownerUserId === user.id;
    if (!mine || !mapId || options.isGlade(mapId) || !isExplorable(t.terrain, EXPLORE_RULES)) {
      container.replaceChildren();
      return;
    }
    // The button first: it pairs with Go home on one row (map.css), and the
    // lines about the tile sit under the pair.
    const nodes: Node[] = [];
    if (t.homestead === 'joined') {
      nodes.push(el('p', { class: 'tile-action-note' }, EXPLORE_TEXT.homestead));
    } else if (t.homestead === 'paused') {
      nodes.push(el('p', { class: 'tile-action-note' }, `zZ ${EXPLORE_TEXT.pausedHome}`));
    }
    // "Fully explored" and whether it joined home are in the panel's header
    // now (`HOMESTEAD_WORDS`, #242): alone down here it read as joined.
    const go = el(
      'button',
      {
        type: 'button',
        class: 'auth-button bag-action tile-action-pair',
        'data-testid': 'tile-explore',
      },
      `🔍 ${EXPLORE_TEXT.explore}`,
    );
    go.addEventListener('click', () => {
      void open(t);
    });
    container.replaceChildren(go, ...nodes);
  }

  return {
    setMap: (next) => {
      if (next === mapId) return;
      generation += 1;
      mapId = next;
      tile = null;
      if (isOpen) hide();
      renderTile();
    },
    setUser: (next) => {
      if (next?.id === user?.id) return;
      user = next;
      generation += 1;
      mapId = null;
      tile = null;
      if (isOpen) hide();
      renderTile();
    },
    open,
    setNight: (night) => {
      if (night) shut();
    },
    tileActions: {
      show: (container, t) => {
        panel = { container, tile: t };
        renderTile();
      },
      hide: () => {
        panel?.container.replaceChildren();
        panel = null;
      },
    },
    get ambient() {
      return isOpen && scene3d ? scene3d.ambientStatus : null;
    },
    get debug() {
      if (!mapId) return null;
      const s = scene3d;
      return {
        mapId,
        open: isOpen,
        tile: tile ? { q: tile.q, r: tile.r, terrain: tile.terrain } : null,
        progress: tile ? { ...tile.progress } : null,
        spots: (tile?.spots ?? []).map(({ index, kind, tool, done, x, z }) => ({
          index,
          kind,
          tool,
          done,
          x,
          z,
        })),
        keeper: { ...keeperAt },
        yaw,
        near: front?.index ?? null,
        playing: playing?.state.kind ?? null,
        card: card ? ('rare' as const) : null,
        toast: toast ? [toast.main, toast.extra].filter((x) => x).join(' · ') : null,
        hint: need.hidden ? null : ((need.dataset['tool'] as ToolId | undefined) ?? null),
        scene: s?.stats ?? null,
        batchUploads: batchUploads.count,
        tierChanges,
        spotOnScreen: (index: number) => {
          const spot = tile?.spots.find((x) => x.index === index);
          return spot && s ? s.screenOf(spot) : null;
        },
        pointOnScreen: (p: WorldPoint) => (s ? s.screenOf(p) : null),
      };
    },
  };
}

/** Directions round the reveal ring that the drawn light must hold. */
const RING_STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [0.71, 0.71],
  [-0.71, 0.71],
  [0.71, -0.71],
  [-0.71, -0.71],
];

/** An icon: a drawn line icon (`ICON_PATHS`), else the emoji or text itself. */
function exploreIcon(icon: string): Node {
  return iconNode(icon, 'explore-icon');
}

/** Stable 0–1 per spot, so the lantern's glint hides in the same place each time. */
function seedOf(spot: PublicSearchSpot): number {
  return (((spot.index * 2654435761) >>> 0) % 1000) / 1000;
}
