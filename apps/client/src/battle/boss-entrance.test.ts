import type { PlayerBattle } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { battleCue } from '../audio/cues.js';
import entranceCss from './boss-entrance.css?raw';
import {
  BOSS_ENTRANCE,
  EntranceGate,
  cardTop,
  entranceAt,
  entranceCard,
  stompStep,
  stompedBetween,
  wantsEntrance,
} from './boss-entrance.js';

type Gated = Parameters<typeof wantsEntrance>[0];

/** A battle at its very start: a boss fight (a 3-v-1 team battle) unless `oneOnOne`. */
function fight(over: { oneOnOne?: boolean; log?: number; status?: string } = {}): Gated {
  return {
    status: over.status ?? 'active',
    view: {
      log: Array.from({ length: over.log ?? 0 }, () => ({ type: 'move' })),
      ...(over.oneOnOne ? {} : { format: { a: 3, b: 1 } }),
    },
  } as unknown as Pick<PlayerBattle, 'view' | 'status'>;
}

const SAMPLES = [
  0, 1, 150, 300, 599, 600, 601, 750, 900, 1000, 1600, 2300, 2419, 2420, 2599, 2600, 4000,
];

describe('the BIG squishy arrives (#190 PR 3)', () => {
  it('lasts 2.6 s and stomps at 0.6 s (owner decision 2, the plan)', () => {
    expect(BOSS_ENTRANCE.totalMs).toBe(2600);
    expect(BOSS_ENTRANCE.stompMs).toBe(600);
    expect(entranceAt(2599).done).toBe(false);
    expect(entranceAt(2600).done).toBe(true);
  });

  it('is a pure function of t: the same t is the same state', () => {
    for (const reduced of [false, true]) {
      const first = SAMPLES.map((t) => entranceAt(t, reduced));
      // In another order, twice over: nothing carries from one call to the next.
      const again = [...SAMPLES]
        .reverse()
        .map((t) => entranceAt(t, reduced))
        .reverse();
      expect(again).toEqual(first);
      expect(SAMPLES.map((t) => entranceAt(t, reduced))).toEqual(first);
    }
  });

  it('plays its four beats in order: arrive, stomp, name card, settled', () => {
    expect(entranceAt(0).phase).toBe('arrive');
    expect(entranceAt(599).phase).toBe('arrive');
    expect(entranceAt(600).phase).toBe('stomp');
    expect(entranceAt(BOSS_ENTRANCE.cardInMs).phase).toBe('card');
    expect(entranceAt(BOSS_ENTRANCE.settleMs).phase).toBe('settled');
    expect(entranceAt(2600).phase).toBe('done');
  });

  it('drops the boss from high up onto its spot, landing at the stomp', () => {
    expect(entranceAt(0).lift).toBe(BOSS_ENTRANCE.dropHeight);
    const lifts = [0, 150, 300, 450, 599].map((t) => entranceAt(t).lift);
    for (let i = 1; i < lifts.length; i += 1) expect(lifts[i]).toBeLessThan(lifts[i - 1] ?? 0);
    expect(entranceAt(600).lift).toBe(0);
    // Squashed flat by the stomp, then round again.
    expect(entranceAt(600).squash).toBeCloseTo(1 - BOSS_ENTRANCE.squashDepth);
    expect(entranceAt(600 + BOSS_ENTRANCE.squashMs).squash).toBe(1);
  });

  it('settles into the rest pose: on the ground, round, no card', () => {
    for (const t of [BOSS_ENTRANCE.settleMs + 20, 2599, 2600]) {
      const s = entranceAt(t);
      expect(s.lift).toBe(0);
      expect(s.squash).toBe(1);
      expect(s.card).toBe(0);
    }
  });

  it('lets a tap skip only once the stomp has landed (the 0.6 s rule)', () => {
    for (const reduced of [false, true]) {
      expect(entranceAt(0, reduced).skippable).toBe(false);
      expect(entranceAt(599, reduced).skippable).toBe(false);
      expect(entranceAt(600, reduced).skippable).toBe(true);
      expect(entranceAt(2000, reduced).skippable).toBe(true);
      expect(entranceAt(2600, reduced).skippable).toBe(false);
    }
  });

  it('keeps every beat under reduced motion, but drops the drop and the squash', () => {
    for (const t of SAMPLES) {
      const still = entranceAt(t, true);
      const moving = entranceAt(t);
      expect(still.lift).toBe(0);
      expect(still.squash).toBe(1);
      expect(still.cardScale).toBe(1);
      expect(still.phase).toBe(moving.phase);
      expect(still.card).toBe(moving.card);
      expect(still.skippable).toBe(moving.skippable);
    }
  });

  it('stomps once, on the frame that crosses 0.6 s', () => {
    expect(stompedBetween(-1, 0)).toBe(false);
    expect(stompedBetween(580, 599)).toBe(false);
    expect(stompedBetween(599, 600)).toBe(true);
    expect(stompedBetween(16, 700)).toBe(true);
    expect(stompedBetween(600, 616)).toBe(false);
  });

  it("plays the boss's landing cue at the stomp (the PR 4 beat hook)", () => {
    expect(battleCue(stompStep('a'), false, { kind: 'landing', element: 'fire' })).toBe(
      'boss-landing-fire',
    );
  });

  it('shows the name card after the stomp, never before', () => {
    for (const t of [0, 300, 599, 600, 799]) expect(entranceAt(t).card).toBe(0);
    expect(entranceAt(1600).card).toBe(1);
    expect(entranceCard('Pumpkaboo')).toEqual({
      title: 'A BIG squishy!',
      name: 'Pumpkaboo stomps in!',
    });
  });

  it('opens every boss fight at its start, never a one-on-one battle', () => {
    expect(wantsEntrance(fight(), false)).toBe(true);
    expect(wantsEntrance(fight({ oneOnOne: true }), false)).toBe(false);
    // A replay, a fight already under way (a reload), or a finished fight: no entrance.
    expect(wantsEntrance(fight(), true)).toBe(false);
    expect(wantsEntrance(fight({ log: 3 }), false)).toBe(false);
    expect(wantsEntrance(fight({ status: 'ended' }), false)).toBe(false);
  });

  it('puts the card between the boss face and the team, inside the band', () => {
    const height = 852;
    const band = { top: 0.1, bottom: 0.7 };
    const face = { top: 0.15, bottom: 0.3 };
    const top = cardTop({ band, face, teamTop: 0.6, height, cardHeight: 64 });
    expect(top).toBeGreaterThanOrEqual(face.bottom * height + BOSS_ENTRANCE.cardGapPx);
    expect(top + 64).toBeLessThanOrEqual(0.6 * height - BOSS_ENTRANCE.cardGapPx);
    // No room between them: under the face, never off the band's bottom.
    const tight = cardTop({
      band,
      face: { top: 0.4, bottom: 0.66 },
      teamTop: 0.6,
      height,
      cardHeight: 64,
    });
    expect(tight + 64).toBeLessThanOrEqual(band.bottom * height - BOSS_ENTRANCE.cardGapPx);
    // Nothing framed yet: in the band.
    const none = cardTop({ band, face: null, teamTop: null, height, cardHeight: 64 });
    expect(none).toBeGreaterThanOrEqual(band.top * height);
  });

  it('moves only transform and opacity', () => {
    expect(entranceCss).not.toMatch(/transition:[^;]*(top|left|width|height)/);
  });
});

describe('EntranceGate: playNext waits for the entrance (#190 PR 3)', () => {
  it('runs at once with no entrance on', () => {
    const gate = new EntranceGate();
    const ran: string[] = [];
    gate.run(() => ran.push('playNext'));
    expect(ran).toEqual(['playNext']);
  });

  it('holds playback until the entrance ends or is skipped, then plays it once', () => {
    const gate = new EntranceGate();
    const ran: string[] = [];
    gate.hold();
    gate.run(() => ran.push('playNext'));
    expect(ran).toEqual([]);
    expect(gate.waiting).toBe(true);
    gate.end();
    expect(ran).toEqual(['playNext']);
    gate.end();
    expect(ran).toEqual(['playNext']);
    expect(gate.waiting).toBe(false);
  });

  it('forgets held playback when the battle closes', () => {
    const gate = new EntranceGate();
    const ran: string[] = [];
    gate.hold();
    gate.run(() => ran.push('playNext'));
    gate.drop();
    gate.end();
    expect(ran).toEqual([]);
  });
});
