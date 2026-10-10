import { CHALLENGE_RULES, findAvoidedWords, type WsEventMessage } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { challengeEventFor, FRIENDLY_TEXT, gapLine, waitLeft } from './friendly-model.js';

const ME = '00000000-0000-7000-8000-00000000000a';
const YOU = '00000000-0000-7000-8000-00000000000b';
const ASK = '00000000-0000-7000-8000-0000000000c1';

const event = (type: string, data: Record<string, unknown>): WsEventMessage => ({
  v: 1,
  type,
  mapId: '00000000-0000-7000-8000-0000000000f1',
  seq: 1,
  at: '2026-10-10T12:00:00.000Z',
  data,
});

describe('friendly battles (#29)', () => {
  it('a big level gap gets a heads-up from my side', () => {
    const gap = CHALLENGE_RULES.levelGapNote;
    expect(gapLine(5, 5 + gap, 'Theo')).toMatch(/stronger/);
    expect(gapLine(5 + gap, 5, 'Theo')).toMatch(/still growing/);
    expect(gapLine(5, 6, 'Theo')).toBeNull();
  });

  it("the ask's bar runs down over its wait", () => {
    const ask = { createdAt: '2026-10-10T12:00:00.000Z', expiresAt: '2026-10-10T12:01:00.000Z' };
    expect(waitLeft(ask, Date.parse('2026-10-10T12:00:00.000Z'))).toBe(1);
    expect(waitLeft(ask, Date.parse('2026-10-10T12:00:30.000Z'))).toBe(0.5);
    expect(waitLeft(ask, Date.parse('2026-10-10T12:02:00.000Z'))).toBe(0);
  });

  it('reads ask events for me, and ignores other Keepers’ and defense prompts', () => {
    const base = { challengeId: ASK, kind: 'friendly', fromUserId: YOU, toUserId: ME };
    expect(challengeEventFor(event('challenge.sent', base), ME)).toEqual({
      type: 'sent',
      challengeId: ASK,
      fromUserId: YOU,
      toUserId: ME,
    });
    expect(
      challengeEventFor(event('challenge.answered', { ...base, answer: 'yes', battleId: ASK }), ME),
    ).toMatchObject({ type: 'answered', answer: 'yes', battleId: ASK });
    expect(challengeEventFor(event('challenge.sent', base), 'someone-else')).toBeNull();
    expect(challengeEventFor(event('challenge.sent', { ...base, kind: 'defense' }), ME)).toBeNull();
    expect(challengeEventFor(event('battle.started', base), ME)).toBeNull();
  });

  it('every line is kind and free of avoided words', () => {
    const lines = Object.values(FRIENDLY_TEXT).map((v) =>
      typeof v === 'function' ? (v as (...a: unknown[]) => string)('Theo', 3) : v,
    );
    for (const line of lines) expect(findAvoidedWords(line), line).toEqual([]);
  });
});
