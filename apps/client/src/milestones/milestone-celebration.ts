import type { MilestoneNews, PublicUser, WsEventMessage } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import { milestonesApi, type MilestonesApi } from './milestones-api.js';
import { freshNews, mayEarnMilestone, MILESTONES_TEXT, rewardLine } from './milestones-view.js';
import './milestones.css';

// A little party when a milestone is earned (design doc §24): a card with
// sparkles, the milestone, its prize and its title. The server's milestone
// consumer grants tiers a moment after the play that earned them, so this
// looks after the player's own play arrives live, and again a bit later.
// "Yay!" marks it seen on the server, so no other device shows it again.

export interface MilestoneCelebrationOptions {
  root: HTMLElement;
  api?: Pick<MilestonesApi, 'get' | 'seen'>;
  setTimer?: (task: () => void, ms: number) => unknown;
  /**
   * True while a card would be in the way (a battle, a found lore page): the
   * look waits and tries again, so cards come one at a time.
   */
  busy?: () => boolean;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface MilestoneCelebrationDebug {
  /** The news on the card, if it's open. */
  readonly showing: string | null;
  /** Its title, so a test can tell which one. */
  readonly title: string | null;
  readonly waiting: number;
}

export interface MilestoneCelebration {
  setUser: (user: PublicUser | null) => void;
  /** Looks for newly earned milestones soon (the consumer runs after the play). */
  check: () => void;
  /** A live event from the map on screen: the player's own counted play checks. */
  liveEvent: (event: WsEventMessage) => void;
  readonly debug: MilestoneCelebrationDebug;
}

/**
 * When to look after play: the consumer usually finishes within a second or
 * two of the event, and the second look catches a slow one.
 */
const CHECK_AFTER_MS = [1_500, 6_000]; // TUNE: guesses
/** How often a look that found the screen busy tries again. */
const BUSY_RETRY_MS = 3_000; // TUNE: guess

export function createMilestoneCelebration(
  options: MilestoneCelebrationOptions,
): MilestoneCelebration {
  const api = options.api ?? milestonesApi;
  const setTimer = options.setTimer ?? ((task, ms) => setTimeout(task, ms));
  const busy = options.busy ?? (() => false);
  let user: PublicUser | null = null;
  let queue: MilestoneNews[] = [];
  let showing: MilestoneNews | null = null;
  /** Ids queued or shown on this device since login, so a slow "seen" never shows one twice. */
  let queued = new Set<string>();
  /** Checks waiting on a timer: more play meanwhile needs no more. */
  let pending = 0;
  /** A busy look waiting to try again (one at a time). */
  let retrying = false;

  const sparkles = el(
    'div',
    { class: 'milestone-sparkles', 'aria-hidden': 'true' },
    ...['✨', '🎉', '⭐', '💖', '✨', '🎊'].map((s) => el('span', {}, s)),
  );
  const kicker = el('p', { class: 'milestone-kicker' }, MILESTONES_TEXT.kicker);
  const name = el('h2', { class: 'milestone-name', 'data-testid': 'milestone-name' });
  const goal = el('p', { class: 'milestone-goal' });
  const title = el('p', { class: 'milestone-title', 'data-testid': 'milestone-title' });
  const prize = el('p', { class: 'milestone-prize', 'data-testid': 'milestone-prize' });
  const button = el(
    'button',
    { type: 'button', class: 'auth-button', 'data-testid': 'milestone-yay' },
    MILESTONES_TEXT.yay,
  );
  const card = el(
    'section',
    {
      class: 'milestone-card',
      role: 'dialog',
      'aria-label': MILESTONES_TEXT.kicker,
      'data-testid': 'milestone-card',
    },
    sparkles,
    kicker,
    name,
    title,
    goal,
    prize,
    button,
  );
  card.hidden = true;
  options.root.append(card);

  const showNext = () => {
    showing = queue.shift() ?? null;
    card.hidden = showing === null;
    if (!showing) return;
    name.textContent = showing.trackName;
    title.textContent = `“${showing.reward.title.name}”`;
    goal.textContent = showing.goal;
    prize.textContent = `${MILESTONES_TEXT.prize} ${rewardLine(showing.reward)}`;
    button.textContent = queue.length > 0 ? MILESTONES_TEXT.next : MILESTONES_TEXT.yay;
    // Restart the sparkles for each card.
    sparkles.classList.remove('milestone-sparkles-on');
    sparkles.getBoundingClientRect();
    sparkles.classList.add('milestone-sparkles-on');
  };

  button.addEventListener('click', () => {
    const done = showing;
    if (done) {
      // Fire and forget: if it fails, the next device may celebrate it once more.
      api.seen([done.id]).catch(() => undefined);
    }
    showNext();
  });

  const look = async (): Promise<void> => {
    const who = user;
    if (!who) return;
    if (busy()) {
      if (!retrying) {
        retrying = true;
        setTimer(() => {
          retrying = false;
          void look();
        }, BUSY_RETRY_MS);
      }
      return;
    }
    try {
      const { news } = await api.get();
      if (user?.id !== who.id) return;
      const fresh = freshNews(news, queued);
      if (fresh.length === 0) return;
      for (const n of fresh) queued.add(n.id);
      queue.push(...fresh);
      if (!showing) showNext();
    } catch {
      // Offline: the next check finds it.
    }
  };

  const check = () => {
    if (!user || pending > 0) return;
    for (const ms of CHECK_AFTER_MS) {
      pending += 1;
      setTimer(() => {
        pending -= 1;
        void look();
      }, ms);
    }
  };

  return {
    setUser: (next) => {
      if (next?.id === user?.id) return;
      user = next;
      queue = [];
      showing = null;
      queued = new Set();
      card.hidden = true;
      // Anything earned while away (a raid held overnight, a backfilled First Patch).
      if (next) void look();
    },
    check,
    liveEvent: (event) => {
      if (user && mayEarnMilestone(event, user.id)) check();
    },
    get debug() {
      return {
        showing: showing?.id ?? null,
        title: showing?.reward.title.id ?? null,
        waiting: queue.length,
      };
    },
  };
}
