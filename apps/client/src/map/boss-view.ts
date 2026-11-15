import type { BossVisit } from '@heartpatch/shared';

/*
 * The mini-boss on the map (#190, 190f): what the marker, the patch line and
 * the tile card say. Pure, so it's unit-tested without the DOM or the scene.
 * The server tells a Keeper the species only once they've met it (CLAUDE.md
 * rule 6), so every text here has a version that names nothing.
 */

// Player-facing text (style guide §2, §6; the owner-approved mockups, #190).
export const BOSS_TEXT = {
  /** The marker's label until the species is known. */
  unknownName: 'A BIG squishy',
  /** The patch line once the species is known (`GET …/boss` names it). */
  stomping: (name: string) => `A giant ${name} is stomping about!`,
  /** The patch line while it isn't: the terrain under the boss, from the client's own tile. */
  stompingAround: (terrain: string) => `Something BIG is stomping around the ${terrain}!`,
  until: (weekday: string) => `here until ${weekday}`,
  lastDay: 'last day!',
  tries: (n: number) => `🍀 ${String(n)} ${n === 1 ? 'try' : 'tries'} left today`,
  noTries: 'No tries left today',
  cardTitle: 'A BIG squishy!',
  cardAsk: 'Bring your whole team?',
  go: "Let's go!",
  tooBig: 'Too big for now! Grow your team and come back.',
  beaten: 'You beat it! See you next time!',
  friend: "It's your friend now! 💗",
  backTomorrow: 'Back tomorrow!',
  seeYou: 'See you next time!',
} as const;

/** The word for the land a boss stands on, in "stomping around the …". */
const TERRAIN_WORDS: Readonly<Record<string, string>> = {
  meadow: 'meadow',
  forest: 'forest',
  'old-forest': 'old forest',
  hills: 'hills',
  mountains: 'mountains',
  lake: 'lake',
  'wild-lake': 'lake',
  'pumpkin-fields': 'pumpkin fields',
  clearing: 'clearing',
  coast: 'coast',
};

/** "meadow" for a tile's terrain; "patch" when the tile is unknown or has no cozy word. */
export function terrainWord(terrain: string | null | undefined): string {
  return (
    (terrain !== undefined && terrain !== null ? TERRAIN_WORDS[terrain] : undefined) ?? 'patch'
  );
}

export interface BossUntil {
  /** "here until Sunday", or "last day!" on its final day. */
  readonly text: string;
  readonly lastDay: boolean;
}

/**
 * When it leaves, in the device's own days. `endsAt` is the instant the visit
 * ends (the server's open time plus two days), so the last day it's here is
 * the one a moment before. Days are the device's own; the server's "last day"
 * uses the patch's zone, and they agree when the two share one. Unreadable or past gives null: nothing is shown.
 */
export function bossUntil(endsAt: string, now: Date, locale = 'en-US'): BossUntil | null {
  const end = Date.parse(endsAt);
  if (!Number.isFinite(end) || end <= now.getTime()) return null;
  const lastMoment = new Date(end - 1);
  const lastDay = lastMoment.toDateString() === now.toDateString();
  const weekday = lastMoment.toLocaleDateString(locale, { weekday: 'long' });
  return {
    text: lastDay ? BOSS_TEXT.lastDay : BOSS_TEXT.until(weekday),
    lastDay,
  };
}

/** What the map draws for the boss: null when none is out (or its time is up). */
export interface BossMarkerModel {
  readonly q: number;
  readonly r: number;
  /** Null until this Keeper has met it: the marker shows "?!". */
  readonly speciesId: string | null;
  /** The name to show, or the "A BIG squishy" stand-in. */
  readonly name: string;
  readonly known: boolean;
  readonly until: BossUntil;
}

/** `nameOf` knows a species' name only if this Keeper's catalog has its def. */
export function markerModel(
  visit: BossVisit | null,
  now: Date,
  nameOf: (speciesId: string) => string | null,
): BossMarkerModel | null {
  if (!visit) return null;
  const until = bossUntil(visit.window.endsAt, now);
  if (!until) return null;
  const name = visit.species !== null ? nameOf(visit.species) : null;
  return {
    q: visit.tile.q,
    r: visit.tile.r,
    speciesId: name !== null ? visit.species : null,
    name: name ?? BOSS_TEXT.unknownName,
    known: name !== null,
    until,
  };
}

/** The patch line when a boss arrives: names it only once the species is known. */
export function bossPatchLine(name: string | null, terrain: string | null | undefined): string {
  return name !== null ? BOSS_TEXT.stomping(name) : BOSS_TEXT.stompingAround(terrainWord(terrain));
}

/** What the tile card shows for the boss's tile. */
export interface BossCardModel {
  readonly title: string;
  /** The line under the title. */
  readonly body: string;
  /** The tries chip; null when the fight isn't on offer. */
  readonly chip: string | null;
  /** Whether "Let's go!" shows (and works). */
  readonly canFight: boolean;
}

export function cardModel(visit: BossVisit, marker: BossMarkerModel): BossCardModel {
  const title = marker.known ? marker.name : BOSS_TEXT.cardTitle;
  switch (visit.state) {
    case 'too-big':
      return { title, body: BOSS_TEXT.tooBig, chip: null, canFight: false };
    case 'beaten':
      return { title, body: BOSS_TEXT.beaten, chip: null, canFight: false };
    case 'friend':
      return { title, body: BOSS_TEXT.friend, chip: null, canFight: false };
    case 'here':
      if (visit.triesLeftToday <= 0) {
        return {
          title,
          body: marker.until.lastDay ? BOSS_TEXT.seeYou : BOSS_TEXT.backTomorrow,
          chip: BOSS_TEXT.noTries,
          canFight: false,
        };
      }
      return {
        title,
        body: BOSS_TEXT.cardAsk,
        chip: BOSS_TEXT.tries(visit.triesLeftToday),
        canFight: true,
      };
  }
}
