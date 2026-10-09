import { describe, expect, it } from 'vitest';

// Every emoji a player can read is one their iPhone can draw (#308). The
// shovel emoji (U+1FA8F, Emoji 16.0) showed as an empty box: iOS draws it
// only from 18.4, and the floor is iOS 17 (tech spec), which stops at Emoji
// 15.0. The rule, as the issue asks: nothing newer than Emoji 12 in client
// text, so older systems are safe too. A few Emoji 13–14 ones were already
// in use before the rule and draw fine on the iOS 17 floor; they're listed
// below by hand. Anything newer than the floor can never be listed.
//
// The scan reads the source of every client module (text tables, icon maps,
// and comments, so examples in doc comments match the real text) and the
// shared public data the client shows. Code points come from Unicode's
// emoji-data (emoji versions 12.0–17.0).

/** Emoji 12.0 in the Symbols and Pictographs Extended-A block (U+1FA70–U+1FAFF). */
const BLOCK_EMOJI_12: readonly (readonly [number, number])[] = [
  [0x1fa70, 0x1fa73],
  [0x1fa78, 0x1fa7a],
  [0x1fa80, 0x1fa82],
  [0x1fa90, 0x1fa95],
];

/** The rest of that block, by the emoji version that added it. */
const BLOCK_NEWER: readonly (readonly [number, number, number])[] = [
  // Emoji 13.0
  [0x1fa74, 0x1fa74, 13],
  [0x1fa83, 0x1fa86, 13],
  [0x1fa96, 0x1faa8, 13],
  [0x1fab0, 0x1fab6, 13],
  [0x1fac0, 0x1fac2, 13],
  [0x1fad0, 0x1fad6, 13],
  // Emoji 14.0
  [0x1fa7b, 0x1fa7c, 14],
  [0x1faa9, 0x1faac, 14],
  [0x1fab7, 0x1faba, 14],
  [0x1fac3, 0x1fac5, 14],
  [0x1fad7, 0x1fad9, 14],
  [0x1fae0, 0x1fae7, 14],
  [0x1faf0, 0x1faf6, 14],
  // Emoji 15.0
  [0x1fa75, 0x1fa77, 15],
  [0x1fa87, 0x1fa88, 15],
  [0x1faad, 0x1faaf, 15],
  [0x1fabb, 0x1fabd, 15],
  [0x1fabf, 0x1fabf, 15],
  [0x1face, 0x1facf, 15],
  [0x1fada, 0x1fadb, 15],
  [0x1fae8, 0x1fae8, 15],
  [0x1faf7, 0x1faf8, 15],
];

/** Emoji 13.0+ outside that block. */
const SINGLES_NEWER = new Map<number, number>([
  [0x26a7, 13], // transgender symbol
  [0x1f6d6, 13], // hut
  [0x1f6d7, 13], // elevator
  [0x1f6fb, 13], // pickup truck
  [0x1f6fc, 13], // roller skate
  [0x1f90c, 13], // pinched fingers
  [0x1f972, 13], // smiling face with tear
  [0x1f977, 13], // ninja
  [0x1f978, 13], // disguised face
  [0x1f9a3, 13], // mammoth
  [0x1f9a4, 13], // dodo
  [0x1f9ab, 13], // beaver
  [0x1f9ac, 13], // bison
  [0x1f9ad, 13], // seal
  [0x1f9cb, 13], // bubble tea
  [0x1f6dd, 14], // playground slide
  [0x1f6de, 14], // wheel
  [0x1f6df, 14], // ring buoy
  [0x1f7f0, 14], // heavy equals sign
  [0x1f979, 14], // face holding back tears
  [0x1f9cc, 14], // troll
  [0x1f6dc, 15], // wireless
  [0x1f6d8, 17], // landslide
]);

const ZWJ = 0x200d;

/** Emoji 13.0+ made of older parts joined by a zero-width joiner (no FE0F). */
const SEQUENCES_NEWER: readonly (readonly [readonly number[], number])[] = [
  [[0x1f408, ZWJ, 0x2b1b], 13], // black cat
  [[0x1f43b, ZWJ, 0x2744], 13], // polar bear
  [[0x1f9d1, ZWJ, 0x1f384], 13], // mx claus
  [[0x1f9d1, ZWJ, 0x1f37c], 13], // person feeding baby
  [[0x1f469, ZWJ, 0x1f37c], 13],
  [[0x1f468, ZWJ, 0x1f37c], 13],
  [[0x2764, ZWJ, 0x1f525], 13.1], // heart on fire
  [[0x2764, ZWJ, 0x1fa79], 13.1], // mending heart
  [[0x1f62e, ZWJ, 0x1f4a8], 13.1], // face exhaling
  [[0x1f635, ZWJ, 0x1f4ab], 13.1], // face with spiral eyes
  [[0x1f636, ZWJ, 0x1f32b], 13.1], // face in clouds
  [[0x1f9d4, ZWJ, 0x2640], 13.1], // woman: beard
  [[0x1f9d4, ZWJ, 0x2642], 13.1], // man: beard
  [[0x1f426, ZWJ, 0x2b1b], 15], // black bird
  [[0x1f426, ZWJ, 0x1f525], 15.1], // phoenix
  [[0x1f34b, ZWJ, 0x1f7e9], 15.1], // lime
  [[0x1f344, ZWJ, 0x1f7eb], 15.1], // brown mushroom
  [[0x26d3, ZWJ, 0x1f4a5], 15.1], // broken chain
  [[0x1f642, ZWJ, 0x2194], 15.1], // head shaking horizontally
  [[0x1f642, ZWJ, 0x2195], 15.1], // head shaking vertically
  [[ZWJ, 0x27a1], 15.1], // anyone facing right
  [[0x1f9d1, ZWJ, 0x1f9d2], 15.1], // family: adult, child
  [[0x1f1e8, 0x1f1f6], 16], // flag: Sark
];

/** The newest emoji the iOS 17 floor draws (tech spec). */
const IOS_FLOOR = 15;

/** The rule (#308): nothing newer than this. */
const NEWEST_ALLOWED = 12;

/**
 * Newer than Emoji 12 but already in use before #308, and drawn by the iOS 17
 * floor. Add one only on purpose, after checking it's on the floor.
 */
const ON_THE_FLOOR: ReadonlySet<string> = new Set([
  '\u{1fab5}', // wood (Timber, fences): Emoji 13.0
  '\u{1faa8}', // rock (Stone): Emoji 13.0
  '\u{1fab6}', // feather (Turkey Feathers): Emoji 13.0
  '\u{1fab1}', // worm (explore): Emoji 13.0
  '\u{1fad0}', // blueberries (bramble hedge): Emoji 13.0
  '\u{1f6d6}', // hut: Emoji 13.0
  '\u{1fae7}', // bubbles (item chips): Emoji 14.0
]);

/** The emoji version that added a code point, or null for Emoji 12 and older. */
function versionOf(cp: number): number | null {
  if (cp >= 0x1fa70 && cp <= 0x1faff) {
    if (BLOCK_EMOJI_12.some(([lo, hi]) => cp >= lo && cp <= hi)) return null;
    // Not in 12–15: added in 16.0 or later (15.1 added only sequences).
    return BLOCK_NEWER.find(([lo, hi]) => cp >= lo && cp <= hi)?.[2] ?? 16;
  }
  return SINGLES_NEWER.get(cp) ?? null;
}

interface TooNew {
  readonly emoji: string;
  readonly version: number;
}

/** Every emoji in `text` newer than Emoji 12, with its version. */
function newerEmoji(text: string): TooNew[] {
  const found: TooNew[] = [];
  const bare = text.replaceAll('\uFE0F', '');
  for (const [cps, version] of SEQUENCES_NEWER) {
    const seq = String.fromCodePoint(...cps);
    if (bare.includes(seq)) found.push({ emoji: seq, version });
  }
  for (const ch of bare) {
    const version = versionOf(ch.codePointAt(0) ?? 0);
    if (version !== null) found.push({ emoji: ch, version });
  }
  return found;
}

function hex(emoji: string): string {
  return [...emoji].map((c) => `U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase()}`).join(' ');
}

/** Each offender as "file:line: 🪏 U+1FA8F is Emoji 16 (…the line…)". */
function offenders(sources: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [file, source] of Object.entries(sources)) {
    source.split('\n').forEach((line, i) => {
      for (const { emoji, version } of newerEmoji(line)) {
        if (version <= IOS_FLOOR && ON_THE_FLOOR.has(emoji)) continue;
        out.push(
          `${file}:${String(i + 1)}: ${emoji} ${hex(emoji)} is Emoji ${String(version)} (${line.trim()})`,
        );
      }
    });
  }
  return out;
}

describe('the emoji check (#308)', () => {
  it('flags emoji newer than Emoji 12, naming the version', () => {
    expect(newerEmoji('\u{1fa8f} A new Shovel!')).toEqual([{ emoji: '\u{1fa8f}', version: 16 }]);
    expect(newerEmoji('\u{1faa2}')).toEqual([{ emoji: '\u{1faa2}', version: 13 }]);
    expect(newerEmoji('\u{1fae7}')).toEqual([{ emoji: '\u{1fae7}', version: 14 }]);
    expect(newerEmoji('\u{1f972}')).toEqual([{ emoji: '\u{1f972}', version: 13 }]);
    expect(newerEmoji('\u2764\uFE0F\u200D\u{1f525}').map((f) => f.version)).toEqual([13.1]);
    expect(offenders({ 'x.ts': "shovel: '\u{1fa8f}'," })).toEqual([
      "x.ts:1: \u{1fa8f} U+1FA8F is Emoji 16 (shovel: '\u{1fa8f}',)",
    ]);
  });

  it('leaves Emoji 12 and older alone', () => {
    // 🧺 basket (11), 🪔 diya lamp (12), 🧗 climber (5), ⛏️ pick (1), 🩹 (12),
    // ❤️ (1), 🥱 yawn (12), skin tones and flags.
    const old =
      '\u{1f9fa} \u{1fa94} \u{1f9d7} \u26CF\uFE0F \u{1fa79} \u2764\uFE0F \u{1f971} \u{1f44b}\u{1f3fd} \u{1f1fa}\u{1f1f8}';
    expect(newerEmoji(old)).toEqual([]);
  });

  it('only lets through emoji the iOS 17 floor draws', () => {
    for (const emoji of ON_THE_FLOOR) {
      const [found] = newerEmoji(emoji);
      expect(found, hex(emoji)).toBeDefined();
      expect(found!.version, hex(emoji)).toBeGreaterThan(NEWEST_ALLOWED);
      expect(found!.version, hex(emoji)).toBeLessThanOrEqual(IOS_FLOOR);
    }
    // The shovel can never be let through: it's past the floor.
    expect(offenders({ 'x.ts': '\u{1fa8f}' })).toHaveLength(1);
  });

  it('finds none in what the client shows', () => {
    const client = import.meta.glob<string>(['../**/*.ts', '!../**/*.test.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    const shared = import.meta.glob<string>(
      [
        '../../../../packages/shared/src/data/**/*.ts',
        '!../../../../packages/shared/src/data/server/**',
        '!../../../../packages/shared/src/**/*.test.ts',
      ],
      { query: '?raw', import: 'default', eager: true },
    );
    // Sanity: the scan really reads the tables it guards.
    expect(Object.keys(client)).toContain('../inventory/tool-uses.ts');
    expect(Object.keys(client)).toContain('../inventory/item-icons.ts');
    expect(Object.keys(shared).length).toBeGreaterThan(5);
    expect(offenders({ ...client, ...shared })).toEqual([]);
  });
});
