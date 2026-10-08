import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { hex, hexKey, hexNeighbors, type Hex } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  borderArrays,
  iconOutline,
  linePieces,
  outerEdges,
  profileAt,
  type BorderLook,
  type BorderShape,
  type BorderTile,
} from './border-layout.js';
import { roundedHexOutline } from './hex-mesh.js';
import { AMBIENT, BORDER, type KeeperIcon } from './map-config.js';

const shape: BorderShape = {
  size: 1,
  radius: 0.95,
  corner: 0.2,
  segments: 3,
  dome: 0.035,
  rings: [
    { scale: 0.5, y: 0.026 },
    { scale: 0.8, y: 0.009 },
    { scale: 0.92, y: -0.018 },
    { scale: 0.98, y: -0.049 },
    { scale: 1, y: -0.07 },
  ],
};
const look: BorderLook = { rgb: [0.9, 0.2, 0.4], line: 'solid', icon: 'heart' };
const land = (hexes: readonly Hex[], home = false): BorderTile[] =>
  hexes.map((h) => ({ ...h, top: 0.2, home }));
const ring = (centre: Hex): Hex[] => [centre, ...hexNeighbors(centre)];
const triangles = (tiles: readonly BorderTile[], l: BorderLook = look) =>
  borderArrays(tiles, shape, l).indices.length / 3;

describe('outerEdges', () => {
  const keys = (hexes: readonly Hex[]) => new Set(hexes.map(hexKey));

  it('gives a lone tile all six edges', () => {
    expect(outerEdges(hex(0, 0), keys([hex(0, 0)]))).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('skips edges between two of the same Keeper’s tiles', () => {
    const home = ring(hex(0, 0));
    expect(outerEdges(hex(0, 0), keys(home))).toEqual([]);
    // A ring tile faces three of the ring and three outside it.
    expect(outerEdges(hex(1, 0), keys(home))).toHaveLength(3);
  });

  it('counts anything that isn’t theirs, past the map’s rim too', () => {
    // Edge 0 faces (1, 0): a rival's, neutral, a trading post or nothing all look the same here.
    expect(outerEdges(hex(0, 0), keys([hex(0, 0), hex(-1, 0)]))).toEqual([0, 1, 2, 4, 5]);
  });
});

describe('linePieces', () => {
  it('keeps every style along its edge and across the ribbon', () => {
    for (const line of BORDER.lines) {
      const pieces = linePieces(line);
      expect(pieces.length, line).toBeGreaterThan(0);
      for (const p of pieces) {
        expect(p.from).toBeGreaterThanOrEqual(0);
        expect(p.to).toBeLessThanOrEqual(1);
        expect(p.from).toBeLessThan(p.to);
        expect(p.fade).toBeLessThan(p.inner);
        expect(p.inner).toBeLessThan(p.outer);
      }
    }
  });

  it('draws each Keeper’s line differently, so colour isn’t the only signal', () => {
    const shapes = BORDER.lines.map((line) => JSON.stringify(linePieces(line)));
    expect(new Set(shapes).size).toBe(BORDER.lines.length);
    expect(new Set(BORDER.lines).size).toBe(BORDER.lines.length);
    expect(new Set(BORDER.icons).size).toBe(BORDER.icons.length);
  });
});

describe('iconOutline', () => {
  it('outlines each icon about one across, each its own shape', () => {
    const outlines = (['heart', 'star', 'flower', 'diamond'] as KeeperIcon[]).map((icon) =>
      iconOutline(icon, 32),
    );
    for (const points of outlines) {
      expect(points).toHaveLength(32);
      for (const p of points) expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(1.1);
      expect(Math.max(...points.map((p) => Math.hypot(p.x, p.z)))).toBeGreaterThan(0.7);
    }
    expect(new Set(outlines.map((o) => JSON.stringify(o))).size).toBe(4);
  });
});

describe('borderArrays', () => {
  it('draws nothing for no land', () => {
    expect(borderArrays([], shape, look)).toEqual({ positions: [], indices: [], colors: [] });
  });

  it('runs the ribbon only along the outside of a Keeper’s land', () => {
    // Home tiles (no badges): each tile is one wash, each outer edge one ribbon.
    const one = triangles(land([hex(0, 0)], true));
    const two = triangles(land([hex(0, 0), hex(1, 0)], true));
    const apart = triangles(land([hex(0, 0), hex(3, 0)], true));
    expect(apart).toBe(2 * one);
    // Touching, they share an edge that gets no ribbon on either side.
    const edge = (apart - two) / 2;
    const wash = one - 6 * edge;
    expect(edge).toBeGreaterThan(0);
    expect(wash).toBeGreaterThan(0);
    // A whole home ring: 7 washes and 18 outer edges, none inside.
    expect(triangles(land(ring(hex(0, 0)), true))).toBe(7 * wash + 18 * edge);
  });

  it('puts an icon badge on border tiles away from home, never at home', () => {
    const badge = triangles(land([hex(0, 0)], false)) - triangles(land([hex(0, 0)], true));
    expect(badge).toBeGreaterThan(0);
    // One badge every `iconEvery` border tiles: the 6 round the middle here.
    const home = triangles(land(ring(hex(0, 0)), true));
    const away = triangles(land(ring(hex(0, 0)), false));
    expect(away - home).toBe(Math.ceil(6 / BORDER.iconEvery) * badge);
  });

  it('faces every triangle up, so it draws with back faces culled', () => {
    for (const line of BORDER.lines) {
      const arrays = borderArrays(land(ring(hex(0, 0))), shape, { ...look, line });
      const normals: number[] = [];
      VertexData.ComputeNormals(arrays.positions, arrays.indices, normals);
      for (let v = 1; v < normals.length; v += 3) expect(normals[v], line).toBeGreaterThan(0);
    }
  });

  it('colours the wash light and the ribbon strong, in the Keeper’s colour (badges white)', () => {
    const arrays = borderArrays(land([hex(0, 0)]), shape, look);
    const alphas = new Set<number>();
    for (let v = 0; v < arrays.colors!.length; v += 4) {
      const [r, g, b, a] = arrays.colors!.slice(v, v + 4);
      const white = r === 1 && g === 1 && b === 1;
      expect(white || (r === 0.9 && g === 0.2 && b === 0.4)).toBe(true);
      alphas.add(a!);
    }
    // The ribbon fades in from 0 across its inner edge.
    for (const a of [BORDER.wash, 0, BORDER.ribbon.alpha, 1]) expect(alphas.has(a)).toBe(true);
    for (const a of alphas) expect(a >= 0 && a <= 1).toBe(true);
  });

  it('stays clear of a lake’s waves everywhere on the tile, not just at its corners', () => {
    // A lake's top bobs up to `AMBIENT.water.bob`; every triangle's middle
    // must sit higher than that over the tile's own (linear-between-rings) top.
    // The tile's own outline, as map-scene.ts draws it (`SEGMENTS`).
    const outline = roundedHexOutline(shape.radius, shape.radius * shape.corner, shape.segments);
    /** How far out a point is, as a share of the outline in its direction. */
    const scaleOf = (x: number, z: number): number => {
      const angle = Math.atan2(z, x);
      for (let i = 0; i < outline.length; i++) {
        const a = outline[i]!;
        const b = outline[(i + 1) % outline.length]!;
        const ta = Math.atan2(a.z, a.x);
        let span = Math.atan2(b.z, b.x) - ta;
        if (span < -Math.PI) span += 2 * Math.PI;
        let into = angle - ta;
        if (into < -Math.PI) into += 2 * Math.PI;
        if (into < 0 || into > span) continue;
        const k = span === 0 ? 0 : into / span;
        const rim = Math.hypot(a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k);
        return Math.hypot(x, z) / rim;
      }
      return Math.hypot(x, z) / shape.radius;
    };
    for (const line of BORDER.lines) {
      const { positions, indices } = borderArrays(land([hex(0, 0)], true), shape, {
        ...look,
        line,
      });
      for (let t = 0; t < indices.length; t += 3) {
        const v = [0, 1, 2].map((j) => indices[t + j]! * 3);
        const x = v.reduce((sum, i) => sum + positions[i]!, 0) / 3;
        const y = v.reduce((sum, i) => sum + positions[i + 1]!, 0) / 3;
        const z = v.reduce((sum, i) => sum + positions[i + 2]!, 0) / 3;
        const scale = scaleOf(x, z);
        if (scale > 1) continue; // over the gap between tiles
        expect(
          y - (0.2 + profileAt(shape, scale)),
          `${line} at ${scale.toFixed(3)}`,
        ).toBeGreaterThan(AMBIENT.water.bob);
      }
    }
  });

  it('lies on the tile’s top, above it and never far above', () => {
    const arrays = borderArrays(land([hex(0, 0)]), shape, look);
    const ys = arrays.positions.filter((_, i) => i % 3 === 1);
    expect(Math.min(...ys)).toBeGreaterThan(0.2 - 0.07);
    expect(Math.max(...ys)).toBeLessThanOrEqual(0.2 + shape.dome + 0.02);
  });

  it('draws the same land the same way, whatever order the view lists it', () => {
    const tiles = land([hex(0, 0), hex(1, 0), hex(2, -1), hex(-1, 1)]);
    const dashed: BorderLook = { ...look, line: 'dash' };
    expect(borderArrays([...tiles].reverse(), shape, dashed)).toEqual(
      borderArrays(tiles, shape, dashed),
    );
  });
});
