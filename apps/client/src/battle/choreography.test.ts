import { FEELINGS, type Move } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { BATTLE_CAMERA, CHOREO } from './battle-config.js';
import type { PlaybackStep } from './battle-playback.js';
import {
  ACT_END,
  actPose,
  actRunning,
  FEELING_TRAITS,
  heldPose,
  hitStrength,
  lerpPose,
  moveStyle,
  planStep,
  readyPose,
  REST,
  SUPER_STRENGTH,
  type Act,
  type ActKind,
  type PlanContext,
  type Pose,
} from './choreography.js';

const step = (kind: PlaybackStep['kind'], side: 'a' | 'b', extra: Partial<PlaybackStep> = {}) =>
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
    ms: 800,
    ...extra,
  }) satisfies PlaybackStep;

const strike: Move = {
  id: 'test-boop',
  name: 'Boop',
  description: 'A boop.',
  element: 'fire',
  power: 40,
  accuracy: 100,
};
const hex: Move = {
  ...strike,
  id: 'test-hex',
  power: 0,
  effects: [{ type: 'status', status: 'dizzy', chance: 50 }],
};
const boost: Move = {
  ...strike,
  id: 'test-boost',
  power: 0,
  effects: [{ type: 'stat', target: 'self', stat: 'attack', stages: 1, chance: 100 }],
};

const ctx = (extra: Partial<PlanContext> = {}): PlanContext => ({
  move: strike,
  user: 'a',
  mySide: 'a',
  reduced: false,
  ...extra,
});

const act = (kind: ActKind, extra: Partial<Act> = {}): Act => ({
  kind,
  start: 1000,
  ms: 600,
  from: REST,
  reach: 3,
  strength: 1,
  feeling: 'cozy',
  reduced: false,
  ...extra,
});

const ALL_ACTS = Object.keys(ACT_END) as ActKind[];
const ALL_STEPS: PlaybackStep['kind'][] = [
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

const finite = (p: Pose) => Object.values(p).every((v) => Number.isFinite(v));

describe('moveStyle and hitStrength', () => {
  it('tells strikes, hexes and boosts apart', () => {
    expect(moveStyle(strike)).toBe('strike');
    expect(moveStyle(hex)).toBe('hex');
    expect(moveStyle(boost)).toBe('boost');
    expect(moveStyle(null)).toBe('strike');
  });

  it('lands harder for a super hit and softer for a weak one', () => {
    expect(hitStrength('super')).toBe(SUPER_STRENGTH);
    expect(hitStrength('super')).toBeGreaterThan(hitStrength('good'));
    expect(hitStrength('good')).toBeGreaterThan(hitStrength('normal'));
    expect(hitStrength('weak')).toBeLessThan(1);
    expect(hitStrength(null)).toBe(1);
    expect(hitStrength('mystery')).toBe(1);
  });
});

describe('poses', () => {
  it('stays finite through every act, for every feeling, and ends where the act says', () => {
    for (const kind of ALL_ACTS) {
      for (const feeling of FEELINGS) {
        for (const reduced of [false, true]) {
          const a = act(kind, { feeling: feeling.id, reduced, strength: 1.45 });
          for (let t = 1000; t <= 1700; t += 10)
            expect(finite(actPose(a, t)), `${kind} ${feeling.id}`).toBe(true);
          expect(actPose(a, 1700)).toEqual(heldPose(kind, a.reach, reduced));
        }
      }
    }
    expect(heldPose('dash', 3, false).forward).toBe(3);
    expect(heldPose('dash', 3, true).forward).toBeCloseTo(3 * CHOREO.reduced.reach, 6);
    expect(heldPose('faint', 3, false).roll).toBe(CHOREO.faint.roll);
    expect(heldPose('swap-out', 3, false).scale).toBe(0);
  });

  it('winds up, dashes to arm’s length and braces, each feeling its own way', () => {
    const t = (u: number) => 1000 + 600 * u;
    const dash = act('dash');
    const windup = actPose(dash, t(CHOREO.dash.windup * 0.9));
    expect(windup.forward).toBeLessThan(0); // pulled back
    expect(windup.squash).toBeLessThan(1); // squatting
    const contact = actPose(dash, t(CHOREO.dash.windup + CHOREO.dash.travel + 0.01));
    expect(contact.forward).toBeCloseTo(3, 1);
    // Brave puffs up in the wind-up; Silly spins; Joy hops; Spooky lifts off.
    const at = (feeling: Act['feeling']) =>
      actPose(act('dash', { feeling }), t(CHOREO.dash.windup * 0.8));
    expect(at('brave').scale).toBeGreaterThan(at('cozy').scale);
    expect(Math.abs(at('silly').spin)).toBeGreaterThan(0);
    expect(at('spooky').lift).toBeGreaterThan(at('cozy').lift);
    expect(at('sleepy').lean).toBeLessThan(at('cozy').lean);
  });

  it('blends out of the pose it started in, so nothing jumps', () => {
    const from = { ...REST, forward: 2, lift: 1 };
    const a = act('knockback', { from });
    const first = actPose(a, 1001);
    expect(first.forward).toBeGreaterThan(1.85);
    expect(first.lift).toBeGreaterThan(0.9);
    expect(actPose(a, 999)).toEqual(from);
    expect(actRunning(a, 1599)).toBe(true);
    expect(actRunning(a, 1600)).toBe(false);
    expect(actRunning(null, 0)).toBe(false);
  });

  it('is calmer with reduced motion: a short lunge, no twirls', () => {
    const t = 1000 + 600 * (CHOREO.dash.windup + CHOREO.dash.travel + 0.05);
    expect(actPose(act('dash', { reduced: true }), t).forward).toBeLessThan(
      actPose(act('dash'), t).forward,
    );
    const twirl = act('power-up', { reduced: true });
    for (let u = 1000; u < 1600; u += 20) expect(actPose(twirl, u).spin).toBe(0);
    expect(actPose(act('knockback', { reduced: true, strength: 1.45 }), 1300).spin).toBe(0);
    expect(actPose(act('knockback', { strength: 1.45 }), 1300).spin).not.toBe(0);
  });

  it('lerps poses', () => {
    const mid = lerpPose(REST, { ...REST, forward: 2, scale: 0 }, 0.5);
    expect(mid.forward).toBe(1);
    expect(mid.scale).toBe(0.5);
  });
});

describe('readyPose', () => {
  it('gives every feeling its own idle and keeps everyone roughly at home', () => {
    const poses = FEELINGS.map((f) => readyPose(1234, 0, f.id, false));
    for (const p of poses) {
      expect(finite(p)).toBe(true);
      expect(Math.abs(p.forward)).toBeLessThan(0.5);
      expect(Math.abs(p.side)).toBeLessThan(0.5);
    }
    const distinct = new Set(poses.map((p) => JSON.stringify(p)));
    expect(distinct.size).toBe(FEELINGS.length);
    expect(FEELING_TRAITS.brave.puff).toBe(1);
  });

  it('moves over time, but holds still with reduced motion', () => {
    expect(readyPose(0, 0, 'joy', false)).not.toEqual(readyPose(400, 0, 'joy', false));
    expect(readyPose(0, 0, 'joy', true)).toEqual(readyPose(400, 0, 'joy', true));
    expect(readyPose(0, 0, 'brave', true).scale).toBeGreaterThan(1);
    expect(readyPose(0, 0, 'spooky', true).lift).toBeGreaterThan(0);
  });

  it('keeps the two fighters out of step', () => {
    expect(readyPose(500, 0, 'cozy', false)).not.toEqual(
      readyPose(500, CHOREO.ready.otherPhase, 'cozy', false),
    );
  });
});

describe('planStep', () => {
  it('keeps every act inside its step, for every step kind', () => {
    for (const kind of ALL_STEPS) {
      for (const move of [strike, hex, boost]) {
        const s = step(kind, 'a', {
          to: kind === 'swap' ? 1 : null,
          squish: 'bounce',
          status: 'dizzy',
        });
        const plan = planStep(s, ctx({ move }));
        for (const a of plan.acts) {
          expect(a.delay, `${kind} ${a.kind}`).toBeGreaterThanOrEqual(0);
          expect(a.delay + a.ms, `${kind} ${a.kind}`).toBeLessThanOrEqual(s.ms + 1);
        }
        for (const e of plan.effects) expect(e.delay).toBeLessThanOrEqual(s.ms);
      }
    }
  });

  it('acts out a strike: wind-up charge, trail, dash; then hit-stop, impact, knockback and follow-through', () => {
    const move = planStep(step('move', 'a', { move: strike.id }), ctx());
    expect(move.acts.map((a) => a.kind)).toEqual(['dash']);
    expect(move.effects.map((e) => e.kind)).toEqual(['charge', 'trail', 'dust']);
    expect(move.effects.every((e) => e.element === 'fire')).toBe(true);
    expect(move.camera.focus).toBe('a');

    const hit = planStep(step('hit', 'b', { effectiveness: 'super' }), ctx());
    expect(hit.hitStop).toBe(Math.round(CHOREO.hitStop * Math.min(1.5, SUPER_STRENGTH)));
    const kinds = hit.acts.map((a) => `${a.side}:${a.kind}`);
    expect(kinds).toEqual(['b:brace', 'a:follow', 'b:knockback']);
    expect(hit.acts[0]).toMatchObject({ delay: 0, ms: hit.hitStop });
    for (const a of hit.acts.slice(1)) expect(a.delay).toBe(hit.hitStop);
    expect(hit.effects.map((e) => e.kind)).toEqual(['flash', 'impact', 'dust']);
    expect(hit.effects.find((e) => e.kind === 'impact')?.strength).toBe(SUPER_STRENGTH);
    expect(hit.camera.shake).toBeGreaterThan(0);
    expect(hit.camera.roll).toBeGreaterThan(0);
    expect(hit.camera.push).toBeGreaterThan(0);
    // An ordinary hit never rolls the camera.
    expect(planStep(step('hit', 'b', { effectiveness: 'normal' }), ctx()).camera.roll).toBe(0);
  });

  it('casts hexes and boosts instead of dashing', () => {
    const h = planStep(step('move', 'a'), ctx({ move: hex }));
    expect(h.acts.map((a) => a.kind)).toEqual(['cast']);
    expect(h.effects.map((e) => e.kind)).toEqual(['bolt']);
    const b = planStep(step('move', 'a'), ctx({ move: boost }));
    expect(b.effects.map((e) => e.kind)).toEqual(['aura']);
    // A hex that lands has no follow-through: nobody dashed in.
    const hit = planStep(step('hit', 'b'), ctx({ move: hex }));
    expect(hit.acts.map((a) => a.kind)).toEqual(['brace', 'knockback']);
  });

  it('has no hit-stop, flash, shake, roll or push with reduced motion', () => {
    const hit = planStep(step('hit', 'b', { effectiveness: 'super' }), ctx({ reduced: true }));
    expect(hit.hitStop).toBe(0);
    expect(hit.effects.map((e) => e.kind)).toEqual(['impact', 'dust']);
    expect(hit.camera).toMatchObject({ shake: 0, roll: 0, push: 0 });
    expect(planStep(step('move', 'a'), ctx({ reduced: true })).camera.push).toBe(0);
  });

  it('misses: the attacker overshoots while the other hops aside', () => {
    const miss = planStep(step('miss', 'a'), ctx());
    expect(miss.acts.map((a) => `${a.side}:${a.kind}`)).toEqual(['a:overshoot', 'b:dodge']);
    expect(miss.camera.focus).toBe('b');
  });

  it('statuses, stat changes and heals', () => {
    const up = planStep(step('effect', 'a', { squish: 'bounce' }), ctx());
    expect(up.acts.map((a) => a.kind)).toEqual(['power-up']);
    const dizzy = planStep(step('effect', 'b', { squish: 'jiggle', status: 'dizzy' }), ctx());
    expect(dizzy.acts.map((a) => a.kind)).toEqual(['shiver']);
    expect(dizzy.effects.map((e) => e.kind)).toEqual(['dizzy']);
    const skip = planStep(step('effect', 'b', { status: 'sleepy' }), ctx());
    expect(skip.acts).toEqual([]);
    expect(skip.effects.map((e) => e.kind)).toEqual(['sleepy']);
    const heal = planStep(step('heal', 'a', { squish: 'bounce' }), ctx());
    expect(heal.effects.map((e) => e.kind)).toEqual(['sparkle']);
  });

  it('tuckers out with dizzy stars and a soft push', () => {
    const ko = planStep(step('tuckered', 'b', { ms: 1100 }), ctx());
    expect(ko.acts.map((a) => a.kind)).toEqual(['faint']);
    expect(ko.effects.map((e) => e.kind)).toEqual(['dizzy', 'dust']);
    expect(ko.camera.push).toBe(BATTLE_CAMERA.koPush);
  });

  it('swaps out then in, or just drops in', () => {
    const swap = planStep(step('swap', 'a', { slot: 0, to: 1, ms: 700 }), ctx());
    expect(swap.acts.map((a) => a.kind)).toEqual(['swap-out', 'swap-in']);
    expect(swap.acts[1]?.delay).toBeCloseTo(700 * CHOREO.swap.out, 6);
    const replace = planStep(step('swap', 'a', { slot: 1, to: 1 }), ctx());
    expect(replace.acts.map((a) => a.kind)).toEqual(['swap-in']);
  });

  it('throws the Heart Charm, draws the squishy in, and pops a friend out (or not)', () => {
    const yes = planStep(step('capture', 'b', { squish: 'bounce', ms: 1300 }), ctx());
    expect(yes.effects.map((e) => e.kind)).toEqual(['charm', 'confetti']);
    expect(yes.effects[0]?.caught).toBe(true);
    expect(yes.acts.map((a) => a.kind)).toEqual(['charmed', 'pop-out']);
    const no = planStep(step('capture', 'b', { squish: 'wobble', ms: 1300 }), ctx());
    expect(no.effects.map((e) => e.kind)).toEqual(['charm', 'dust']);
    expect(no.squish[0]?.move).toBe('wobble');
  });

  it('wins with hops and confetti; a new friend bounces along; a loss just watches', () => {
    const won = planStep(step('end', 'a', { squish: 'bounce' }), ctx({ captured: true }));
    expect(won.acts.map((a) => a.kind)).toEqual(['victory']);
    expect(won.squish.map((s) => s.side)).toEqual(['a', 'b']);
    const lost = planStep(step('end', 'a'), ctx());
    expect(lost.acts).toEqual([]);
    expect(lost.camera.focus).toBeNull();
    const scoot = planStep(step('forfeit', 'a'), ctx());
    expect(scoot.acts.map((a) => a.kind)).toEqual(['scoot']);
  });
});
