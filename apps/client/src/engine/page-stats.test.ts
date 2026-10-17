import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import { afterEach, describe, expect, it } from 'vitest';
import { RenderRate } from './page-stats.js';

describe('RenderRate (#501)', () => {
  const engine = new NullEngine();
  afterEach(() => {
    for (const scene of [...engine.scenes]) scene.dispose();
  });

  function scene(): Scene {
    const s = new Scene(engine);
    s.activeCamera = new FreeCamera('cam', new Vector3(0, 0, -5), s);
    return s;
  }

  function render(s: Scene, times: number): void {
    for (let i = 0; i < times; i++) s.render();
  }

  it('counts each render once (a scene’s render id moves twice or more a frame)', () => {
    const rate = new RenderRate();
    const a = scene();
    render(a, 5); // before it was first seen: not counted
    expect(rate.sample([a], 0)).toBe(0);
    render(a, 10);
    expect(a.getRenderId()).toBeGreaterThan(20);
    expect(rate.sample([a], 1000)).toBe(10);
  });

  it('adds up scenes, counting a new one from when it is first seen', () => {
    const rate = new RenderRate();
    const a = scene();
    rate.sample([a], 0);
    render(a, 15);
    const b = scene();
    render(b, 7);
    expect(rate.sample([a, b], 500)).toBe(30);
    render(a, 15);
    render(b, 15);
    expect(rate.sample([a, b], 1000)).toBe(60);
  });

  it('drops a scene that went away', () => {
    const rate = new RenderRate();
    const a = scene();
    rate.sample([a], 0);
    render(a, 10);
    expect(rate.sample([], 1000)).toBe(0);
  });
});
