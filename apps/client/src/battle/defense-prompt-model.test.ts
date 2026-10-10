import type { WsEventMessage } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  DEFENSE_TEXT,
  defensePromptFor,
  endsDefensePrompt,
  secondsLeft,
} from './defense-prompt-model.js';

const ME = '00000000-0000-7000-8000-000000000001';
const LEE = '00000000-0000-7000-8000-000000000002';
const CHALLENGE = '00000000-0000-7000-8000-000000000003';
const BATTLE = '00000000-0000-7000-8000-000000000004';

const event = (type: string, data: Record<string, unknown>): WsEventMessage => ({
  v: 1,
  type,
  mapId: '00000000-0000-7000-8000-000000000005',
  seq: 7,
  at: '2026-10-10T18:00:00.000Z',
  data,
});

const prompted = (to = ME) =>
  event('defense.prompted', {
    challengeId: CHALLENGE,
    battleId: BATTLE,
    fromUserId: LEE,
    toUserId: to,
    expiresAt: '2026-10-10T18:00:20.000Z',
  });

describe('defense prompt (#29-C)', () => {
  it('reads a prompt meant for me, timed on the server clock', () => {
    expect(defensePromptFor(prompted(), ME)).toEqual({
      challengeId: CHALLENGE,
      battleId: BATTLE,
      fromUserId: LEE,
      windowMs: 20_000,
    });
  });

  it('ignores prompts for someone else, other events, and broken ones', () => {
    expect(defensePromptFor(prompted(LEE), ME)).toBeNull();
    expect(defensePromptFor(event('battle.started', {}), ME)).toBeNull();
    expect(
      defensePromptFor(event('defense.prompted', { ...prompted().data, expiresAt: 'soon' }), ME),
    ).toBeNull();
  });

  it('closes on its own answer only', () => {
    expect(
      endsDefensePrompt(event('defense.answered', { challengeId: CHALLENGE }), CHALLENGE),
    ).toBe(true);
    expect(endsDefensePrompt(event('defense.answered', { challengeId: BATTLE }), CHALLENGE)).toBe(
      false,
    );
    expect(endsDefensePrompt(prompted(), CHALLENGE)).toBe(false);
  });

  it('counts whole seconds down to zero', () => {
    expect(secondsLeft(20_000, 0)).toBe(20);
    expect(secondsLeft(20_000, 19_001)).toBe(1);
    expect(secondsLeft(20_000, 25_000)).toBe(0);
  });

  it('speaks kindly, and never says attack', () => {
    const words = [
      DEFENSE_TEXT.title,
      DEFENSE_TEXT.visiting('Lee'),
      DEFENSE_TEXT.visiting(null),
      DEFENSE_TEXT.calm,
      DEFENSE_TEXT.defend,
      DEFENSE_TEXT.notNow,
    ];
    for (const line of words) expect(line).not.toMatch(/attack|enemy|destroy/i);
    expect(DEFENSE_TEXT.visiting('Lee')).toMatch(/^Lee is challenging your land!/);
  });
});
