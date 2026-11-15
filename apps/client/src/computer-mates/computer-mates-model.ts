import type { ComputerMatesState, MapDetail, MapMember } from '@heartpatch/shared';

/*
 * Computer patch-mates (#386b, the owner-approved mockup's variant A): the
 * switch's states, the badge's words, and the hello and goodbye lines. Pure,
 * so Vitest covers every state; the DOM lives in `computer-badge.ts`, the
 * lobby and `computer-mates-notes.ts`. The server decides who moves in and
 * out (rule 1); the client only shows it, always badged, never as a real kid.
 */

// Player-facing text (style guide §2: cozy, short, kid-readable).
export const COMPUTER_TEXT = {
  badge: 'Computer friend',
  badgeMany: 'Computer friends',
  heading: 'Computer friends',
  ownerLine: 'Fills your patch with friendly computer Keepers until real friends join',
  memberLine: 'Fills the patch with friendly computer Keepers until real friends join',
  honest: "They're run by the game, not real people. Real friends always get the home first.",
  ownerPicks: 'The patch owner picks this.',
  on: 'On',
  off: 'Off',
  cooldown: 'Back on tomorrow',
  cooldownHint:
    'You switched them off a little while ago. Come back tomorrow to switch them on again.',
  switched: (on: boolean) => `Computer friends: ${on ? 'On' : 'Off'}.`,
  /** The hello card's line under the names. */
  helloLine: "They're run by the game.",
  helloButton: 'Say hi!',
  /** Who's here: mates are always here. */
  here: 'Here now',
  hereHint: "Computer friends are run by the game, so they're always here.",
  battleSoon: 'Battles with Computer friends are coming soon!',
  /** Who's here with only mates around: "nobody here" would contradict the list. */
  noKidsHere: 'No other Keepers are here right now. Try again in a bit!',
} as const;

/** True for a computer patch-mate's seat (`MapMember.computer`, #386a). */
export function isComputer(member: Pick<MapMember, 'computer'>): boolean {
  return member.computer !== undefined;
}

/** "Bramble", "Bramble and Marigold", "Bramble, Marigold and Pocket". */
export function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/** The green line under an on switch: how many live here, and that they make room. */
export function livesHereLine(names: readonly string[], ownerName: string | null): string {
  if (ownerName !== null) {
    return names.length === 0
      ? `${ownerName} has Computer friends on.`
      : `${ownerName} has Computer friends on. ${nameList(names)} ${names.length === 1 ? 'lives' : 'live'} here.`;
  }
  if (names.length === 0) return 'Computer friends are on. They move in when there’s a free home.';
  const count =
    names.length === 1
      ? '1 computer friend lives'
      : `${String(names.length)} computer friends live`;
  return `${count} here. They move over when real friends join.`;
}

/** What the switch row shows. Null: the row is left out (the server's switch is closed here). */
export interface SwitchView {
  readonly on: boolean;
  /** The owner can tap it now. */
  readonly tappable: boolean;
  readonly line: string;
  /** The green "who lives here" line (on), or null. */
  readonly livesHere: string | null;
  /** The cream "Back on tomorrow" note (off, cooling down), or null. */
  readonly cooldown: string | null;
  /** The grey hint under it: honest words, the owner-picks line, or the cooldown's why. */
  readonly hint: string;
  /** "The patch owner picks this." above the row (non-owners). */
  readonly ownerPicks: boolean;
}

export function switchView(
  map: Pick<MapDetail, 'role' | 'computerMates' | 'members'>,
  now: number,
): SwitchView | null {
  const state: ComputerMatesState | undefined = map.computerMates;
  if (!state) return null;
  const isOwner = map.role === 'owner';
  const mates = map.members.filter(isComputer).map((m) => m.user.username);
  const owner = map.members.find((m) => m.role === 'owner')?.user.username ?? 'The owner';
  const coolingDown = !state.enabled && state.changeAt !== null && Date.parse(state.changeAt) > now;
  return {
    on: state.enabled,
    tappable: isOwner && !coolingDown,
    line: isOwner ? COMPUTER_TEXT.ownerLine : COMPUTER_TEXT.memberLine,
    livesHere: state.enabled ? livesHereLine(mates, isOwner ? null : owner) : null,
    cooldown: isOwner && coolingDown ? COMPUTER_TEXT.cooldown : null,
    hint:
      isOwner && coolingDown
        ? COMPUTER_TEXT.cooldownHint
        : isOwner && !state.enabled
          ? COMPUTER_TEXT.honest
          : '',
    ownerPicks: !isOwner,
  };
}

/** The hello card's title (approval record: the names, "moved in next door!"). */
export function helloTitle(names: readonly string[]): string {
  // A no-break space keeps the house with the last word, never alone on a line.
  return `${nameList(names)} moved in next door!\u00a0🏡`;
}

/**
 * The goodbye toast (mockup 3c): the mate badged in words, the real friend
 * named when known so it reads as good news.
 */
export function goodbyeLine(mate: string, friend: string | null): string {
  return friend
    ? `${mate} (${COMPUTER_TEXT.badge}) waved goodbye so ${friend} could move in 👋`
    : `${mate} (${COMPUTER_TEXT.badge}) waved goodbye to make room for a new friend 👋`;
}

/** A member as the roster compare sees them. */
export interface RosterEntry {
  readonly name: string;
  readonly computer: boolean;
}

/**
 * What changed between two views' members (#386b): mates to say hello to
 * (any not yet in `greeted`, which this adds them to), and, when the same
 * patch was on screen before (`last`), mates who left and real kids who
 * moved in. A mate leaving as a kid arrives is the goodbye.
 */
export function rosterDelta(
  last: ReadonlyMap<string, RosterEntry> | null,
  next: ReadonlyMap<string, RosterEntry>,
  greeted: Set<string>,
): { arrivals: string[]; departed: string[]; newKids: string[] } {
  const arrivals: string[] = [];
  const departed: string[] = [];
  const newKids: string[] = [];
  for (const [id, m] of next) {
    if (m.computer && !greeted.has(id)) {
      greeted.add(id);
      arrivals.push(m.name);
    } else if (!m.computer && last && !last.has(id)) {
      newKids.push(m.name);
    }
  }
  for (const [id, m] of last ?? []) if (m.computer && !next.has(id)) departed.push(m.name);
  return { arrivals, departed, newKids };
}
