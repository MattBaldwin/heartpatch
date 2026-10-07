import type { Scene } from '@babylonjs/core/scene';
import {
  GAME_EVENTS,
  heartSeedOf,
  hexKey,
  type HexKey,
  type LandTending,
  type MapView,
  type PublicTile,
  type PublicUser,
  type WsEventMessage,
} from '@heartpatch/shared';
import { describeItems } from '../inventory/bag-view.js';
import { tileScreenRectOf } from '../map/map-scene.js';
import type { MapLayer, TileActions } from '../map/map-screen.js';
import { el, messageOf } from '../ui/dom.js';
import { landApi, type LandApi } from './land-api.js';
import {
  LAND_TEXT,
  landFade,
  landMarks,
  latestWildNight,
  rippleFade,
  unseenLostFires,
  unseenWild,
  type LandMark,
} from './land-text.js';
import './land.css';

// Land that misses you (owner decision 2026-10-06, design review Q2), as
// the owner approved it in the mockup: my fading land drains towards wild on
// the map with a 💛 or 🍂 mark, a chip says "Some land misses you!" with a
// Visit button that tends all of it (the colour ripples back out from home),
// a welcome-back card says what went wild while I was away, and 🌱 marks it
// until it's claimed again. The server decides all of it (CLAUDE.md rule 1);
// this only shows what it says and sends the tap.

export interface LandScreenOptions {
  root: HTMLElement;
  api?: LandApi;
  /** Draws my fading land part of the way to wild (`MapScreen.setLandFade`). */
  setFade: (fade: ReadonlyMap<HexKey, number>) => void;
  /** The map on screen as I see it (`MapScreen.view`). */
  view: () => MapView | null;
  /** Remembers which night's welcome-back card I've seen per patch (null: nowhere). */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Device wall clock in ms (tests pass a fake). */
  now?: () => number;
  /** Visit's ripple runs on animation frames; tests pass their own. */
  frame?: (draw: () => void) => void;
  reducedMotion?: () => boolean;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface LandDebug {
  readonly mapId: string;
  readonly missing: number;
  readonly wentWild: number;
  readonly chip: boolean;
  readonly welcome: boolean;
  readonly marks: number;
}

export interface LandScreen {
  /** The map on screen (null: none); fetches my land's tending. */
  setMap: (mapId: string | null) => Promise<void>;
  setUser: (user: PublicUser | null) => void;
  /** Every live event, in seq order: land of mine going wild refetches. */
  liveEvent: (event: WsEventMessage) => void;
  /** The marks over my fading and wild-again tiles. */
  readonly layer: MapLayer;
  readonly tileActions: TileActions;
  readonly debug: LandDebug | null;
}

/** Visit's colour ripple, start to end. */
const RIPPLE_MS = 900; // TUNE: the mockup's 0.6–1 s
/** How long the happy toast stays. */
const TOAST_MS = 2600; // TUNE
/** Look again at least this often while the map is open (land starts to miss me). */
const MAX_CHECK_MS = 30 * 60_000;

const seenKey = (userId: string, mapId: string) => `heartpatch.land.seen.${userId}.${mapId}`;

function safeStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createLandScreen(options: LandScreenOptions): LandScreen {
  const api = options.api ?? landApi;
  const storage = options.storage === undefined ? safeStorage() : options.storage;
  const now = options.now ?? (() => Date.now());
  const frame = options.frame ?? ((draw) => void requestAnimationFrame(draw));
  const still =
    options.reducedMotion ?? (() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  let user: PublicUser | null = null;
  let mapId: string | null = null;
  let tending: LandTending | null = null;
  /** Bumped by every map or user change, so a late reply can't land on another map. */
  let generation = 0;
  let working = false;
  /** The newest wild night I said Okay to here, in case storage is blocked. */
  let dismissedNight: string | null = null;
  let checkTimer: ReturnType<typeof setTimeout> | undefined;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let panel: { container: HTMLElement; tile: PublicTile } | null = null;

  const visitButton = el(
    'button',
    { type: 'button', class: 'land-chip-visit', 'data-testid': 'land-visit' },
    LAND_TEXT.visit,
  );
  const chip = el(
    'div',
    { class: 'land-chip', role: 'status', 'data-testid': 'land-chip' },
    el('span', { 'aria-hidden': 'true' }, '💛'),
    el('span', { class: 'land-chip-text' }, LAND_TEXT.chip),
    visitButton,
  );
  chip.hidden = true;
  visitButton.addEventListener('click', () => void visit());

  const toast = el('div', { class: 'land-toast', role: 'status', 'data-testid': 'land-toast' });
  toast.hidden = true;

  const okButton = el(
    'button',
    { type: 'button', class: 'auth-button', 'data-testid': 'land-welcome-ok' },
    LAND_TEXT.ok,
  );
  const welcomeLine = el('p', { class: 'land-line' });
  const welcomeClaim = el('p', { class: 'land-line' });
  const welcomeFire = el('p', { class: 'land-line', 'data-testid': 'land-welcome-fire' });
  const welcomeBack = el('p', { class: 'land-line land-line-small' });
  const welcome = el(
    'div',
    {
      class: 'land-welcome',
      role: 'dialog',
      'aria-labelledby': 'land-welcome-title',
      'data-testid': 'land-welcome',
    },
    el('div', { class: 'land-welcome-icon', 'aria-hidden': 'true' }, '🌱'),
    el('h2', { class: 'land-title', id: 'land-welcome-title' }, LAND_TEXT.welcomeTitle),
    welcomeLine,
    welcomeClaim,
    welcomeFire,
    welcomeBack,
    okButton,
  );
  welcome.hidden = true;
  okButton.addEventListener('click', () => {
    const night = latestWildNight(tending);
    if (user && mapId && night) {
      try {
        storage?.setItem(seenKey(user.id, mapId), night);
      } catch {
        // A blocked store only means the card may show once more.
      }
    }
    dismissedNight = night;
    render();
  });
  options.root.append(chip, toast, welcome);

  const marks = createMarks(options.root);

  const seenNight = (): string | null => {
    let stored: string | null = null;
    if (user && mapId) {
      try {
        stored = storage?.getItem(seenKey(user.id, mapId)) ?? null;
      } catch {
        stored = null;
      }
    }
    if (stored === null) return dismissedNight;
    return dismissedNight !== null && dismissedNight > stored ? dismissedNight : stored;
  };

  /** My Heart Seed on the map on screen, where Visit's ripple starts. */
  const myHome = () => {
    const view = options.view();
    if (!view || !user) return null;
    const me = user.id;
    return heartSeedOf(view.tiles.filter((t) => t.ownerUserId === me && t.homeSlot !== null));
  };

  function render(): void {
    const open = mapId !== null && tending !== null;
    chip.hidden = !open || (tending?.missing.length ?? 0) === 0;
    visitButton.disabled = working;
    const unseen = open ? unseenWild(tending, seenNight()) : 0;
    welcome.hidden = unseen === 0;
    if (unseen > 0) {
      welcomeLine.textContent = LAND_TEXT.welcomeLine(unseen);
      welcomeClaim.textContent = LAND_TEXT.welcomeClaim(unseen);
    }
    const lost = open ? unseenLostFires(tending, seenNight()) : { fires: 0, back: {} };
    welcomeFire.hidden = lost.fires === 0;
    welcomeBack.hidden = lost.fires === 0;
    if (lost.fires > 0) {
      welcomeFire.textContent = LAND_TEXT.welcomeFire(lost.fires);
      welcomeBack.textContent = describeItems(lost.back);
    }
    const view = options.view();
    marks.draw(open ? landMarks(tending, view?.tiles ?? []) : new Map(), view);
    renderPanel();
  }

  function renderPanel(): void {
    if (!panel) return;
    const { container, tile } = panel;
    const key = hexKey(tile);
    const me = user?.id;
    const missing =
      me && tile.ownerUserId === me && tending?.missing.some((t) => hexKey(t) === key);
    const wild =
      tile.ownerUserId === null && tending?.wentWild.some((t) => hexKey(t) === key) === true;
    if (missing) {
      const button = el(
        'button',
        {
          type: 'button',
          class: 'auth-button auth-button-small',
          'data-testid': 'land-tile-visit',
        },
        LAND_TEXT.visit,
      );
      button.disabled = working;
      button.addEventListener('click', () => void visit());
      container.replaceChildren(
        el('p', { class: 'land-panel-title' }, LAND_TEXT.missesTitle),
        el('p', { class: 'land-panel-line' }, LAND_TEXT.missesLine),
        button,
      );
    } else if (wild) {
      container.replaceChildren(
        el('p', { class: 'land-panel-title' }, LAND_TEXT.wildTitle),
        el('p', { class: 'land-panel-line' }, LAND_TEXT.wildLine),
      );
    } else {
      container.replaceChildren();
    }
  }

  /** Shows `fresh` and draws its fade; looks again when land next starts to miss me. */
  function take(fresh: LandTending): void {
    tending = fresh;
    options.setFade(landFade(fresh));
    clearTimeout(checkTimer);
    const next = fresh.nextMissesYouAt
      ? Date.parse(fresh.nextMissesYouAt) - Date.parse(fresh.now)
      : MAX_CHECK_MS;
    checkTimer = setTimeout(() => void refresh(), Math.min(MAX_CHECK_MS, Math.max(60_000, next)));
    render();
  }

  async function refresh(): Promise<void> {
    const id = mapId;
    const at = generation;
    if (!id || !user) return;
    try {
      const fresh = await api.status(id);
      if (at === generation) take(fresh);
    } catch {
      // Tending is a nice-to-have on screen: the next look tries again.
    }
  }

  function showToast(text: string): void {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, TOAST_MS);
  }

  async function visit(): Promise<void> {
    const id = mapId;
    if (!id || working) return;
    const at = generation;
    working = true;
    render();
    const before = landFade(tending);
    try {
      const fresh = await api.visit(id);
      if (at !== generation) return;
      tending = fresh;
      showToast(LAND_TEXT.happy);
      if (still() || before.size === 0) {
        take(fresh);
      } else {
        // The colour comes back outward from home, then the fresh fade takes over.
        const tiles = options.view()?.tiles ?? [];
        const home = myHome();
        const started = now();
        const step = () => {
          if (at !== generation) return;
          const elapsed = now() - started;
          options.setFade(rippleFade(before, tiles, home, elapsed, RIPPLE_MS));
          if (elapsed < RIPPLE_MS) frame(step);
          else take(fresh);
        };
        frame(step);
      }
    } catch (err) {
      if (at === generation) showToast(messageOf(err));
    } finally {
      if (at === generation) {
        working = false;
        render();
      }
    }
  }

  const reset = () => {
    generation += 1;
    tending = null;
    working = false;
    dismissedNight = null;
    clearTimeout(checkTimer);
    options.setFade(new Map());
    render();
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refresh();
  });

  return {
    setMap: async (next) => {
      if (next === mapId) return;
      mapId = next;
      reset();
      await refresh();
    },
    setUser: (next) => {
      if (next?.id === user?.id) return;
      user = next;
      reset();
      void refresh();
    },
    liveEvent: (event) => {
      if (event.mapId !== mapId) return;
      if (event.type === 'tile.captured') {
        // A rival took one of my fading tiles: it's theirs now, so stop drawing it faded.
        const parsed = GAME_EVENTS['tile.captured'].public.safeParse(event.data);
        if (parsed.success && parsed.data.fromUserId === user?.id) void refresh();
        return;
      }
      if (event.type !== 'tile.rewilded') return;
      const parsed = GAME_EVENTS['tile.rewilded'].public.safeParse(event.data);
      if (!parsed.success || parsed.data.userId === user?.id) void refresh();
      else render();
    },
    layer: {
      attach: (scene, view) => {
        marks.attach(scene);
        marks.draw(landMarks(tending, view.tiles), view);
      },
      update: () => {
        render();
      },
    },
    tileActions: {
      show: (container, tile) => {
        panel = { container, tile };
        renderPanel();
      },
      hide: () => {
        panel?.container.replaceChildren();
        panel = null;
      },
    },
    get debug() {
      if (!mapId || !tending) return null;
      return {
        mapId,
        missing: tending.missing.length,
        wentWild: tending.wentWild.length,
        chip: !chip.hidden,
        welcome: !welcome.hidden,
        marks: marks.shown,
      };
    },
  };
}

interface Mark {
  tile: PublicTile;
  node: HTMLElement;
  at: string;
  label: LandMark;
}

/**
 * The marks over tiles, as DOM placed with the map's one tile projection
 * (`tileScreenRectOf`, like the gatherer badges), so the 3D scene stays the
 * terrain lane's. They move only when a frame is drawn.
 */
function createMarks(root: HTMLElement) {
  let scene: Scene | null = null;
  const marks = new Map<HexKey, Mark>();

  const place = (mark: Mark) => {
    const rect = scene ? tileScreenRectOf(scene, mark.tile) : null;
    const seen =
      rect &&
      rect.x + rect.width > 0 &&
      rect.x < window.innerWidth &&
      rect.y + rect.height > 0 &&
      rect.y < window.innerHeight
        ? rect
        : null;
    const at = seen
      ? `${String(Math.round(seen.x + seen.width / 2))},${String(Math.round(seen.y + seen.height / 2))}`
      : 'hidden';
    if (at === mark.at) return;
    mark.at = at;
    mark.node.hidden = seen === null;
    if (seen) {
      const [x, y] = at.split(',');
      mark.node.style.transform = `translate(${x ?? '0'}px, ${y ?? '0'}px) translate(-50%, -50%)`;
    }
  };
  const placeAll = () => {
    for (const mark of marks.values()) place(mark);
  };
  const clear = () => {
    for (const mark of marks.values()) mark.node.remove();
    marks.clear();
  };

  return {
    attach: (next: Scene) => {
      clear();
      scene = next;
      next.onAfterRenderObservable.add(placeAll);
      next.onDisposeObservable.addOnce(() => {
        if (scene !== next) return;
        scene = null;
        clear();
      });
    },
    draw: (wanted: ReadonlyMap<HexKey, LandMark>, view: MapView | null) => {
      const tiles = new Map((view?.tiles ?? []).map((t) => [hexKey(t), t]));
      for (const [key, mark] of marks) {
        if (!wanted.has(key) || !tiles.has(key)) {
          mark.node.remove();
          marks.delete(key);
        }
      }
      if (!scene) return;
      for (const [key, label] of wanted) {
        const tile = tiles.get(key);
        if (!tile) continue;
        const mark = marks.get(key);
        if (mark) {
          mark.tile = tile;
          if (mark.label !== label) mark.node.textContent = label;
          mark.label = label;
          continue;
        }
        const node = el(
          'div',
          { class: 'land-mark', 'aria-hidden': 'true', 'data-testid': 'land-mark' },
          label,
        );
        node.hidden = true;
        root.append(node);
        const added = { tile, node, at: '', label };
        marks.set(key, added);
        place(added);
      }
    },
    get shown() {
      return [...marks.values()].filter((m) => !m.node.hidden).length;
    },
  };
}
