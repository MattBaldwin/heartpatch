// The music loops (#25; `wonder` is the opening cinematic's, #46), written as notes rather than recordings: the
// engine renders each one to a buffer the first time it plays. Day is a bright
// marimba bounce, night a slow lavender music box, and Halloween a playful
// minor-key plink with a wobbly whistle (style guide §1: lightly spooky,
// never scary). Pure data and arithmetic, so it is unit-tested.

export type TrackId = 'day' | 'night' | 'halloween' | 'wonder';

export type Voice =
  /** Soft sustained chord, slow in and out. */
  | 'pad'
  /** Round low note. */
  | 'bass'
  /** Wooden plink (marimba / pizzicato). */
  | 'pluck'
  /** Music box / celesta. */
  | 'bell'
  /** A breathy whistle with a little wobble (Halloween's lead). */
  | 'whistle';

export interface Note {
  /** Start, in beats from the top of the loop. */
  readonly beat: number;
  readonly beats: number;
  readonly midi: number;
  /** 0–1. */
  readonly velocity: number;
  readonly voice: Voice;
}

export interface Score {
  readonly id: TrackId;
  readonly bpm: number;
  readonly beatsPerBar: number;
  readonly bars: number;
  readonly notes: readonly Note[];
}

/** Picks the loop: night wins (the dusk is calm), then Halloween's window, then day. */
export function pickTrack(input: { night: boolean; halloween: boolean }): TrackId {
  if (input.night) return 'night';
  return input.halloween ? 'halloween' : 'day';
}

export function loopSeconds(score: Score): number {
  return (score.bars * score.beatsPerBar * 60) / score.bpm;
}

export const midiToHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** A chord as semitones above its root. */
type Chord = readonly [root: number, ...rest: number[]];

interface Part {
  /** Plays under one bar's chord, starting at `bar`. */
  (chord: Chord, bar: number, beatsPerBar: number): Note[];
}

const n = (beat: number, beats: number, midi: number, velocity: number, voice: Voice): Note => ({
  beat,
  beats,
  midi,
  velocity,
  voice,
});

/** One note per chord tone, held for the bar. */
const padPart =
  (velocity: number): Part =>
  (chord, bar, bpb) =>
    chord.slice(1).map((tone) => n(bar * bpb, bpb, chord[0] + tone, velocity, 'pad'));

/** Root on the given beats, an octave below the chord. */
const bassPart =
  (beats: readonly number[], velocity: number): Part =>
  (chord, bar, bpb) =>
    beats.map((b) => n(bar * bpb + b, 0.9, chord[0] - 12, velocity, 'bass'));

/** Walks the chord tones in a pattern of steps (indexes into chord tones, -1 rests). */
const arpPart =
  (
    pattern: readonly number[],
    step: number,
    octave: number,
    velocity: number,
    voice: Voice,
  ): Part =>
  (chord, bar, bpb) => {
    const tones = chord.slice(1);
    const notes: Note[] = [];
    pattern.forEach((index, i) => {
      if (index < 0) return;
      const tone = tones[index % tones.length] ?? 0;
      const lift = Math.floor(index / tones.length) * 12;
      // Accent the downbeat a little.
      const v = i === 0 ? velocity : velocity * 0.8;
      notes.push(n(bar * bpb + i * step, step * 0.9, chord[0] + tone + lift + octave, v, voice));
    });
    return notes;
  };

/** A hand-written line: [beat, beats, midi] from the top of the loop. */
const melody = (
  voice: Voice,
  velocity: number,
  line: readonly (readonly [number, number, number])[],
): Note[] => line.map(([beat, beats, midi]) => n(beat, beats, midi, velocity, voice));

function compose(
  id: TrackId,
  bpm: number,
  beatsPerBar: number,
  progression: readonly Chord[],
  parts: readonly Part[],
  lead: readonly Note[],
): Score {
  const notes: Note[] = [];
  progression.forEach((chord, bar) => {
    for (const part of parts) notes.push(...part(chord, bar, beatsPerBar));
  });
  notes.push(...lead);
  notes.sort((a, b) => a.beat - b.beat || a.midi - b.midi);
  return { id, bpm, beatsPerBar, bars: progression.length, notes };
}

// MIDI roots: C4 = 60. Chords are [root, ...tones].
const MAJ = [0, 4, 7] as const;
const MIN = [0, 3, 7] as const;
const MAJ7 = [0, 4, 7, 11] as const;
const MIN7 = [0, 3, 7, 10] as const;
const chord = (root: number, tones: readonly number[]): Chord => [root, ...tones];

/** Day: C major, a sunny marimba bounce. */
const DAY = compose(
  'day',
  92, // TUNE
  4,
  [
    chord(60, MAJ),
    chord(57, MIN),
    chord(53, MAJ),
    chord(55, MAJ),
    chord(60, MAJ),
    chord(57, MIN),
    chord(53, MAJ),
    chord(55, MAJ7),
  ],
  [
    padPart(0.22),
    bassPart([0, 2], 0.5),
    arpPart([0, 1, 2, 3, 2, 1, 0, -1], 0.5, 12, 0.32, 'pluck'),
  ],
  melody('bell', 0.3, [
    [0, 1, 76],
    [1.5, 0.5, 79],
    [2, 2, 76],
    [4, 1, 72],
    [5, 1, 76],
    [6, 2, 74],
    [8, 1.5, 72],
    [9.5, 0.5, 74],
    [10, 2, 77],
    [12, 1, 79],
    [13, 1, 77],
    [14, 2, 74],
    [16, 1, 76],
    [17.5, 0.5, 79],
    [18, 2, 84],
    [20, 1, 81],
    [21, 1, 79],
    [22, 2, 76],
    [24, 1.5, 77],
    [25.5, 0.5, 76],
    [26, 2, 74],
    [28, 1, 74],
    [29, 1, 76],
    [30, 2, 79],
  ]),
);

/** Night: slow and lavender, a sleepy music box over soft seventh chords. */
const NIGHT = compose(
  'night',
  64, // TUNE
  4,
  [
    chord(53, MAJ7),
    chord(52, MIN7),
    chord(50, MIN7),
    chord(48, MAJ7),
    chord(53, MAJ7),
    chord(52, MIN7),
    chord(50, MIN7),
    chord(55, MAJ),
  ],
  [padPart(0.26), bassPart([0], 0.35), arpPart([0, 2, 3, 1], 1, 24, 0.18, 'bell')],
  melody('bell', 0.22, [
    [0.5, 1.5, 81],
    [2, 2, 79],
    [5, 1, 76],
    [6, 2, 79],
    [9, 2, 77],
    [11, 1, 74],
    [13, 3, 76],
    [16.5, 1.5, 81],
    [18, 2, 84],
    [21, 1, 81],
    [22, 2, 79],
    [25, 2, 77],
    [27, 1, 76],
    [29, 3, 74],
  ]),
);

/** Halloween: D minor, plinky "creeping on tiptoes" with a wobbly whistle. */
const HALLOWEEN = compose(
  'halloween',
  104, // TUNE
  4,
  [
    chord(62, MIN),
    chord(58, MAJ),
    chord(55, MIN),
    chord(57, MAJ),
    chord(62, MIN),
    chord(58, MAJ),
    chord(55, MIN),
    chord(57, MAJ7),
  ],
  [
    padPart(0.14),
    bassPart([0, 1, 2, 3], 0.42),
    arpPart([-1, 0, -1, 1, -1, 2, -1, 1], 0.5, 0, 0.3, 'pluck'),
  ],
  melody('whistle', 0.26, [
    [0, 1.5, 74],
    [1.5, 0.5, 77],
    [2, 2, 81],
    [4, 1, 82],
    [5, 1, 81],
    [6, 2, 77],
    [8, 1.5, 79],
    [9.5, 0.5, 77],
    [10, 2, 74],
    [12, 2, 76],
    [14, 2, 73],
    [16, 1.5, 74],
    [17.5, 0.5, 77],
    [18, 2, 81],
    [20, 1, 86],
    [21, 1, 84],
    [22, 2, 82],
    [24, 1.5, 79],
    [25.5, 0.5, 82],
    [26, 2, 81],
    [28, 4, 74],
  ]),
);

/**
 * Wonder (the opening cinematic, #46): F major, slow and sweeping, a music
 * box over warm open chords, like the first page of a storybook.
 */
const WONDER = compose(
  'wonder',
  72, // TUNE
  4,
  [
    chord(53, MAJ),
    chord(58, MAJ),
    chord(50, MIN),
    chord(48, MAJ),
    chord(53, MAJ7),
    chord(58, MAJ),
    chord(55, MIN7),
    chord(48, MAJ),
  ],
  [padPart(0.3), bassPart([0], 0.38), arpPart([0, 1, 2, 1], 1, 12, 0.2, 'bell')],
  melody('bell', 0.3, [
    [0, 1.5, 77],
    [1.5, 0.5, 79],
    [2, 2, 81],
    [4, 1.5, 82],
    [5.5, 0.5, 81],
    [6, 2, 77],
    [8, 1.5, 74],
    [9.5, 0.5, 76],
    [10, 2, 77],
    [12, 3, 76],
    [16, 1.5, 81],
    [17.5, 0.5, 84],
    [18, 2, 86],
    [20, 1.5, 82],
    [21.5, 0.5, 81],
    [22, 2, 77],
    [24, 1.5, 79],
    [25.5, 0.5, 77],
    [26, 2, 74],
    [28, 4, 72],
  ]),
);

export const SCORES: Readonly<Record<TrackId, Score>> = {
  day: DAY,
  night: NIGHT,
  halloween: HALLOWEEN,
  wonder: WONDER,
};
