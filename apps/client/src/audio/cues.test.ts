import { describe, expect, it } from 'vitest';
import type { PlaybackStep } from '../battle/battle-playback.js';
import {
  battleCue,
  careCue,
  CUE_NAMES,
  findCue,
  DUCKING_CUES,
  isCueName,
  touchCue,
  UI_CUES,
} from './cues.js';
import { RECIPES } from './sfx.js';

describe('cues', () => {
  it('has a recipe for every cue, and lists every recipe', () => {
    expect(Object.keys(RECIPES).sort()).toEqual([...CUE_NAMES].sort());
    for (const cue of [...DUCKING_CUES, ...UI_CUES]) expect(CUE_NAMES).toContain(cue);
  });

  it('gives each size of rare find its own chime, dipping the music (#391)', () => {
    const cues = [1, 2, 3, 4].map(findCue);
    expect(new Set(cues).size).toBe(4);
    expect(findCue(6)).toBe('find-4');
    expect(findCue(0)).toBe('find-1');
    for (const cue of cues) {
      expect(CUE_NAMES).toContain(cue);
      expect(DUCKING_CUES.has(cue)).toBe(true);
    }
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
    // A rare new friend's win is a fanfare instead (#391); the charm's toss stays.
    expect(battleCue({ kind: 'end', squish: 'bounce' }, true)).toBe('friend-fanfare');
    expect(battleCue({ kind: 'capture', squish: 'bounce' }, true)).toBe('charm');
    expect(battleCue({ kind: 'end', squish: null }, true)).toBe('aww');
    expect(battleCue({ kind: 'end', squish: null })).toBe('aww');
    expect(battleCue({ kind: 'hit', squish: 'jiggle' })).toBe('bonk');
    expect(battleCue({ kind: 'hit', squish: 'wobble', effectiveness: 'weak' })).toBe('bonk');
    expect(battleCue({ kind: 'hit', squish: 'wobble', effectiveness: 'super' })).toBe('thwack');
    expect(battleCue({ kind: 'hit', squish: 'wobble', effectiveness: 'good' })).toBe('thwack');
  });

  it('maps touches up close and care moments', () => {
    expect(touchCue('boop')).toBe('boop');
    expect(touchCue('stroke')).toBe('squeak');
    expect(touchCue('tickle')).toBe('giggle');
    expect(touchCue('treat')).toBe('nom');
    expect(careCue('care')).toBe('twinkle');
    expect(careCue('evolve')).toBe('evolve');
  });

  it('dips the music for his visit, his sting, the peekaboo, a new friend, an evolution, a win, a rare find, the title card and the Crooked House moments', () => {
    expect([...DUCKING_CUES].sort()).toEqual([
      'charm',
      'chest',
      'chest-big',
      'door-wake',
      'evolve',
      'find-1',
      'find-2',
      'find-3',
      'find-4',
      'friend-fanfare',
      'hollow-sting',
      'key-found',
      'nightfall',
      'peekaboo',
      'room-bloom',
      'title',
      'yay',
    ]);
  });

  it('tells a known cue name from any other string (cinematic data)', () => {
    expect(isCueName('bloom')).toBe(true);
    expect(isCueName('crash')).toBe(false);
  });
});
