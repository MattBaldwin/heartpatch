import {
  findAvoidedWords,
  HOME_BASE_RULES,
  POWER_RULES,
  RAIL_RULES,
  type PowerRules,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { testWildIsle, userId } from '../map/test-view.js';
import { linePath } from './line-api.js';
import {
  LINE_TEXT,
  lineCardId,
  lineCardOf,
  lineCards,
  lineCommandFor,
  lineRefund,
  railEffect,
  railName,
  refundText,
} from './line-model.js';

const ME = userId(1);
const view = testWildIsle();
const mine = view.tiles.find((t) => t.ownerUserId === ME && t.homeSlot === null);
const theirs = view.tiles.find((t) => t.ownerUserId === userId(2));
const river = view.tiles.find((t) => t.terrain === 'river');

/** Every string in the text table, with its functions called on sample values. */
function allText(): string[] {
  return Object.values(LINE_TEXT).flatMap((v): string[] => {
    if (typeof v === 'string') return [v];
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === 'function') {
      // One argument: a level or a tile count; two: what and what comes back.
      const f = v as (...args: unknown[]) => string;
      return f.length === 1 ? [f(1), f(2), f(6)] : [f('wire', '1 ⚙️'), f('rail', '')];
    }
    return [];
  });
}

describe('wire and rail cards (#874 C4)', () => {
  it('offers a Wire and a Rail on a tile of mine with neither, at the data costs', () => {
    if (!mine) throw new Error('no tile');
    const cards = lineCards({ tile: mine, me: ME, wire: false, rail: null, supplied: true });
    expect(cards.map((c) => c.id)).toEqual(['line-wire', 'line-rail-1']);
    expect(cards[0]).toMatchObject({
      name: 'Wire',
      effect: `Carries Spark. Up to ${String(POWER_RULES.wire.maxRun)} tiles.`,
      cost: POWER_RULES.wire.cost,
      area: 'spot',
      blocked: null,
    });
    expect(cards[1]).toMatchObject({
      name: 'Rail',
      cost: RAIL_RULES.levels[0]?.cost,
      blocked: null,
    });
  });

  it('offers the next rail level once a rail is down, and no second wire', () => {
    if (!mine) throw new Error('no tile');
    const cards = lineCards({ tile: mine, me: ME, wire: true, rail: 1, supplied: true });
    expect(cards.map((c) => c.id)).toEqual(['line-rail-2']);
    expect(cards[0]?.name).toBe('Brass rail');
    expect(cards[0]?.cost).toEqual(RAIL_RULES.levels[1]?.cost);
    // Brass waits on the Tidy Rails blueprint: the card says so; the server checks.
    expect(cards[0]?.hint).toBe(LINE_TEXT.needsResearch);
    expect(lineCards({ tile: mine, me: ME, wire: true, rail: 2, supplied: true })).toEqual([]);
  });

  it('blocks a new line on land cut off from home, saying why (plan §7)', () => {
    if (!mine) throw new Error('no tile');
    const cards = lineCards({ tile: mine, me: ME, wire: false, rail: null, supplied: false });
    expect(cards.map((c) => c.blocked)).toEqual([LINE_TEXT.cutOff, LINE_TEXT.railCutOff]);
    expect(LINE_TEXT.cutOff).toBe("Lay wires from land that's joined up to home!");
    // Not loaded yet: the server decides.
    const unknown = lineCards({ tile: mine, me: ME, wire: false, rail: null, supplied: null });
    expect(unknown.map((c) => c.blocked)).toEqual([null, null]);
    // Raising a rail that's already down isn't a new line.
    const raise = lineCards({ tile: mine, me: ME, wire: true, rail: 1, supplied: false });
    expect(raise[0]?.blocked).toBeNull();
  });

  it("offers nothing on someone else's tile, on water, or signed out", () => {
    if (!mine || !theirs || !river) throw new Error('no tile');
    const none = { wire: false, rail: null, supplied: true };
    expect(lineCards({ tile: theirs, me: ME, ...none })).toEqual([]);
    expect(lineCards({ tile: { ...river, ownerUserId: ME }, me: ME, ...none })).toEqual([]);
    expect(lineCards({ tile: mine, me: null, ...none })).toEqual([]);
  });

  it('drops the Wire card when power is not on wires (owner Q3 branches)', () => {
    if (!mine) throw new Error('no tile');
    const radius: PowerRules = { ...POWER_RULES, model: 'radius' };
    const cards = lineCards({
      tile: mine,
      me: ME,
      wire: false,
      rail: null,
      supplied: true,
      power: radius,
    });
    expect(cards.map((c) => c.id)).toEqual(['line-rail-1']);
  });

  it('reads card ids back, and sends build then upgrade', () => {
    expect(lineCardOf(lineCardId('wire', 1))).toEqual({ kind: 'wire', level: 1 });
    expect(lineCardOf(lineCardId('rail', 2))).toEqual({ kind: 'rail', level: 2 });
    expect(lineCardOf('road-1')).toBeNull();
    expect(lineCardOf('line-rail-x')).toBeNull();
    expect(lineCommandFor(1)).toBe('build');
    expect(lineCommandFor(2)).toBe('upgrade');
    expect(linePath('m', 'build')).toBe('/maps/m/lines');
    expect(linePath('m', 'remove')).toBe('/maps/m/lines/remove');
    expect(railName(1)).toBe('Rail');
    expect(railName(9)).toBe('Brass rail');
    expect(railEffect(1)).toContain(`${String(RAIL_RULES.levels[0]?.reach)} tiles`);
  });

  it("gives back the take-down share of everything a line cost (the server's lineRefund)", () => {
    const share = HOME_BASE_RULES.removeRefundPercent / 100;
    const half = (n: number) => Math.floor(n * share);
    const l1 = RAIL_RULES.levels[0]?.cost ?? {};
    const l2 = RAIL_RULES.levels[1]?.cost ?? {};
    const expected: Record<string, number> = {};
    for (const [id, n] of Object.entries(l1)) expected[id] = n;
    for (const [id, n] of Object.entries(l2)) expected[id] = (expected[id] ?? 0) + n;
    const want = Object.fromEntries(
      Object.entries(expected)
        .map(([id, n]) => [id, half(n)] as const)
        .filter(([, n]) => n > 0),
    );
    expect(lineRefund('rail', 2)).toEqual(want);
    // One Part of wire floors to nothing back.
    expect(lineRefund('wire', 1, { ...POWER_RULES, wire: { ...POWER_RULES.wire, cost: { parts: 1 } } })).toEqual({});
    expect(refundText({})).toBe('');
  });

  it('keeps every word kind and short (STYLE_GUIDE)', () => {
    const text = allText();
    expect(text.length).toBeGreaterThan(20);
    expect(text.flatMap((t) => findAvoidedWords(t))).toEqual([]);
    for (const t of text) expect(t.split(' ').length).toBeLessThanOrEqual(12);
  });
});
