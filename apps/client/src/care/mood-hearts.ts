import { CARE_RULES, type MoodId } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import './mood-hearts.css';

// How happy a squishy is, one way everywhere (#375): five hearts filled to its
// contentment and one mood word, from the shared mood bands (CARE_RULES.moods).
// The Squishies roster and the care sheet both draw this, so they always agree.

/** A mood's picture and word, happiest first, so the order reads at a glance. */
export const MOOD_WORDS: Readonly<Record<MoodId, { icon: string; word: string }>> = {
  glowing: { icon: '🌟', word: 'Glowing' },
  happy: { icon: '😊', word: 'Happy' },
  calm: { icon: '🙂', word: 'Okay' },
  cuddly: { icon: '🥺', word: 'Lonely' },
};

/** Hearts out of 5 for a contentment, to the nearest half (2.5 = two and a half). */
export function heartsOf(contentment: number): number {
  return Math.round((contentment / CARE_RULES.maxContentment) * 10) / 2;
}

/** Below this a squishy isn't Happy any more (the shared mood bands). */
const HAPPY_FROM = CARE_RULES.moods.find((m) => m.id === 'happy')?.atLeast ?? 40;

/** Care is due whenever it's below Happy (Okay or Lonely): one rule, no hidden counts. */
export function needsCareAt(contentment: number): boolean {
  return contentment < HAPPY_FROM;
}

export interface MoodHeartsEl {
  readonly root: HTMLElement;
  update(contentment: number, mood: MoodId, drifting: boolean): void;
}

/** Five hearts and the mood word, side by side. */
export function moodHeartsEl(testId: string): MoodHeartsEl {
  const fill = el('span', { class: 'mood-hearts-fill' });
  const hearts = el('span', { class: 'mood-hearts', role: 'img' }, fill);
  const word = el('span', { class: 'mood-word' });
  const root = el('span', { class: 'mood-hearts-row', 'data-testid': testId }, hearts, word);
  return {
    root,
    update(contentment, mood, drifting) {
      const n = heartsOf(contentment);
      fill.style.width = `${String(n * 20)}%`;
      hearts.setAttribute('aria-label', `${String(n)} of 5 hearts`);
      const w = MOOD_WORDS[mood];
      word.textContent = `${w.icon} ${w.word}`;
      word.className = `mood-word mood-word-${mood}`;
      root.dataset['hearts'] = String(n);
      root.dataset['mood'] = mood;
      root.classList.toggle('mood-drifting', drifting);
    },
  };
}
