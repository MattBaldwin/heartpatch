import { GAME_DATA, type Move } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { CHOREO } from './battle-config.js';
import type { PlaybackStep } from './battle-playback.js';
import {
  ACT_END,
  actPose,
  heldPose,
  hitStrength,
  lerpPose,
  moveStyle,
  planStep,
  readyPose,
  REST,
  type Act,
  type ActKind,
  type PlanContext,
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

describe('moveStyle', () => {
  it('dashes in with a hit, casts a hex at the other side, and boosts itself', () => {
    expect(moveStyle(strike)).toBe('strike');
    expect(moveStyle(hex)).toBe('hex');
    expect(moveStyle(boost)).toBe('boost');
    expect(moveStyle(null)).toBe('strike');
  });

  it('has a style for every move in the game data', () => {
    for (const move of GAME_DATA.moves) {
      expect(['strike', 'hex', 'boost']).toContain(moveStyle(move));
    }
  });
});

describe('planStep (the timeline for each step of the log)', () => {
  it('winds up and dashes in on a strike, trailing its element', () => {
    const plan = planStep(step('move', 'a', { ms: 650 }), ctx());
    expect(plan.acts).toEqual([{ side: 'a', kind: 'dash', delay: 0, ms: 650, strength: 1 }]);
    const trail = plan.effects.find((e) => e.kind === 'trail');
    expect(trail).toMatchObject({ side: 'a', element: 'fire' });
    // The trail starts when the dash does, after the wind-up.
    expect(trail?.delay).toBeCloseTo(650 * CHOREO.dash.windup);
    expect(plan.camera.focus).toBe('a');
  });

  it('casts a hex as a bolt and a boost as an aura', () => {
    const h = planStep(step('move', 'b'), ctx({ move: hex, user: 'b' }));
    expect(h.acts.map((a) => a.kind)).toEqual(['cast']);
    expect(h.effects.map((e) => e.kind)).toEqual(['bolt']);
    const b = planStep(step('move', 'b'), ctx({ move: boost, user: 'b' }));
    expect(b.effects.map((e) => e.kind)).toEqual(['aura']);
  });

  it('lands a hit with hit-stop, an impact, knockback, a push-in and a shake', () => {
    const plan = planStep(step('hit', 'b', { effectiveness: 'normal' }), ctx());
    expect(plan.hitStop).toBe(CHOREO.hitStop);
    // Both fighters wait out the hit-stop, then the target is knocked back
    // and the attacker follows through and hops home.
    expect(plan.acts).toEqual([
      { side: 'a', kind: 'follow', delay: plan.hitStop, ms: 800 - plan.hitStop, strength: 1 },
      { side: 'b', kind: 'knockback', delay: plan.hitStop, ms: 800 - plan.hitStop, strength: 1 },
    ]);
    expect(plan.effects.map((e) => e.kind)).toEqual(['flash', 'impact', 'dust']);
    expect(plan.effects.find((e) => e.kind === 'impact')).toMatchObject({
      element: 'fire',
      side: 'b',
    });
    expect(plan.squish).toEqual([{ side: 'b', move: 'wobble', delay: plan.hitStop, strength: 1 }]);
    expect(plan.camera).toMatchObject({ focus: 'b', shake: CHOREO.camera.shake });
    expect(plan.camera.push).toBeGreaterThan(0);
  });

  it('hits harder for a super hit, softer for a weak one', () => {
    const big = planStep(step('hit', 'b', { effectiveness: 'super' }), ctx());
    const small = planStep(step('hit', 'b', { effectiveness: 'weak' }), ctx());
    expect(big.hitStop).toBeGreaterThan(small.hitStop);
    expect(big.camera.shake).toBeGreaterThan(small.camera.shake);
    expect(hitStrength('super')).toBeGreaterThan(hitStrength(null));
    expect(hitStrength('weak')).toBeLessThan(1);
    expect(hitStrength('no-such-tier')).toBe(1);
  });

  it('overshoots on a miss while the other one dodges', () => {
    const plan = planStep(step('miss', 'a', { move: 'test-boop' }), ctx());
    expect(plan.acts.map((a) => [a.side, a.kind])).toEqual([
      ['a', 'overshoot'],
      ['b', 'dodge'],
    ]);
  });

  it('shows a status with its own effect', () => {
    const dizzy = planStep(step('effect', 'b', { squish: 'jiggle', status: 'dizzy' }), ctx());
    expect(dizzy.effects.map((e) => e.kind)).toEqual(['dizzy']);
    const sleepy = planStep(step('effect', 'b', { status: 'sleepy' }), ctx());
    expect(sleepy.effects.map((e) => e.kind)).toEqual(['sleepy']);
    const down = planStep(step('effect', 'b', { squish: 'jiggle' }), ctx());
    expect(down.effects.map((e) => e.kind)).toEqual(['droop']);
    const up = planStep(step('effect', 'a', { squish: 'bounce' }), ctx());
    expect(up.acts.map((a) => a.kind)).toEqual(['power-up']);
  });

  it('flops a tuckered-out squishy over with dizzy stars', () => {
    const plan = planStep(step('tuckered', 'b', { ms: 1100 }), ctx());
    expect(plan.acts).toEqual([{ side: 'b', kind: 'faint', delay: 0, ms: 1100, strength: 1 }]);
    expect(plan.effects.map((e) => e.kind)).toContain('dizzy');
    expect(ACT_END.faint).toBe('down');
  });

  it('hops the old squishy out before the new one drops in', () => {
    const plan = planStep(step('swap', 'a', { slot: 0, to: 1, ms: 700 }), ctx());
    expect(plan.acts.map((a) => [a.kind, a.delay])).toEqual([
      ['swap-out', 0],
      ['swap-in', 700 * CHOREO.swap.out],
    ]);
    // A replacement after a flop just drops in.
    const replace = planStep(step('swap', 'a', { slot: 1, to: 1 }), ctx());
    expect(replace.acts.map((a) => a.kind)).toEqual(['swap-in']);
  });

  it('throws a Heart Charm: drawn in, wobbles, then a friend or a wiggle free', () => {
    const caught = planStep(step('capture', 'b', { squish: 'bounce', ms: 1300 }), ctx());
    expect(caught.acts.map((a) => a.kind)).toEqual(['charmed', 'pop-out']);
    expect(caught.effects.map((e) => e.kind)).toEqual(['charm', 'confetti']);
    expect(caught.effects[0]).toMatchObject({ caught: true });
    const free = planStep(step('capture', 'b', { squish: 'wobble', ms: 1300 }), ctx());
    expect(free.effects.map((e) => e.kind)).toEqual(['charm', 'dust']);
  });

  it('cheers a win', () => {
    const plan = planStep(step('end', 'a', { squish: 'bounce' }), ctx());
    expect(plan.acts.map((a) => a.kind)).toEqual(['victory']);
    expect(planStep(step('end', 'a'), ctx()).acts).toEqual([]);
  });

  it('keeps every act and effect inside its step', () => {
    for (const kind of ALL_STEPS) {
      for (const reduced of [false, true]) {
        const s = step(kind, 'b', { ms: 900, to: kind === 'swap' ? 1 : null });
        const plan = planStep(s, ctx({ reduced }));
        for (const a of plan.acts) {
          expect(a.delay).toBeGreaterThanOrEqual(0);
          expect(a.delay + a.ms).toBeLessThanOrEqual(s.ms + 1e-9);
        }
        for (const e of plan.effects) expect(e.delay).toBeLessThan(s.ms);
      }
    }
  });

  describe('reduced motion', () => {
    it('never shakes, flashes, pushes in or freezes', () => {
      for (const kind of ALL_STEPS) {
        const plan = planStep(step(kind, 'b', { effectiveness: 'super' }), ctx({ reduced: true }));
        expect(plan.camera.shake).toBe(0);
        expect(plan.camera.push).toBe(0);
        expect(plan.hitStop).toBe(0);
        expect(plan.effects.map((e) => e.kind)).not.toContain('flash');
      }
    });

    it('makes moves smaller: a short lunge instead of a dash, no twirls', () => {
      const full = act('dash', { reach: 3 });
      const gentle = act('dash', { reach: 3, reduced: true });
      expect(actPose(gentle, 2000).forward).toBeLessThan(actPose(full, 2000).forward);
      expect(actPose(gentle, 2000).forward).toBeCloseTo(3 * CHOREO.reduced.reach);
      for (const kind of ALL_ACTS) {
        for (let t = 1000; t <= 1600; t += 50) {
          expect(actPose(act(kind, { reduced: true }), t).spin).toBe(0);
        }
      }
    });

    it('stands ready without bouncing', () => {
      expect(readyPose(0, 0, true)).toEqual(readyPose(12345, 0.4, true));
      expect(readyPose(0, 0, false)).not.toEqual(readyPose(333, 0, false));
    });
  });
});

describe('actPose (a fighter over time)', () => {
  it('starts from where it was and ends where the act leaves it', () => {
    const from = lerpPose(REST, heldPose('dash', 3, false), 1);
    for (const kind of ALL_ACTS) {
      const a = act(kind, { from });
      expect(actPose(a, 999)).toEqual(from);
      const start = actPose(a, 1000);
      expect(start.forward).toBeCloseTo(from.forward);
      expect(actPose(a, 1600)).toEqual(heldPose(kind, 3, false));
    }
  });

  it('dashes to arm’s length and holds there', () => {
    const a = act('dash');
    expect(actPose(a, 1000 + 600 * CHOREO.dash.windup * 0.9).forward).toBeLessThan(0); // pulled back
    expect(actPose(a, 1599).forward).toBeCloseTo(3, 1);
    expect(actPose(a, 5000)).toMatchObject({ forward: 3 });
  });

  it('knocks the target back and brings it home, squashed by the bonk', () => {
    const a = act('knockback', { strength: 1.4 });
    const mid = actPose(a, 1000 + 600 * 0.3);
    expect(mid.forward).toBeLessThan(-0.5);
    expect(Math.min(...[1030, 1040, 1050].map((t) => actPose(a, t).squash))).toBeLessThan(0.9);
    expect(actPose(a, 1600)).toEqual(REST);
  });

  it('flops over and stays down after fainting', () => {
    const down = actPose(act('faint'), 3000);
    expect(down.roll).toBeCloseTo(CHOREO.faint.roll);
    expect(down.lift).toBeLessThan(0);
  });

  it('moves smoothly from the pose the step before left it in: no jumps between frames', () => {
    /** What each act follows in a real log (a follow-through comes after a dash…). */
    const before: Partial<Record<ActKind, ActKind>> = {
      follow: 'dash',
      overshoot: 'dash',
      return: 'dash',
      'swap-in': 'swap-out',
      'pop-out': 'charmed',
    };
    for (const kind of ALL_ACTS) {
      const prior = before[kind];
      const a = act(kind, { from: prior ? heldPose(prior, 3, false) : REST });
      let last = actPose(a, 1000);
      // 60 fps; a dash is a fast smear by design, still under a squishy's width a frame.
      for (let t = 1000; t <= 1600; t += 1000 / 60) {
        const p = actPose(a, t);
        if (p.scale > 0.05 && last.scale > 0.05) {
          expect(Math.abs(p.forward - last.forward), `${kind} forward`).toBeLessThan(0.75);
          expect(Math.abs(p.lift - last.lift), `${kind} lift`).toBeLessThan(0.45);
          expect(Math.abs(p.squash - last.squash), `${kind} squash`).toBeLessThan(0.25);
          expect(Math.abs(p.roll - last.roll), `${kind} roll`).toBeLessThan(0.3);
        }
        expect(Math.abs(p.scale - last.scale), `${kind} scale`).toBeLessThan(0.3);
        last = p;
      }
    }
  });

  it('is pure: the same time always gives the same pose', () => {
    const a = act('victory');
    expect(actPose(a, 1234)).toEqual(actPose(a, 1234));
    expect(actPose(null, 50)).toBe(REST);
  });
});
