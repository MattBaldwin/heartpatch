import { describe, expect, it } from 'vitest';
import { formatRenderStats, formatResourceStats } from './render-stats.js';

describe('formatRenderStats', () => {
  it('shows draw calls and thousands of triangles', () => {
    expect(formatRenderStats(61, 729_014)).toBe('61 draws · 729k tris');
    expect(formatRenderStats(0, 400)).toBe('0 draws · 0k tris');
  });
});

describe('formatResourceStats', () => {
  const base = {
    meshes: 48,
    materials: 20,
    textures: 5,
    animatables: 0,
    gl: { buffersMade: 40, buffersFreed: 12, texturesMade: 9, texturesFreed: 2, programs: 27 },
    batchUploads: 6,
    renderScale: 1,
  };

  it('shows the scene, WebGL objects made and freed, uploads and the render scale', () => {
    expect(formatResourceStats(base)).toBe(
      '48 mesh · 20 mat · 5 tex · 0 anim · buf +40/-12 · gltex +9/-2 · 27 prog · 6 up · 1.00 scale',
    );
  });

  it('leaves the WebGL counts out on WebGPU', () => {
    expect(formatResourceStats({ ...base, gl: null, renderScale: 0.85 })).toBe(
      '48 mesh · 20 mat · 5 tex · 0 anim · 6 up · 0.85 scale',
    );
  });
});
