import type { StoryCard, StoryDeal } from '@heartpatch/shared';

/*
 * A forgotten story try as the card plays it (#306, the owner's approved
 * mockup): read the torn pages, then tap the moments in the order they
 * happened; tap a placed one to take it back. Tell it, and the order goes to
 * the server, which alone knows the day (CLAUDE.md rule 1). A wrong order
 * shows which places were right, then the ink shifts to a new day of the
 * same size. No hints, no peeking. A pure reducer, so every case is
 * unit-tested.
 */

export type StoryOutcome = 'playing' | 'telling' | 'smudged';

export interface StoryPlay {
  /** This try's number (`StoryStart.attempt`), sent back with the order. */
  readonly attempt: number;
  readonly deal: StoryDeal;
  /** Moment ids placed so far, first to last. */
  readonly placed: readonly string[];
  readonly outcome: StoryOutcome;
  /** After a wrong telling: place by place, was it right? */
  readonly marks: readonly boolean[] | null;
  /** After a wrong telling: how many were in the right place. */
  readonly right: number | null;
}

export function startStory(attempt: number, deal: StoryDeal): StoryPlay {
  return { attempt, deal, placed: [], outcome: 'playing', marks: null, right: null };
}

/** How many places the day has. */
export const storyPlaces = (play: StoryPlay) => play.deal.moments.length;

/** The cards still to place, as dealt. */
export function storyTray(play: StoryPlay): StoryCard[] {
  return play.deal.moments.filter((m) => !play.placed.includes(m.id));
}

/** The card at each place, first to last (null while empty). */
export function storySlots(play: StoryPlay): (StoryCard | null)[] {
  return play.deal.moments.map(
    (_, i) => play.deal.moments.find((m) => m.id === play.placed[i]) ?? null,
  );
}

/** Every place filled, ready to tell. */
export const storyReady = (play: StoryPlay) =>
  play.outcome === 'playing' && play.placed.length === storyPlaces(play);

/** A tap on a card in the tray: it goes in the next empty place. */
export function placeMoment(play: StoryPlay, id: string): StoryPlay {
  if (play.outcome !== 'playing' || play.placed.includes(id)) return play;
  if (!play.deal.moments.some((m) => m.id === id)) return play;
  return { ...play, placed: [...play.placed, id] };
}

/** A tap on a placed card: it goes back to the tray and the ones after it move up. */
export function takeBack(play: StoryPlay, place: number): StoryPlay {
  if (play.outcome !== 'playing' || place < 0 || place >= play.placed.length) return play;
  return { ...play, placed: play.placed.filter((_, i) => i !== place) };
}

/** Clear: every card back to the tray. */
export function clearStory(play: StoryPlay): StoryPlay {
  return play.outcome === 'playing' ? { ...play, placed: [] } : play;
}

/** Tell it: the order goes to the server, and the card waits. */
export function tellStory(play: StoryPlay): StoryPlay {
  return storyReady(play) ? { ...play, outcome: 'telling' } : play;
}

/** The server's word: not quite. The places show right or wrong until the ink shifts. */
export function smudgeStory(play: StoryPlay, right: number, marks: readonly boolean[]): StoryPlay {
  return { ...play, outcome: 'smudged', right, marks };
}

/** The telling didn't reach the server (offline, a hiccup): back to the same order to try again. */
export function untellStory(play: StoryPlay): StoryPlay {
  return play.outcome === 'telling' ? { ...play, outcome: 'playing' } : play;
}
