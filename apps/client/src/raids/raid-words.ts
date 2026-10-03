import type { DefenseStance, Raid } from '@heartpatch/shared';

// Player-facing words for the raid report (#16; style guide §2, §6, §9):
// calm and reassuring, never shaming. A challenge is "Someone challenged your
// patch!", the stance is the "Defense style" (Bold, Careful, Balanced).

export const RAID_TEXT = {
  open: 'Report',
  title: 'Raid report',
  challenged: 'Someone challenged your patch!',
  quiet: 'All quiet on your patch. Everyone is snug!',
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

/** One line per raid: who came by and how it went, kind either way. */
export function raidLine(
  raid: Pick<Raid, 'attackerName' | 'outcome' | 'reason' | 'stance'>,
): string {
  const who = raid.attackerName;
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

/** "Bold" etc. for a raid's style, or null when guardians stood in. */
export function raidStyleLine(raid: Pick<Raid, 'stance'>): string | null {
  return raid.stance === null ? null : `Style: ${stanceName(raid.stance)}`;
}
