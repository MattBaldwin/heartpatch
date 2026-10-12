import { capacityAt, HOUSE_DATA, type HomeResponse, type HouseView } from '@heartpatch/shared';

/*
 * What the house screen and the home's house card say (#381 plan §10),
 * pure so it's unit-tested. Player-facing text follows the style guide:
 * short, cozy, kid-readable.
 */

const beds = (n: number) => `${String(n)} ${n === 1 ? 'bed' : 'beds'}`;

export const HOUSE_TEXT = {
  card: '🏠 Your house',
  cardLine: (level: number, n: number) => `House ${String(level)} · ${beds(n)}`,
  goInside: 'Go inside',
  /** The home peek bar's shortcut, in its Build row. */
  shortcut: 'Your house',
  shortcutIcon: '🏠',
  back: 'Back',
  walkIn: 'Walk in',
  walkInIcon: '👣',
  stepOut: 'Step out',
  stepOutIcon: '🚪',
  pill: (level: number) => `🏠 House ${String(level)}`,
  room: (name: string, n: number) => `${name} · ${beds(n)}`,
  wholeHouse: (owner: string, n: number) => `${owner}’s house · ${beds(n)}`,
  /** The sign on the wall. */
  sign: (owner: string) => `${owner}’s house`,
  /** Before the owner's name is known. */
  yourHouse: 'Your house',
  /** The sheet's handle, for screen readers. */
  sheetHandle: 'Show or hide your house’s sheet',
} as const;

/*
 * Grow the house (#381 plan §10.4–10.5): the sheet that shows what the next
 * level needs and builds it. The lines and hints of each requirement come
 * from the server (`RequirementProgress.line`, `.hint`); only the frame
 * around them lives here.
 */
const things = (n: number) => `${String(n)} ${n === 1 ? 'thing' : 'things'}`;

export const GROW_TEXT = {
  open: 'Grow the house',
  openIcon: '🌱',
  allGrown: 'Your house is all grown! ✨',
  header: (from: number, to: number, room: string, beds: number) =>
    `House ${String(from)} → ${String(to)} · ${room} (room for ${String(beds)})`,
  /** One heading per kind of "getting better", with its picture. */
  groups: {
    seed: { icon: '🌱', title: 'Heart Seed' },
    home: { icon: '🏡', title: 'Your home base' },
    residents: { icon: '💗', title: 'Your residents' },
    'patch-mates': { icon: '💌', title: 'Your patch-mates' },
    land: { icon: '🗺️', title: 'Your land' },
    adventure: { icon: '⚔️', title: 'Adventure' },
  },
  youNeed: 'You need:',
  buildIt: 'Build it!',
  notYet: (n: number) => `Not yet: ${things(n)} to go!`,
  /** Under "Not yet": the first thing still to do. */
  nextUp: (what: string) => `Next up: ${what}`,
  /** The first thing to do when only the bag is short. */
  gatherMore: (n: number, name: string) => `Gather ${String(n)} more ${name}`,
  confirm: (room: string, cost: string) => `Build ${room} for ${cost}?`,
  confirmYes: 'Build it!',
  notNow: 'Not now',
  building: 'Building…',
  back: 'Back',
  built: (room: string) => `Ta-da! ${room} is ready. Who moves in?`,
  builtFinal: (room: string) => `Ta-da! ${room} is ready. Your house is all grown! ✨`,
  done: 'Done',
  toDo: 'Not yet',
} as const;

/**
 * The home's house card, or null while the house is switched off for this
 * player (`HomeResponse.house` left out): then there's no card and no cottage.
 */
export function houseCard(
  home: Pick<HomeResponse, 'house'>,
): { title: string; line: string } | null {
  if (!home.house) return null;
  const { level } = home.house;
  return {
    title: HOUSE_TEXT.card,
    line: HOUSE_TEXT.cardLine(level, capacityAt(HOUSE_DATA, level)),
  };
}

/** Every bed in the house. */
export const houseBeds = (view: Pick<HouseView, 'rooms'>): number =>
  view.rooms.reduce((sum, r) => sum + r.beds, 0);

/**
 * The peek bar's line: the room in view ("The Snug · 2 beds"), or the whole
 * house ("Mia’s house · 10 beds") when more than one room is in view.
 */
export function peekLine(
  view: Pick<HouseView, 'rooms'>,
  owner: string | null,
  focus: string | null = null,
): string {
  const room =
    view.rooms.find((r) => r.id === focus) ?? (view.rooms.length === 1 ? view.rooms[0] : undefined);
  if (room) return HOUSE_TEXT.room(room.name, room.beds);
  const n = houseBeds(view);
  return owner ? HOUSE_TEXT.wholeHouse(owner, n) : `${HOUSE_TEXT.yourHouse} · ${beds(n)}`;
}
