import { describe, expect, it } from 'vitest';
import {
  createSproutTips,
  FIRES_TIP_DAY,
  patchDay,
  SPROUT_TIP_GAP_MS,
  SPROUT_TIP_LOOK_MS,
  SPROUT_TIP_MAX_LENGTH,
  SPROUT_TIP_SHOW_MS,
  SPROUT_TIPS,
  sproutTipKey,
  tipDue,
  type SproutTipFacts,
} from './sprout-tips.js';

const NONE: SproutTipFacts = { postFlag: false, hollowedVillage: false, day: 1, evolved: false };
const ME = 'user-1';

function setup(storage: Map<string, string> | null = new Map()) {
  let facts: Omit<SproutTipFacts, 'evolved'> = { postFlag: false, hollowedVillage: false, day: 1 };
  let busy = false;
  const shown: string[] = [];
  let hides = 0;
  const timers = new Map<number, { task: () => void; ms: number }>();
  let next = 1;
  const tips = createSproutTips({
    show: (text) => shown.push(text),
    hide: () => {
      hides += 1;
    },
    busy: () => busy,
    facts: () => facts,
    storage: storage && {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => void storage.set(k, v),
    },
    setTimer: (task, ms) => {
      timers.set(next, { task, ms });
      return next++;
    },
    clearTimer: (h) => void timers.delete(h as number),
  });
  /** Runs every timer due now, once (timers they set wait for the next call). */
  const tick = () => {
    const due = [...timers.entries()];
    timers.clear();
    for (const [, t] of due) t.task();
  };
  return {
    tips,
    shown,
    storage,
    hides: () => hides,
    tick,
    timers,
    setFacts: (f: Partial<Omit<SproutTipFacts, 'evolved'>>) => {
      facts = { ...facts, ...f };
    },
    setBusy: (b: boolean) => {
      busy = b;
    },
    onPatch: () => {
      tips.setUser(ME);
      tips.setOnPatch(true);
    },
  };
}

describe('the tips list', () => {
  it('has the four tips, each short enough for one bubble', () => {
    expect(SPROUT_TIPS.map((t) => t.id)).toEqual([
      'trading-post',
      'hollowed-village',
      'day-three',
      'first-evolution',
    ]);
    for (const tip of SPROUT_TIPS) {
      expect(tip.text.length).toBeLessThanOrEqual(SPROUT_TIP_MAX_LENGTH);
    }
  });

  it('keeps each tip waiting on its own thing', () => {
    expect(tipDue('trading-post', { ...NONE, postFlag: true })).toBe(true);
    expect(tipDue('trading-post', NONE)).toBe(false);
    expect(tipDue('hollowed-village', { ...NONE, hollowedVillage: true })).toBe(true);
    expect(tipDue('first-evolution', { ...NONE, evolved: true })).toBe(true);
    expect(tipDue('day-three', { ...NONE, day: FIRES_TIP_DAY - 1 })).toBe(false);
    expect(tipDue('day-three', { ...NONE, day: FIRES_TIP_DAY })).toBe(true);
    expect(tipDue('day-three', { ...NONE, day: null })).toBe(false);
  });
});

describe('patchDay', () => {
  const joined = '2026-11-01T10:00:00.000Z';
  it('counts the day they joined as day 1, on the game clock', () => {
    const at = Date.parse(joined);
    expect(patchDay(joined, at)).toBe(1);
    expect(patchDay(joined, at + 24 * 3600_000 - 1)).toBe(1);
    expect(patchDay(joined, at + 2 * 24 * 3600_000)).toBe(3);
  });
  it('never goes below day 1 and ignores a bad date', () => {
    expect(patchDay(joined, Date.parse(joined) - 5 * 24 * 3600_000)).toBe(1);
    expect(patchDay('soon', 0)).toBeNull();
  });
});

describe('Sprout tips', () => {
  it('says the trading-post tip once, when a flag is on screen', () => {
    const t = setup();
    t.onPatch();
    expect(t.shown).toEqual([]);
    t.setFacts({ postFlag: true });
    t.tick();
    expect(t.shown).toEqual(["That's a trading post!"]);
    // Gone and back: not twice.
    t.tick(); // hides
    for (let i = 0; i < 6; i++) t.tick();
    expect(t.shown).toEqual(["That's a trading post!"]);
    expect(t.storage?.get(sproutTipKey('trading-post', ME))).toBe('1');
  });

  it('says the village tip when a grey village is seen', () => {
    const t = setup();
    t.onPatch();
    t.setFacts({ hollowedVillage: true });
    t.tick();
    expect(t.shown).toEqual(["Something's wrong with that village…"]);
  });

  it('says the fires tip on day 3 and not before', () => {
    const t = setup();
    t.onPatch();
    t.setFacts({ day: 2 });
    t.tick();
    expect(t.shown).toEqual([]);
    t.setFacts({ day: 3 });
    t.tick();
    expect(t.shown).toEqual(['Fires keep them safe at night.']);
  });

  it('says the growing tip after the first evolution', () => {
    const t = setup();
    t.onPatch();
    t.tips.evolved();
    expect(t.shown).toEqual(['Friends grow too! Training Grounds go on a homestead.']);
    t.tips.evolved();
    expect(t.shown).toHaveLength(1);
  });

  it('waits behind a battle, a sheet or the tutorial (busy), then says it', () => {
    const t = setup();
    t.setBusy(true);
    t.onPatch();
    t.setFacts({ postFlag: true });
    t.tick();
    t.tick();
    expect(t.shown).toEqual([]);
    expect(t.storage?.size).toBe(0);
    t.setBusy(false);
    t.tick();
    expect(t.shown).toEqual(["That's a trading post!"]);
  });

  it('says one tip at a time, with a pause between', () => {
    const t = setup();
    t.onPatch();
    t.setFacts({ postFlag: true, day: 3 });
    t.tick();
    expect(t.shown).toEqual(["That's a trading post!"]);
    t.tick(); // a look while it is up does nothing; its hide timer fires
    expect(t.hides()).toBe(1);
    expect([...t.timers.values()].map((x) => x.ms)).toEqual([SPROUT_TIP_GAP_MS]);
    t.tick();
    expect(t.shown).toEqual(["That's a trading post!", 'Fires keep them safe at night.']);
    expect(SPROUT_TIP_SHOW_MS).toBeGreaterThan(0);
  });

  it('is once per account: a new session on the same storage stays quiet', () => {
    const store = new Map<string, string>();
    const a = setup(store);
    a.onPatch();
    a.setFacts({ postFlag: true });
    a.tick();
    expect(a.shown).toHaveLength(1);
    const b = setup(store);
    b.onPatch();
    b.setFacts({ postFlag: true });
    b.tick();
    expect(b.shown).toEqual([]);
  });

  it('is per account: another player on the device still hears it', () => {
    const store = new Map<string, string>();
    const a = setup(store);
    a.onPatch();
    a.setFacts({ postFlag: true });
    a.tick();
    const b = setup(store);
    b.tips.setUser('user-2');
    b.tips.setOnPatch(true);
    b.setFacts({ postFlag: true });
    b.tick();
    expect(b.shown).toEqual(["That's a trading post!"]);
  });

  it('says nothing off a patch or signed out, and takes a showing tip down on leaving', () => {
    const t = setup();
    t.setFacts({ postFlag: true });
    t.tips.setUser(ME);
    t.tick();
    expect(t.shown).toEqual([]);
    t.tips.setOnPatch(true);
    expect(t.shown).toHaveLength(1);
    t.tips.setOnPatch(false); // the Glade, or off the map
    expect(t.hides()).toBe(1);
    t.tips.setUser(null);
    t.tips.setOnPatch(true);
    expect(t.timers.size).toBe(0);
  });

  it('still says each tip at most once a session when storage throws or is missing', () => {
    const t = setup(null);
    t.onPatch();
    t.setFacts({ postFlag: true });
    t.tick();
    for (let i = 0; i < 8; i++) t.tick();
    expect(t.shown).toEqual(["That's a trading post!"]);
  });

  it('stops looking once every tip is said', () => {
    const t = setup();
    t.onPatch();
    t.setFacts({ postFlag: true, hollowedVillage: true, day: 3 });
    t.tips.evolved();
    for (let i = 0; i < 20; i++) t.tick();
    expect(t.shown).toHaveLength(4);
    expect(t.tips.debug.said).toHaveLength(4);
    expect(t.timers.size).toBe(0);
    expect(SPROUT_TIP_LOOK_MS).toBeGreaterThan(0);
  });
});
