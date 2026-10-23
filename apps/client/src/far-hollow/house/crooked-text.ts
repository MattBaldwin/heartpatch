import type { CrookedHouseView, CrookedRoom, CrookedThingKind } from '@heartpatch/shared';
import { CROOKED_HOUSE, GAME_DATA } from '@heartpatch/shared';
import { ELEMENT_GLYPH } from '../../ui/glyphs.js';
import type { CrookedTarget } from './crooked-plan.js';

// The Crooked House's words (#306 6c), style guide: cozy, short, kind. Pure.

/** A no-break space: a title's emoji never wraps onto a line of its own. */
const KEEP = '\u00a0';

export const CROOKED_TEXT = {
  back: 'Back',
  map: 'Map',
  mapOpen: 'The dollhouse map',
  tiptoe: 'Tiptoe',
  keysLabel: (n: number, total: number) => `${String(n)} of ${String(total)} keys found`,
  keys: (n: number, total: number) => `${String(n)} of ${String(total)}`,
  putRight: (n: number, total: number) => `${String(n)} of ${String(total)} put right`,
  roomTitle: (name: string, lit: boolean) => `${name} ${lit ? '✨' : '🕯️'}`,
  crooked: 'Something’s crooked here…',
  walkHint: 'Drag to walk, or tap the floor',
  hold: 'Keep holding…',
  fixed: (thing: string) => `You put ${thing} right! ✨`,
  locked: (key: string) => `Locked tight! The ${key} is somewhere in this house…`,
  useKey: (key: string) => `Use the ${key} 🗝️`,
  tryDoor: 'Try the door 🔒',
  opened: 'Clunk! The door swings open 🚪',
  sleeping: (sleeper: string, element: string, icon: string) =>
    `${capital(sleeper)} won't budge. A ${element} friend could help ${icon}`,
  sleepingAction: (icon: string) => `Who can help? ${icon}`,
  keyTitle: (name: string) => `You found the ${name}!${KEEP}🗝️`,
  keyLine: (thing: string) => `It was in ${thing} all along.`,
  keepIt: 'Keep it',
  bloomTitle: (room: string) => `The ${room} is put right!${KEEP}🌈`,
  bloomLine: 'The colour came back. Your lantern will always burn here now.',
  bloomFound: (n: number) =>
    n === 1 ? 'You found something too! 🎒' : `You found ${String(n)} things too! 🎒`,
  notYet: 'Take the far road first! The Crooked House waits at the end 🕯️',
  yay: 'Yay!',
  caught: `Peekaboo!${KEEP}👻`,
  mapTitle: (floor: string) => `🗺️ ${floor}`,
  /** The map's legend, one idea a line. */
  mapHint: [
    'Colour = put right',
    'Grey = still dark',
    'Tap a lit room to go there',
  ] as readonly string[],
  mapDark: 'That room is still dark. Walk there with your lantern! 🕯️',
  floors: ['Ground', 'Upstairs', 'Attic'] as readonly string[],
} as const;

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** How each kind of crooked thing is put right, on the big button. */
const ACTIONS: Record<CrookedThingKind, { label: string; hold: boolean }> = {
  straighten: { label: 'Straighten it 🖼️', hold: false },
  lift: { label: 'Hold to lift 🪑', hold: true },
  rub: { label: 'Dust it off 🧽', hold: false },
  'tap-rhythm': { label: 'Tap-tap it ✨', hold: false },
  relight: { label: 'Relight it 🧩', hold: false },
};

export function thingAction(kind: CrookedThingKind): { label: string; hold: boolean } {
  return ACTIONS[kind];
}

const ELEMENT_NAMES = new Map<string, string>(GAME_DATA.elements.map((e) => [e.id, e.name]));

/** An element's name and icon (the game's own), for a sleeping door. */
export function elementWords(power: string): { name: string; icon: string } {
  return { name: ELEMENT_NAMES.get(power) ?? capital(power), icon: ELEMENT_GLYPH[power] ?? '✨' };
}

/** A key's name by id. */
export function keyName(id: string): string {
  return CROOKED_HOUSE.keys.find((k) => k.id === id)?.name ?? 'key';
}

/** The big button and the bubble over it for what's in front of the Keeper. */
export function targetWords(target: CrookedTarget): {
  action: string;
  bubble: string | null;
  hold: boolean;
} {
  if (target.kind === 'thing') {
    const a = thingAction(target.thing.kind);
    return { action: a.label, bubble: CROOKED_TEXT.crooked, hold: a.hold };
  }
  const s = target.state;
  if (s.kind === 'locked') {
    return s.held
      ? { action: CROOKED_TEXT.useKey(keyName(s.key)), bubble: null, hold: false }
      : { action: CROOKED_TEXT.tryDoor, bubble: CROOKED_TEXT.locked(keyName(s.key)), hold: false };
  }
  if (s.kind === 'sleeping') {
    const e = elementWords(s.power);
    return {
      action: CROOKED_TEXT.sleepingAction(e.icon),
      bubble: CROOKED_TEXT.sleeping(s.sleeper, e.name, e.icon),
      hold: false,
    };
  }
  return { action: '', bubble: null, hold: false };
}

/** The keys pill and the put-right line. */
export function progressWords(view: Pick<CrookedHouseView, 'keys' | 'rooms'>): {
  keys: string;
  keysLabel: string;
  rooms: string;
} {
  const total = CROOKED_HOUSE.keys.length;
  return {
    keys: CROOKED_TEXT.keys(view.keys.length, total),
    keysLabel: CROOKED_TEXT.keysLabel(view.keys.length, total),
    rooms: CROOKED_TEXT.putRight(view.rooms.filter((r) => r.bloomed).length, view.rooms.length),
  };
}

/** The room pill: its name, a candle while dark, a sparkle once lit. */
export function roomWords(room: CrookedRoom, lit: boolean): string {
  return CROOKED_TEXT.roomTitle(room.name, lit);
}

/** A floor's name on the map. */
export function floorWords(floor: number): string {
  return CROOKED_TEXT.floors[floor] ?? `Floor ${String(floor + 1)}`;
}

// ── The Relight boards and the story scraps (#306 6f) ───────────────────

export const CROOKED_RELIGHT_TEXT = {
  /** Over the board: which thing, in which room. */
  heading: (thing: string, room: string) => `${capital(thing)} in the ${room}`,
  /** A board solved, the room not yet right. */
  relit: (thing: string) => `You relit ${thing}! ✨`,
  /** On a bloom's card, over the room's scrap of the house's story. */
  scrap: 'A scrap of the house’s story 📜',
} as const;

export const CROOKED_ATTIC_TEXT = {
  action: 'Open the big chest 🎁',
  /** Near the chest with the house all put right. */
  ready: `The story page is ready to read!${KEEP}📜`,
  /** …and with rooms still dark (the server says the same, rule 1). */
  faint: (left: number) =>
    `The page is too faint to read! Put ${String(left)} more ${left === 1 ? 'room' : 'rooms'} right first 🕯️`,
  cardTitle: `The Crooked House is all put right!${KEEP}🏠`,
  page: (title: string) => `📜 The house’s story: “${title}”`,
  cloak: (name: string) => `🧥 ${name.replace(/'/g, '’')} to wear`,
  /** The milestone grants it on `journey.completed`; a later season's Keeper already has it. */
  titleLine: '🏅 Your title: Lantern Keeper',
  /** The chest's pile and the far Hollow's gift, summed (the server gives them as one find). */
  pile: (things: readonly string[]) =>
    `🎁 ${things.length > 1 ? `${things.slice(0, -1).join(', ')} and ${things.at(-1) ?? ''}` : (things[0] ?? '')}, from the chest and the far Hollow’s gift`,
  ok: 'Hooray!',
} as const;

// ── The echoes and the peekaboo (#306 6d) ───────────────────────────────

export const CROOKED_ECHO_TEXT = {
  /** At a doorway, an echo close by in the dark room past it. */
  near: 'Shh… an echo is close 👀 Wait for it to drift off',
  /** …and Tiptoe would get me past it. */
  tiptoe: 'Shh… an echo is close 👀 Tiptoe past it?',
  /** The friendly echo after the peekaboo. */
  giggle: 'Hee hee! Got you! 👋',
  caughtTitle: 'Whoops! Back to the light 🕯️',
  caughtLine: 'The echo only wanted to play. You still have everything!',
  caughtOk: 'Phew!',
} as const;
