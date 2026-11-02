import { CLOTHING_BY_ID, type MilestoneReward, type MilestonesResponse } from '@heartpatch/shared';
import { MILESTONES_TEXT, nextTier, type ShownTrack } from './milestones-view.js';

// The Next-up chip, its goals sheet and the Adventure tray's Goals row (#731,
// owner-approved mockups v4). Pure, so the rules are tested without a DOM:
// which goals are nearest, the "All done" chip, and the solo card while a
// patch waits for a friend. Words follow the style guide (§2, §6).

export const NEXT_UP_TEXT = {
  kicker: 'Next up',
  kickerCount: (have: number, need: number) => `Next up · ${String(have)} of ${String(need)}`,
  open: 'See your next goals',
  sheetTitle: 'Next up',
  close: 'Close Next up',
  allDoneChip: 'All done! Nice one',
  allDoneTitle: 'All done!',
  allDoneLine: 'You finished every milestone you can see. Wow, Keeper!',
  secretName: MILESTONES_TEXT.secretName,
  secretGoal: MILESTONES_TEXT.secretGoal,
  // The solo card (owner decision 3): milestones need a friend on the patch.
  soloChip: 'Invite a friend to start',
  soloHeading: 'Milestones start counting when a friend joins 💛',
  soloLine: 'Your patch needs two Keepers. Share your code and ask a friend to join!',
  soloWaiting: 'Waiting for a friend:',
  soloNotOwner: 'Ask whoever made this patch to share its code!',
  soloLoading: 'Finding your code…',
  copy: 'Copy code',
  copied: 'Copied!',
  copyFailed: 'Write it down instead',
  makeCode: 'Make a code',
  // The tray row (owner decision 2): the nearest goal, opening the same sheet.
  rowLabel: 'Next up',
  // Sprout, once per account after graduation (owner decision 4).
  sprout: 'Ooh, a goal!',
  title: (name: string) => `Title: ${name}`,
} as const;

/** Where a goal's button leads: existing places only, no new screens. */
export type NextUpGo = 'find' | 'claim' | 'map' | 'hollow' | 'team';

export interface NextUpGoal {
  readonly trackId: string;
  readonly trackName: string;
  /** In kid words, what's left: "Befriend 2 more kinds". */
  readonly short: string;
  /** The tier's own goal: "Befriend 8 kinds of squishy." */
  readonly goal: string;
  readonly have: number;
  readonly need: number;
  /** 0–100, towards this tier. */
  readonly percent: number;
  /** The prize, one chip per piece. */
  readonly prizes: readonly string[];
  readonly go: NextUpGo;
  /** The button's words. */
  readonly goLabel: string;
}

export type NextUpState =
  /** Nothing to show (loading, the Glade, a failed read). */
  | { readonly kind: 'none' }
  /** The nearest goals (state A). */
  | { readonly kind: 'goals'; readonly goals: readonly NextUpGoal[] }
  /** Alone on this patch: the goals wait for a friend (state B). */
  | { readonly kind: 'solo'; readonly goals: readonly NextUpGoal[] }
  /** Every tier you can see is earned (state C). */
  | {
      readonly kind: 'done';
      readonly titles: readonly string[];
      /** Secret tracks still hidden ("???"). */
      readonly secrets: number;
    };

/** How many goals the sheet shows. */
export const NEAREST_COUNT = 3;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** What's left in kid words, per track; any other track says its tier goal. */
const LEFT: Readonly<Record<string, (n: number) => string>> = {
  territory: (n) => `Claim ${String(n)} more ${plural(n, 'tile', 'tiles')}`,
  collector: (n) => `Befriend ${String(n)} more ${plural(n, 'kind', 'kinds')}`,
  evolution: (n) => `Help ${String(n)} more ${plural(n, 'squishy', 'squishies')} evolve`,
  caretaker: (n) => `Feed, pet or play ${String(n)} more ${plural(n, 'time', 'times')}`,
  defender: (n) => `Keep your land safe ${String(n)} more ${plural(n, 'time', 'times')}`,
  rescuer: (n) => `Bring ${String(n)} more home from the Hollow`,
  seeker: (n) => `Search ${String(n)} more ${plural(n, 'spot', 'spots')}`,
};

/** Where each track is played (mockup "Where each Go button leads"); others go to the map. */
const GO: Readonly<Record<string, { go: NextUpGo; label: string }>> = {
  collector: { go: 'find', label: 'Find a squishy' },
  territory: { go: 'claim', label: 'Claim land' },
  seeker: { go: 'map', label: 'Search your land' },
  rescuer: { go: 'hollow', label: 'Go to the Hollow' },
  evolution: { go: 'team', label: 'See your team' },
  caretaker: { go: 'team', label: 'See your team' },
};
const GO_MAP = { go: 'map', label: 'Off you go!' } as const;

/** The prize as chips: "Explorer's Hat", "25 Patch Coins", "Title: Trailblazer". */
export function prizeChips(reward: MilestoneReward): string[] {
  const out: string[] = [];
  const piece = reward.clothing ? CLOTHING_BY_ID.get(reward.clothing)?.name : undefined;
  if (piece) out.push(piece);
  if (reward.coins > 0) out.push(MILESTONES_TEXT.coins(reward.coins));
  out.push(NEXT_UP_TEXT.title(reward.title.name));
  return out;
}

function goalOf(track: ShownTrack): { goal: NextUpGoal; coins: number } | null {
  const tier = nextTier(track);
  if (!tier) return null;
  const have = Math.min(track.progress, tier.threshold);
  const left = tier.threshold - have;
  const short = LEFT[track.id]?.(left) ?? tier.goal.replace(/[.!]$/, '');
  const where = GO[track.id] ?? GO_MAP;
  const goal: NextUpGoal = {
    trackId: track.id,
    trackName: track.name,
    short,
    goal: tier.goal,
    have,
    need: tier.threshold,
    percent: Math.floor((have * 100) / tier.threshold),
    prizes: prizeChips(tier.reward),
    go: where.go,
    goLabel: where.label,
  };
  return { goal, coins: tier.reward.coins };
}

/**
 * The nearest unfinished tiers by progress, nearest first: skips secret
 * tracks (found or not), finished tracks and seasonal tracks out of season
 * (`inSeason`, when known). Ties go to the bigger prize, then the track
 * order the server sends.
 */
export function nearestGoals(
  tracks: MilestonesResponse['tracks'],
  inSeason: ((season: string) => boolean) | null = null,
  count = NEAREST_COUNT,
): NextUpGoal[] {
  const found: { goal: NextUpGoal; coins: number; order: number; share: number }[] = [];
  tracks.forEach((track, order) => {
    if (track.hidden || track.secret) return;
    if (track.season !== null && inSeason !== null && !inSeason(track.season)) return;
    const next = goalOf(track);
    if (next) found.push({ ...next, order, share: next.goal.have / next.goal.need });
  });
  found.sort((a, b) => b.share - a.share || b.coins - a.coins || a.order - b.order);
  return found.slice(0, count).map((f) => f.goal);
}

/**
 * What the chip, sheet and row show for a milestones read with `?mapId=`
 * (null: not read yet, or no patch to read it for).
 */
export function nextUpState(
  response: MilestonesResponse | null,
  inSeason: ((season: string) => boolean) | null = null,
): NextUpState {
  if (!response) return { kind: 'none' };
  const goals = nearestGoals(response.tracks, inSeason);
  if (response.countsHere === false) return { kind: 'solo', goals };
  if (goals.length > 0) return { kind: 'goals', goals };
  return {
    kind: 'done',
    titles: response.titles.map((t) => t.name),
    secrets: response.tracks.filter((t) => t.hidden).length,
  };
}

export interface ChipView {
  readonly kicker: string;
  readonly line: string;
  readonly icon: string;
  /** Ring fill, 0–100. */
  readonly percent: number;
  readonly look: 'goal' | 'solo' | 'done';
}

/** The chip's words and ring for a state, or null when it hides. */
export function chipView(state: NextUpState): ChipView | null {
  switch (state.kind) {
    case 'none':
      return null;
    case 'goals': {
      const goal = state.goals[0];
      if (!goal) return null;
      return {
        kicker: NEXT_UP_TEXT.kickerCount(goal.have, goal.need),
        line: goal.short,
        icon: '🎯',
        percent: goal.percent,
        look: 'goal',
      };
    }
    case 'solo':
      return {
        kicker: NEXT_UP_TEXT.kicker,
        line: NEXT_UP_TEXT.soloChip,
        icon: '💛',
        percent: 0,
        look: 'solo',
      };
    case 'done':
      return {
        kicker: NEXT_UP_TEXT.kicker,
        line: NEXT_UP_TEXT.allDoneChip,
        icon: '🌟',
        percent: 100,
        look: 'done',
      };
  }
}

/** The tray row's sub line and count ("6/8"), from the same state. */
export function rowView(state: NextUpState): { sub: string; count: string | null } | null {
  const chip = chipView(state);
  if (!chip) return null;
  const goal = state.kind === 'goals' ? state.goals[0] : undefined;
  return {
    sub: chip.line,
    count: goal ? `${String(goal.have)}/${String(goal.need)}` : null,
  };
}

/** Where the one-time Sprout line remembers it was said, per account. */
export const sproutKey = (accountId: string) => `heartpatch.next-up.sprout.${accountId}`;
