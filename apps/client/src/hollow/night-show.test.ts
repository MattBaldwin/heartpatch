import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import {
  findAvoidedWords,
  HOLLOW_RULES,
  hexDistance,
  hexKey,
  hexNeighbors,
  type HexKey,
  type MapView,
  type MorningReport,
  type WalkPointView,
} from '@heartpatch/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { testView, userId } from '../map/test-view.js';
import { createDarkLand, darkTiles, dashedHexRing, heartSeedOf, placeOf } from './dark-land.js';
import { SHOW } from './hollow-config.js';
import { HollowLayer, standOf, stepPose } from './hollow-layer.js';
import { createNightShow, type ShowStage } from './night-show.js';
import { firesLine, NIGHT_TEXT, reachText, STAGES, stageNights, wildLine } from './night-text.js';
import { beatIndexAt, joinNames, narrate, showBeats, SHOW_TEXT } from './show-timeline.js';

const ME = userId(1);
const PROWL = HOLLOW_RULES.show.prowlMinutes * 60_000;

/** A walk the server could send: enter, two recoils, a strike between them, two strikes, leave. */
const WALK: WalkPointView[] = [
  { q: 3, r: 0, kind: 'enter' },
  { q: 3, r: 0, kind: 'recoil' },
  { q: 2, r: 2, kind: 'strike' },
  { q: 0, r: 3, kind: 'recoil' },
  { q: -3, r: 3, kind: 'strike' },
  { q: -3, r: 3, kind: 'leave' },
];

describe('the show timeline', () => {
  it('backs away across the prowl, then strikes at its end, live', () => {
    const beats = showBeats(WALK, PROWL);
    expect(beats.map((b) => [b.kind, b.q, b.r, b.at])).toEqual([
      ['enter', 3, 0, 0],
      ['recoil', 3, 0, PROWL / 3],
      ['recoil', 0, 3, (2 * PROWL) / 3],
      ['strike', 2, 2, PROWL],
      ['strike', -3, 3, PROWL + SHOW.strikeGapMs],
      ['leave', -3, 3, PROWL + 2 * SHOW.strikeGapMs],
    ]);
    // A quiet night: he leaves at the prowl's end, kept out.
    const quiet = showBeats(
      WALK.filter((p) => p.kind !== 'strike'),
      PROWL,
    );
    expect(quiet.at(-1)).toEqual({ kind: 'leave', q: 0, r: 3, at: PROWL });
    expect(showBeats([], PROWL)).toEqual([]);
  });

  it('plays the same stops a few seconds apart in the morning replay', () => {
    const beats = showBeats(WALK, null);
    expect(beats.map((b) => b.at)).toEqual([0, 1, 2, 3, 4, 5].map((i) => i * SHOW.replayBeatMs));
    expect(beats.map((b) => b.kind)).toEqual([
      'enter',
      'recoil',
      'recoil',
      'strike',
      'strike',
      'leave',
    ]);
  });

  it('finds the stop a kid joins at part way', () => {
    const beats = showBeats(WALK, PROWL);
    expect(beatIndexAt(beats, -1)).toBe(-1);
    expect(beatIndexAt(beats, 0)).toBe(0);
    expect(beatIndexAt(beats, 14 * 60_000)).toBe(1);
    expect(beatIndexAt(beats, PROWL)).toBe(3);
  });

  it('narrates my walk kindly, telling who he took once, on the last strike', () => {
    const beats = showBeats(WALK, PROWL);
    const story = {
      placeOf: () => 'your meadow',
      isHome: (h: { q: number; r: number }) => h.q === 0 && h.r === 3,
      reclaimed: new Set<HexKey>(['2,2']),
      taken: ['Pip'],
      strikes: 2,
    };
    const lines = beats.map((_, i) => narrate(beats, i, story));
    expect(lines).toEqual([
      SHOW_TEXT.enter,
      "The fire's too bright! He backs away from your meadow.",
      SHOW_TEXT.recoilHome,
      'He found a dark spot. Your meadow went wild again.',
      'He found a dark spot… Pip was taken to the Hollow. You can rescue them!',
      SHOW_TEXT.leave,
    ]);
    expect(narrate(beats, 5, { ...story, strikes: 0 })).toBe(SHOW_TEXT.safe);
    expect(SHOW_TEXT.taken(['Pip', 'Mo'])).toBe(
      'Pip and Mo were taken to the Hollow. You can rescue them!',
    );
    expect(joinNames(['Pip', 'Mo', 'Bo'])).toBe('Pip, Mo and Bo');
    for (const line of [...lines, SHOW_TEXT.safe, SHOW_TEXT.found, SHOW_TEXT.recoilHome]) {
      expect(findAvoidedWords(line)).toEqual([]);
    }
  });
});

describe('the night words', () => {
  it('names the stages with moons and the nights from the curve', () => {
    expect(stageNights()).toEqual({
      watching: 'nights 1–2',
      curious: 'nights 3–6',
      bold: 'nights 7–13',
      boldest: 'night 14 on',
    });
    expect(STAGES.bold).toEqual({ moon: '🌓', name: 'Bold' });
    expect(NIGHT_TEXT.stageChip('bold')).toBe("🌓 He's bold tonight");
  });

  it('says how many dark spots he reaches for, never a chance, and less on a gentle patch', () => {
    expect(reachText('watching', 'on')).toBe("He's only watching tonight.");
    expect(reachText('curious', 'on')).toBe('He might reach for 1 dark spot.');
    expect(reachText('bold', 'on')).toBe("He'll reach for 1 or 2 dark spots.");
    expect(reachText('boldest', 'on')).toBe("He'll reach for up to 3 dark spots.");
    expect(reachText('boldest', 'gentle')).toBe("He'll reach for 1 dark spot.");
  });

  it('counts the dark spots and who sleeps out there', () => {
    expect(NIGHT_TEXT.darkSpots(1)).toBe('🌑 1 dark spot');
    expect(NIGHT_TEXT.darkSpots(2)).toBe('🌑 2 dark spots');
    expect(NIGHT_TEXT.outInDark(['Pip'])).toBe('Pip is out in the dark tonight!');
    expect(NIGHT_TEXT.outInDark(['Pip', 'Mo'])).toBe('Pip and Mo are out in the dark tonight!');
    expect(NIGHT_TEXT.outInDark(['Pip', 'Mo', 'Bo'])).toBe(
      'Pip and 2 friends are out in the dark tonight!',
    );
    expect(NIGHT_TEXT.outInDark([])).toBe('Some of your land is dark tonight!');
    expect(NIGHT_TEXT.noLight(1)).toMatch(/^1 bit of your land has no fire light\./);
  });

  it('tells the fires and the land gone wild calmly', () => {
    const base: MorningReport = {
      night: '2026-10-31',
      taken: [],
      sheltered: 0,
      exposed: 0,
      reclaimed: [],
      stage: 'bold',
      walk: [],
      lostBuildings: { fires: 0, fences: 0, trainingGrounds: 0 },
    };
    expect(firesLine([base])).toBeNull();
    expect(firesLine([{ ...base, walk: [{ q: 1, r: 0, kind: 'recoil' }] }])?.text).toBe(
      'He backed away once!',
    );
    expect(wildLine([base])).toBeNull();
    expect(
      wildLine([
        {
          ...base,
          reclaimed: [{ q: 1, r: 0 }],
          lostBuildings: { fires: 2, fences: 0, trainingGrounds: 1 },
        },
      ])?.text,
    ).toBe(
      'A bit of your dark land went wild again. Your fires and Training Grounds there came back to your bag.',
    );
  });

  it('uses kind words only (style guide §9) and keeps the chips short', () => {
    const text = [
      ...Object.values(NIGHT_TEXT).flatMap((v): string[] => (typeof v === 'string' ? [v] : [])),
      NIGHT_TEXT.nightIn(20),
      NIGHT_TEXT.darkSpots(3),
      NIGHT_TEXT.outInDark(['Pip', 'Mo', 'Bo']),
      NIGHT_TEXT.noLight(3),
      ...(['watching', 'curious', 'bold', 'boldest'] as const).flatMap((s) => [
        NIGHT_TEXT.stageChip(s),
        NIGHT_TEXT.tonight(s),
        reachText(s, 'on'),
      ]),
    ];
    for (const line of text) expect(findAvoidedWords(line)).toEqual([]);
    for (const chip of [
      NIGHT_TEXT.nightIn(20),
      NIGHT_TEXT.darkSpots(12),
      NIGHT_TEXT.stageChip('boldest'),
    ]) {
      expect(chip.split(' ').length).toBeLessThanOrEqual(5);
    }
  });
});

/** My land grown out from home by `extra` tiles, with a lit level-1 fire on the first `lit`. */
function myLand(extra: number, lit: number): MapView {
  const view = testView(1);
  const seed = heartSeedOf(view, ME)!;
  const mine = new Set(view.tiles.filter((t) => t.ownerUserId === ME).map(hexKey));
  const grown: string[] = [];
  while (grown.length < extra) {
    const next = view.tiles
      .filter(
        (t) =>
          !mine.has(hexKey(t)) &&
          t.homeSlot === null &&
          t.terrain !== 'junipers-gap' &&
          hexNeighbors(t).some((n) => mine.has(hexKey(n))),
      )
      .sort((a, b) => hexDistance(a, seed) - hexDistance(b, seed) || a.q - b.q || a.r - b.r)[0]!;
    mine.add(hexKey(next));
    grown.push(hexKey(next));
  }
  return {
    ...view,
    tiles: view.tiles.map((t) => {
      const i = grown.indexOf(hexKey(t));
      if (i < 0) return t;
      return {
        ...t,
        ownerUserId: ME,
        buildings:
          i < lit
            ? [
                {
                  id: `0190a8c4-0000-7000-8000-0000000003${String(i).padStart(2, '0')}`,
                  buildingId: 'hearthfire',
                  kind: 'hearthfire' as const,
                  level: 1,
                  spot: 0,
                  lit: true,
                  safeRadius: 1,
                },
              ]
            : [],
      };
    }),
  };
}

describe('my dark land', () => {
  const engine = new NullEngine();
  afterEach(() => {
    for (const scene of [...engine.scenes]) scene.dispose();
  });

  it('is my land outside home that no lit fire reaches, farthest from home first', () => {
    const view = myLand(10, 0);
    const seed = heartSeedOf(view, ME)!;
    const dark = darkTiles(view, ME);
    expect(dark).toHaveLength(10);
    const far = dark.map((t) => hexDistance(t, seed));
    expect([...far].sort((a, b) => b - a)).toEqual(far);
    // Home is always safe, and someone else's land isn't mine to worry about.
    expect(dark.every((t) => t.homeSlot === null && t.ownerUserId === ME)).toBe(true);
    expect(darkTiles(view, userId(2))).toEqual([]);
    expect(darkTiles(view, null)).toEqual([]);
    // A lit fire lights its ring.
    const lit = myLand(10, 1);
    const fire = lit.tiles.find((t) => t.buildings.length > 0)!;
    expect(darkTiles(lit, ME).some((t) => hexDistance(t, fire) <= 1)).toBe(false);
    expect(darkTiles(lit, ME).length).toBeLessThan(10);
    expect(placeOf({ terrain: 'meadow' })).toBe('your meadow');
    expect(placeOf(undefined)).toBe('your land');
  });

  it('draws a dashed edge as one instanced mesh, only while there is dark land', () => {
    const ring = dashedHexRing(0.6, 2, 0.5, 0.04);
    // 6 edges × 2 dashes, each a quad.
    expect(ring.positions.length / 3).toBe(6 * 2 * 4);
    expect(ring.indices.length / 3).toBe(6 * 2 * 2);
    const scene = new Scene(engine);
    // No root: the moons are DOM (e2e checks them); the edge is the scene's.
    const layer = createDarkLand(null, () => ME);
    layer.attach(scene, myLand(0, 0));
    const edge = scene.getMeshByName('dark-edge');
    expect(edge?.isEnabled()).toBe(false);
    const meshes = scene.meshes.length;
    layer.update?.(myLand(6, 0));
    expect(edge?.isEnabled()).toBe(true);
    expect((edge as unknown as { thinInstanceCount: number }).thinInstanceCount).toBe(6);
    expect(layer.debug.tiles).toBe(6);
    expect(scene.meshes.length).toBe(meshes);
    layer.update?.(myLand(0, 0));
    expect(edge?.isEnabled()).toBe(false);
  });
});

describe('the Hollow Man walks the border', () => {
  const engine = new NullEngine();
  afterEach(() => {
    for (const scene of [...engine.scenes]) scene.dispose();
  });

  it('stands outside the tile, away from home', () => {
    const seed = { q: 0, r: 0 };
    const at = standOf({ q: 3, r: 0 }, seed);
    const tile = { x: 0.65 * Math.sqrt(3) * 3, z: 0 };
    expect(at.x).toBeGreaterThan(tile.x);
    expect(at.z).toBeCloseTo(0);
  });

  it('leans in at a lit tile with his eyes flaring, and never flares with reduced motion', () => {
    const from = { x: 0, z: 0 };
    const stand = { x: 2, z: 0 };
    const tile = { x: 1, z: 0 };
    const mid = stepPose('recoil', 0.7, from, stand, tile, false);
    expect(mid.flare).toBeGreaterThan(0.5);
    expect(mid.x).toBeLessThan(stand.x);
    expect(stepPose('recoil', 0.7, from, stand, tile, true).flare).toBe(0);
    expect(stepPose('strike', 0.7, from, stand, tile, false).reach).toBeGreaterThan(0.5);
    const end = stepPose('recoil', 1, from, stand, tile, false);
    expect(end).toMatchObject({ x: stand.x, z: stand.z, flare: 0, alpha: SHOW.waitAlpha });
    expect(stepPose('leave', 1, from, stand, tile, false).alpha).toBe(0);
  });

  it('walks one Hollow Man per Keeper, plays a stop on its own animation, then goes', () => {
    const scene = new Scene(engine);
    const layer = new HollowLayer({ invalidate: () => undefined });
    layer.attach(scene, testView(2));
    const meshes = scene.meshes.length;
    let done = 0;
    expect(
      layer.walk(ME, { kind: 'enter', q: 3, r: 0 }, { q: 0, r: 0 }, false, () => (done += 1)),
    ).toBe(true);
    // Three draw calls for him, only while he's out; the stop keeps the map drawing.
    expect(scene.meshes.length).toBe(meshes + 3);
    expect(scene.animatables.length).toBeGreaterThan(0);
    expect(layer.debug).toMatchObject({ walking: 1, steps: 1 });
    layer.walk(userId(2), { kind: 'enter', q: -3, r: 0 }, null, true);
    expect(layer.debug.walking).toBe(2);
    // A new stop finishes the one still playing first.
    layer.walk(ME, { kind: 'recoil', q: 3, r: 0 }, { q: 0, r: 0 }, false);
    expect(done).toBe(1);
    layer.walk(userId(2), { kind: 'leave', q: -3, r: 0 }, null, true);
    expect(layer.debug.walking).toBe(1);
    layer.endWalks();
    expect(layer.debug.walking).toBe(0);
    expect(scene.meshes.length).toBe(meshes);
  });

  it('does nothing without a map on screen', () => {
    const layer = new HollowLayer({ invalidate: () => undefined });
    expect(layer.walk(ME, { kind: 'enter', q: 0, r: 0 }, null, false)).toBe(false);
  });
});

describe('the night show', () => {
  /** A fake clock and timers, and a stage that records what it was told. */
  function rig() {
    let clock = 1_000_000;
    let timers: { at: number; fn: () => void; id: number }[] = [];
    let ids = 0;
    const walked: string[] = [];
    const holds: number[] = [];
    let held: ReadonlyMap<HexKey, string> = new Map();
    const cues: string[] = [];
    const stage: ShowStage = {
      walk: (keeper, beat, _seed, still, done) => {
        walked.push(`${keeper === ME ? 'me' : 'them'}:${beat.kind}${still ? ':still' : ''}`);
        done?.();
        return true;
      },
      endWalks: () => walked.push('end'),
      hold: (next) => {
        held = new Map(next);
        holds.push(next.size);
      },
      cue: (kind) => cues.push(kind),
    };
    const caption = { line: '', shown: false };
    const show = createNightShow({
      caption: () => ({
        say: (line) => {
          caption.line = line;
          caption.shown = true;
        },
        hide: () => {
          caption.line = '';
          caption.shown = false;
        },
        get shown() {
          return caption.shown;
        },
      }),
      stage,
      now: () => clock,
      setTimer: (fn, ms) => {
        const id = (ids += 1);
        timers.push({ at: clock + ms, fn, id });
        return id;
      },
      clearTimer: (id) => {
        timers = timers.filter((t) => t.id !== id);
      },
    });
    const advance = (ms: number) => {
      const until = clock + ms;
      for (;;) {
        const next = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        timers = timers.filter((t) => t !== next);
        clock = next.at;
        next.fn();
      }
      clock = until;
    };
    return {
      show,
      caption,
      walked,
      holds,
      cues,
      held: () => held,
      advance,
      now: () => clock,
    };
  }
  const story = () => ({
    placeOf: () => 'your meadow',
    isHome: () => false,
    reclaimed: new Set<HexKey>(['2,2', '-3,3']),
    taken: ['Pip'],
    strikes: 2,
  });
  const mine = {
    userId: ME,
    walk: WALK,
    reclaimed: [
      { q: 2, r: 2 },
      { q: -3, r: 3 },
    ],
    seed: { q: 0, r: 0 },
    story,
  };

  it('plays live from nightfall, holding the land he wins back until he strikes there', () => {
    const t = rig();
    let ended: boolean | null = null;
    expect(t.show.play([mine], t.now(), PROWL, (s) => (ended = s))).toBe(true);
    expect(t.show.debug).toMatchObject({ playing: true, mode: 'live', held: 2, beats: 6 });
    t.advance(0);
    expect(t.show.debug.line).toBe(SHOW_TEXT.enter);
    expect(t.caption.shown).toBe(true);
    t.advance(PROWL / 3);
    expect(t.show.debug.line).toBe("The fire's too bright! He backs away from your meadow.");
    expect(t.show.debug.held).toBe(2);
    t.advance((2 * PROWL) / 3 + 2 * SHOW.strikeGapMs);
    // Both strikes have landed: the land shows wild, and who he took is told.
    expect(t.held().size).toBe(0);
    expect(t.show.debug.line).toBe(SHOW_TEXT.leave);
    expect(t.cues).toEqual(['enter', 'recoil', 'recoil', 'strike', 'strike', 'leave']);
    t.advance(10_000);
    expect(ended).toBe(false);
    expect(t.show.playing).toBe(false);
  });

  it('joins part way for a kid who opens the app at 7:14', () => {
    const t = rig();
    const nightfall = t.now() - 14 * 60_000;
    t.show.play([mine], nightfall, PROWL, () => undefined);
    // He stands where his first recoil ended, without playing it again.
    expect(t.walked).toEqual(['me:recoil:still']);
    expect(t.cues).toEqual([]);
    expect(t.show.debug.beat).toBe(1);
    t.advance(PROWL);
    expect(t.walked).toContain('me:strike');
  });

  it('plays others’ walks silently, and Skip shows the land as it is at once', () => {
    const t = rig();
    const theirs = { ...mine, userId: userId(2), story: null };
    let ended: boolean | null = null;
    t.show.play([theirs], t.now(), PROWL, (s) => (ended = s));
    t.advance(0);
    expect(t.show.debug.line).toBe('');
    expect(t.caption.shown).toBe(false);
    expect(t.held().size).toBe(2);
    t.show.skip();
    expect(ended).toBe(true);
    expect(t.held().size).toBe(0);
    expect(t.walked.at(-1)).toBe('end');
    // Nothing to walk: nothing plays.
    expect(t.show.play([{ ...mine, walk: [] }], t.now(), PROWL, () => undefined)).toBe(false);
  });

  it('plays the morning replay sped up', () => {
    const t = rig();
    let ended: boolean | null = null;
    t.show.play([mine], t.now(), null, (s) => (ended = s));
    expect(t.show.debug.mode).toBe('replay');
    t.advance(6 * SHOW.replayBeatMs + 3_000);
    expect(ended).toBe(false);
    expect(t.walked.filter((w) => w.startsWith('me:'))).toEqual([
      'me:enter',
      'me:recoil',
      'me:recoil',
      'me:strike',
      'me:strike',
      'me:leave',
    ]);
  });
});
