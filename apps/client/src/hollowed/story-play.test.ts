import { MEMORY_PUZZLES, makeStory, storyDeal } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  clearStory,
  placeMoment,
  smudgeStory,
  startStory,
  storyReady,
  storySlots,
  storyTray,
  takeBack,
  tellStory,
  untellStory,
} from './story-play.js';

const deal = storyDeal(makeStory('story-play', 5, MEMORY_PUZZLES.story));
const ids = deal.moments.map((m) => m.id);

describe('story play (#306)', () => {
  it('starts with every card in the tray, as dealt, and every place empty', () => {
    const play = startStory(3, deal);
    expect(play).toMatchObject({ attempt: 3, placed: [], outcome: 'playing', marks: null });
    expect(storyTray(play).map((m) => m.id)).toEqual(ids);
    expect(storySlots(play)).toEqual([null, null, null, null, null]);
    expect(storyReady(play)).toBe(false);
  });

  it('places a tapped card in the next place, once', () => {
    let play = placeMoment(startStory(1, deal), ids[2]!);
    play = placeMoment(play, ids[0]!);
    play = placeMoment(play, ids[2]!);
    play = placeMoment(play, 'not-dealt');
    expect(play.placed).toEqual([ids[2], ids[0]]);
    expect(storySlots(play).map((m) => m?.id ?? null)).toEqual([ids[2], ids[0], null, null, null]);
    expect(storyTray(play).map((m) => m.id)).toEqual([ids[1], ids[3], ids[4]]);
  });

  it('takes a placed card back, and the ones after it move up', () => {
    let play = startStory(1, deal);
    for (const id of ids.slice(0, 3)) play = placeMoment(play, id);
    expect(takeBack(play, 0).placed).toEqual([ids[1], ids[2]]);
    expect(takeBack(play, 7)).toBe(play);
    expect(clearStory(play).placed).toEqual([]);
  });

  it('tells only a full day, and a wrong telling shows the marks until the ink shifts', () => {
    let play = startStory(1, deal);
    expect(tellStory(play)).toBe(play);
    for (const id of ids) play = placeMoment(play, id);
    expect(storyReady(play)).toBe(true);
    const telling = tellStory(play);
    expect(telling.outcome).toBe('telling');
    // Nothing moves while it's being told.
    expect(takeBack(telling, 0)).toBe(telling);
    expect(placeMoment(clearStory(telling), ids[0]!)).toBe(telling);
    // A hiccup on the way: the same order, to tell again.
    expect(untellStory(telling)).toEqual(play);
    const marks = [true, false, false, true, true];
    const smudged = smudgeStory(telling, 3, marks);
    expect(smudged).toMatchObject({ outcome: 'smudged', right: 3, marks });
    expect(storyReady(smudged)).toBe(false);
    expect(clearStory(smudged)).toBe(smudged);
  });
});
