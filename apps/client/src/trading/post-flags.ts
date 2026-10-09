import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { hexKey, hexToWorld, type HexKey, type MapView } from '@heartpatch/shared';
import { HEX_SIZE } from '../map/map-config.js';
import { DOME, TILE_RADIUS, tileScreenRectOf, topOf } from '../map/map-scene.js';
import type { MapLayer } from '../map/map-screen.js';
import { el } from '../ui/dom.js';
import './trading.css';
import { flagSpot } from './flag-spot.js';
import { postFlagLabel, postFlags, type PostFlag } from './post-model.js';

// Trading posts on the map (#269, mockup screen a): a flag over every post
// ("🔗 Acorn Crossing" when my land reaches it, "🏮 Lantern Post · 3 tiles"
// when it's a journey away), and a soft gold ring round the posts my land
// reaches. Flags are a DOM overlay placed with the map's one tile projection
// (`tileScreenRectOf`), like the gatherer badges; they move only when a frame
// is drawn and touch the DOM only when they moved. The rings are a few static
// meshes, so they cost nothing between frames.

export interface PostFlags extends MapLayer {
  /** Flags on screen now (the dev hook). */
  readonly shown: number;
  /** Posts with a gold ring (the dev hook). */
  readonly rings: number;
  /** Each post on screen: its name and its tile's middle in CSS pixels (the dev hook, for taps). */
  readonly onScreen: readonly { name: string; x: number; y: number }[];
}

interface Flag {
  post: PostFlag;
  node: HTMLElement;
  /** Where and what it last showed, so an unchanged flag writes nothing. */
  at: string;
  label: string;
}

/** A flag's size before it has been laid out. */
const FLAG_MIN_WIDTH_PX = 80;
const FLAG_MIN_HEIGHT_PX = 26;
/** The top bar's corner buttons (trays.ts, and the auth chip without trays). */
const TOP_BAR = '.tray-top-left, .tray-top-right, .auth-chip';

/**
 * Where the top bar ends, in CSS pixels from the top (0 when none is shown).
 * Measured, not a constant: its height follows the safe area and, on an iPad
 * in landscape, the trays' layout. Read after the flags' own sizes, so the
 * layout is already fresh.
 */
function topBarBottom(): number {
  let bottom = 0;
  for (const node of document.querySelectorAll(TOP_BAR)) {
    const box = node.getBoundingClientRect();
    if (box.height > 0) bottom = Math.max(bottom, box.bottom);
  }
  return bottom;
}

/** The ring: just inside the tile's rim, lifted clear of the dome. TUNE. */
const RING = { diameter: TILE_RADIUS * 1.84, thickness: 0.045, lift: 0.012, color: '#ffc94d' };

export function createPostFlags(root: HTMLElement, me: () => string | null): PostFlags {
  let scene: Scene | null = null;
  const flags = new Map<HexKey, Flag>();
  const rings = new Map<HexKey, Mesh>();
  let ringMat: StandardMaterial | null = null;

  const place = (flag: Flag, top: number) => {
    const spot = flagSpot(
      scene ? tileScreenRectOf(scene, flag.post.tile) : null,
      {
        width: Math.max(flag.node.offsetWidth, FLAG_MIN_WIDTH_PX),
        height: Math.max(flag.node.offsetHeight, FLAG_MIN_HEIGHT_PX),
      },
      { width: window.innerWidth, height: window.innerHeight, top },
    );
    const at = spot ? `${String(spot.x)},${String(spot.y)}` : 'hidden';
    if (at === flag.at) return;
    flag.at = at;
    flag.node.hidden = spot === null;
    if (spot) {
      flag.node.style.transform = `translate(${String(spot.x)}px, ${String(spot.y)}px) translate(-50%, -100%)`;
    }
  };
  const placeAll = () => {
    const top = topBarBottom();
    for (const flag of flags.values()) place(flag, top);
  };

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
    const wanted = new Map(postFlags(view, me()).map((p) => [hexKey(p.tile), p] as const));
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
        if (flag.label !== label) flag.node.textContent = label;
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
      const added = { post, node, at: '', label };
      flags.set(key, added);
      place(added, topBarBottom());
    }
  };

  const clear = () => {
    for (const flag of flags.values()) flag.node.remove();
    flags.clear();
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
      next.onDisposeObservable.addOnce(() => {
        if (scene !== next) return;
        scene = null;
        clear();
      });
    },
    update: (view) => {
      if (scene) draw(view);
    },
    get shown() {
      return [...flags.values()].filter((f) => !f.node.hidden).length;
    },
    get rings() {
      return rings.size;
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
