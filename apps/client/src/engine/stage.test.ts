import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Renderer } from './renderer.js';
import { mountStage, type Stage } from './stage.js';

// NullEngine can't build the sky's cube texture; lighting isn't what's tested.
vi.mock('./lighting/lighting.js', () => ({ setupLighting: vi.fn() }));

// The order inside one frame of the render loop: a canvas resize clears its
// drawing buffer, so one between scene.render() and the frame being shown
// would show a blank frame (#260). Resizes happen at the top of a frame,
// before the draw (#251's resize, and the governor's rescale).

describe('mountStage frame order', () => {
  let engine: NullEngine;
  let frame: () => void;
  let stage: Stage | null = null;
  /** The stubbed window's addEventListener, to fire what the stage listens for. */
  let windowListen: ReturnType<typeof vi.fn>;
  const order: string[] = [];

  beforeEach(() => {
    // Client unit tests run in Node: just the bits of the DOM the stage uses.
    windowListen = vi.fn();
    vi.stubGlobal('window', {
      devicePixelRatio: 2,
      addEventListener: windowListen,
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
    engine = new NullEngine();
    vi.spyOn(engine, 'runRenderLoop').mockImplementation((loop) => {
      frame = loop;
    });
    vi.spyOn(engine, 'resize').mockImplementation(() => {
      order.push('resize');
    });
    order.length = 0;
  });

  afterEach(() => {
    stage?.dispose();
    stage = null;
    engine.dispose();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function mount(): Stage {
    const canvas = {
      addEventListener: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 }),
      clientWidth: 390,
      clientHeight: 844,
      dataset: {},
    } as unknown as HTMLCanvasElement;
    const renderer: Renderer = {
      engine,
      kind: 'webgl2',
      onLost: vi.fn(),
    };
    const s = mountStage(
      renderer,
      canvas,
      () => ({ bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 } }),
      'high',
    );
    vi.spyOn(s.scene, 'render').mockImplementation(() => {
      order.push('render');
    });
    return s;
  }

  it('applies the governor’s rescale at the top of the next frame, never after a draw', () => {
    stage = mount();
    const quality = stage.quality;
    // The governor wants a new scale once, after a draw.
    vi.spyOn(quality, 'sample').mockReturnValueOnce(true).mockReturnValue(false);
    const applyPending = vi.spyOn(quality, 'applyPending').mockImplementation(() => {
      order.push('rescale');
      return true;
    });
    stage.invalidate();
    // Two frames: the first has no frame time yet; the second samples one.
    frame();
    frame();
    const drawnAt = order.lastIndexOf('render');
    expect(drawnAt).toBeGreaterThanOrEqual(0);
    expect(order.slice(drawnAt + 1), 'nothing resizes after the draw').toEqual([]);
    expect(applyPending).not.toHaveBeenCalled();
    // The next frame applies it first, then draws with it.
    order.length = 0;
    frame();
    expect(order[0]).toBe('rescale');
    expect(order).toContain('render');
    expect(order.indexOf('rescale')).toBeLessThan(order.indexOf('render'));
  });

  it('applies a pending rescale before a resize in the same frame, so it still reloads', () => {
    stage = mount();
    const quality = stage.quality;
    vi.spyOn(quality, 'sample').mockReturnValueOnce(true).mockReturnValue(false);
    const applyPending = vi.spyOn(quality, 'applyPending').mockImplementation(() => {
      order.push('rescale');
      return true;
    });
    stage.invalidate();
    frame();
    frame();
    // The window resizes before the next frame: the resize re-applies the
    // pixel ratio (and so whatever the governor wants) in that frame too.
    const onResize = windowListen.mock.calls.find(([type]) => type === 'resize')?.[1] as () => void;
    onResize();
    order.length = 0;
    frame();
    expect(applyPending).toHaveBeenCalledTimes(1);
    expect(order.indexOf('rescale')).toBe(0);
    expect(order.indexOf('rescale')).toBeLessThan(order.indexOf('resize'));
    expect(order.indexOf('resize')).toBeLessThan(order.lastIndexOf('render'));
  });
});
