import type { Species, VisualRegistry } from '@heartpatch/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPortraits, inUse, opaqueBox } from './portraits.js';

// The portrait scene, as small as the draw's lifecycle needs (no WebGL here).
const scenes: { disposed: boolean }[] = [];
/** When a scene is ready: at once, unless a test says never (as Babylon's own wait can be). */
let whenReady = () => Promise.resolve();
let shots: { resolve: (url: string) => void; timeOut: () => void }[] = [];
vi.mock('@babylonjs/core/scene', () => ({
  Scene: class {
    isDisposed = false;
    clearColor: unknown = null;
    activeCamera: unknown = null;
    constructor() {
      scenes.push(this as unknown as { disposed: boolean });
    }
    whenReadyAsync() {
      return whenReady();
    }
    dispose() {
      this.isDisposed = true;
      (this as unknown as { disposed: boolean }).disposed = true;
    }
  },
}));
vi.mock('@babylonjs/core/Cameras/targetCamera', () => ({
  TargetCamera: class {
    position = { set: () => undefined };
    fov = 0;
    minZ = 0;
    setTarget() {
      return undefined;
    }
  },
}));
// A snapshot that finishes (or times out) only when the test says so (a slow device).
vi.mock('@babylonjs/core/Misc/screenshotTools', () => ({
  CreateScreenshotUsingRenderTarget: (...args: unknown[]) => {
    shots.push({
      resolve: args[3] as (url: string) => void,
      timeOut: args[15] as () => void,
    });
  },
}));
vi.mock('../engine/lighting/lighting.js', () => ({ setupLighting: () => undefined }));
vi.mock('./accessory.js', () => ({ accessoryItem: () => null }));
vi.mock('../close-up/close-up-view.js', () => ({
  cameraFor: () => ({ position: { x: 0, y: 0, z: 5 }, target: { x: 0, y: 0, z: 0 } }),
}));
vi.mock('./squishy-field.js', () => ({
  SquishyField: class {
    add() {
      return { params: { body: { id: 'b', scale: [1, 1, 1] } } };
    }
    setAccessory() {
      return undefined;
    }
    heightOf() {
      return 1;
    }
    flush() {
      return undefined;
    }
    remove() {
      return undefined;
    }
  },
}));

/** A width × height RGBA picture, opaque only where `on(x, y)`. */
function picture(width: number, height: number, on: (x: number, y: number) => boolean) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (on(x, y)) data[(y * width + x) * 4 + 3] = 255;
  }
  return data;
}

describe('opaqueBox', () => {
  it('finds the drawn squishy, ears and all', () => {
    // A body from (3,5) to (6,8) with one tall ear pixel at (4,1).
    const data = picture(
      10,
      10,
      (x, y) => (x >= 3 && x <= 6 && y >= 5 && y <= 8) || (x === 4 && y === 1),
    );
    expect(opaqueBox(data, 10, 10)).toEqual({ x0: 3, y0: 1, x1: 7, y1: 9 });
  });

  it('ignores nearly see-through edges and says null for an empty picture', () => {
    const faint = new Uint8ClampedArray(4 * 4 * 4).fill(0);
    faint[3] = 4; // alpha 4: anti-aliasing dust
    expect(opaqueBox(faint, 4, 4)).toBeNull();
  });
});

describe('inUse', () => {
  it('disposes at once when nothing is drawing', () => {
    const dispose = vi.fn();
    inUse(dispose).retire();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('waits for the draws on it before disposing, and disposes once', () => {
    const dispose = vi.fn();
    const use = inUse(dispose);
    const first = use.begin();
    const second = use.begin();
    use.retire();
    expect(use.retired).toBe(true);
    first();
    expect(dispose).not.toHaveBeenCalled();
    second();
    second();
    use.retire();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

describe('createPortraits', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { setTimeout, clearTimeout, innerWidth: 390 });
    scenes.length = 0;
    shots = [];
    whenReady = () => Promise.resolve();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const portraitsFor = () =>
    createPortraits({
      engine: () => ({ isDisposed: false }) as never,
      registry: { bodies: new Map() } as unknown as VisualRegistry,
      lod: () => 'high',
      invalidate: () => undefined,
    });
  const look = { species: { id: 'puddlepuff' } as Species, instanceId: 'a', accessory: null };

  it('keeps the scene of a draw it gave up on until its snapshot is done (#375)', async () => {
    const portraits = portraitsFor();
    const first = portraits.get(look);
    await vi.waitFor(() => {
      expect(shots).toHaveLength(1);
    });
    // The screen asking gives up while the snapshot is still pending: no
    // picture, and its scene stays (disposing it under the snapshot froze the game).
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await first).toBeNull();
    expect(scenes[0]?.disposed).toBeFalsy();

    // The next picture waits: two snapshots at once would leave the engine's
    // render size wrong.
    void portraits.get({ ...look, instanceId: 'b' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(shots).toHaveLength(1);

    // The late snapshot lands (its crop fails here, with no Image in node:
    // the draw still ends), the old scene goes, and the next draws on a fresh one.
    shots[0]?.resolve('data:image/png;base64,');
    await vi.waitFor(() => {
      expect(shots).toHaveLength(2);
    });
    expect(scenes[0]?.disposed).toBe(true);
    expect(scenes).toHaveLength(2);
    expect(scenes[1]?.disposed).toBeFalsy();
  });

  it('gives up on a scene that never gets ready, before any snapshot', async () => {
    const portraits = portraitsFor();
    whenReady = () => new Promise<void>(() => undefined);
    const first = portraits.get(look);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await first).toBeNull();
    // No snapshot was started, and the draw ended: its scene goes.
    expect(shots).toHaveLength(0);
    expect(scenes[0]?.disposed).toBe(true);

    // The next picture draws (and snapshots) on a fresh scene.
    whenReady = () => Promise.resolve();
    void portraits.get({ ...look, instanceId: 'b' });
    await vi.waitFor(() => {
      expect(shots).toHaveLength(1);
    });
    expect(scenes).toHaveLength(2);
  });

  it('moves on when a snapshot never gets ready (Babylon gives up on it)', async () => {
    const portraits = portraitsFor();
    const first = portraits.get(look);
    void portraits.get({ ...look, instanceId: 'b' });
    await vi.waitFor(() => {
      expect(shots).toHaveLength(1);
    });
    shots[0]?.timeOut();
    expect(await first).toBeNull();
    await vi.waitFor(() => {
      expect(shots).toHaveLength(2);
    });
  });
});
