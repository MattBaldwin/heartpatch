import { BODIES, CLOTHING, GAME_DATA, SQUISHY_SLOT, visualRegistry } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { accessoryPieces, accessorySocket } from './accessory.js';
import { surfacePoint } from './body-shape.js';
import { squishyParams, type SquishySpecies } from './params.js';

const registry = visualRegistry(GAME_DATA);
const ACCESSORIES = CLOTHING.filter((item) => item.slot === SQUISHY_SLOT);

/** Every species, plus every registry body worn one-piece and as a head. */
const LOOKS: SquishySpecies[] = [
  ...GAME_DATA.species,
  ...BODIES.flatMap((b) => [
    { id: `one-piece-${b.id}`, visual: { body: b.id, palette: ['#b8dcff'], parts: ['dot-eyes'] } },
    {
      id: `headed-${b.id}`,
      visual: {
        body: 'barrel',
        palette: ['#b8dcff'],
        parts: ['dot-eyes'],
        head: { body: b.id, size: 0.7, forward: 0.3, up: 0.6 },
      },
    },
  ]),
];

describe('squishy accessories (#340)', () => {
  it('has crown and neck accessories to test', () => {
    expect(ACCESSORIES.some((a) => a.visual.anchor === 'crown')).toBe(true);
    expect(ACCESSORIES.some((a) => a.visual.anchor === 'neck')).toBe(true);
  });

  it.each(LOOKS.map((look) => [look.id, look] as const))('every accessory fits %s', (_, look) => {
    const params = squishyParams(look, 'fit-test', registry);
    for (const item of ACCESSORIES) {
      const anchor = item.visual.anchor!;
      const socket = accessorySocket(params, registry.bodies, anchor);
      expect(socket, item.id).not.toBeNull();
      for (const p of accessoryPieces(item, socket!)) {
        for (const v of [...p.at, ...p.size]) expect(Number.isFinite(v), item.id).toBe(true);
        expect(Math.min(...p.size), item.id).toBeGreaterThan(0);
        // Above the ground, and never towering over the squishy.
        expect(p.at[1] - p.size[1] / 2, item.id).toBeGreaterThan(0);
        expect(p.at[1], item.id).toBeLessThan(params.height * 1.6);
      }
      const host = params.head ?? params.body;
      const hostBody = registry.bodies.get(host.id)!;
      const width = hostBody.width * host.scale[0];
      if (anchor === 'crown') {
        // Seated on top: a little under the head's top point at most (on its
        // shoulders for a thin tip), and the hat itself not much wider than
        // the head (a witch's brim may be).
        const hostAt = params.head?.offset[1] ?? params.lift;
        const height = hostBody.height * host.scale[1];
        const top = hostAt + surfacePoint(hostBody, 0, Math.PI / 2)[1] * host.scale[1];
        expect(socket!.at[1], item.id).toBeLessThanOrEqual(top + 1e-9);
        expect(socket!.at[1], item.id).toBeGreaterThan(top - 0.45 * height);
        for (const p of accessoryPieces(item, socket!)) {
          expect(p.size[0], item.id).toBeLessThanOrEqual(width * 1.1);
        }
      } else {
        // Round the neck: on the squishy, and a little wider than it there, so it shows.
        expect(socket!.at[1], item.id).toBeLessThan(params.height);
        expect(socket!.size[0], item.id).toBeLessThanOrEqual(width * 1.01);
        const band = accessoryPieces(item, socket!)[0]!;
        expect(band.size[0], item.id).toBeGreaterThan(socket!.size[0]);
        expect(band.size[0], item.id).toBeLessThan(socket!.size[0] * 1.3);
      }
    }
  });

  it('sizes a piece with the squishy: a bigger squishy wears a bigger hat', () => {
    const crown = ACCESSORIES.find((a) => a.id === 'tiny-crown')!;
    const at = (size: number) => {
      const look = { id: 'grow', visual: { body: 'orb', palette: ['#fff'], parts: [], size } };
      const socket = accessorySocket(squishyParams(look, 'x', registry), registry.bodies, 'crown');
      return accessoryPieces(crown, socket!)[0]!.size[0];
    };
    expect(at(1.3)).toBeGreaterThan(at(1) * 1.2);
  });
});
