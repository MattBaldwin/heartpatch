// The music loops (#25; `wonder` is the opening cinematic's, #46), written as notes rather than recordings: the
// engine renders each one to a buffer the first time it plays, with real CC0
// instrument notes (#664, `music-samples.ts`) or the synth until they're in.
// Day is a sunny marimba bounce, night a slow lavender music box, and
// Halloween a playful minor-key plink on tiptoes with a breathy flute (style
// guide §1: lightly spooky, never scary). Each loop plays its tune twice, the
// second time dressed differently (a new lead, fuller strings, a shaker), so
// it doesn't feel like a repeat. Pure data and arithmetic, so it is unit-tested.

export type TrackId = 'day' | 'night' | 'halloween' | 'wonder';

export type Voice =
  /** Soft sustained chord, slow in and out (strings). */
  | 'pad'
  /** Round low note (plucked double bass). */
  | 'bass'
  /** Wooden plink (marimba). */
  | 'pluck'
  /** Music box (glockenspiel). */
  | 'bell'
  /** A breathy lead (flute; the synth's is a whistle with a little wobble). */
  | 'whistle'
  /** Soft felt piano. */
  | 'piano'
  /** Harp. */
  | 'harp'
  /** Plucked violins, on tiptoes. */
  | 'pizz'
  /** A soft shaker; its MIDI number only picks which shake. */
  | 'shaker';

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

/**
 * One note per chord tone, held for the bar. `open` lifts the middle tone an
 * octave (a wider, fuller voicing for a loop's second time round).
 */
const padPart =
  (velocity: number, open = false): Part =>
  (chord, bar, bpb) =>
    chord
      .slice(1)
      .map((tone, i) =>
        n(bar * bpb, bpb, chord[0] + tone + (open && i === 1 ? 12 : 0), velocity, 'pad'),
      );

/** The chord's root on the given beats, `octave` semitones from the chord. */
const rootPart =
  (beats: readonly number[], octave: number, velocity: number, voice: Voice, length = 0.9): Part =>
  (chord, bar, bpb) =>
    beats.map((b) => n(bar * bpb + b, length, chord[0] + octave, velocity, voice));

/** Root on the given beats, an octave below the chord. */
const bassPart = (beats: readonly number[], velocity: number): Part =>
  rootPart(beats, -12, velocity, 'bass');

/** A soft shaker on the given beats of every bar, alternating its two shakes. */
const shakerPart =
  (beats: readonly number[], velocity: number): Part =>
  (_chord, bar, bpb) =>
    beats.map((b, i) => n(bar * bpb + b, 0.25, 60 + (i % 2), velocity, 'shaker'));

/** A part that only plays in bars `from` to `to` (not including `to`). */
const during =
  (part: Part, from: number, to: number): Part =>
  (chord, bar, bpb) =>
    bar >= from && bar < to ? part(chord, bar, bpb) : [];

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

type Line = readonly (readonly [beat: number, beats: number, midi: number])[];

/** A hand-written line: [beat, beats, midi] from the top of the loop. */
const melody = (voice: Voice, velocity: number, line: Line): Note[] =>
  line.map(([beat, beats, midi]) => n(beat, beats, midi, velocity, voice));

/** The same line later in the loop (`beats`) and `semitones` up or down. */
const moved = (line: Line, beats: number, semitones = 0): Line =>
  line.map(([beat, length, midi]) => [beat + beats, length, midi + semitones] as const);

/** Only the line's long notes (a sparse echo of the tune for a second voice). */
const longNotes = (line: Line, atLeast: number): Line =>
  line.filter(([, length]) => length >= atLeast);

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

/** Twice through the same chords: the tune, then its repeat in new clothes. */
const twice = (progression: readonly Chord[]): Chord[] => [...progression, ...progression];

const DAY_TUNE: Line = [
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
];

/**
 * Day: C major, a sunny marimba bounce over soft strings and a plucked bass.
 * First time the music box sings the tune; second time the piano takes it,
 * the music box echoes its long notes up high, a harp and a shaker join in.
 */
const DAY = compose(
  'day',
  92, // TUNE
  4,
  twice([
    chord(60, MAJ),
    chord(57, MIN),
    chord(53, MAJ),
    chord(55, MAJ),
    chord(60, MAJ),
    chord(57, MIN),
    chord(53, MAJ),
    chord(55, MAJ7),
  ]),
  [
    during(padPart(0.2), 0, 8),
    during(padPart(0.24, true), 8, 16),
    during(bassPart([0, 2], 0.5), 0, 8),
    during(bassPart([0, 1.5, 2], 0.5), 8, 16),
    during(arpPart([0, 1, 2, 3, 2, 1, 0, -1], 0.5, 12, 0.3, 'pluck'), 0, 8),
    during(arpPart([0, 1, 2, 3, 4, 3, 2, 1], 0.5, 12, 0.28, 'pluck'), 8, 16),
    during(arpPart([0, 1, 2], 0.12, 0, 0.18, 'harp'), 8, 16),
    during(shakerPart([0.5, 1.5, 2.5, 3.5], 0.22), 8, 16),
  ],
  [
    ...melody('bell', 0.32, DAY_TUNE),
    ...melody('piano', 0.36, moved(DAY_TUNE, 32)),
    ...melody(
      'bell',
      0.16,
      moved(longNotes(DAY_TUNE, 2), 32, 12).filter(([, , m]) => m <= 91),
    ),
  ],
);

const NIGHT_TUNE: Line = [
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
];

/**
 * Night: slow and lavender, sleepier than day. A harp rocks gently under the
 * music box's tune and soft strings; second time the piano hums the tune an
 * octave down, with the music box's twinkle far off.
 */
const NIGHT = compose(
  'night',
  64, // TUNE
  4,
  twice([
    chord(53, MAJ7),
    chord(52, MIN7),
    chord(50, MIN7),
    chord(48, MAJ7),
    chord(53, MAJ7),
    chord(52, MIN7),
    chord(50, MIN7),
    chord(55, MAJ),
  ]),
  [
    during(padPart(0.18), 0, 8),
    during(padPart(0.2, true), 8, 16),
    rootPart([0], -12, 0.3, 'bass', 2),
    arpPart([0, 2, 3, 1], 1, 12, 0.2, 'harp'),
    during(arpPart([-1, 2, -1, 3], 1, 24, 0.09, 'bell'), 8, 16),
  ],
  [...melody('bell', 0.4, NIGHT_TUNE), ...melody('piano', 0.48, moved(NIGHT_TUNE, 32, -12))],
);

const HALLOWEEN_TUNE: Line = [
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
];

/**
 * Halloween: D minor, "creeping on tiptoes": plucked violins and a walking
 * plucked bass under a breathy flute. Second time the music box takes the
 * tune, the flute holds its long notes, and a shaker rattles softly, like
 * a friendly skeleton.
 */
const HALLOWEEN = compose(
  'halloween',
  104, // TUNE
  4,
  twice([
    chord(62, MIN),
    chord(58, MAJ),
    chord(55, MIN),
    chord(57, MAJ),
    chord(62, MIN),
    chord(58, MAJ),
    chord(55, MIN),
    chord(57, MAJ7),
  ]),
  [
    during(padPart(0.14), 0, 8),
    during(padPart(0.18, true), 8, 16),
    bassPart([0, 1, 2, 3], 0.42),
    arpPart([-1, 0, -1, 1, -1, 2, -1, 1], 0.5, 0, 0.3, 'pizz'),
    during(shakerPart([1, 3], 0.2), 8, 16),
  ],
  [
    ...melody('whistle', 0.28, HALLOWEEN_TUNE),
    ...melody('bell', 0.3, moved(HALLOWEEN_TUNE, 32)),
    ...melody('whistle', 0.14, moved(longNotes(HALLOWEEN_TUNE, 2), 32)),
  ],
);

/**
 * Wonder (the opening cinematic, #46): F major, slow and sweeping, a music
 * box over warm strings and a rippling harp, like the first page of a
 * storybook. Its second half opens the strings out.
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
  [
    during(padPart(0.28), 0, 4),
    during(padPart(0.3, true), 4, 8),
    rootPart([0], -12, 0.34, 'bass', 2),
    rootPart([0], 0, 0.16, 'piano', 3),
    arpPart([0, 1, 2, 1], 1, 12, 0.22, 'harp'),
    during(arpPart([-1, 2, -1, 1], 1, 24, 0.1, 'bell'), 4, 8),
  ],
  melody('bell', 0.32, [
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
