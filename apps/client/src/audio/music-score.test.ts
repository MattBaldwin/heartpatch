import { describe, expect, it } from 'vitest';
import { MUSIC } from './audio-config.js';
import { loopSeconds, midiToHz, pickTrack, SCORES, type TrackId } from './music-score.js';

const TRACKS: TrackId[] = ['day', 'night', 'halloween', 'wonder'];

describe('music score', () => {
  it('picks night over Halloween, and Halloween over day', () => {
    expect(pickTrack({ night: false, halloween: false })).toBe('day');
    expect(pickTrack({ night: false, halloween: true })).toBe('halloween');
    expect(pickTrack({ night: true, halloween: true })).toBe('night');
    expect(pickTrack({ night: true, halloween: false })).toBe('night');
  });

  it('tunes A4 to 440 Hz', () => {
    expect(midiToHz(69)).toBe(440);
    expect(midiToHz(81)).toBeCloseTo(880);
  });

  it.each(TRACKS)('%s fits its loop, in a comfortable range', (id) => {
    const score = SCORES[id];
    expect(score.id).toBe(id);
    const beats = score.bars * score.beatsPerBar;
    expect(score.notes.length).toBeGreaterThan(40);
    for (const note of score.notes) {
      expect(note.beat).toBeGreaterThanOrEqual(0);
      expect(note.beat).toBeLessThan(beats);
      expect(note.beats).toBeGreaterThan(0);
      expect(note.velocity).toBeGreaterThan(0);
      expect(note.velocity).toBeLessThanOrEqual(1);
      // Nothing rumbly or shrill: C2 to C7.
      expect(note.midi).toBeGreaterThanOrEqual(36);
      expect(note.midi).toBeLessThanOrEqual(96);
    }
    // Long enough not to nag (each tune plays twice, dressed differently, #664),
    // short enough to keep each rendered loop small.
    const seconds = loopSeconds(score);
    expect(seconds).toBeGreaterThan(20);
    expect(seconds).toBeLessThanOrEqual(60);
    expect(seconds * MUSIC.sampleRate * 4).toBeLessThan(5.5 * 1024 * 1024);
  });

  it('dresses up the second time round: new voices join halfway through', () => {
    for (const id of ['day', 'night', 'halloween'] as const) {
      const score = SCORES[id];
      const half = (score.bars * score.beatsPerBar) / 2;
      const voices = (from: number, to: number) =>
        new Set(score.notes.filter((n) => n.beat >= from && n.beat < to).map((n) => n.voice));
      const first = voices(0, half);
      const second = voices(half, half * 2);
      expect(
        [...second].some((v) => !first.has(v)),
        id,
      ).toBe(true);
    }
  });

  it('keeps notes in time order', () => {
    for (const id of TRACKS) {
      const beats = SCORES[id].notes.map((n) => n.beat);
      expect(beats).toEqual([...beats].sort((a, b) => a - b));
    }
  });
});
