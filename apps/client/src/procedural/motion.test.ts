import { describe, expect, it } from 'vitest';
import { SQUISH } from './config.js';
import { eventAttribute, eventRunning, lodFor } from './motion.js';

describe('squish moves', () => {
  it('runs for exactly its duration', () => {
    const event = { move: 'bounce', start: 10, strength: 1 } as const;
    expect(eventRunning(event, 9.99)).toBe(false);
    expect(eventRunning(event, 10)).toBe(true);
    expect(eventRunning(event, 10 + SQUISH.duration.bounce - 0.001)).toBe(true);
    expect(eventRunning(event, 10 + SQUISH.duration.bounce)).toBe(false);
    expect(eventRunning(null, 10)).toBe(false);
  });

  it('encodes moves for the shader', () => {
    expect(eventAttribute(null)).toEqual([0, 0, 0, 0]);
    expect(eventAttribute({ move: 'jiggle', start: 2.5, strength: 0.5 })).toEqual([2.5, 1, 0.5, 0]);
    expect(eventAttribute({ move: 'wobble', start: 0, strength: 1 })[1]).toBe(2);
    expect(eventAttribute({ move: 'bounce', start: 0, strength: 1 })[1]).toBe(3);
  });
});

describe('lodFor', () => {
  it('uses low detail on the map and high detail up close, unless the tier is low', () => {
    expect(lodFor('map', 'high')).toBe('low');
    expect(lodFor('map', 'low')).toBe('low');
    expect(lodFor('closeUp', 'high')).toBe('high');
    expect(lodFor('closeUp', 'medium')).toBe('high');
    expect(lodFor('closeUp', 'low')).toBe('low');
  });
});
