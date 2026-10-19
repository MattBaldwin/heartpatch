import { describe, expect, it } from 'vitest';
import {
  formatAmbientStatus,
  formatPageStats,
  formatRenderStats,
  formatResourceStats,
} from './render-stats.js';

describe('formatRenderStats', () => {
  it('shows draw calls and thousands of triangles', () => {
    expect(formatRenderStats(61, 729_014)).toBe('61 draws · 729k tris');
    expect(formatRenderStats(0, 400)).toBe('0 draws · 0k tris');
  });
});

describe('formatResourceStats', () => {
  const base = {
    jsMs: 4.24,
    meshes: 48,
    materials: 20,
    textures: 5,
    animatables: 0,
    gl: {
      buffersMade: 40,
      buffersFreed: 12,
      texturesMade: 9,
      texturesFreed: 2,
      vertexArraysMade: 30,
      vertexArraysFreed: 4,
      programs: 27,
    },
    batchUploads: 6,
    renderScale: 1,
  };

  it('shows the scene, WebGL objects made and freed, uploads and the render scale', () => {
    expect(formatResourceStats(base)).toBe(
      'js 4.2 ms · 48 mesh · 20 mat · 5 tex · 0 anim · buf +40/-12 · gltex +9/-2 · vao +30/-4 · 27 prog · 6 up · 1.00 scale',
    );
  });

  it('leaves the WebGL counts out on WebGPU', () => {
    expect(formatResourceStats({ ...base, gl: null, renderScale: 0.85 })).toBe(
      'js 4.2 ms · 48 mesh · 20 mat · 5 tex · 0 anim · 6 up · 0.85 scale',
    );
  });
});

describe('formatPageStats', () => {
  it('shows the page: engines, renders per second, grouped render targets, DOM and flags (#501)', () => {
    expect(
      formatPageStats({
        engines: 1,
        framesPerSecond: 30.6,
        snapshots: 4,
        targets: [
          { width: 590, height: 1278, samples: 1 },
          { width: 1179, height: 2556, samples: 1 },
          { width: 590, height: 1278, samples: 1 },
          { width: 256, height: 256, samples: 4 },
        ],
        canvases: 1,
        domNodes: 1834,
        animations: 3,
        flags: 'nopost cap30',
      }),
    ).toBe(
      'page · 1 engine · 31 fr/s · 4 snap · rt 4: 1179x2556, 590x1278 ×2, 256x256/4 · 1 canvas · 1834 dom · 3 css · nopost cap30',
    );
  });

  it('keeps the page line short with many render target sizes and no flags', () => {
    const targets = [1, 2, 3, 4, 5, 6].map((n) => ({ width: n * 100, height: 100, samples: 1 }));
    expect(
      formatPageStats({
        engines: 2,
        framesPerSecond: 0,
        snapshots: 0,
        targets,
        canvases: 2,
        domNodes: 9,
        animations: 0,
        flags: '',
      }),
    ).toBe(
      'page · 2 engines · 0 fr/s · 0 snap · rt 6: 600x100, 500x100, 400x100, 300x100, +2 · 2 canvas · 9 dom · 0 css',
    );
  });
});

describe('formatAmbientStatus', () => {
  it('shows the mode, and when the judge called the device slow (#501 H)', () => {
    expect(formatAmbientStatus({ mode: 'live', slow: false })).toBe('ambient live');
    expect(formatAmbientStatus({ mode: 'off', slow: true })).toBe('ambient off (slow)');
  });
});
