import { CLOTHING, findAvoidedWords } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  BEAT_MS,
  beatsFor,
  CARD_TEXT,
  cardFor,
  DOOR_TEXT,
  heartSnackCost,
  sceneLines,
} from './door-view.js';

const heartdust = (count: number, lantern = false) => ({
  lantern,
  prize: { kind: 'heartdust' as const, itemId: 'heartdust', count },
});

describe('beatsFor (#515 part C)', () => {
  it('opens the door on the pail for a plain treat', () => {
    expect(beatsFor(false, false)).toEqual([{ scene: 'open', ms: BEAT_MS.open }]);
  });

  it('plays the silly trick first, then the treat anyway', () => {
    expect(beatsFor(true, false).map((b) => b.scene)).toEqual(['trick', 'anyway']);
  });

  it('keeps every beat with Reduce Motion, each a calm read', () => {
    for (const trick of [false, true]) {
      expect(beatsFor(trick, true).map((b) => b.scene)).toEqual(
        beatsFor(trick, false).map((b) => b.scene),
      );
      for (const beat of beatsFor(trick, true)) expect(beat.ms).toBeGreaterThanOrEqual(1000);
    }
  });
});

describe('cardFor', () => {
  it('says Heartdust with the count and what a few are for', () => {
    const card = cardFor(heartdust(2, true), 1);
    expect(card).toMatchObject({
      kind: 'heartdust',
      title: '2 Heartdust!',
      lantern: true,
      detail: CARD_TEXT.snack(1, heartSnackCost()),
    });
  });

  it('says when there is already enough for a Heart Snack', () => {
    expect(cardFor(heartdust(1), heartSnackCost())?.detail).toBe(
      'You have enough for a Heart Snack!',
    );
  });

  it('names a Keeper costume with its rarity', () => {
    const item = CLOTHING.find((c) => c.slot === 'costume');
    if (!item) throw new Error('no costume in the data');
    const card = cardFor(
      { lantern: false, prize: { kind: 'keeper-costume', itemId: item.id, count: 1 } },
      null,
    );
    expect(card).toMatchObject({
      kind: 'keeper-costume',
      itemId: item.id,
      title: item.name,
      rarity: item.rarity,
      lantern: false,
      detail: CARD_TEXT.keeperBlurb,
    });
  });

  it('offers a squishy costume as a costume for the squishies', () => {
    const item = CLOTHING.find((c) => c.slot === 'squishy');
    if (!item) throw new Error('no squishy costume in the data');
    const card = cardFor(
      { lantern: true, prize: { kind: 'squishy-costume', itemId: item.id, count: 1 } },
      null,
    );
    expect(card).toMatchObject({ kind: 'squishy-costume', itemId: item.id });
    expect(card?.detail).toBe(CARD_TEXT.squishyBlurb);
  });

  it("has no card for a costume this build doesn't know (the toast says it)", () => {
    expect(
      cardFor(
        { lantern: false, prize: { kind: 'keeper-costume', itemId: 'from-the-future', count: 1 } },
        null,
      ),
    ).toBeNull();
  });

  it("reads a Heart Snack's price from the care data", () => {
    expect(heartSnackCost()).toBeGreaterThan(0);
  });
});

describe('the words', () => {
  it('give every scene a title and a line', () => {
    for (const scene of ['knock', 'waiting', 'open', 'trick', 'anyway'] as const) {
      const lines = sceneLines(scene);
      expect(lines.title.length).toBeGreaterThan(0);
      expect(lines.sub.length).toBeGreaterThan(0);
    }
  });

  it('use none of the style guide’s avoided words (§9)', () => {
    const lines = [
      CARD_TEXT.kicker,
      CARD_TEXT.lantern,
      CARD_TEXT.keeperBlurb,
      CARD_TEXT.squishyBlurb,
      CARD_TEXT.yay,
      CARD_TEXT.wear,
      CARD_TEXT.dressUp,
      CARD_TEXT.later,
      CARD_TEXT.wearing,
      CARD_TEXT.heartdust(2),
      CARD_TEXT.snack(0, 3),
      CARD_TEXT.snack(3, 3),
      DOOR_TEXT.home('sam'),
      DOOR_TEXT.sceneLabel('sam'),
      DOOR_TEXT.knockButton,
      ...(['knock', 'waiting', 'open', 'trick', 'anyway'] as const).flatMap((s) => [
        sceneLines(s).title,
        sceneLines(s).sub,
      ]),
    ];
    for (const line of lines) expect(findAvoidedWords(line)).toEqual([]);
  });

  it('keep the lines short enough for a 10-year-old to read at a glance (§2)', () => {
    for (const scene of ['knock', 'waiting', 'open', 'trick', 'anyway'] as const) {
      expect(sceneLines(scene).sub.split(' ').length).toBeLessThanOrEqual(10);
    }
  });
});
