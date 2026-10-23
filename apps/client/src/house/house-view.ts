import {
  capacityAt,
  HOUSE_DATA,
  type HomeResponse,
  type HouseView,
  type ResidentAway,
} from '@heartpatch/shared';

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
  /** The floor switch (B4), with more than one floor. */
  upstairs: 'Upstairs',
  upstairsIcon: '⬆️',
  downstairs: 'Downstairs',
  downstairsIcon: '⬇️',
  pill: (level: number) => `🏠 House ${String(level)}`,
  room: (name: string, n: number) => `${name} · ${beds(n)}`,
  /** More than one room in view: how many, and every bed. */
  rooms: (n: number, b: number) => `${String(n)} rooms · ${beds(b)}`,
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
const things = (n: number) => `${String(n)}\u00A0${n === 1 ? 'thing' : 'things'}`;

export const GROW_TEXT = {
  open: 'Grow the house',
  openIcon: '🌱',
  allGrown: 'Your house is all grown! ✨',
  /** The header's big line. */
  levels: (from: number, to: number) => `House\u00A0${String(from)}\u00A0→\u00A0${String(to)}`,
  /** Under it: the new room and the beds it adds. */
  room: (room: string, n: number) => `${room} · +${String(n)}\u00A0${n === 1 ? 'bed' : 'beds'}`,
  close: 'Close',
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
  /** The not-yet box's little cue. */
  waitIcon: '⏳',
  /** Under "Not yet": the first thing still to do. */
  nextUp: (what: string) => `Next up: ${what}`,
  /** The first thing to do when only the bag is short. */
  gatherMore: (n: number, name: string) => `Gather ${String(n)} more ${name}`,
  confirm: (room: string, cost: string) => `Build ${room} for ${cost}?`,
  confirmYes: 'Build it!',
  notNow: 'Not now',
  building: 'Building…',
  built: (room: string) => `Ta-da! ${room} is ready. Who moves in?`,
  builtFinal: (room: string) => `Ta-da! ${room} is ready. Your house is all grown! ✨`,
  done: 'Done',
  toDo: 'Not yet',
} as const;

/*
 * Residents (#381 plan §10.2–10.3, Q5): the open sheet's beds, the move-in
 * picker and moving out. The server decides who may move in and says why
 * not; these are only the words the client shows around its replies.
 */
const hours = (n: number) => `${String(n)}\u00A0h`;
/** Hours in words: "1 hour", "5 hours". */
const hoursWord = (n: number) => `${String(n)}\u00A0${n === 1 ? 'hour' : 'hours'}`;
/** A wait in kid words: "a day" for 24 h, "2 days", else hours. */
const afterHours = (n: number) =>
  n === 24 ? 'a\u00A0day' : n % 24 === 0 ? `${String(n / 24)}\u00A0days` : hours(n);

export const RESIDENT_TEXT = {
  /** The open sheet's heading over a room's beds: "The Snug · 1 of 2 beds". */
  beds: (room: string, used: number, all: number) => `${room} · ${String(used)} of ${beds(all)}`,
  /** An empty bed's chip. */
  moveIn: 'Move in',
  moveInIcon: '+',
  /**
   * Why a resident isn't in its bed right now (`HouseResident.away`), in a
   * picker row or a bed's detail. The last word and its emoji never part.
   */
  away: {
    gathering: 'Out\u00A0gathering\u00A0🧺',
    guarding: 'On watch\u00A0🛡️',
    training: 'Training\u00A0🎯',
    // Style guide §9: "Taken to the Hollow" always goes with "you can rescue them!".
    hollow: 'Taken to the Hollow, but you can rescue\u00A0them!',
    'in-trade': 'Waiting at the\u00A0post\u00A0📬',
  } satisfies Record<ResidentAway, string>,
  /**
   * The same on a bed chip: short, and one unbreakable piece (no-break
   * spaces throughout), so every chip keeps one line and the same height.
   * The emoji leads, as the mood chips' do ("😊 Happy"), B5.
   */
  awayShort: {
    gathering: '🧺\u00A0Gathering',
    guarding: '🛡️\u00A0On\u00A0watch',
    training: '🎯\u00A0Training',
    hollow: '🌙\u00A0Hollow',
    'in-trade': '📬\u00A0Trading',
  } satisfies Record<ResidentAway, string>,
  /** The next step under a resident taken to the Hollow (style guide §3.5), as the map says it. */
  hollowNext: 'Find the Hollow 🌙 on the map to bring\u00A0them\u00A0home!',
  /** A resident at home, while its mood is still loading. */
  home: 'Home 🏠',
  /** The picker's eyebrow and title. */
  pickerEyebrow: 'Move in',
  pickerTitle: (room: string) => `Who moves into ${room}?`,
  /** Beds left in the picked room. */
  free: (n: number) => `${beds(n)} free`,
  full: (room: string) => `${room} is full! Move someone out first.`,
  /** A picker row: lives in another room (a tap moves it over). */
  livesIn: (room: string) => `Lives in ${room}`,
  livesHere: 'Lives here',
  /** Picker rows that can't come, and why (the server checks again). */
  cantCooldown: (h: number) => `Can move back in ${hoursWord(h)}\u00A0🏠`,
  /** A row while the room has no free bed. */
  cantFull: 'No free bed',
  noOne: 'No squishies yet. Befriend one on the map!',
  moving: 'Moving in…',
  moved: (name: string, room: string) => `${name} moved into ${room}! 🏠`,
  /** A resident's bed chip, opened. */
  moveOut: 'Move out',
  /**
   * The move-out confirm (style guide §3.6), with the cooldown from data.
   * The house's confirm has the name in its title, so it says "them".
   */
  moveOutAsk: (name: string | null, h: number) =>
    `Move ${name ?? 'them'} out? They can move back in after ${afterHours(h)}.`,
  movingOut: 'Moving out…',
  movedOut: (name: string) => `${name} moved out. See you soon! 👋`,
  notNow: 'Not now',
  close: 'Close',
  /** The roster row's detail (#375). */
  rosterMoveIn: '🏠 Move into the house',
  rosterMoveOut: '👋 Move out of the house',
  rosterLivesIn: (room: string) => `🏠 Lives in ${room}`,
} as const;

/*
 * The daily gift (#381 H2): a resident leaves the Keeper a little something
 * once a patch day. The note itself comes from the server, the giver's name
 * already in it; only the frame around it lives here.
 */
export const GIFT_TEXT = {
  icon: '🎁',
  /** The peek bar's line, the giver by name. */
  peek: (name: string) => `🎁 ${name} left you something!`,
  /** When the giver isn't known here (traded away, or not in the home reply). */
  peekSomeone: '🎁 A little gift is waiting for you!',
  /** The card's eyebrow. */
  title: 'A gift for you!',
  open: 'Open it!',
  opening: 'Opening…',
  close: 'Close',
  /** What's inside, on the card: "3 Timber". */
  item: (count: number, name: string) => `${String(count)}\u00A0${name}`,
  /** The toast once it's open: "+3 Timber 🎁". */
  toast: (count: number, name: string) => `+${String(count)}\u00A0${name}\u00A0🎁`,
} as const;

/** Welcome home (#381 H2): the first visit of a patch day. */
export const WELCOME_TEXT = {
  line: 'Welcome home! 🏠',
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
 * The peek bar's line, one pattern at every level: the room in view ("The
 * Snug · 2 beds"), or the whole house ("2 rooms · 4 beds") when more than
 * one room is in view. Never the owner's name.
 */
export function peekLine(view: Pick<HouseView, 'rooms'>, focus: string | null = null): string {
  const room =
    view.rooms.find((r) => r.id === focus) ?? (view.rooms.length === 1 ? view.rooms[0] : undefined);
  if (room) return HOUSE_TEXT.room(room.name, room.beds);
  return HOUSE_TEXT.rooms(view.rooms.length, houseBeds(view));
}

/**
 * Keeps a line's last three words together ("to level 1 🌱"), so a wrap
 * never leaves a number or an emoji alone on the last line. For lines the
 * server wrote; the client's own joins use no-break spaces already.
 */
export function keepTail(line: string): string {
  // Words and the plain-space runs between them; spaces at either end and
  // no-break spaces already in the line are left as they are.
  const lead = /^ */.exec(line)?.[0] ?? '';
  const trail = / *$/.exec(line.slice(lead.length))?.[0] ?? '';
  const body = line.slice(lead.length, line.length - trail.length);
  const parts = body.split(/( +)/);
  // parts: word, gap, word, gap, …, word
  if ((parts.length + 1) / 2 < 4) return line;
  parts[parts.length - 2] = '\u00A0';
  parts[parts.length - 4] = '\u00A0';
  return lead + parts.join('') + trail;
}
