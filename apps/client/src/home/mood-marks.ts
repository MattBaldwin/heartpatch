import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import type { Scene } from '@babylonjs/core/scene';
import type { WorkMood } from '../squishies/jobs/jobs-view.js';
import { el } from '../ui/dom.js';
import { MOOD_CUES } from './home-config.js';
import { createMoodLayoutFrame, ensureMoodLayoutFrame, layoutMoodMarks } from './mood-layout.js';
import type { HomeScene } from './home-scene.js';

// The home's mood bubbles (#393): a small 💕 over each squishy at a job it
// loves and a 🌧️ over each one that isn't keen, on every quality tier, the
// same pair the map's 🧺 badges use. A DOM overlay placed from the scene's
// own projection after each drawn frame (frames are drawn on demand, so a
// still home costs nothing), like the map's badges: no meshes, materials or
// draw calls. Each bubble sits over its own squishy's head with a tail (and a
// stem when it climbed) pointing at it, clear of other squishies' faces and
// bubbles (mood-layout.ts); with no clear spot it waits, hidden. Placing them allocates
// nothing per frame and touches the DOM only when a bubble changed.

export interface MoodMarks {
  /** Follows a home scene's squishies, drawing a bubble over each with a mood. */
  attach: (scene: Scene, home: HomeScene) => void;
  /** The moods changed (a fresh jobs view, a squishy came or went): place again. */
  refresh: () => void;
  /** Bubbles on screen now, by mood (the dev hook). */
  readonly shown: Readonly<Record<WorkMood, number>>;
  /** The last layout, squishy by squishy, nearest first (the dev hook and e2e). */
  readonly layout: readonly MoodMarkLayout[];
}

export interface MoodMarkLayout {
  readonly id: string;
  readonly x: number;
  readonly top: number;
  readonly foot: number;
  readonly face: boolean;
  readonly mood: WorkMood | null;
  /** The bubble's middle and bottom, CSS px, and whether it hid (only with a mood). */
  readonly bx: number | null;
  readonly y: number | null;
  readonly hidden: boolean;
}

interface Mark {
  readonly node: HTMLElement;
  mood: WorkMood;
  /** What it last showed, so an unchanged bubble writes nothing. */
  x: number;
  y: number;
  tail: number;
  stem: number;
  hidden: boolean;
}

export const MOOD_MARK_TEXT: Readonly<Record<WorkMood, string>> = { loves: '💕', meh: '🌧️' };

/** Scratch for placing bubbles every drawn frame (no allocations). */
const TOP = new Vector3();
const FOOT = new Vector3();
const SCREEN = new Vector3();
const VIEWPORT = new Viewport(0, 0, 1, 1);

export function createMoodMarks(root: HTMLElement): MoodMarks {
  let scene: Scene | null = null;
  let home: HomeScene | null = null;
  const marks = new Map<string, Mark>();
  const frame = createMoodLayoutFrame();
  /** Ids in `frame` order (reused). */
  const frameIds: string[] = [];

  const place = () => {
    const s = scene;
    const h = home;
    const moods = h?.moods;
    // (forEach, not for…of: no entry arrays every frame.)
    marks.forEach((mark, id) => {
      const mood = moods?.get(id);
      if (mood && mood === mark.mood) return;
      mark.node.remove();
      marks.delete(id);
    });
    const camera = s?.activeCamera;
    const canvas = s?.getEngine().getRenderingCanvas();
    if (!s || !h || !moods || !camera || !canvas || moods.size === 0) return;
    const box = canvas.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    // `toGlobalToRef` fills VIEWPORT but returns the camera's own (0–1) viewport.
    camera.viewport.toGlobalToRef(box.width, box.height, VIEWPORT);
    const transform = camera.getTransformationMatrix();
    // Every squishy's head and feet on screen, nearest first, then the layout.
    const order = h.drawOrder;
    ensureMoodLayoutFrame(frame, order.length);
    frame.count = 0;
    frameIds.length = 0;
    for (const id of order) {
      if (!h.headAndFeet(id, TOP, FOOT)) continue;
      const i = frame.count++;
      frameIds.push(id);
      Vector3.ProjectToRef(TOP, Matrix.IdentityReadOnly, transform, VIEWPORT, SCREEN);
      frame.x[i] = box.left + SCREEN.x;
      frame.top[i] = box.top + SCREEN.y;
      Vector3.ProjectToRef(FOOT, Matrix.IdentityReadOnly, transform, VIEWPORT, SCREEN);
      frame.foot[i] = box.top + SCREEN.y;
      frame.marked[i] = moods.has(id) ? 1 : 0;
      frame.face[i] = h.tucked(id) ? 0 : 1;
    }
    layoutMoodMarks(frame, MOOD_CUES.marks);
    let i = -1;
    for (const id of order) {
      if (!h.headAndFeet(id, TOP, FOOT)) continue;
      i += 1;
      const mood = moods.get(id);
      if (!mood) continue;
      const x = Math.round(frame.bx[i] ?? 0);
      const y = Math.round(frame.y[i] ?? 0);
      // The tail (and stem) point at its own squishy's head, even when the
      // bubble slid a little to one side; the stem reaches down to the head.
      const tail = Math.round(frame.x[i] ?? 0) - x;
      const stem = Math.max(0, Math.round((frame.top[i] ?? 0) - MOOD_CUES.marks.gap - y));
      const hidden = frame.hidden[i] === 1;
      let mark = marks.get(id);
      if (!mark) {
        const node = el(
          'div',
          {
            class: `home-mood-mark home-mood-${mood}`,
            'aria-hidden': 'true',
            'data-testid': 'home-mood-mark',
            'data-mood': mood,
          },
          MOOD_MARK_TEXT[mood],
        );
        root.append(node);
        mark = { node, mood, x: NaN, y: NaN, tail: NaN, stem: NaN, hidden: false };
        marks.set(id, mark);
      }
      if (mark.x !== x || mark.y !== y) {
        mark.node.style.transform = `translate(${String(x)}px, ${String(y)}px) translate(-50%, -100%)`;
      }
      if (mark.tail !== tail) mark.node.style.setProperty('--tail', `${String(tail)}px`);
      if (mark.stem !== stem) mark.node.style.setProperty('--stem', `${String(stem)}px`);
      if (mark.hidden !== hidden) mark.node.hidden = hidden;
      mark.x = x;
      mark.y = y;
      mark.tail = tail;
      mark.stem = stem;
      mark.hidden = hidden;
    }
  };

  const clear = () => {
    for (const mark of marks.values()) mark.node.remove();
    marks.clear();
  };

  return {
    attach: (next, nextHome) => {
      clear();
      scene = next;
      home = nextHome;
      next.onAfterRenderObservable.add(place);
      next.onDisposeObservable.addOnce(() => {
        if (scene !== next) return;
        scene = null;
        home = null;
        clear();
      });
    },
    refresh: place,
    get layout() {
      const moods = home?.moods;
      return frameIds.map((id, i) => {
        const mood = moods?.get(id) ?? null;
        return {
          id,
          x: Math.round(frame.x[i] ?? 0),
          top: Math.round(frame.top[i] ?? 0),
          foot: Math.round(frame.foot[i] ?? 0),
          face: frame.face[i] === 1,
          mood,
          bx: mood ? Math.round(frame.bx[i] ?? 0) : null,
          y: mood ? Math.round(frame.y[i] ?? 0) : null,
          hidden: mood !== null && frame.hidden[i] === 1,
        };
      });
    },
    get shown() {
      const shown = { loves: 0, meh: 0 };
      for (const mark of marks.values()) if (!mark.hidden) shown[mark.mood] += 1;
      return shown;
    },
  };
}
