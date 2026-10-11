import { KEEPER_DATA } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { KEEPER_TEXT } from './keeper-screen.js';
import { bodyTileSvg, faceTileSvg, KEEPER_STEPS, nextStep, previousStep } from './keeper-steps.js';

describe('Keeper creator steps (#372)', () => {
  it('runs in the owner-approved order, with the outfit on the body step', () => {
    expect(KEEPER_STEPS).toEqual(['face', 'body', 'skin', 'hairstyle', 'hairColor', 'details']);
    expect(nextStep('face')).toBe('body');
    expect(nextStep('details')).toBeNull();
    expect(previousStep('face')).toBeNull();
    expect(previousStep('body')).toBe('face');
  });

  it('names every step in one short word', () => {
    for (const s of KEEPER_STEPS) expect(KEEPER_TEXT.steps[s].tab).toMatch(/^\w{1,7}$/);
  });

  it('draws every face and body tile with real numbers, inside the tile', () => {
    for (const face of KEEPER_DATA.faces) {
      const svg = faceTileSvg(face, '#f6cfae');
      expect(svg).not.toMatch(/NaN|Infinity/);
    }
    for (const body of KEEPER_DATA.bodies) {
      const svg = bodyTileSvg(body, '#f6cfae', '#ffd85a');
      expect(svg).not.toMatch(/NaN|Infinity/);
      // The head's top stays on the tile.
      const [, cy, r] = /<circle cx="[\d.]+" cy="([\d.-]+)" r="([\d.]+)"/.exec(svg) ?? [];
      expect(Number(cy) - Number(r)).toBeGreaterThanOrEqual(0);
    }
  });
});
