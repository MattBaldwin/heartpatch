import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { hex, hexKey, hexNeighbors, type Hex } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  borderArrays,
  iconOutline,
  linePieces,
  outerEdges,
  type BorderLook,
  type BorderShape,
  type BorderTile,
} from './border-layout.js';
import { BORDER, type KeeperIcon } from './map-config.js';

const shape: BorderShape = {
  size: 1,
  radius: 0.95,
  corner: 0.2,
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
    const home = land(ring(hex(0, 0)), true);
    const away = land(ring(hex(0, 0)), false);
    expect(triangles(away)).toBeGreaterThan(triangles(home));
    // One badge per `iconEvery` border tiles: 6 border tiles here.
    const badges = Math.ceil(6 / BORDER.iconEvery);
    expect((triangles(away) - triangles(home)) % badges).toBe(0);
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
    expect(alphas).toEqual(new Set([BORDER.wash, 0, BORDER.ribbon.alpha, 1]));
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
