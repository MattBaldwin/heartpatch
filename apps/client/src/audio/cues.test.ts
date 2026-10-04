import { describe, expect, it } from 'vitest';
import type { PlaybackStep } from '../battle/battle-playback.js';
import { battleCue, careCue, CUE_NAMES, DUCKING_CUES, touchCue, UI_CUES } from './cues.js';
import { RECIPES } from './sfx.js';

describe('cues', () => {
  it('has a recipe for every cue, and lists every recipe', () => {
    expect(Object.keys(RECIPES).sort()).toEqual([...CUE_NAMES].sort());
    for (const cue of [...DUCKING_CUES, ...UI_CUES]) expect(CUE_NAMES).toContain(cue);
  });

  it('gives every battle step kind a sound', () => {
    const kinds: PlaybackStep['kind'][] = [
      'move',
      'hit',
      'miss',
      'heal',
      'effect',
      'tuckered',
      'swap',
      'forfeit',
      'capture',
      'end',
    ];
    for (const kind of kinds) expect(battleCue({ kind, squish: null })).not.toBeNull();
  });

  it('cheers a new friend and a win, and is kind about the rest', () => {
    expect(battleCue({ kind: 'capture', squish: 'bounce' })).toBe('charm');
    expect(battleCue({ kind: 'capture', squish: 'wobble' })).toBe('wiggle-free');
    expect(battleCue({ kind: 'end', squish: 'bounce' })).toBe('yay');
    expect(battleCue({ kind: 'end', squish: null })).toBe('aww');
    expect(battleCue({ kind: 'hit', squish: 'jiggle' })).toBe('bonk');
  });

  it('maps touches up close and care moments', () => {
    expect(touchCue('boop')).toBe('boop');
    expect(touchCue('stroke')).toBe('squeak');
    expect(touchCue('tickle')).toBe('giggle');
    expect(touchCue('treat')).toBe('nom');
    expect(careCue('care')).toBe('twinkle');
    expect(careCue('evolve')).toBe('evolve');
  });

  it('dips the music for his visit, a new friend, an evolution, a win and the title card', () => {
    expect([...DUCKING_CUES].sort()).toEqual(['charm', 'evolve', 'nightfall', 'title', 'yay']);
  });
});
