import {
  GAME_DATA,
  visualRegistry,
  type CinematicShot,
  type HomeResponse,
  type HouseView,
  type KeeperConfig,
  type PublicUser,
} from '@heartpatch/shared';
import type { Scene } from '@babylonjs/core/scene';
import type { QualityTier } from '../engine/config.js';
import type { SceneBuilder, SceneContent } from '../engine/stage.js';
import { TapDetector } from '../map/tap-detector.js';
import { el, messageOf } from '../ui/dom.js';
import { houseApi, type HouseApi } from './house-api.js';
import {
  blend,
  clampZoom,
  entryGlide,
  fitHouse,
  glidePose,
  kidPose,
  panPerPixel,
  panPose,
  panRange,
  pinchedOut,
  pinchZoom,
  roofAt,
  walkedIn,
  walkZoom,
  type HousePose,
  type HouseViewport,
} from './house-camera.js';
import { HouseScene, type HouseCastMember, type HouseSceneStats } from './house-scene.js';
import { HOUSE_CAMERA } from './house-config.js';
import { createOpenGate } from './house-open-gate.js';
import { HOUSE_TEXT, peekLine } from './house-view.js';
import './house.css';

// The Keeper's house (#381 plan §10): "Go inside" on the home's house card,
// or a tap on the cottage, lifts the roof off and settles above the whole
// dollhouse. Back (or Escape, or a pinch out past the dollhouse) goes home.
// Like the close-up, it owns the screen while open and swaps its scene onto
// the one shared stage.

export interface HouseScreenOptions {
  root: HTMLElement;
  showScene: (build: SceneBuilder | null) => void;
  /** Draws a few frames (`Stage.invalidate`). */
  invalidate: () => void;
  tier: () => QualityTier;
  /** The player's Keeper, standing by the hearth. */
  keeper: () => KeeperConfig | null;
  keeperWearing?: () => readonly string[];
  /** Covered by the account chip at the top of the screen (CSS px from the top). */
  coveredTop?: () => number;
  /** The house opened: home and the map step out. */
  onOpen: (mapId: string) => void;
  /** Back home. */
  onClosed: (mapId: string) => void;
  /** The house couldn't open (offline): say why where the player is looking. */
  onProblem: (message: string) => void;
  api?: HouseApi;
  /** `prefers-reduced-motion` (the dev gallery pins it to skip the glide). */
  reducedMotion?: Pick<MediaQueryList, 'matches'> &
    Partial<Pick<MediaQueryList, 'addEventListener'>>;
  /**
   * Still wanted when the reply lands (home still open on this patch): a
   * player who left Home mid-fetch never gets the house over the map.
   */
  canOpen?: (mapId: string) => boolean;
}

/** Read-only state for the dev hook (Playwright asserts on it, not pixels). */
export interface HouseDebug {
  readonly mapId: string;
  readonly open: boolean;
  readonly level: number;
  readonly rooms: number;
  /** `glide` while the roof lifts off, `walk` while Walk in or Step out moves, else `dollhouse` or `kid`. */
  readonly pose: 'glide' | 'walk' | 'dollhouse' | 'kid';
  readonly zoom: number;
  readonly scene: HouseSceneStats | null;
  /** Residents whose faces the camera sees, of those drawn. */
  readonly faces: { visible: number; total: number } | null;
}

export interface HouseScreen {
  setUser: (user: PublicUser | null) => void;
  /** Opens the house of this patch; the home reply says who the residents are. */
  open: (mapId: string, home: Pick<HomeResponse, 'squishies' | 'speciesDefs'>) => Promise<void>;
  close: () => void;
  readonly isOpen: boolean;
  /** The patch whose house is open, or null (cheap: no scene stats). */
  readonly mapId: string | null;
  readonly debug: HouseDebug | null;
}

export function createHouseScreen(options: HouseScreenOptions): HouseScreen {
  const api = options.api ?? houseApi;
  const registry = visualRegistry(GAME_DATA);
  const reducedMotion =
    options.reducedMotion ?? window.matchMedia('(prefers-reduced-motion: reduce)');
  // Turned on mid-glide: cut to the end, as the close-up does.
  reducedMotion.addEventListener?.('change', () => {
    if (!reducedMotion.matches) return;
    skipGlide();
    if (walk) {
      zoom = walk.goal;
      walk = null;
      renderWalk();
      draw();
    }
  });
  /** One open at a time; a late reply after Back, a logout or another player is dropped. */
  const gate = createOpenGate();

  let user: PublicUser | null = null;
  let mapId: string | null = null;
  let view: HouseView | null = null;
  let cast = new Map<string, HouseCastMember>();
  let isOpen = false;
  let scene3d: HouseScene | null = null;
  let builtTier: QualityTier | null = null;
  /** The fitted dollhouse pose for the screen as it is now. */
  let base: HousePose | null = null;
  /** The dollhouse as fitted, and how far a sideways drag has slid it from there (metres). */
  let fitted: HousePose | null = null;
  let pan = 0;
  let glide: { shot: CinematicShot; start: number | null } | null = null;
  /** Kid height in the focus room, for the screen as it is now. */
  let kid: HousePose | null = null;
  /** 0 the dollhouse, 1 kid height. */
  let zoom = 0;
  /** The floor the dollhouse shows (kid height walks in on the ground floor). */
  let floor = 0;
  /** Walk in or Step out under way: from where, to where, since when (ms). */
  let walk: { from: number; goal: number; start: number | null } | null = null;
  let frame = 0;

  // ── DOM ───────────────────────────────────────────────────────────────
  const touch = el('div', { class: 'house-touch', 'data-testid': 'house-touch' });
  const back = el(
    'button',
    { type: 'button', class: 'house-back', 'data-testid': 'house-back' },
    `‹ ${HOUSE_TEXT.back}`,
  );
  const pill = el('span', { class: 'house-pill', 'data-testid': 'house-pill' });
  const top = el('div', { class: 'house-top' }, back, pill);
  const walkButton = el('button', {
    type: 'button',
    class: 'house-walk',
    'data-testid': 'house-walk',
  });
  // B4 floor switch: shown when the house has more than one floor, in the dollhouse.
  const floorButton = el('button', {
    type: 'button',
    class: 'house-floor',
    'data-testid': 'house-floor',
  });
  const peekText = el('span', { class: 'house-peek-line', 'data-testid': 'house-peek-line' });
  const peek = el(
    'section',
    { class: 'house-peek', 'data-testid': 'house-peek', 'aria-label': HOUSE_TEXT.yourHouse },
    el('span', { class: 'house-peek-handle', 'aria-hidden': 'true' }),
    peekText,
  );
  const overlay = el(
    'div',
    { class: 'house', 'data-testid': 'house', role: 'dialog', 'aria-label': HOUSE_TEXT.yourHouse },
    touch,
    top,
    walkButton,
    floorButton,
    peek,
  );
  overlay.hidden = true;
  options.root.append(overlay);
  back.addEventListener('click', () => {
    close();
  });
  // The button alternative to the pinch (style guide §3.3).
  walkButton.addEventListener('click', () => {
    skipGlide();
    walk = { from: zoom, goal: walkedIn(zoom) ? 0 : 1, start: null };
    renderWalk();
    draw();
  });

  floorButton.addEventListener('click', () => {
    skipGlide();
    showFloor(floor === 0 ? (scene3d?.floors.at(-1) ?? 0) : 0);
  });

  /** The dollhouse shows floor `n` (the floors above taken away) and refits to it. */
  function showFloor(n: number): void {
    floor = n;
    scene3d?.setFloor(n);
    renderFloor();
    refit();
  }

  /** Upstairs or Downstairs: only with more than one floor, and only in the dollhouse. */
  function renderFloor(): void {
    const floors = scene3d?.floors ?? [];
    floorButton.hidden = floors.length < 2 || walk !== null || zoom > 0;
    const up = floor === 0;
    if (floorButton.dataset['up'] === String(up)) return;
    floorButton.dataset['up'] = String(up);
    floorButton.replaceChildren(
      el('span', { 'aria-hidden': 'true' }, up ? '⬆' : '⬇'),
      ` ${up ? 'Upstairs' : 'Downstairs'}`,
    );
  }

  /** Walk in or Step out, by where the camera is going (or is). */
  function renderWalk(): void {
    const inside = walk ? walk.goal === 1 : walkedIn(zoom);
    // The emoji is decoration: screen readers hear just the words.
    walkButton.replaceChildren(
      el(
        'span',
        { class: 'house-walk-icon', 'aria-hidden': 'true' },
        inside ? HOUSE_TEXT.stepOutIcon : HOUSE_TEXT.walkInIcon,
      ),
      ` ${inside ? HOUSE_TEXT.stepOut : HOUSE_TEXT.walkIn}`,
    );
    renderFloor();
  }

  const owner = () => user?.username ?? null;

  function render(): void {
    overlay.hidden = !isOpen;
    if (!isOpen || !view) return;
    top.style.top = `${String(Math.max(0, options.coveredTop?.() ?? 0))}px`;
    pill.textContent = HOUSE_TEXT.pill(view.level);
    peekText.textContent = peekLine(view, owner());
    renderWalk();
  }

  /** The canvas and the bands the HUD covers, for fitting the house between them. */
  function viewport(): HouseViewport {
    const box = overlay.getBoundingClientRect();
    const width = box.width || window.innerWidth;
    const height = box.height || window.innerHeight;
    const topBand = top.getBoundingClientRect().bottom - box.top;
    const bottomBand =
      box.bottom -
      Math.min(peek.getBoundingClientRect().top, walkButton.getBoundingClientRect().top);
    const sheet = Math.max(0, box.bottom - peek.getBoundingClientRect().top);
    return { width, height, top: Math.max(0, topBand), bottom: Math.max(0, bottomBand), sheet };
  }

  // ── Camera ────────────────────────────────────────────────────────────

  /** The pose now: the glide while it plays, then the dollhouse with the pinch's zoom. */
  function poseNow(now: number): HousePose | null {
    if (!base) return null;
    if (glide) {
      glide.start ??= now;
      const local = (now - glide.start) / 1000;
      if (local < glide.shot.duration && !reducedMotion.matches) {
        scene3d?.setRoof(roofAt(local, false));
        return glidePose(glide.shot, local, false);
      }
      glide = null;
      scene3d?.setRoof(1);
    }
    if (walk) {
      walk.start ??= now;
      zoom = walkZoom(walk.from, walk.goal, (now - walk.start) / 1000, reducedMotion.matches);
      if (zoom === walk.goal) walk = null;
      renderWalk();
    }
    return kid ? blend(base, kid, zoom) : base;
  }

  /** Puts the camera where it is now and draws; keeps drawing while the glide plays. */
  function draw(): void {
    if (frame !== 0) return;
    frame = requestAnimationFrame(step);
  }

  function step(now: number): void {
    frame = 0;
    const s = scene3d;
    if (!s || !isOpen) return;
    // The governor stepped the tier: rebuild the house for it (lights, shadows, detail).
    if (builtTier !== null && options.tier() !== builtTier) {
      options.showScene(build);
      return;
    }
    // Kid height walks into the Keeper's room, on the ground floor.
    if (floor !== 0 && (zoom > 0 || walk?.goal === 1)) {
      floor = 0;
      s.setFloor(0);
      fit(s);
    }
    const pose = poseNow(now);
    if (pose) s.setPose(pose, glide ? 0 : clampZoom(zoom));
    renderFloor();
    options.invalidate();
    if (glide || walk) draw();
  }

  /** Refits the dollhouse to the screen (a turn, a resize). */
  function refit(): void {
    if (!isOpen || !scene3d) return;
    fit(scene3d);
    draw();
  }
  window.addEventListener('resize', refit);

  /** The dollhouse and kid-height poses for the screen as it is now. */
  function fit(s: HouseScene): void {
    const vp = viewport();
    const room = s.focusRoom;
    // B4: a tall phone fits the Keeper's room and drags sideways to the rest.
    fitted = fitHouse(s.frameBounds, vp, undefined, room);
    const range = panRange(s.frameBounds, vp, room);
    pan = Math.min(range.max, Math.max(range.min, pan));
    base = panPose(fitted, pan);
    kid = room ? kidPose(room, vp) : null;
    frameOutside(s, base);
  }

  /** Drops trees the dollhouse frame would clip, or that would stand under the top bar. */
  function frameOutside(s: HouseScene, pose: HousePose): void {
    const vp = viewport();
    const height = Math.max(1, vp.height);
    s.frameOutside({ pose, aspect: vp.width / height, topBar: 1 - (2 * vp.top) / height });
  }

  /** Skips the glide to the dollhouse (a tap, or reduced motion). */
  function skipGlide(): void {
    if (!glide) return;
    glide = null;
    scene3d?.setRoof(1);
    draw();
  }

  // ── Gestures ──────────────────────────────────────────────────────────
  // The touch layer covers the canvas, so the stage's map camera never sees
  // a finger: one finger taps (skips the glide), two pinch the zoom.
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { spread: number; zoom: number } | null = null;
  const taps = new TapDetector(() => {
    skipGlide();
  });
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const sample = (e: PointerEvent) => ({
    id: e.pointerId,
    x: e.clientX,
    y: e.clientY,
    t: e.timeStamp,
  });
  touch.addEventListener('pointerdown', (e) => {
    touch.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    taps.pointerDown(sample(e));
    if (pointers.size === 2) {
      skipGlide();
      walk = null;
      pinch = { spread: spread(), zoom };
    }
  });
  touch.addEventListener('pointermove', (e) => {
    const was = pointers.get(e.pointerId);
    if (!was) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // One finger in the dollhouse slides it sideways (a tall phone shows one room or two).
    if (pointers.size === 1 && zoom === 0 && !walk && fitted && scene3d) {
      pan -= (e.clientX - was.x) * panPerPixel(fitted, viewport());
      fit(scene3d);
      draw();
    }
    taps.pointerMove(sample(e));
    if (pinch && pointers.size === 2) {
      zoom = pinchZoom(pinch.zoom, pinch.spread, spread());
      renderWalk();
      draw();
    }
  });
  const lift = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    if (e.type === 'pointercancel') taps.pointerCancel(sample(e));
    else taps.pointerUp(sample(e));
    if (pinch && pointers.size < 2) {
      pinch = null;
      if (pinchedOut(zoom)) {
        close();
        return;
      }
      zoom = clampZoom(zoom);
      draw();
    }
  };
  touch.addEventListener('pointerup', lift);
  touch.addEventListener('pointercancel', lift);
  touch.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      skipGlide();
      walk = null;
      zoom -= e.deltaY / HOUSE_CAMERA.wheelPerZoom;
      if (pinchedOut(zoom)) {
        close();
        return;
      }
      zoom = clampZoom(zoom);
      draw();
    },
    { passive: false },
  );
  window.addEventListener('keydown', (e) => {
    if (isOpen && e.key === 'Escape') close();
  });

  // ── Scene ─────────────────────────────────────────────────────────────

  const build = (scene: Scene): SceneContent => {
    if (!view) throw new Error('no house to build');
    const tier = options.tier();
    const fresh = builtTier === null;
    builtTier = tier;
    const built = new HouseScene(scene, view, {
      tier,
      registry,
      keeper: options.keeper(),
      keeperWearing: options.keeperWearing?.() ?? [],
      cast,
      signText: owner() ? HOUSE_TEXT.sign(owner() ?? '') : HOUSE_TEXT.yourHouse,
    });
    scene3d = built;
    built.setFloor(floor);
    fit(built);
    renderFloor();
    if (!base) throw new Error('no dollhouse pose');
    // The roof lifts off as you arrive; a rebuild for a new tier doesn't glide again.
    glide = fresh && !reducedMotion.matches ? { shot: entryGlide(base), start: null } : null;
    built.setRoof(glide ? 0 : 1);
    const pose = poseNow(performance.now());
    if (pose) built.setPose(pose, glide ? 0 : clampZoom(zoom));
    scene.onDisposeObservable.addOnce(() => {
      built.dispose();
      if (scene3d === built) scene3d = null;
    });
    // The glide waits for the first real frame (shaders compile first).
    scene.onAfterRenderObservable.addOnce(() => {
      draw();
    });
    return built.content;
  };

  async function open(
    id: string,
    home: Pick<HomeResponse, 'squishies' | 'speciesDefs'>,
  ): Promise<void> {
    if (isOpen) return;
    await gate.open(
      () => api.get(id),
      (fresh) => {
        if (isOpen || options.canOpen?.(id) === false) return;
        show(id, fresh, home);
      },
      (err) => {
        options.onProblem(messageOf(err));
      },
    );
  }

  function show(
    id: string,
    fresh: HouseView,
    home: Pick<HomeResponse, 'squishies' | 'speciesDefs'>,
  ): void {
    const species = new Map([...GAME_DATA.species, ...home.speciesDefs].map((s) => [s.id, s]));
    cast = new Map();
    for (const s of home.squishies) {
      const kind = species.get(s.speciesId);
      if (kind) cast.set(s.id, { species: kind, accessory: s.accessory });
    }
    mapId = id;
    view = fresh;
    zoom = 0;
    floor = 0;
    pan = 0;
    walk = null;
    builtTier = null;
    isOpen = true;
    options.onOpen(id);
    render();
    options.showScene(build);
  }

  function hide(): void {
    gate.cancel();
    isOpen = false;
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    glide = null;
    walk = null;
    pointers.clear();
    pinch = null;
    scene3d = null;
    render();
  }

  function close(): void {
    if (!isOpen) return;
    const id = mapId;
    hide();
    options.showScene(null);
    if (id) options.onClosed(id);
  }

  return {
    setUser: (next) => {
      if (next?.id === user?.id) return;
      user = next;
      gate.cancel();
      if (isOpen) hide();
      mapId = null;
      view = null;
    },
    open,
    close,
    get mapId() {
      return isOpen ? mapId : null;
    },
    get isOpen() {
      return isOpen;
    },
    get debug(): HouseDebug | null {
      if (!mapId || !view) return null;
      return {
        mapId,
        open: isOpen,
        level: view.level,
        rooms: view.rooms.length,
        pose: glide ? 'glide' : walk ? 'walk' : walkedIn(zoom) ? 'kid' : 'dollhouse',
        zoom,
        scene: scene3d?.stats ?? null,
        faces: scene3d?.faceReport() ?? null,
      };
    },
  };
}
