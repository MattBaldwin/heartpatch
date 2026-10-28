import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { hexKey, hexToWorld, type HexKey, type MapView, type PublicTile } from '@heartpatch/shared';
import { homeFlags } from '../home/home-name-view.js';
import { HEX_SIZE } from '../map/map-config.js';
import { findHomeBases } from '../map/map-layout.js';
import { DOME, TILE_RADIUS, tileScreenRectOf, topOf } from '../map/map-scene.js';
import type { MapLayer } from '../map/map-screen.js';
import { boxOf, SHEET_SELECTOR } from '../tutorial/sheets.js';
import { el } from '../ui/dom.js';
import type { Rect } from '../ui/geometry.js';
import './trading.css';
import { flagBox, flagSpot, keeperCover, keeperTile, type FlagRoom } from './flag-spot.js';
import { postFlagLabel, postFlags, type PostFlag } from './post-model.js';

// Trading posts on the map (#269, mockup screen a): a flag over every post
// ("🔗 Acorn Crossing" when my land reaches it, "🏮 Lantern Post · 3 tiles"
// when it's a journey away), and a soft gold ring round the posts my land
// reaches. Flags are a DOM overlay placed with the map's one tile projection
// (`tileScreenRectOf`), like the gatherer badges; they move only when a frame
// is drawn and touch the DOM only when they moved. The rings are a few static
// meshes, so they cost nothing between frames.
//
// Named homes (#306 PR 0) fly a flag too, "🏡 Puddle Corner" over each
// member's Heart Seed. Every flag keeps clear of the others as well as of
// what's over the map: posts are placed first, then homes, and each one
// placed is a cover for the rest, so two flags never overlap.

export interface PostFlags extends MapLayer {
  /** Flags on screen now (the dev hook). */
  readonly shown: number;
  /** Posts with a gold ring (the dev hook). */
  readonly rings: number;
  /** Home flags on screen now (#306, the dev hook): their words and boxes in CSS pixels. */
  readonly homes: readonly { label: string; box: Rect }[];
  /** Every flag on screen now (posts and homes, #306): its box, to check none overlap. */
  readonly boxes: readonly Rect[];
  /** Each post on screen: its name and its tile's middle in CSS pixels (the dev hook, for taps). */
  readonly onScreen: readonly { name: string; x: number; y: number }[];
  /**
   * Each post my land reaches: its name and its tile's middle in CSS pixels, whether or not its
   * flag shows (a flag hides when a tray handle covers both spots beside its tile, #426), for
   * e2e taps (#429).
   */
  readonly connected: readonly { name: string; x: number; y: number }[];
}

interface Flag {
  /** The post it names; null on a home's flag (#306). */
  post: PostFlag | null;
  /** The tile it flies over: the post's, or the home's Heart Seed. */
  tile: PublicTile;
  node: HTMLElement;
  /** Where and what it last showed, so an unchanged flag writes nothing. */
  at: string;
  label: string;
  /** Its size when last shown (a hidden flag measures 0); null until then or after its words change. */
  size: { width: number; height: number } | null;
  /** Where it showed after the last placing (null: hidden), a cover for the flags after it. */
  box: Rect | null;
}

/** Room left between two flags (#306), so pills never touch. TUNE. */
const FLAG_GAP_PX = 4;
const roomy = (box: Rect): Rect => ({
  x: box.x - FLAG_GAP_PX,
  y: box.y - FLAG_GAP_PX,
  width: box.width + FLAG_GAP_PX * 2,
  height: box.height + FLAG_GAP_PX * 2,
});

/** A flag's size before it has been laid out. */
const FLAG_MIN_WIDTH_PX = 80;
const FLAG_MIN_HEIGHT_PX = 26;
/**
 * The top bar's corner buttons, by their always-small parts: with trays up
 * the Keeper chip is a round button whose menu opens below it (the menu is
 * a cover, not the bar); without trays it's the one-row "Hi" chip.
 */
const TOP_BAR =
  '.tray-top-left, .tray-top-right, .auth-chip-toggle, body:not(.hp-trays-on) .auth-chip';
/**
 * Everything over the map: the corner buttons (an open Keeper menu too), the
 * patch name pill, the tray handles (#426), the night's chips (#306), every
 * open sheet or panel, and a storm's bolt feet (weather/storm-marks.ts), so
 * no pill sits where lightning lands.
 */
const OVER_MAP = `.tray-top-left, .tray-top-right, .auth-chip, .map-hud, .tray-handle, .night-chip, .weather-bolt-room, ${SHEET_SELECTOR}`;

/**
 * What a flag must keep clear of, in CSS pixels: where the top bar ends (0
 * with none shown), the boxes of everything over the map and my Keeper (the
 * Heart Seed's tile and the room they stand up into). Measured, not
 * constants: the bar follows the safe area and, on an iPad in landscape, the
 * trays' layout, and sheets differ per screen. Shut ones (hidden, inert, a
 * closed tray) don't count: the tutorial's own test for an open sheet.
 */
export function flagRoom(keeper: Rect | null): FlagRoom {
  let top = 0;
  for (const node of document.querySelectorAll(TOP_BAR)) {
    const box = boxOf(node)?.box;
    if (box) top = Math.max(top, box.y + box.height);
  }
  const covers: Rect[] = [];
  if (keeper) covers.push(keeperCover(keeper));
  for (const node of document.querySelectorAll(OVER_MAP)) {
    const box = boxOf(node)?.box;
    if (box) covers.push(box);
  }
  return { width: window.innerWidth, height: window.innerHeight, top, covers };
}

/** The ring: just inside the tile's rim, lifted clear of the dome. TUNE. */
const RING = { diameter: TILE_RADIUS * 1.84, thickness: 0.045, lift: 0.012, color: '#ffc94d' };

export function createPostFlags(root: HTMLElement, me: () => string | null): PostFlags {
  let scene: Scene | null = null;
  const flags = new Map<HexKey, Flag & { post: PostFlag }>();
  /** Named homes' flags (#306), by member; placed after the posts'. */
  const homes = new Map<string, Flag>();
  const rings = new Map<HexKey, Mesh>();
  /** My Heart Seed's tile, where my Keeper stands; null with no land here. */
  let seed: PublicTile | null = null;
  let ringMat: StandardMaterial | null = null;

  const place = (flag: Flag, room: FlagRoom) => {
    if (flag.node.offsetWidth > 0) {
      flag.size = { width: flag.node.offsetWidth, height: flag.node.offsetHeight };
    }
    const size = flag.size ?? { width: FLAG_MIN_WIDTH_PX, height: FLAG_MIN_HEIGHT_PX };
    const rect = scene ? tileScreenRectOf(scene, flag.tile) : null;
    // My own home's flag flies over my Keeper, who stands on its Heart Seed (#306).
    const mine = rect && flag.post === null && seed && hexKey(seed) === hexKey(flag.tile);
    const spot = flagSpot(mine ? keeperTile(rect) : rect, size, room);
    flag.box = spot ? flagBox(spot, size) : null;
    const at = spot ? `${String(spot.x)},${String(spot.y)}` : 'hidden';
    if (at === flag.at) return;
    flag.at = at;
    const wasHidden = flag.node.hidden;
    flag.node.hidden = spot === null;
    if (spot) {
      flag.node.style.transform = `translate(${String(spot.x)}px, ${String(spot.y)}px) translate(-50%, -100%)`;
      // A flag never shown yet was placed by the stand-in size: now it shows,
      // place it again by its own (it may run off the edge or into the patch
      // name, and an idle map draws no frame to fix it).
      if (wasHidden) place(flag, room);
    }
  };
  const measure = () => flagRoom(scene && seed ? tileScreenRectOf(scene, seed) : null);
  /** Places every flag, posts first, each one placed a cover for the next (#306: none overlap). */
  const placeAll = () => {
    if (flags.size === 0 && homes.size === 0) return;
    const room = measure();
    const covers = [...room.covers];
    const next = { ...room, covers };
    for (const flag of [...flags.values(), ...homes.values()]) {
      place(flag, next);
      if (flag.box) covers.push(roomy(flag.box));
    }
  };
  // A sheet opening or shutting over an idle map draws no frame, so watch
  // for it and look again once on the next frame, like the tutorial's own
  // watch: sheets show and shut by `hidden`, trays by `inert` and a class
  // they drop once their slide ends, the Keeper menu by a class. A flag's
  // own changes are skipped.
  let recheck = 0;
  const covers = new MutationObserver((changes) => {
    if (recheck || !scene) return;
    if (
      changes.every(
        (c) => c.target instanceof HTMLElement && c.target.classList.contains('post-flag'),
      )
    ) {
      return;
    }
    recheck = requestAnimationFrame(() => {
      recheck = 0;
      if (scene) placeAll();
    });
  });

  const ringFor = (target: Scene, flag: PostFlag): Mesh => {
    // Six sides with a corner on +x: the same hex as the tiles.
    const ring = CreateTorus(
      `post-ring-${hexKey(flag.tile)}`,
      { diameter: RING.diameter, thickness: RING.thickness, tessellation: 6 },
      target,
    );
    ringMat ??= (() => {
      const m = new StandardMaterial('post-ring-mat', target);
      m.disableLighting = true;
      m.emissiveColor = Color3.FromHexString(RING.color).toLinearSpace();
      return m;
    })();
    ring.material = ringMat;
    const p = hexToWorld(flag.tile, HEX_SIZE);
    ring.position.set(p.x, topOf(flag.tile) + DOME + RING.lift, p.z);
    ring.isPickable = false;
    ring.freezeWorldMatrix();
    return ring;
  };

  /** Matches flags and rings to the view's posts and how I reach them now. */
  const draw = (view: MapView) => {
    let changed = false;
    const mine = me();
    seed =
      mine === null
        ? null
        : (findHomeBases(view.tiles).find((h) => h.seed.ownerUserId === mine)?.seed ?? null);
    const wanted = new Map(postFlags(view, mine).map((p) => [hexKey(p.tile), p] as const));
    const named = new Map(homeFlags(view).map((h) => [h.userId, h] as const));
    for (const [id, flag] of homes) {
      if (!named.has(id)) {
        flag.node.remove();
        homes.delete(id);
      }
    }
    for (const [key, flag] of flags) {
      if (!wanted.has(key)) {
        flag.node.remove();
        flags.delete(key);
      }
    }
    for (const [key, ring] of rings) {
      if (wanted.get(key)?.reach?.kind !== 'connected') {
        ring.dispose();
        rings.delete(key);
      }
    }
    for (const [key, post] of wanted) {
      if (scene && post.reach?.kind === 'connected' && !rings.has(key)) {
        rings.set(key, ringFor(scene, post));
      }
      const label = postFlagLabel(post);
      const connected = post.reach?.kind === 'connected';
      const flag = flags.get(key);
      if (flag) {
        flag.post = post;
        flag.tile = post.tile;
        if (flag.label !== label) {
          flag.node.textContent = label;
          flag.size = null;
        }
        flag.label = label;
        flag.node.classList.toggle('post-flag-connected', connected);
        continue;
      }
      const node = el(
        'div',
        {
          class: connected ? 'post-flag post-flag-connected' : 'post-flag',
          'aria-hidden': 'true',
          'data-testid': 'post-flag',
        },
        label,
      );
      node.hidden = true;
      root.append(node);
      const added = { post, tile: post.tile, node, at: '', label, size: null, box: null };
      flags.set(key, added);
      changed = true;
    }
    for (const [id, home] of named) {
      const flag = homes.get(id);
      if (flag) {
        flag.tile = home.tile;
        if (flag.label !== home.label) {
          flag.node.textContent = home.label;
          flag.size = null;
          flag.label = home.label;
          changed = true;
        }
        continue;
      }
      const node = el(
        'div',
        { class: 'post-flag home-flag', 'aria-hidden': 'true', 'data-testid': 'home-flag' },
        home.label,
      );
      node.hidden = true;
      root.append(node);
      homes.set(id, {
        post: null,
        tile: home.tile,
        node,
        at: '',
        label: home.label,
        size: null,
        box: null,
      });
      changed = true;
    }
    // New or reworded flags: place everything again, so they keep clear of each other.
    if (changed) placeAll();
  };

  const clear = () => {
    for (const flag of [...flags.values(), ...homes.values()]) flag.node.remove();
    flags.clear();
    homes.clear();
    seed = null;
    // The rings go with their scene; just forget them.
    rings.clear();
    ringMat = null;
  };

  return {
    attach: (next, view) => {
      clear();
      scene = next;
      draw(view);
      next.onAfterRenderObservable.add(placeAll);
      covers.observe(document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: ['hidden', 'inert', 'class'],
      });
      next.onDisposeObservable.addOnce(() => {
        if (scene !== next) return;
        scene = null;
        covers.disconnect();
        clear();
      });
    },
    update: (view) => {
      if (scene) draw(view);
    },
    get shown() {
      return [...flags.values()].filter((f) => !f.node.hidden).length;
    },
    get homes() {
      return [...homes.values()].flatMap((f) =>
        f.box && !f.node.hidden ? [{ label: f.label, box: f.box }] : [],
      );
    },
    get boxes() {
      return [...flags.values(), ...homes.values()].flatMap((f) =>
        f.box && !f.node.hidden ? [f.box] : [],
      );
    },
    get rings() {
      return rings.size;
    },
    get connected() {
      return [...flags.values()].flatMap((f) => {
        const rect =
          scene && f.post.reach?.kind === 'connected' ? tileScreenRectOf(scene, f.post.tile) : null;
        return rect
          ? [{ name: f.post.name, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }]
          : [];
      });
    },
    get onScreen() {
      return [...flags.values()].flatMap((f) => {
        const rect = scene && !f.node.hidden ? tileScreenRectOf(scene, f.post.tile) : null;
        return rect
          ? [{ name: f.post.name, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }]
          : [];
      });
    },
  };
}
