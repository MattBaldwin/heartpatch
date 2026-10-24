import { ELEMENT_FX, elementFx } from '../../battle/element-fx.js';
import { el } from '../../ui/dom.js';
import type { FloorPoint } from './crooked-plan.js';
import { WOKEN_LIGHT } from './crooked-bonus-kit.js';

import './crooked-door-light.css';

// A woken power door's cue (#306, owner 2026-10-24): a soft bright outline of
// the door in its power's colour, with the power's sparkles (embers, leaves,
// droplets, motes) drifting up from it. The house's dark is a DOM layer over
// the whole 3D view, so the cue is drawn over it, like the echoes' eyes, at
// the door's own place in the wall. A frame only moves nodes with transforms:
// the outline is a fixed-size box mapped onto the door's four projected
// corners, and the sparkles ride one translate-and-scale per door. Pure maths
// here; the screen projects the door's points.

/** The door's cue, metres and counts. */
export const DOOR_LIGHT = {
  /** The outline's height and half width: just round the door slab (2.0 × 1.3). */
  doorway: { height: 2.15, half: 0.72 },
  /** How far in front of the wall the outline sits, so the slab never pokes through. */
  lift: 0.1,
  /** The outline is never thinner than this share of its height on screen (a side wall's door is edge-on). */
  slim: 0.32,
  /** The wake pulse: how long it lasts, s, and how much the outline swells. */
  pulse: { seconds: 2.4, swell: 0.12 },
  /** Sparkles a door, and how long one takes to drift up, s (each a little different). */
  sparkles: { count: 6, seconds: 4.2 },
  /** A door this far (px) past the screen's edge is hidden, so its sparkles stop. */
  offscreen: 40,
} as const; // TUNE: all of them

/** Never more sparkles a door than this, whatever the tuning says (older iPads). */
export const MAX_SPARKLES = 8;

/** The outline box's own size, CSS px: about a door's size on a phone, so its border barely stretches. */
export const OUTLINE_BOX = { w: 64, h: 100 } as const;

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

/** A door's cue on screen: its (widened) corners, the outline's CSS transform, and the sparkles' anchor. */
export interface DoorLightLayout {
  readonly corners: readonly [Pt, Pt, Pt, Pt];
  /** `matrix3d(…)` mapping the OUTLINE_BOX onto the corners (transform-origin 0 0). */
  readonly outline: string;
  /** The door's foot middle and its height on screen, px: the sparkles rise from here at this scale. */
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

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * The corners widened about their middles so the outline is at least
 * `slim` of its height across (an edge-on door stays a slim door, not a line).
 */
function widened(fl: Pt, fr: Pt, tl: Pt, tr: Pt): [Pt, Pt, Pt, Pt] {
  const foot = mid(fl, fr);
  const height = Math.hypot(mid(tl, tr).x - foot.x, mid(tl, tr).y - foot.y);
  const across = Math.hypot(fr.x - fl.x, fr.y - fl.y);
  const least = height * DOOR_LIGHT.slim;
  if (across >= least) return [fl, fr, tl, tr];
  // Grow both edges to the least width along the foot's own direction (flat if it has none).
  const dir =
    across > 1e-6 ? { x: (fr.x - fl.x) / across, y: (fr.y - fl.y) / across } : { x: 1, y: 0 };
  const grow = (a: Pt, b: Pt): [Pt, Pt] => {
    const m = mid(a, b);
    const half = least / 2;
    return [
      { x: m.x - dir.x * half, y: m.y - dir.y * half },
      { x: m.x + dir.x * half, y: m.y + dir.y * half },
    ];
  };
  const [l, r] = grow(fl, fr);
  const [tl2, tr2] = grow(tl, tr);
  return [l, r, tl2, tr2];
}

/**
 * The CSS `matrix3d` taking a `w`×`h` box (origin top left) onto a quad:
 * its top left to `tl`, top right to `tr`, bottom right to `br`, bottom left
 * to `bl` (the square-to-quad projective map). Pure.
 */
export function quadTransform(w: number, h: number, tl: Pt, tr: Pt, br: Pt, bl: Pt): string {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y];
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  const affine = Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9;
  const g = affine || det === 0 ? 0 : (dx3 * dy2 - dx2 * dy3) / det;
  const k = affine || det === 0 ? 0 : (dx1 * dy3 - dx3 * dy1) / det;
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + k * x3;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + k * y3;
  const n = (v: number) => String(Number(v.toPrecision(7)));
  // Column-major: u = x / w and v = y / h feed the map.
  return `matrix3d(${[a / w, d / w, 0, g / w, b / h, e / h, 0, k / h, 0, 0, 1, 0, x0, y0, 0, 1].map(n).join(',')})`;
}

/** The door's cue from its projected corners, or null while any is off screen. Pure. */
export function doorLightLayout(p: DoorPoints): DoorLightLayout | null {
  const { footLeft, footRight, topLeft, topRight } = p;
  if (!footLeft || !footRight || !topLeft || !topRight) return null;
  const corners = widened(footLeft, footRight, topLeft, topRight);
  const [fl, fr, tl, tr] = corners;
  const foot = mid(fl, fr);
  const top = mid(tl, tr);
  return {
    corners,
    outline: quadTransform(OUTLINE_BOX.w, OUTLINE_BOX.h, tl, tr, fr, fl),
    foot,
    height: Math.hypot(top.x - foot.x, top.y - foot.y),
  };
}

/** True when a door's cue is well clear of the screen, so it is hidden and its sparkles stop. */
export function offScreen(
  layout: DoorLightLayout,
  view: { readonly width: number; readonly height: number },
): boolean {
  const m = DOOR_LIGHT.offscreen;
  const xs = layout.corners.map((c) => c.x);
  const ys = layout.corners.map((c) => c.y);
  return (
    Math.max(...xs) < -m ||
    Math.min(...xs) > view.width + m ||
    Math.max(...ys) < -m ||
    Math.min(...ys) > view.height + m
  );
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
  readonly outline: HTMLElement;
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
          const outline = el('div', { class: 'crooked-door-outline' });
          const sparks = el('div', { class: 'crooked-door-sparks' });
          const shape = sparkleShape(door.power);
          for (const s of sparkles(door.power)) {
            const bit = el('span', { class: `crooked-door-spark crooked-door-spark-${shape}` });
            bit.style.setProperty('--x', `${r1(s.x * OUTLINE_BOX.w)}px`);
            bit.style.setProperty('--y', `${r1(-s.y * OUTLINE_BOX.h)}px`);
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
          node.style.setProperty('--swell', String(1 + DOOR_LIGHT.pulse.swell));
          node.style.setProperty('--box-w', `${String(OUTLINE_BOX.w)}px`);
          node.style.setProperty('--box-h', `${String(OUTLINE_BOX.h)}px`);
          light = { root: node, outline, sparks, key: '' };
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
        const { outline, foot, height } = door.layout;
        const scale = height / OUTLINE_BOX.h;
        const sparks = `translate(${r1(foot.x)}px, ${r1(foot.y)}px) scale(${String(Math.round(scale * 100) / 100)})`;
        const key = `${outline}|${sparks}`;
        if (key === light.key) continue;
        light.key = key;
        light.outline.style.transform = outline;
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
