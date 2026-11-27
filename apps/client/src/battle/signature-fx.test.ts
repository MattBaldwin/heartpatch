import {
  BATTLE_RULES,
  battleContentHash,
  GAME_DATA,
  type BattleSideId,
  type Move,
} from '@heartpatch/shared';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PlaybackStep } from './battle-playback.js';
import {
  NO_TRAIL,
  planStep,
  signatureCue,
  trailAfter,
  type MoveTrail,
  type PlanContext,
  type SignatureCue,
} from './choreography.js';
import { POOL_SIZE } from './effects.js';
import {
  emit,
  PARTICLE_SHAPES,
  particleAt,
  SIGNATURE_FALLBACK,
  SIGNATURE_FX,
  signatureOf,
  signatureTraits,
  type Particle,
  type ParticleShape,
  type ParticleState,
  type SignatureBeat,
} from './element-fx.js';

const PUBLIC = GAME_DATA.moves;

/**
 * The server's secret move table, by the fields a signature keys on (copied
 * from `packages/shared/src/data/server` on main 2d01b48; the client and its
 * tests can't import it, as the `forbid-server-data` plugin makes sure).
 * Power and accuracy are stand-ins; only the effects, element and targets matter here.
 */
const mv = (
  id: string,
  element: Move['element'],
  power: number,
  effects: NonNullable<Move['effects']> = [],
  targets?: Move['targets'],
): Move => ({
  id,
  name: id,
  description: id,
  element,
  power,
  accuracy: 100,
  effects,
  ...(targets ? { targets } : {}),
});
const SERVER_MOVES: readonly Move[] = [
  mv('rake-mouth', 'leaf', 90, [{ type: 'status', status: 'dizzy', chance: 15 }]),
  mv('stink-bomb', 'leaf', 55, [{ type: 'status', status: 'dizzy', chance: 20 }], 'all-foes'),
  mv('leaf-pile-pounce', 'leaf', 75, [{ type: 'flinch', chance: 25 }]),
  mv('count-to-three', 'leaf', 170, [{ type: 'windup' }]),
  mv('the-look', 'fire', 0, [
    { type: 'stat', target: 'opponent', stat: 'attack', stages: -1, chance: 100 },
  ]),
  mv('full-name-shout', 'fire', 85, [{ type: 'flinch', chance: 35 }]),
  mv('mama-bear-charge', 'fire', 80, [{ type: 'low-energy', extraPercent: 80 }]),
  mv('dad-joke', 'frost', 0, [{ type: 'status', status: 'dizzy', chance: 60 }]),
  mv('lawnmower-rumble', 'frost', 65, [], 'all-foes'),
  mv('thermostat-lock', 'frost', 70, [
    { type: 'stat', target: 'opponent', stat: 'speed', stages: -1, chance: 50 },
  ]),
  mv('ask-your-mother', 'frost', 0, [
    { type: 'assist', move: 'mama-bear-charge' },
    { type: 'stat', target: 'self', stat: 'defense', stages: 1, chance: 20 },
  ]),
  mv('pit-stop', 'spark', 0, [
    { type: 'heal', percent: 30 },
    { type: 'stat', target: 'self', stat: 'speed', stages: 1, chance: 100 },
  ]),
  mv('drift-spin', 'spark', 60, [], 'all-foes'),
  mv('speed-bump', 'spark', 70, [
    { type: 'stat', target: 'opponent', stat: 'speed', stages: -1, chance: 30 },
  ]),
  mv('heart-glow', 'light', 0, [
    { type: 'heal', percent: 30 },
    { type: 'stat', target: 'self', stat: 'defense', stages: 1, chance: 100 },
  ]),
  mv('heart-chorus', 'light', 60, [
    { type: 'stat', target: 'self', stat: 'speed', stages: 1, chance: 30 },
  ]),
];

/**
 * The server files' own text (an fs read, which the plugin doesn't see and
 * nothing bundles): the copy above must list every secret move, so a new or
 * renamed one fails here instead of drifting from the table.
 */
function serverMoveIds(): string[] {
  const dir = fileURLToPath(
    new URL('../../../../packages/shared/src/data/server/', import.meta.url),
  );
  const block = (file: string, name: string) => {
    const text = readFileSync(dir + file, 'utf8');
    const from = text.indexOf(`export const ${name}`);
    const to = text.indexOf('\n];', from);
    return [...text.slice(from, to).matchAll(/^\s{4}id: '([a-z0-9-]+)'/gm)].map((m) => m[1]!);
  };
  return [...block('boss-species.ts', 'BOSS_MOVES'), ...block('secret-species.ts', 'SECRET_MOVES')];
}
const ALL: readonly Move[] = [...PUBLIC, ...SERVER_MOVES];
const MOVES = new Map(ALL.map((m) => [m.id, m]));
const byId = (id: string): Move => {
  const m = MOVES.get(id);
  if (!m) throw new Error(`no move ${id}`);
  return m;
};

const BEATS: readonly SignatureBeat[] = ['windup', 'strike', 'hit', 'flinch', 'call', 'backup'];

const step = (kind: PlaybackStep['kind'], side: BattleSideId, extra: Partial<PlaybackStep> = {}) =>
  ({
    kind,
    side,
    slot: 0,
    text: '',
    callout: null,
    squish: null,
    energy: null,
    to: null,
    move: null,
    effectiveness: null,
    status: null,
    item: null,
    shielded: false,
    stance: null,
    ms: 700,
    ...extra,
  }) satisfies PlaybackStep;

/** Plays `steps` through the trail, returning each one's signature cue (the boss is `b`). */
function cues(steps: readonly PlaybackStep[], boss: BattleSideId | null = 'b') {
  let trail: MoveTrail = NO_TRAIL;
  return steps.map((s) => {
    trail = trailAfter(trail, s);
    return signatureCue(s, { boss, trail, moves: MOVES });
  });
}
const named = (c: SignatureCue | null) => (c ? `${c.key}/${c.beat}` : null);

describe('signature table (#190 PR 5)', () => {
  it('mirrors every secret move on the server (the copy can’t drift)', () => {
    expect(SERVER_MOVES.map((m) => m.id).sort()).toEqual(serverMoveIds().sort());
  });

  it('resolves every (effect, element) in the public and server move tables to an FX or its fallback', () => {
    let pairs = 0;
    for (const move of ALL) {
      for (const trait of signatureTraits(move)) {
        pairs += 1;
        const key = `${trait}:${move.element}`;
        // An entry of its own, or the kind's fallback (null: the element's ordinary look).
        const look = SIGNATURE_FX[key] ?? SIGNATURE_FALLBACK[trait];
        expect(look, `${move.id} ${key}`).not.toBeUndefined();
      }
      const sig = signatureOf(move);
      const traits = signatureTraits(move);
      const own = traits.find((t) => SIGNATURE_FX[`${t}:${move.element}`]);
      if (own) expect(sig?.key, move.id).toBe(`${own}:${move.element}`);
      else if (sig) expect(traits, move.id).toContain(sig.key);
    }
    expect(pairs).toBeGreaterThan(50);
    // A move with no traits (a plain hit) is ordinary.
    expect(signatureOf({ element: 'fire', effects: [], targets: 'one' })).toBeNull();
    expect(signatureOf(null)).toBeNull();
  });

  it('every entry is a pair some server move has, with valid beats and pooled shapes', () => {
    const emitted = new Set(ALL.flatMap((m) => signatureTraits(m).map((t) => `${t}:${m.element}`)));
    for (const [key, moment] of Object.entries(SIGNATURE_FX)) {
      expect(emitted, key).toContain(key);
      for (const [beat, fx] of Object.entries(moment)) {
        expect(BEATS, key).toContain(beat);
        for (const b of fx.bursts ?? []) {
          expect(PARTICLE_SHAPES, `${key}/${beat}`).toContain(b.shape);
          expect(b.count, `${key}/${beat}`).toBeGreaterThan(0);
          expect(b.delay + (b.spread ?? 0), `${key}/${beat} fits its step`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('gives the four BIG squishies their own moments, keyed by effect and element', () => {
    expect(signatureOf(byId('count-to-three'))?.key).toBe('windup:leaf');
    expect(signatureOf(byId('full-name-shout'))?.key).toBe('flinch:fire');
    expect(signatureOf(byId('ask-your-mother'))?.key).toBe('assist:frost'); // stat + assist
    expect(signatureOf(byId('drift-spin'))?.key).toBe('all-foes:spark');
    // A flinch with no entry of its own shivers (the kind's fallback); an area move with none is ordinary.
    expect(signatureOf(byId('leaf-pile-pounce'))?.key).toBe('flinch');
    expect(signatureOf(byId('lawnmower-rumble'))).toBeNull();
    // No public move has a signature.
    for (const m of PUBLIC) expect(signatureOf(m), m.id).toBeNull();
  });
});

describe('signatureCue (#190 PR 5)', () => {
  it('finds each beat of a signature turn from the log', () => {
    // Count to Three: the charge round, its count, then next round it lands.
    expect(
      cues([
        step('move', 'b', { move: 'count-to-three', charge: true }),
        step('effect', 'b', { windup: true, move: 'count-to-three' }),
        step('move', 'a', { move: PUBLIC[0]!.id }),
        step('hit', 'b'),
        step('move', 'b', { move: 'count-to-three', landing: true }),
        step('hit', 'a'),
      ]).map(named),
    ).toEqual([null, 'windup:leaf/windup', null, null, 'windup:leaf/strike', 'windup:leaf/hit']);
    // Full Name Shout: the shout, its hit, and the friend's flinch.
    expect(
      cues([
        step('move', 'b', { move: 'full-name-shout' }),
        step('hit', 'a'),
        step('effect', 'a', { slot: 1, flinch: true }),
      ]).map(named),
    ).toEqual(['flinch:fire/strike', null, 'flinch:fire/flinch']);
    // Ask Your Mother: the call, then the friend's move (keyed by the move that called it).
    expect(
      cues([
        step('move', 'b', { move: 'ask-your-mother' }),
        step('effect', 'b', { assist: true, move: 'mama-bear-charge' }),
        step('move', 'b', { move: 'mama-bear-charge', backup: true }),
        step('hit', 'a'),
      ]).map(named),
    ).toEqual([null, 'assist:frost/call', 'assist:frost/backup', null]);
    // Drift Spin: the skid, then a trail at every post it hits.
    expect(
      cues([
        step('move', 'b', { move: 'drift-spin' }),
        step('hit', 'a', { slot: 0 }),
        step('hit', 'a', { slot: 1 }),
        step('hit', 'a', { slot: 2 }),
      ]).map(named),
    ).toEqual([
      'all-foes:spark/strike',
      'all-foes:spark/hit',
      'all-foes:spark/hit',
      'all-foes:spark/hit',
    ]);
  });

  it('is only ever the boss’s: not the team’s moves, not outside a boss fight', () => {
    const shout = [step('move', 'a', { move: 'full-name-shout' }), step('hit', 'b')];
    expect(cues(shout).map(named)).toEqual([null, null]);
    expect(
      cues([step('move', 'b', { move: 'drift-spin' }), step('hit', 'a')], null).map(named),
    ).toEqual([null, null]);
  });
});

describe('planStep with a signature (#190 PR 5)', () => {
  const plan = (s: PlaybackStep, move: string, cue: SignatureCue | null, reduced = false) =>
    planStep(s, {
      move: byId(move),
      user: 'b',
      mySide: 'a',
      reduced,
      boss: 'b',
      signature: cue,
    } satisfies PlanContext);
  const cueOf = (key: string, beat: SignatureBeat): SignatureCue => ({
    key,
    beat,
    fx: SIGNATURE_FX[key]![beat]!,
  });

  it('stomps the count, shrugs for backup and shivers a flinch, in place of the usual act', () => {
    const windup = step('effect', 'b', { windup: true, squish: 'jiggle' });
    expect(plan(windup, 'count-to-three', null).acts.map((a) => a.kind)).toEqual(['power-up']);
    expect(
      plan(windup, 'count-to-three', cueOf('windup:leaf', 'windup')).acts.map((a) => a.kind),
    ).toEqual(['stomp']);
    const call = step('effect', 'b', { assist: true, squish: 'bounce' });
    expect(
      plan(call, 'ask-your-mother', cueOf('assist:frost', 'call')).acts.map((a) => a.kind),
    ).toEqual(['shrug']);
    const flinch = step('effect', 'a', { flinch: true, squish: 'wobble' });
    expect(
      plan(flinch, 'full-name-shout', cueOf('flinch:fire', 'flinch')).acts.map(
        (a) => `${a.side}:${a.kind}`,
      ),
    ).toEqual(['a:shiver']);
  });

  it('leans the camera 2° on Drift Spin, and not at all with reduced motion', () => {
    const spin = step('move', 'b', { move: 'drift-spin' });
    const cue = cueOf('all-foes:spark', 'strike');
    expect(plan(spin, 'drift-spin', cue).camera.tilt).toBeCloseTo((2 * Math.PI) / 180);
    expect(plan(spin, 'drift-spin', null).camera.tilt).toBeUndefined();
    const calm = plan(spin, 'drift-spin', cue, true).camera;
    expect(calm.tilt ?? 0).toBe(0);
    expect(calm.shake).toBe(0);
    expect(calm.roll).toBe(0);
  });

  it('adds its bursts as pooled signature effects, in order through the step', () => {
    const s = step('effect', 'b', { windup: true, squish: 'jiggle' });
    const p = plan(s, 'count-to-three', cueOf('windup:leaf', 'windup'));
    const sig = p.effects.filter((e) => e.kind === 'signature');
    expect(sig).toHaveLength(1);
    expect(sig[0]!.burst?.shape).toBe('leaf');
    expect(sig[0]!.side).toBe('b');
  });
});

describe('budgets at the heaviest beat (#190 PR 5)', () => {
  // A BIG squishy is about twice a friend's height (bossScale 2.2).
  const H = { b: 4.4, a: 2 } as const;
  const HOME = { a: { x: 0, y: 1, z: -4 }, b: { x: 0, y: 2.2, z: 4 } } as const;

  /** Every particle a plan spawns (as the scene would), its effects at `now + delay`. */
  function spawn(
    s: PlaybackStep,
    ctx: PlanContext,
    now: number,
    salt: number,
    ringsAndArcs: Particle[] = [],
  ): Particle[] {
    const p = planStep(s, ctx);
    return p.effects.flatMap((e, i) => {
      const made = emit({
        kind: e.kind,
        element: e.element,
        strength: e.strength,
        now: now + e.delay,
        at: HOME[e.side],
        height: H[e.side],
        to: HOME[e.side === 'a' ? 'b' : 'a'],
        duration: e.kind === 'signature' || e.kind === 'trail' ? s.ms : 0,
        salt: salt + i,
        ...(e.burst ? { burst: e.burst } : {}),
        reduced: ctx.reduced,
      });
      if (e.burst?.pattern === 'rings' || e.burst?.pattern === 'arc') ringsAndArcs.push(...made);
      return made;
    });
  }

  /** The most of each shape alive at once over [from, to]. */
  function peaks(parts: readonly Particle[], from: number, to: number) {
    const out: ParticleState = {
      x: 0,
      y: 0,
      z: 0,
      sx: 0,
      sy: 0,
      sz: 0,
      yaw: 0,
      tumble: 0,
      billboard: false,
      roll: 0,
    };
    const peak = new Map<ParticleShape, number>();
    let total = 0;
    for (let t = from; t <= to; t += 20) {
      const live = new Map<ParticleShape, number>();
      let all = 0;
      for (const p of parts) {
        if (!particleAt(p, t, out)) continue;
        live.set(p.shape, (live.get(p.shape) ?? 0) + 1);
        all += 1;
      }
      for (const [k, v] of live) peak.set(k, Math.max(peak.get(k) ?? 0, v));
      total = Math.max(total, all);
    }
    return { peak, total };
  }

  /** Each signature turn as the log plays it, step by step (all steps of the turn spawn). */
  const TURNS: Record<string, PlaybackStep[]> = {
    'windup:leaf': [
      step('move', 'b', { move: 'count-to-three', charge: true, ms: 650 }),
      step('effect', 'b', { windup: true, squish: 'jiggle', move: 'count-to-three' }),
      step('move', 'b', { move: 'count-to-three', landing: true, ms: 650 }),
      step('hit', 'a', { effectiveness: 'super', ms: 800 }),
    ],
    'flinch:fire': [
      step('move', 'b', { move: 'full-name-shout', ms: 650 }),
      step('hit', 'a', { ms: 800 }),
      step('effect', 'a', { flinch: true, squish: 'wobble' }),
    ],
    'assist:frost': [
      step('move', 'b', { move: 'ask-your-mother', ms: 650 }),
      step('effect', 'b', { assist: true, squish: 'bounce', move: 'mama-bear-charge' }),
      step('move', 'b', { move: 'mama-bear-charge', backup: true, ms: 650 }),
      step('hit', 'a', { effectiveness: 'super', ms: 800 }),
    ],
    'all-foes:spark': [
      step('move', 'b', { move: 'drift-spin', ms: 650 }),
      step('hit', 'a', { slot: 0, ms: 800 }),
      step('hit', 'a', { slot: 1, ms: 800 }),
      step('hit', 'a', { slot: 2, ms: 800 }),
    ],
  };

  for (const reduced of [false, true]) {
    it(`keeps every pool under its cap through each signature turn${reduced ? ' (reduced motion)' : ''}`, () => {
      for (const [key, steps] of Object.entries(TURNS)) {
        let trail: MoveTrail = NO_TRAIL;
        let now = 1000;
        const parts: Particle[] = [];
        const ringsAndArcs: Particle[] = [];
        let sawSignature = false;
        steps.forEach((s, i) => {
          trail = trailAfter(trail, s);
          const cue = signatureCue(s, { boss: 'b', trail, moves: MOVES });
          if (cue) sawSignature = true;
          const move = MOVES.get(trail.last?.move ?? '') ?? null;
          const ctx: PlanContext = {
            move,
            user: trail.last?.user ?? null,
            mySide: 'a',
            reduced,
            boss: 'b',
            landing: s.kind === 'hit' && i > 0 && steps[i - 1]?.landing === true,
            signature: cue,
          };
          parts.push(...spawn(s, ctx, now, i * 100, ringsAndArcs));
          now += s.ms;
        });
        expect(sawSignature, key).toBe(true);
        const { peak, total } = peaks(parts, 1000, now + 1500);
        for (const shape of PARTICLE_SHAPES) {
          expect(peak.get(shape) ?? 0, `${key}: ${shape}`).toBeLessThanOrEqual(POOL_SIZE[shape]);
        }
        // The plan's budgets: ≤ 150 live leaves, ≤ 80 rings and arc bits.
        expect(peak.get('leaf') ?? 0, `${key}: leaves`).toBeLessThanOrEqual(150);
        // Live at once across the turn (a skid's arcs and three hits' trails overlap).
        expect(
          peaks(ringsAndArcs, 1000, now + 1500).total,
          `${key}: rings and arcs`,
        ).toBeLessThanOrEqual(80);
        expect(total, `${key}: all live`).toBeLessThanOrEqual(
          Object.values(POOL_SIZE).reduce((a, b) => a + b, 0),
        );
      }
    });
  }

  it('keeps the rings and arcs of every signature beat within 80 bits', () => {
    for (const [key, moment] of Object.entries(SIGNATURE_FX)) {
      for (const [beat, fx] of Object.entries(moment)) {
        const ringsAndArcs = (fx.bursts ?? [])
          .filter((b) => b.pattern === 'rings' || b.pattern === 'arc')
          .reduce((n, b) => n + b.count, 0);
        expect(ringsAndArcs, `${key}/${beat}`).toBeLessThanOrEqual(80);
      }
    }
  });
});

describe('presentation only (#190 PR 5)', () => {
  it('leaves the battle content hash unchanged', () => {
    const data = { ...GAME_DATA, moves: [...ALL] };
    const before = battleContentHash(data, BATTLE_RULES);
    const json = JSON.stringify(ALL);
    const looks = ALL.flatMap((m) => BEATS.map((beat) => signatureOf(m)?.moment[beat]));
    expect(looks.filter(Boolean).length).toBeGreaterThan(0);
    cues([
      step('move', 'b', { move: 'count-to-three', charge: true }),
      step('effect', 'b', { windup: true }),
      step('move', 'b', { move: 'ask-your-mother' }),
      step('effect', 'b', { assist: true }),
      step('move', 'b', { move: 'mama-bear-charge', backup: true }),
    ]);
    expect(JSON.stringify(ALL)).toBe(json);
    expect(battleContentHash(data, BATTLE_RULES)).toBe(before);
  });
});

describe('emit: signature bursts (#190 PR 5)', () => {
  const base = {
    kind: 'signature',
    element: 'leaf',
    strength: 1,
    now: 1000,
    at: { x: 0, y: 2.2, z: 4 },
    // The team (and the camera) is towards -z.
    to: { x: 0, y: 1, z: -4 },
    height: 4.4,
    duration: 700,
    salt: 3,
    reduced: false,
  } as const;
  const burstOf = (key: string, beat: SignatureBeat, i = 0) =>
    SIGNATURE_FX[key]![beat]!.bursts![i]!;

  it('throws each pattern, deterministically, born no earlier than its cue', () => {
    for (const [key, moment] of Object.entries(SIGNATURE_FX)) {
      for (const fx of Object.values(moment)) {
        for (const burst of fx.bursts ?? []) {
          const out = emit({ ...base, burst });
          expect(out.length, key).toBeGreaterThanOrEqual(burst.count);
          expect(emit({ ...base, burst })).toEqual(out);
          for (const p of out) {
            expect(p.born, key).toBeGreaterThanOrEqual(1000);
            expect(p.size, key).toBeGreaterThan(0);
          }
        }
      }
    }
    expect(emit({ ...base })).toEqual([]);
  });

  it('grows the leaf pile across the count, round the BIG squishy (not inside it)', () => {
    const out = emit({ ...base, burst: burstOf('windup:leaf', 'windup') });
    const born = out.map((p) => p.born);
    expect(Math.max(...born) - Math.min(...born)).toBeGreaterThan(700 * 0.7);
    const state: ParticleState = {
      x: 0,
      y: 0,
      z: 0,
      sx: 0,
      sy: 0,
      sz: 0,
      yaw: 0,
      tumble: 0,
      billboard: false,
      roll: 0,
    };
    const p = out[0]!;
    expect(particleAt(p, p.born + 600, state)).toBe(true);
    expect(Math.hypot(state.x - base.at.x, (state.z - base.at.z) / 0.8)).toBeGreaterThan(4.4 * 0.3);
  });

  it('lays a skid arc on the ground, drawn in order, and rings at the feet', () => {
    const arc = emit({ ...base, element: 'spark', burst: burstOf('all-foes:spark', 'strike') });
    // Just off the ground, and on its front: the side facing the team, so the camera sees it.
    expect(arc.every((p) => p.origin.y > 0 && p.origin.y < 0.2 * 4.4 + 0.1)).toBe(true);
    expect(arc.every((p) => p.origin.z <= base.at.z + 0.01)).toBe(true);
    expect(arc.map((p) => p.born)).toEqual([...arc.map((p) => p.born)].sort((a, b) => a - b));
    // It turns with the fight: facing +x, it lies on the +x side.
    const turned = emit({
      ...base,
      to: { x: 10, y: 1, z: 4 },
      burst: burstOf('all-foes:spark', 'strike'),
    });
    expect(turned.every((p) => p.origin.x >= base.at.x - 0.01)).toBe(true);
    const rings = emit({ ...base, element: 'fire', burst: burstOf('flinch:fire', 'strike', 1) });
    expect(rings).toHaveLength(3);
    expect(rings.every((p) => p.motion === 'ring' && p.origin.y === 0.06)).toBe(true);
  });

  it('takes the move’s own colours for the backup’s flash (fire, in a frost fight)', () => {
    const halo = burstOf('assist:frost', 'backup', 1);
    const fire = emit({ ...base, element: 'fire', burst: halo });
    expect(fire.every((p) => ['#ff7a3d', '#ffb347', '#ffe066'].includes(p.color))).toBe(true);
    // Beside the BIG squishy (to its side, a little towards the team), not on it.
    const o = fire[0]!.origin;
    expect(Math.abs(o.x - base.at.x)).toBeGreaterThan(4.4 * 0.5);
    expect(o.z).toBeLessThan(base.at.z);
    // Its `side` is the fighter's right (`#centre`'s convention): facing -z, that is -x.
    expect(o.x).toBeLessThan(base.at.x);
  });

  it('puts a friend’s spark trail on the camera’s side, away from the BIG squishy', () => {
    // A friend at -z facing the boss at +z: the camera is behind the friend, at -z.
    const friend = {
      ...base,
      element: 'spark',
      at: { x: 0, y: 1, z: -4 },
      to: { x: 0, y: 2.2, z: 4 },
      height: 2,
    };
    const trail = emit({ ...friend, burst: burstOf('all-foes:spark', 'hit') });
    expect(trail.length).toBeGreaterThan(0);
    expect(trail.every((p) => p.origin.z <= friend.at.z + 0.01)).toBe(true);
  });

  it('is thinner for reduced motion', () => {
    const burst = burstOf('windup:leaf', 'windup');
    expect(emit({ ...base, burst, reduced: true }).length).toBeLessThan(
      emit({ ...base, burst }).length,
    );
  });
});
