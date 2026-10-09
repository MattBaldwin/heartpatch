import { describe, expect, it } from 'vitest';
import { formatRenderStats } from './render-stats.js';

describe('formatRenderStats', () => {
  it('shows draw calls and thousands of triangles', () => {
    expect(formatRenderStats(61, 729_014)).toBe('61 draws · 729k tris');
    expect(formatRenderStats(0, 400)).toBe('0 draws · 0k tris');
  });
});
