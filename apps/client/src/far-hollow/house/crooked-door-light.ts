import { ELEMENT_FX } from '../../battle/element-fx.js';
import { el } from '../../ui/dom.js';
import type { FloorPoint } from './crooked-plan.js';
import { WOKEN_COLOUR } from './crooked-bonus-kit.js';

import './crooked-door-light.css';

// A woken power door's light (#306): the house's dark is a layer over the
// whole 3D view with one hole (the lantern's), so light drawn in 3D elsewhere
// is dimmed to nothing. This light is drawn over the dark, like the echoes'
// eyes, at the door's own place in the wall: a glow filling the doorway and a
// soft spill hugging the wall at its foot, in the power's colour. Nothing
// floats mid-room. Pure layout here; the screen projects the door's points.

/** The door and its spill, metres. */
export const DOOR_LIGHT = {
  /** The doorway's height and half width (the glow's own size). */
  doorway: { height: 1.9, half: 0.6 },
  /** The floor spill: how far into the room it reaches and its half width along the wall. */
  spill: { reach: 1.1, half: 1.1 },
  /** The doorway glow is never thinner than this share of its height on screen (a side wall's door is edge-on). */
  slim: 0.42,
  /** The wake pulse: how long it lasts, s, and how much each glow swells. */
  pulse: { seconds: 2.4, swell: 0.3 },
} as const; // TUNE: all of them

/** Where the door's points land on screen, CSS px (null while the camera can't see them). */
export interface DoorPoints {
  /** The doorway's foot and top in the wall, and the doorway's middle, left and right. */
  readonly foot: Pt | null;
  readonly top: Pt | null;
  readonly left: Pt | null;
  readonly right: Pt | null;
  /** The spill's reach into the room, and its ends along the wall, on the floor. */
  readonly reach: Pt | null;
  readonly sideA: Pt | null;
  readonly sideB: Pt | null;
}

interface Pt {
  readonly x: number;
  readonly y: number;
}

/** An ellipse on screen, CSS px. */
export interface Glow {
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
}

export interface DoorLightLayout {
  readonly doorway: Glow;
  readonly spill: Glow;
}

/** The two glows from the door's projected points, or null while any is off screen. Pure. */
export function doorLightLayout(p: DoorPoints): DoorLightLayout | null {
  const { foot, top, left, right, reach, sideA, sideB } = p;
  if (!foot || !top || !left || !right || !reach || !sideA || !sideB) return null;
  const ry = (Math.abs(foot.y - top.y) / 2) * 1.1;
  const doorway: Glow = {
    cx: (foot.x + top.x) / 2,
    cy: (foot.y + top.y) / 2,
    rx: Math.max(Math.abs(right.x - left.x) / 2, ry * DOOR_LIGHT.slim),
    ry,
  };
  // The pool lies on the floor: its middle is part way in, its reach and ends bound it.
  const spill: Glow = {
    cx: (foot.x + reach.x) / 2,
    cy: (foot.y + reach.y) / 2,
    rx: Math.max(Math.abs(sideA.x - sideB.x) / 2, Math.abs(reach.x - foot.x) / 2, 10),
    ry: Math.max(Math.abs(sideA.y - sideB.y) / 2, Math.abs(reach.y - foot.y) / 2, 10),
  };
  return { doorway, spill };
}

/** The floor points to project for a door in the wall at `at`, `inward` into the room: [point, lift in metres]. */
export function doorLightPoints(
  at: FloorPoint,
  inward: FloorPoint,
): Record<keyof DoorPoints, readonly [FloorPoint, number]> {
  const along = { x: -inward.z, z: inward.x };
  const on = (u: number, v: number): FloorPoint => ({
    x: at.x + along.x * u + inward.x * v,
    z: at.z + along.z * u + inward.z * v,
  });
  const { doorway, spill } = DOOR_LIGHT;
  return {
    foot: [at, 0],
    top: [at, doorway.height],
    left: [on(-doorway.half, 0), doorway.height / 2],
    right: [on(doorway.half, 0), doorway.height / 2],
    reach: [on(0, spill.reach), 0],
    sideA: [on(-spill.half, spill.reach / 2), 0],
    sideB: [on(spill.half, spill.reach / 2), 0],
  };
}

/** A power's colours: the element's own for the glow, lightened for its hot middle. */
export function doorLightColours(power: string): { glow: string; hot: string } {
  return {
    glow: ELEMENT_FX[power]?.colors[0] ?? '#ffffff',
    hot: WOKEN_COLOUR[power] ?? '#ffffff',
  };
}

interface Light {
  readonly root: HTMLElement;
  readonly spill: HTMLElement;
  readonly doorway: HTMLElement;
  /** The last layout written, so a still door costs nothing. */
  key: string;
}

/** The woken doors' lights, one per door, over the dark. */
export interface DoorLights {
  readonly root: HTMLElement;
  /** Shows exactly these doors (`layout` null hides one); `pulse` swells a door that woke just now. */
  set(
    doors: readonly {
      id: string;
      power: string;
      at: FloorPoint;
      layout: DoorLightLayout | null;
      fresh: boolean;
    }[],
  ): void;
  /** Where each door's light is now, for the dev hook. */
  readonly debug: () => readonly {
    door: string;
    power: string;
    at: FloorPoint;
    doorway: Glow;
    spill: Glow;
  }[];
}

export function createDoorLights(): DoorLights {
  const root = el('div', { class: 'crooked-door-lights', 'aria-hidden': 'true' });
  const lights = new Map<string, Light>();
  const placed = new Map<string, { power: string; at: FloorPoint; layout: DoorLightLayout }>();
  const px = (n: number) => `${String(Math.round(n))}px`;
  const put = (node: HTMLElement, g: Glow) => {
    node.style.left = px(g.cx - g.rx);
    node.style.top = px(g.cy - g.ry);
    node.style.width = px(g.rx * 2);
    node.style.height = px(g.ry * 2);
  };
  return {
    root,
    set(doors) {
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
          const spill = el('div', { class: 'crooked-door-spill' });
          const doorway = el('div', { class: 'crooked-door-glow' });
          const node = el(
            'div',
            { class: 'crooked-door-light', 'data-testid': `crooked-door-light-${door.id}` },
            spill,
            doorway,
          );
          const { glow, hot } = doorLightColours(door.power);
          node.style.setProperty('--glow', glow);
          node.style.setProperty('--hot', hot);
          node.style.setProperty('--pulse', `${String(DOOR_LIGHT.pulse.seconds)}s`);
          node.style.setProperty('--swell', String(1 + DOOR_LIGHT.pulse.swell));
          light = { root: node, spill, doorway, key: '' };
          lights.set(door.id, light);
          root.append(node);
          // A door that woke just now swells and settles (CSS; never under reduced motion).
          if (door.fresh) node.classList.add('crooked-door-light-fresh');
        }
        light.root.hidden = door.layout === null;
        if (!door.layout) {
          placed.delete(door.id);
          continue;
        }
        const key = JSON.stringify(door.layout, (_k, v: unknown) =>
          typeof v === 'number' ? Math.round(v) : v,
        );
        placed.set(door.id, { power: door.power, at: door.at, layout: door.layout });
        if (key === light.key) continue;
        light.key = key;
        put(light.spill, door.layout.spill);
        put(light.doorway, door.layout.doorway);
      }
    },
    debug: () =>
      [...placed].map(([door, p]) => ({
        door,
        power: p.power,
        at: p.at,
        doorway: p.layout.doorway,
        spill: p.layout.spill,
      })),
  };
}
