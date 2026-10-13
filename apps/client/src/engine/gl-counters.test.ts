import { describe, expect, it } from 'vitest';
import { countGl, type CountedGl } from './gl-counters.js';

/** A stand-in context: hands out objects, and records what reached it. */
function fakeGl(): CountedGl & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    createBuffer: () => ({}),
    deleteBuffer: () => {
      calls.push('deleteBuffer');
    },
    createTexture: () => ({}),
    deleteTexture: () => {
      calls.push('deleteTexture');
    },
    createVertexArray: () => ({}),
    deleteVertexArray: () => {
      calls.push('deleteVertexArray');
    },
    linkProgram: () => {
      calls.push('linkProgram');
    },
  };
}

describe('countGl', () => {
  it('counts buffers, textures and vertex arrays made and freed, and programs linked', () => {
    const gl = fakeGl();
    const counts = countGl(gl);
    const a = gl.createBuffer();
    gl.createBuffer();
    gl.deleteBuffer(a as object);
    const t = gl.createTexture();
    gl.deleteTexture(t as object);
    const v = gl.createVertexArray();
    gl.deleteVertexArray(v as object);
    gl.linkProgram({});
    expect(counts).toEqual({
      buffersMade: 2,
      buffersFreed: 1,
      texturesMade: 1,
      texturesFreed: 1,
      vertexArraysMade: 1,
      vertexArraysFreed: 1,
      programs: 1,
    });
    // The real calls still happen.
    expect(gl.calls).toEqual(['deleteBuffer', 'deleteTexture', 'deleteVertexArray', 'linkProgram']);
  });

  it('ignores null (a lost context makes nothing; deleting null frees nothing)', () => {
    const gl = { ...fakeGl(), createBuffer: () => null };
    const counts = countGl(gl);
    gl.createBuffer();
    gl.deleteBuffer(null);
    expect(counts.buffersMade).toBe(0);
    expect(counts.buffersFreed).toBe(0);
  });

  it('wraps a context once: a second call returns the same counts', () => {
    const gl = fakeGl();
    const counts = countGl(gl);
    expect(countGl(gl)).toBe(counts);
    gl.createBuffer();
    expect(counts.buffersMade).toBe(1);
  });
});
