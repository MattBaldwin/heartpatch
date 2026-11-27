import { describe, expect, it } from 'vitest';
import { MUSIC, VOICE_STYLES } from './audio-config.js';
import { loopSeconds, midiToHz, pickTrack, SCORES, type TrackId } from './music-score.js';

const TRACKS: TrackId[] = ['day', 'night', 'halloween', 'christmas', 'wonder'];

describe('music score', () => {
  it('picks night over Halloween, and Halloween over day', () => {
    const pick = (night: boolean, halloween: boolean) =>
      pickTrack({ night, halloween, christmas: false });
    expect(pick(false, false)).toBe('day');
    expect(pick(false, true)).toBe('halloween');
    expect(pick(true, true)).toBe('night');
    expect(pick(true, false)).toBe('night');
  });

  it('picks Christmas by day in its window, night at night, and Halloween if both are open (#37)', () => {
    expect(pickTrack({ night: false, halloween: false, christmas: true })).toBe('christmas');
    expect(pickTrack({ night: true, halloween: false, christmas: true })).toBe('night');
    // Should the windows ever overlap, the season that started first keeps its music.
    expect(pickTrack({ night: false, halloween: true, christmas: true })).toBe('halloween');
    expect(pickTrack({ night: true, halloween: true, christmas: true })).toBe('night');
  });

  it('sits with the other loops in loudness: as busy, and no spikier (#37)', () => {
    // The engine levels every loop to MUSIC.rms, unless a peak would pass
    // MUSIC.peak first; a sparse, spiky loop would then come out quieter.
    // So the new loop's note energy per beat (each note's velocity times its
    // voice's mix gain, squared), and its loudest beat against that, must sit
    // inside the range day, night and Halloween already span.
    const level = (id: TrackId) => {
      const score = SCORES[id];
      const beats = score.bars * score.beatsPerBar;
      const perBeat = new Array<number>(beats).fill(0);
      for (const note of score.notes) {
        const from = Math.floor(note.beat);
        const to = Math.min(beats, Math.ceil(note.beat + note.beats));
        for (let b = from; b < to; b += 1) perBeat[b] = (perBeat[b] ?? 0) + (note.velocity * VOICE_STYLES[note.voice].gain) ** 2;
      }
      const mean = perBeat.reduce((a, b) => a + b, 0) / beats;
      return { mean, crest: Math.max(...perBeat) / mean };
    };
    const known = (['day', 'night', 'halloween'] as const).map(level);
    const christmas = level('christmas');
    expect(christmas.mean).toBeGreaterThanOrEqual(Math.min(...known.map((k) => k.mean)));
    expect(christmas.mean).toBeLessThanOrEqual(Math.max(...known.map((k) => k.mean)));
    expect(christmas.crest).toBeLessThanOrEqual(Math.max(...known.map((k) => k.crest)));
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
    for (const id of ['day', 'night', 'halloween', 'christmas'] as const) {
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
