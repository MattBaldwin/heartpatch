import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { el } from '../ui/dom.js';
import type { Rect } from '../ui/geometry.js';
import { bankField, bankTop } from './weather-clouds.js';
import { WEATHER_LOOK } from './weather-config.js';
import type { WeatherLayout } from './weather-layout.js';
import './weather.css';

// The map's DOM marks under a storm (#686 follow-ups). The marks and pills are
// DOM over the canvas, so they draw over the clouds and stay readable (the
// W1-9h call). Two things keep that from clashing with the storm:
// - Each bolt's foot gets an empty, see-through box in the DOM
//   (`.weather-bolt-room`). The map's flags and marks already keep clear of
//   everything over the map by its box (`flagRoom`, post-flags.ts), as they
//   keep clear of my Keeper, so a post's pill steps aside rather than sit
//   where a bolt lands.
// - A 🌙 seen through a storm's bank is drawn smaller (`.weather-under-storm`),
//   so twenty of them don't polka-dot the bank. It still shows, a little one.

const MARKS = WEATHER_LOOK.marks;
/** Points tried along the eye's line through a bank's height. */
const SAMPLES = 8;

export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * The points a bolt's room is fitted round (world units): `from` of the way
 * down the bolt, its foot, and four round the foot `pool` bolt lengths out.
 * Bolt `i`'s matrix hangs it from its translation down its y axis.
 */
export function boltRoomPoints(matrices: Float32Array, i: number): Point3[] {
  const o = i * 16;
  const [ax, ay, az] = [matrices[o + 4] ?? 0, matrices[o + 5] ?? 0, matrices[o + 6] ?? 0];
  const [tx, ty, tz] = [matrices[o + 12] ?? 0, matrices[o + 13] ?? 0, matrices[o + 14] ?? 0];
  const foot = { x: tx - ax, y: ty - ay, z: tz - az };
  const r = Math.hypot(ax, ay, az) * MARKS.pool;
  return [
    { x: tx - ax * MARKS.from, y: ty - ay * MARKS.from, z: tz - az * MARKS.from },
    foot,
    { x: foot.x - r, y: foot.y, z: foot.z },
    { x: foot.x + r, y: foot.y, z: foot.z },
    { x: foot.x, y: foot.y, z: foot.z - r },
    { x: foot.x, y: foot.y, z: foot.z + r },
  ];
}

/**
 * Whether the line from `eye` along `dir` passes through one of the first
 * `count` banks (their matrices: a translation at the belly and one scale)
 * on its way down. `top` is a bank's height at scale 1 (`bankTop`).
 */
export function seenThroughBank(
  eye: Point3,
  dir: Point3,
  banks: Float32Array,
  count: number,
  top: number,
): boolean {
  if (dir.y >= 0) return false;
  for (let b = 0; b < count; b++) {
    const o = b * 16;
    const s = banks[o] ?? 0;
    if (s <= 0) continue;
    const [tx, ty, tz] = [banks[o + 12] ?? 0, banks[o + 13] ?? 0, banks[o + 14] ?? 0];
    // Where the line crosses the bank's top and its belly.
    const k0 = (ty + top * s - eye.y) / dir.y;
    const k1 = (ty - eye.y) / dir.y;
    for (let k = 0; k < SAMPLES; k++) {
      const t = k0 + ((k1 - k0) * (k + 0.5)) / SAMPLES;
      const x = (eye.x + dir.x * t - tx) / s;
      const y = (eye.y + dir.y * t - ty) / s;
      const z = (eye.z + dir.z * t - tz) / s;
      if (bankField(x, y, z) < 0) return true;
    }
  }
  return false;
}

export interface StormMarks {
  /** Each drawn frame: the bolts' rooms follow the camera; the 🌙 are looked at every `every` ms. */
  update(scene: Scene, layout: WeatherLayout, bolts: boolean, now: number): void;
  /** Takes the rooms away and gives every 🌙 back its own size. */
  remove(): void;
}

/** Scratch for the projections, which run every drawn frame in a storm. */
const WORLD = new Vector3();
const PROJECTED = new Vector3();
const NEAR = new Vector3();
const FAR = new Vector3();

export function createStormMarks(root: HTMLElement): StormMarks {
  const rooms: { node: HTMLElement; at: string }[] = [];
  let top: number | null = null;
  let lookedAt = -Infinity;
  let shrunk = false;

  const roomFor = (i: number): { node: HTMLElement; at: string } => {
    let room = rooms[i];
    if (!room) {
      const node = el('div', { class: 'weather-bolt-room', 'aria-hidden': 'true' });
      node.hidden = true;
      root.append(node);
      room = { node, at: 'hidden' };
      rooms[i] = room;
    }
    return room;
  };
  const show = (room: { node: HTMLElement; at: string }, box: Rect | null): void => {
    const at = box
      ? `${String(Math.round(box.x))},${String(Math.round(box.y))},${String(Math.round(box.width))},${String(Math.round(box.height))}`
      : 'hidden';
    if (at === room.at) return;
    room.at = at;
    room.node.hidden = box === null;
    if (!box) return;
    const s = room.node.style;
    s.transform = `translate(${String(Math.round(box.x))}px, ${String(Math.round(box.y))}px)`;
    s.width = `${String(Math.round(box.width))}px`;
    s.height = `${String(Math.round(box.height))}px`;
  };
  const unshrink = (): void => {
    if (!shrunk) return;
    shrunk = false;
    for (const moon of document.querySelectorAll('.weather-under-storm')) {
      moon.classList.remove('weather-under-storm');
    }
  };

  return {
    update(scene, layout, bolts, now) {
      const camera = scene.activeCamera;
      const canvas = scene.getEngine().getRenderingCanvas();
      const box = canvas?.getBoundingClientRect();
      const live = camera && box && box.width > 0 && box.height > 0 ? { camera, box } : null;
      const viewport = live?.camera.viewport.toGlobal(live.box.width, live.box.height);
      const transform = live?.camera.getTransformationMatrix();
      const count = bolts ? layout.bolts : 0;
      for (let i = 0; i < Math.max(count, rooms.length); i++) {
        if (i >= count || !live || !viewport || !transform) {
          if (rooms[i]) show(roomFor(i), null);
          continue;
        }
        let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
        let seen = true;
        for (const p of boltRoomPoints(layout.boltMatrices, i)) {
          WORLD.set(p.x, p.y, p.z);
          const s = Vector3.ProjectToRef(
            WORLD,
            Matrix.IdentityReadOnly,
            transform,
            viewport,
            PROJECTED,
          );
          if (s.z < 0 || s.z > 1) seen = false;
          x0 = Math.min(x0, s.x);
          y0 = Math.min(y0, s.y);
          x1 = Math.max(x1, s.x);
          y1 = Math.max(y1, s.y);
        }
        show(
          roomFor(i),
          seen
            ? { x: live.box.left + x0, y: live.box.top + y0, width: x1 - x0, height: y1 - y0 }
            : null,
        );
      }

      if (layout.banks === 0 || !live || !viewport) {
        unshrink();
        return;
      }
      if (now - lookedAt < MARKS.every) return;
      lookedAt = now;
      top ??= bankTop();
      const view = live.camera.getViewMatrix();
      const projection = live.camera.getProjectionMatrix();
      for (const moon of document.querySelectorAll<HTMLElement>('.dark-moon')) {
        if (moon.hidden) continue;
        const r = moon.getBoundingClientRect();
        const sx = r.x + r.width / 2 - live.box.left - viewport.x;
        const sy = r.y + r.height / 2 - live.box.top - viewport.y;
        Vector3.UnprojectToRef(
          WORLD.set(sx, sy, 0),
          viewport.width,
          viewport.height,
          Matrix.IdentityReadOnly,
          view,
          projection,
          NEAR,
        );
        Vector3.UnprojectToRef(
          WORLD.set(sx, sy, 1),
          viewport.width,
          viewport.height,
          Matrix.IdentityReadOnly,
          view,
          projection,
          FAR,
        );
        const under = seenThroughBank(
          NEAR,
          FAR.subtractInPlace(NEAR),
          layout.bankMatrices,
          layout.banks,
          top,
        );
        moon.classList.toggle('weather-under-storm', under);
        if (under) shrunk = true;
      }
    },
    remove() {
      for (const room of rooms) room.node.remove();
      rooms.length = 0;
      unshrink();
    },
  };
}
