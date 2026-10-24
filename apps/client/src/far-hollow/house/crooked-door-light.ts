import { ELEMENT_FX, elementFx } from '../../battle/element-fx.js';
import { el } from '../../ui/dom.js';
import type { FloorPoint } from './crooked-plan.js';
import { WOKEN_LIGHT } from './crooked-bonus-kit.js';

import './crooked-door-light.css';

// A woken power door's cue (#306, owner 2026-10-24): a soft bright outline of
// the doorway in its power's colour, with the power's sparkles (embers,
// leaves, droplets, motes) drifting up from it. The house's dark is a DOM
// layer over the whole 3D view, so the cue is drawn over it, like the echoes'
// eyes, at the door's own place in the wall. A frame only moves nodes with
// transforms: the outline is an upright doorway fitted round the door's
// projected corners (a side wall's door, seen edge-on from above, stays a
// slim door, not a crack), built from glowing pieces that only stretch along
// their length so the glow keeps its width; the sparkles ride one
// translate-and-scale per door. Pure maths here; the screen projects the points.

/** The door's cue, metres, px and counts. */
export const DOOR_LIGHT = {
  /** The outline's height and half width: just round the door slab (2.0 × 1.3). */
  doorway: { height: 2.15, half: 0.72 },
  /** How far in front of the wall the outline sits, so the slab never pokes through. */
  lift: 0.1,
  /** The outline is never narrower than this share of its height on screen (a side wall's door is edge-on). */
  slim: 0.36,
  /** The outline's rounded top corners, and how thick its bright rim is, px. */
  round: 12,
  thick: 3,
  /** The wake pulse: how long it lasts, s. */
  pulse: { seconds: 2.4 },
  /** Sparkles a door, and how long one takes to drift up, s (each a little different). */
  sparkles: { count: 6, seconds: 4.2 },
  /** A door this far (px) past the screen's edge is hidden, so its sparkles stop. */
  offscreen: 40,
} as const; // TUNE: all of them

/** Never more sparkles a door than this, whatever the tuning says (older iPads). */
export const MAX_SPARKLES = 8;

/** The outline pieces' own length (and the sparkles' reference door height), CSS px; a frame scales them from it. */
export const PIECE = 100;

interface Pt {
  readonly x: number;
  readonly y: number;
}

/** Where the door's corners land on screen, CSS px (null while the camera can't see one). */
export interface DoorPoints {
  readonly footLeft: Pt | null;
  readonly footRight: Pt | null;
  readonly topLeft: Pt | null;
  readonly topRight: Pt | null;
}

/** An upright box on screen, CSS px. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A door's cue on screen: the doorway's box, and the sparkles' anchor (its foot middle) and scale (its height). */
export interface DoorLightLayout {
  readonly box: Box;
  readonly foot: Pt;
  readonly height: number;
}

/** The door's corners to project, for a door in the wall at `at`, `inward` into the room: [point, lift in metres]. */
export function doorLightPoints(
  at: FloorPoint,
  inward: FloorPoint,
): Record<keyof DoorPoints, readonly [FloorPoint, number]> {
  const along = { x: -inward.z, z: inward.x };
  const { doorway, lift } = DOOR_LIGHT;
  const on = (u: number): FloorPoint => ({
    x: at.x + along.x * u + inward.x * lift,
    z: at.z + along.z * u + inward.z * lift,
  });
  return {
    footLeft: [on(-doorway.half), 0],
    footRight: [on(doorway.half), 0],
    topLeft: [on(-doorway.half), doorway.height],
    topRight: [on(doorway.half), doorway.height],
  };
}

/** The door's cue from its projected corners, or null while any is off screen. Pure. */
export function doorLightLayout(p: DoorPoints): DoorLightLayout | null {
  const { footLeft, footRight, topLeft, topRight } = p;
  if (!footLeft || !footRight || !topLeft || !topRight) return null;
  const xs = [footLeft.x, footRight.x, topLeft.x, topRight.x];
  const ys = [footLeft.y, footRight.y, topLeft.y, topRight.y];
  const top = Math.min(...ys);
  const height = Math.max(...ys) - top;
  const middle = (Math.min(...xs) + Math.max(...xs)) / 2;
  // Never thinner than a slim door, about its own middle.
  const width = Math.max(Math.max(...xs) - Math.min(...xs), height * DOOR_LIGHT.slim);
  return {
    box: { left: middle - width / 2, top, width, height },
    foot: { x: middle, y: top + height },
    height,
  };
}

/** The outline's pieces: two sides, a top, its two round corners, and a soft fill. */
export type OutlinePiece = 'left' | 'right' | 'top' | 'cornerLeft' | 'cornerRight' | 'fill';

export const OUTLINE_PIECES: readonly OutlinePiece[] = [
  'fill',
  'left',
  'right',
  'top',
  'cornerLeft',
  'cornerRight',
];

/**
 * Each piece's CSS transform for a doorway `box` (transform-origin 0 0). The
 * sides are `thick` px wide and PIECE px long, stretched only along their
 * length; the corners (`round` + `thick` px square) only move; the fill
 * (PIECE square) stretches both ways, being only a soft gradient. Pure.
 */
export function outlineTransforms(box: Box, thick: number): Record<OutlinePiece, string> {
  const r = Math.max(0, Math.min(DOOR_LIGHT.round, box.width / 2, box.height / 2));
  const n = (v: number) => String(Math.round(v * 10) / 10);
  const k = (v: number) => String(Math.round(Math.max(v, 0) * 1000) / 1000);
  const half = thick / 2;
  const right = box.left + box.width;
  const at = (x: number, y: number) => `translate(${n(x)}px, ${n(y)}px)`;
  return {
    fill: `${at(box.left, box.top)} scale(${k(box.width / PIECE)}, ${k(box.height / PIECE)})`,
    left: `${at(box.left - half, box.top + r)} scale(1, ${k((box.height - r) / PIECE)})`,
    right: `${at(right - half, box.top + r)} scale(1, ${k((box.height - r) / PIECE)})`,
    top: `${at(box.left + r, box.top - half)} scale(${k((box.width - 2 * r) / PIECE)}, 1)`,
    cornerLeft: at(box.left - half, box.top - half),
    cornerRight: at(right - r - half, box.top - half),
  };
}

/** True when a door's cue is well clear of the screen, so it is hidden and its sparkles stop. */
export function offScreen(
  layout: DoorLightLayout,
  view: { readonly width: number; readonly height: number },
): boolean {
  const m = DOOR_LIGHT.offscreen;
  const { left, top, width, height } = layout.box;
  return left + width < -m || left > view.width + m || top + height < -m || top > view.height + m;
}

/** A power's colours: its outline glow, and a hotter middle. */
export function doorLightColours(power: string): { glow: string; hot: string } {
  return WOKEN_LIGHT[power] ?? { glow: '#ffffff', hot: '#ffffff' };
}

/** One sparkle: where it starts across the door and up it (shares), when, how long, how far it sways, its size and colour. */
export interface Sparkle {
  readonly x: number;
  readonly y: number;
  readonly delay: number;
  readonly seconds: number;
  readonly sway: number;
  readonly size: number;
  readonly colour: string;
}

/** The sparkles' shape: the power's own battle bit (ember puff, leaf, droplet, star mote). */
export function sparkleShape(power: string): string {
  return (ELEMENT_FX[power] ?? elementFx(null)).shape;
}

/**
 * A door's sparkles, spread evenly (no randomness, so every door and every
 * capture looks the same): they start along the outline's sides and top and
 * are staggered so only a few are up at once. Pure.
 */
export function sparkles(power: string): Sparkle[] {
  const count = Math.min(Math.max(0, Math.floor(DOOR_LIGHT.sparkles.count)), MAX_SPARKLES);
  const { glow, hot } = doorLightColours(power);
  const colours = [hot, glow, (ELEMENT_FX[power] ?? elementFx(null)).colors[0]];
  const base = DOOR_LIGHT.sparkles.seconds;
  return Array.from({ length: count }, (_, i) => {
    // The golden ratio spreads them round the outline without bunching.
    const t = (i * 0.618034) % 1;
    const side = i % 3; // left side, top, right side in turn
    const x = side === 0 ? -0.5 : side === 2 ? 0.5 : t - 0.5;
    const y = side === 1 ? 1 : 0.25 + t * 0.7;
    const seconds = base * (0.85 + ((i * 0.37) % 0.3));
    return {
      x,
      y,
      delay: -(i / Math.max(count, 1)) * seconds,
      seconds,
      sway: (i % 2 === 0 ? 1 : -1) * (6 + (i % 3) * 3),
      size: 7 + (i % 3) * 2,
      colour: colours[i % colours.length] ?? glow,
    };
  });
}

interface Light {
  readonly root: HTMLElement;
  readonly pieces: Record<OutlinePiece, HTMLElement>;
  readonly sparks: HTMLElement;
  /** The last layout written, so a still door costs nothing. */
  key: string;
}

/** The woken doors' cues, one per door, over the dark. */
export interface DoorLights {
  readonly root: HTMLElement;
  /** Shows exactly these doors (`layout` null hides one); `fresh` pulses a door that woke just now. */
  set(
    doors: readonly {
      id: string;
      power: string;
      at: FloorPoint;
      layout: DoorLightLayout | null;
      fresh: boolean;
    }[],
    view: { readonly width: number; readonly height: number },
  ): void;
  /** Where each shown door's cue is now, for the dev hook. */
  readonly debug: () => readonly {
    door: string;
    power: string;
    at: FloorPoint;
    foot: Pt;
    height: number;
    sparkles: number;
  }[];
}

export function createDoorLights(): DoorLights {
  const root = el('div', { class: 'crooked-door-lights', 'aria-hidden': 'true' });
  const lights = new Map<string, Light>();
  const placed = new Map<string, { power: string; at: FloorPoint; layout: DoorLightLayout }>();
  const r1 = (n: number) => String(Math.round(n * 10) / 10);
  return {
    root,
    set(doors, view) {
      const keep = new Set(doors.map((d) => d.id));
      for (const [id, light] of lights) {
        if (keep.has(id)) continue;
        light.root.remove();
        lights.delete(id);
        placed.delete(id);
      }
      for (const door of doors) {
        let light = lights.get(door.id);
        if (!light) {
          const pieces = Object.fromEntries(
            OUTLINE_PIECES.map((name) => [
              name,
              el('span', {
                class: `crooked-door-piece crooked-door-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
              }),
            ]),
          ) as Record<OutlinePiece, HTMLElement>;
          const outline = el('div', { class: 'crooked-door-outline' }, ...Object.values(pieces));
          const sparks = el('div', { class: 'crooked-door-sparks' });
          const shape = sparkleShape(door.power);
          for (const s of sparkles(door.power)) {
            const bit = el('span', { class: `crooked-door-spark crooked-door-spark-${shape}` });
            bit.style.setProperty('--x', `${r1(s.x * PIECE * 0.6)}px`);
            bit.style.setProperty('--y', `${r1(-s.y * PIECE)}px`);
            bit.style.setProperty('--sway', `${r1(s.sway)}px`);
            bit.style.setProperty('--size', `${r1(s.size)}px`);
            bit.style.setProperty('--delay', `${r1(s.delay)}s`);
            bit.style.setProperty('--life', `${r1(s.seconds)}s`);
            bit.style.setProperty('--spark', s.colour);
            sparks.append(bit);
          }
          const node = el(
            'div',
            { class: 'crooked-door-light', 'data-testid': `crooked-door-light-${door.id}` },
            outline,
            sparks,
          );
          const { glow, hot } = doorLightColours(door.power);
          node.style.setProperty('--glow', glow);
          node.style.setProperty('--hot', hot);
          node.style.setProperty('--pulse', `${String(DOOR_LIGHT.pulse.seconds)}s`);
          node.style.setProperty('--thick', `${String(DOOR_LIGHT.thick)}px`);
          node.style.setProperty('--round', `${String(DOOR_LIGHT.round)}px`);
          light = { root: node, pieces, sparks, key: '' };
          lights.set(door.id, light);
          root.append(node);
          // A door that woke just now pulses and settles (CSS; never under reduced motion).
          if (door.fresh) node.classList.add('crooked-door-light-fresh');
        }
        // Off screen, the door is hidden: display none stops its sparkles' animations.
        const shown = door.layout !== null && !offScreen(door.layout, view);
        if (light.root.hidden === shown) light.root.hidden = !shown;
        if (!door.layout || !shown) {
          placed.delete(door.id);
          continue;
        }
        placed.set(door.id, { power: door.power, at: door.at, layout: door.layout });
        const { box, foot, height } = door.layout;
        const outline = outlineTransforms(box, DOOR_LIGHT.thick);
        const scale = Math.round((height / PIECE) * 100) / 100;
        const sparks = `translate(${r1(foot.x)}px, ${r1(foot.y)}px) scale(${String(scale)})`;
        const key = `${Object.values(outline).join('|')}|${sparks}`;
        if (key === light.key) continue;
        light.key = key;
        for (const name of OUTLINE_PIECES) light.pieces[name].style.transform = outline[name];
        light.sparks.style.transform = sparks;
      }
    },
    debug: () =>
      [...placed].map(([door, p]) => ({
        door,
        power: p.power,
        at: p.at,
        foot: p.layout.foot,
        height: p.layout.height,
        sparkles: lights.get(door)?.sparks.childElementCount ?? 0,
      })),
  };
}
