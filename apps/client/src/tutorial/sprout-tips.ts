// Sprout's week-two tips (#731 item 5, design doc §26: "Sprout appears again
// later for occasional tips"). Four short lines, each said once per account,
// when the thing it is about first shows up on a patch. Pure and DOM-free so
// every case is unit-tested: the bubble itself is `sprout-tips-screen.ts`.
//
// "Once per account" is this device's localStorage, the same pattern as
// Sprout's tray hint and the Next-up "Ooh, a goal!" line (no server field):
// a new device may say a tip again.

/** What a tip waits for. */
export type SproutTipId =
  'first-snow' | 'trading-post' | 'hollowed-village' | 'day-three' | 'first-evolution';

export interface SproutTip {
  readonly id: SproutTipId;
  /** Sprout's words (style guide: short, warm, kid-readable). */
  readonly text: string;
}

/** The tips, in the order they are offered when more than one is due. */
export const SPROUT_TIPS: readonly SproutTip[] = [
  // Christmas (#37): the first snow on a patch (the owner's line, Christmas plan §1).
  { id: 'first-snow', text: 'Ooh! Snow! Everyone, look up! ❄️' },
  { id: 'trading-post', text: "That's a trading post!" },
  { id: 'hollowed-village', text: "Something's wrong with that village…" },
  { id: 'day-three', text: 'Fires keep them safe at night.' },
  { id: 'first-evolution', text: 'Friends grow too! Training Grounds go on a homestead.' },
];

/** A tip's longest text that still fits one bubble line on a phone. */
export const SPROUT_TIP_MAX_LENGTH = 60; // TUNE:
/** The patch day (1 = the day they joined) the "fires" tip waits for. */
export const FIRES_TIP_DAY = 3; // TUNE:
/** How long a tip stays up (ms). */
export const SPROUT_TIP_SHOW_MS = 5000; // TUNE:
/** How often a waiting tip looks at the screen again (ms). */
export const SPROUT_TIP_LOOK_MS = 2500; // TUNE:
/** The pause after a tip before the next one may show (ms). */
export const SPROUT_TIP_GAP_MS = 4000; // TUNE:

const DAY_MS = 24 * 60 * 60 * 1000;

/** What is true on the patch on screen right now (the screen supplies these). */
export interface SproutTipFacts {
  /** A trading post's flag is on screen. */
  readonly postFlag: boolean;
  /** A grey (Hollowed) village's flag is on screen. */
  readonly hollowedVillage: boolean;
  /** The player's day on this patch (1 on the day they joined), or null if unknown. */
  readonly day: number | null;
  /** The player's squishy has evolved on a patch. */
  readonly evolved: boolean;
  /** Christmas is on for the patch on screen: it's snowing (#37). */
  readonly snow: boolean;
}

/** Whether the thing a tip is about has happened. */
export function tipDue(id: SproutTipId, facts: SproutTipFacts): boolean {
  switch (id) {
    case 'first-snow':
      return facts.snow;
    case 'trading-post':
      return facts.postFlag;
    case 'hollowed-village':
      return facts.hollowedVillage;
    case 'day-three':
      return facts.day !== null && facts.day >= FIRES_TIP_DAY;
    case 'first-evolution':
      return facts.evolved;
  }
}

/**
 * The player's day on a patch from when they joined, by the game's clock (the
 * server's time as the bag has it, never the device's alone): 1 on the day
 * they joined. Null for a time that isn't a date.
 */
export function patchDay(joinedAt: string, gameNow: number): number | null {
  const joined = Date.parse(joinedAt);
  if (!Number.isFinite(joined)) return null;
  return Math.max(0, Math.floor((gameNow - joined) / DAY_MS)) + 1;
}

/** Where a tip remembers it was said, per account. */
export const sproutTipKey = (tipId: SproutTipId, accountId: string) =>
  `heartpatch.sprout-tip.${tipId}.${accountId}`;

export interface SproutTipsOptions {
  /** Puts the bubble up with these words. */
  show: (text: string) => void;
  /** Takes the bubble down. */
  hide: () => void;
  /**
   * True while a tip must wait: a battle, the tutorial, an open sheet, another
   * card or note (main.ts, the same test as the patch line's).
   */
  busy: () => boolean;
  /** What is on screen now; asked on every look. */
  facts: () => Omit<SproutTipFacts, 'evolved'>;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  setTimer: (task: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

export interface SproutTips {
  /** Who is playing, or null when signed out. */
  setUser: (accountId: string | null) => void;
  /** A real patch is on screen (never the Tutorial Glade, never off the map). */
  setOnPatch: (on: boolean) => void;
  /** The player's squishy evolved on a patch. */
  evolved: () => void;
  /** Looks now; tests and the screen's own timer call it. */
  look: () => void;
  readonly debug: { readonly showing: SproutTipId | null; readonly said: readonly SproutTipId[] };
}

export function createSproutTips(options: SproutTipsOptions): SproutTips {
  const storage = options.storage ?? null;
  let account: string | null = null;
  let onPatch = false;
  let didEvolve = false;
  let showing: SproutTipId | null = null;
  let timer: unknown = null;
  /** Said this session, even where storage won't keep it (private mode, full). */
  const saidHere = new Set<string>();

  const said = (id: SproutTipId): boolean => {
    if (account === null) return true;
    if (saidHere.has(sproutTipKey(id, account))) return true;
    try {
      return storage?.getItem(sproutTipKey(id, account)) === '1';
    } catch {
      // Storage that throws can't remember: say each tip at most once a session.
      return false;
    }
  };
  const remember = (id: SproutTipId): void => {
    if (account === null) return;
    saidHere.add(sproutTipKey(id, account));
    try {
      storage?.setItem(sproutTipKey(id, account), '1');
    } catch {
      // Private mode: it may say it again next time.
    }
  };

  const stop = () => {
    if (timer !== null) options.clearTimer(timer);
    timer = null;
  };
  const later = (ms: number) => {
    stop();
    timer = options.setTimer(() => {
      timer = null;
      look();
    }, ms);
  };

  function look(): void {
    if (showing !== null) return;
    if (account === null || !onPatch) {
      stop();
      return;
    }
    const waiting = SPROUT_TIPS.filter((tip) => !said(tip.id));
    // Everything said: nothing left to watch for, so nothing runs.
    if (waiting.length === 0) {
      stop();
      return;
    }
    if (options.busy()) {
      later(SPROUT_TIP_LOOK_MS);
      return;
    }
    const facts = { ...options.facts(), evolved: didEvolve };
    const due = waiting.find((tip) => tipDue(tip.id, facts));
    if (!due) {
      later(SPROUT_TIP_LOOK_MS);
      return;
    }
    remember(due.id);
    showing = due.id;
    options.show(due.text);
    stop();
    timer = options.setTimer(() => {
      timer = null;
      showing = null;
      options.hide();
      later(SPROUT_TIP_GAP_MS);
    }, SPROUT_TIP_SHOW_MS);
  }

  const hideNow = () => {
    if (showing === null) return;
    showing = null;
    options.hide();
  };

  return {
    setUser: (accountId) => {
      if (accountId === account) return;
      account = accountId;
      didEvolve = false;
      stop();
      hideNow();
      look();
    },
    setOnPatch: (on) => {
      if (on === onPatch) return;
      onPatch = on;
      stop();
      // Leaving the patch (a battle, the lobby, the Glade) takes a tip down.
      if (!on) hideNow();
      look();
    },
    evolved: () => {
      didEvolve = true;
      look();
    },
    look,
    get debug() {
      return { showing, said: SPROUT_TIPS.filter((tip) => said(tip.id)).map((tip) => tip.id) };
    },
  };
}
