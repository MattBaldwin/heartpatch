import { describe, expect, it, vi } from 'vitest';
import { boot, type LosableRenderer } from './boot.js';

class FakeRenderer implements LosableRenderer {
  readonly engine = { dispose: vi.fn() };
  private lost: (() => void) | null = null;
  readonly kind: string;
  constructor(kind: string) {
    this.kind = kind;
  }
  onLost(callback: () => void): void {
    this.lost = callback;
  }
  loseDevice(): void {
    this.lost?.();
  }
}

/** Canvases are only compared by identity here, so plain objects will do. */
function fakeCanvas(id: number): HTMLCanvasElement {
  return { id } as unknown as HTMLCanvasElement;
}

function setup(createKind: (pref: string, attempt: number) => string | Error) {
  let canvasCount = 0;
  const first = fakeCanvas(canvasCount);
  const freshCanvas = vi.fn(() => fakeCanvas(++canvasCount));
  const renderers: FakeRenderer[] = [];
  let attempt = 0;
  const createRenderer = vi.fn((_canvas: HTMLCanvasElement, pref: 'webgpu' | 'webgl2') => {
    const kind = createKind(pref, attempt++);
    if (kind instanceof Error) return Promise.reject(kind);
    const r = new FakeRenderer(kind);
    renderers.push(r);
    return Promise.resolve(r);
  });
  const stages: { renderer: FakeRenderer; canvas: HTMLCanvasElement; dispose: () => void }[] = [];
  const mount = vi.fn((renderer: FakeRenderer, canvas: HTMLCanvasElement) => {
    const stage = { renderer, canvas, dispose: vi.fn() };
    stages.push(stage);
    return stage;
  });
  const onStart = vi.fn();
  const onError = vi.fn();
  return { first, freshCanvas, createRenderer, mount, onStart, onError, renderers, stages };
}

describe('boot', () => {
  it('mounts the scene on the first renderer', async () => {
    const t = setup(() => 'webgpu');
    await boot(t.first, { preference: 'webgpu', ...t });
    expect(t.createRenderer).toHaveBeenCalledWith(t.first, 'webgpu', expect.any(Function));
    expect(t.stages).toHaveLength(1);
    expect(t.stages[0]!.canvas).toBe(t.first);
    expect(t.onStart).toHaveBeenCalledWith(t.stages[0], t.renderers[0]);
  });

  it('starts straight on WebGL2 when that is the preference', async () => {
    const t = setup((pref) => pref);
    await boot(t.first, { preference: 'webgl2', ...t });
    expect(t.renderers[0]!.kind).toBe('webgl2');
  });

  it('falls back to WebGL2 on a fresh canvas when the WebGPU device is lost', async () => {
    const t = setup((pref) => (pref === 'webgpu' ? 'webgpu' : 'webgl2'));
    await boot(t.first, { preference: 'webgpu', ...t });
    const [gpu] = t.renderers;

    gpu!.loseDevice();
    await vi.waitFor(() => {
      expect(t.stages).toHaveLength(2);
    });

    expect(t.stages[0]!.dispose).toHaveBeenCalledOnce();
    expect(gpu!.engine.dispose).toHaveBeenCalledOnce();
    expect(t.createRenderer).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 1 }),
      'webgl2',
      expect.any(Function),
    );
    const second = t.stages[1]!;
    expect(second.renderer.kind).toBe('webgl2');
    expect(second.canvas).not.toBe(t.first);
    expect(t.onStart).toHaveBeenLastCalledWith(second, second.renderer);
  });

  it('rebuilds on a fresh canvas when a WebGL context is lost and restored', async () => {
    const t = setup(() => 'webgl2');
    await boot(t.first, { preference: 'webgl2', ...t });
    t.renderers[0]!.loseDevice();
    await vi.waitFor(() => {
      expect(t.stages).toHaveLength(2);
    });
    expect(t.stages[0]!.dispose).toHaveBeenCalledOnce();
    expect(t.renderers[0]!.engine.dispose).toHaveBeenCalledOnce();
    expect(t.stages[1]!.canvas).not.toBe(t.first);
    expect(t.stages[1]!.renderer.kind).toBe('webgl2');
  });

  it('reports a failed restart instead of throwing into the void', async () => {
    const t = setup((pref) => (pref === 'webgpu' ? 'webgpu' : new Error('no webgl')));
    await boot(t.first, { preference: 'webgpu', ...t });
    t.renderers[0]!.loseDevice();
    await vi.waitFor(() => {
      expect(t.onError).toHaveBeenCalledOnce();
    });
  });

  it('rejects if the very first renderer cannot start', async () => {
    const t = setup(() => new Error('no gpu at all'));
    await expect(boot(t.first, { preference: 'webgpu', ...t })).rejects.toThrow('no gpu at all');
  });
});
