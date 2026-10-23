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
  puzzle: 'This one is a puzzle! It wakes up soon 🧩',
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
  caughtLine: 'Whoops! Back to the light 🕯️',
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

// ── Bonus rooms (#306 6e) ──────────────────────────────────────────────

export const BONUS_TEXT = {
  pickerTitle: (icon: string) => `Who can help?${KEEP}${icon}`,
  pickerLine: (sleeper: string, element: string) =>
    `${capital(sleeper)} needs a ${element} friend.`,
  pickerLoading: 'Calling your team… 🐾',
  /** A team squishy of another element, on its row. */
  notThisOne: (element: string) => `Not a ${element} friend`,
  /** Nobody on the team has the element: say how to fix it, kindly. */
  nobody: (element: string, icon: string) =>
    `Put a ${element} friend on your team, then come back! ${icon}`,
  notNow: 'Not now',
  /** A woken door's card: where it leads now. */
  wokeLine: (room: string) => `The way to the ${room} is open! Step through 🚪`,
  wokeLineAny: 'A new way is open! Step through 🚪',
  chestAction: 'Open the chest 🎁',
  chestBubble: 'A little chest! What’s inside? ✨',
  chestTitle: `Treasure!${KEEP}🎁`,
  chestLine: (things: string) => `You found ${things}!`,
  chestEmpty: 'Just dust and a happy sparkle ✨',
  chestWear: 'And something to wear! 🧥',
  friendSomeone: 'squishy',
  friendTitle: `Someone’s in the chest!${KEEP}👀`,
  friendLine: (name: string) =>
    `A shy ${name} was napping inside. Use a Heart Charm to befriend it!`,
  friendGo: 'Say hello! 💛',
} as const;

/** What each element's friend does to a sleeping door, said as the door wakes. */
const POWER_DONE: Readonly<Record<string, (name: string) => string>> = {
  fire: (name) => `${name} lit the fireplace! 🔥`,
  leaf: (name) => `${name} grew a vine through the window! 🌿`,
  water: (name) => `${name} put out the flames! 💧`,
  light: (name) => `${name} chased the dark away! ✨`,
};

export function powerDone(power: string, name: string): string {
  return POWER_DONE[power]?.(name) ?? `${name} opened the way! ✨`;
}

/** A chest's loot as words: "4 Treats and 1 Heartdust". */
export function lootWords(found: Readonly<Record<string, number>>, nameOf: (id: string) => string) {
  const parts = Object.entries(found)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `${String(n)} ${nameOf(id)}`);
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] ?? ''}`;
}
