import { GAME_DATA, type DefenseStance, type Raid } from '@heartpatch/shared';

// Player-facing words for the challenge report (#16; style guide §2, §6, §9):
// calm and reassuring, never shaming. A challenge is "Someone challenged your
// land!", the stance is the "Defense style" (Bold, Careful, Balanced).

export const RAID_TEXT = {
  open: 'Report',
  /** Peeks out beside the Adventure handle while a raid is unseen. */
  news: 'New challenge report!',
  title: 'Challenge report',
  challenged: 'Someone challenged your land!',
  quiet: 'All quiet on your land. Everyone is snug!',
  fresh: 'New!',
  watch: 'Watch',
  gotIt: 'Got it!',
  close: 'Close',
  styleTitle: 'Defense style',
  styleNote: 'How your squishies on watch play when someone challenges your land.',
  styleSaved: (name: string) => `Your squishies will play ${name}!`,
  noReplay: 'Nothing to watch for this one.',
} as const;

/** The three defense styles, in the order the picker shows them. */
export const STANCES: readonly { stance: DefenseStance; name: string; hint: string }[] = [
  { stance: 'aggressive', name: 'Bold', hint: 'Go for the big plays!' },
  { stance: 'balanced', name: 'Balanced', hint: 'A little of everything.' },
  { stance: 'defensive', name: 'Careful', hint: 'Rest up and swap out.' },
];

export function stanceName(stance: DefenseStance): string {
  return STANCES.find((s) => s.stance === stance)?.name ?? 'Balanced';
}

const FENCE_NAMES = new Map(
  GAME_DATA.buildings.filter((b) => b.kind === 'fence').map((b) => [b.id, b.name]),
);

/** One line per raid: who came by and how it went, kind either way. */
export function raidLine(
  raid: Pick<Raid, 'attackerName' | 'outcome' | 'reason' | 'stance'> & Partial<Pick<Raid, 'fence'>>,
): string {
  const who = raid.attackerName;
  // A fence battle (#203): the fence held, or it was broken (the guard's still there).
  if (raid.fence) {
    const name = FENCE_NAMES.get(raid.fence.buildingId) ?? 'fence';
    if (raid.fence.broken) {
      return `🪵 ${who} broke your ${name}! Your guard is still there. Build it again from the land’s Fences.`;
    }
    return raid.reason === 'forfeit'
      ? `🔨 ${who} came by, then stopped. Your ${name} is at ${String(raid.fence.percent)}%.`
      : `🔨 Your ${name} kept ${who} out! It’s at ${String(raid.fence.percent)}%. Repair it from the land’s Fences.`;
  }
  const defenders = raid.stance === null ? 'The land’s guardians' : 'Your squishies';
  switch (raid.outcome) {
    case 'held':
      return raid.reason === 'forfeit'
        ? `${who} came to visit, then scooted home. Your land is safe!`
        : `${who} tried to visit your land. ${defenders} held on!`;
    case 'tie':
      return `${who} came to visit. It was a tie, and your land is safe!`;
    case 'lost':
      return `${who} won a showdown on your land. ${defenders} did their best!`;
    case 'taken':
      return `${who} won a showdown and claimed one of your spots. Everyone came home safe!`;
    case 'no-contest':
      return `${who} came to visit, but everyone got distracted. Nothing changed!`;
  }
}

/** A fire that came down with the land (#202), or null when there was none there. */
export function raidFireLine(raid: Pick<Raid, 'lostFire'>): string | null {
  return raid.lostFire === null
    ? null
    : 'Your fire there went out when the land changed hands. You got some things back 🔥';
}

/** My fences destroyed when the land was taken (#203), or null when there were none there. */
export function raidFencesLine(raid: Partial<Pick<Raid, 'lostFences'>>): string | null {
  const n = raid.lostFences ?? 0;
  if (n === 0) return null;
  return n === 1
    ? 'Your fence there was lost when the land changed hands. 🪵'
    : `Your ${String(n)} fences there were lost when the land changed hands. 🪵`;
}

/** "Bold" etc. for a raid's style, or null when guardians stood in. */
export function raidStyleLine(raid: Pick<Raid, 'stance'>): string | null {
  return raid.stance === null ? null : `Style: ${stanceName(raid.stance)}`;
}
