import {
  CARE_ACTIONS,
  CLOTHING_BY_ID,
  type ClothingItem,
  type Rarity,
  type TrickOrTreatVisit,
} from '@heartpatch/shared';

// The door scene's words, beats and prize card (#515 part C, the approved
// drawn door; style guide §2, §6). Pure, so what each beat says, how long it
// holds and what the card offers are unit-tested.

export const DOOR_TEXT = {
  /** The scene's name tag: whose porch it is. */
  home: (name: string) => `${name}'s home`,
  knock: { title: 'Knock, knock! 🎃', sub: "Who's home? Tap to knock." },
  /** The knock is on its way to the server. */
  waiting: { title: 'Knock, knock… 🎃', sub: 'Someone is coming!' },
  open: { title: 'Trick or treat!', sub: 'The door swings open…' },
  trick: { title: 'Boo! 👻', sub: 'Hee hee! Just a silly trick.' },
  anyway: { title: '…and a treat anyway!', sub: 'Look what is in the pail!' },
  knockButton: '✊ Knock!',
  knockingButton: 'Knocking…',
  /** For a screen reader: the drawn door has no text of its own. */
  sceneLabel: (name: string) => `A porch at ${name}'s home, with a front door.`,
  close: 'Close',
} as const;

export const CARD_TEXT = {
  kicker: '🍬 A treat!',
  /** Heartdust: the count, and what a few are for. */
  heartdust: (n: number) => `${String(n)} Heartdust!`,
  snack: (have: number, cost: number) =>
    have >= cost ? `You have enough for a Heart Snack!` : `Save ${String(cost)} for a Heart Snack!`,
  lantern: '🎃 Their lantern made it extra sweet!',
  keeperBlurb: 'A costume for you! It’s in your Wardrobe.',
  squishyBlurb: 'A costume for your squishies! It’s in your Wardrobe.',
  yay: 'Yay!',
  wear: 'Wear it!',
  dressUp: 'Dress up!',
  later: 'Later',
  wearing: 'You’re wearing it! Looking good!',
} as const;

/** Which scene the door shows (the drawn door, its light, who stands in the doorway). */
export type DoorScene = 'knock' | 'waiting' | 'open' | 'trick' | 'anyway';

export interface DoorBeat {
  readonly scene: DoorScene;
  readonly ms: number;
}

/** How long each beat holds before the next (a tap skips ahead). */
export const BEAT_MS = { open: 1500, trick: 2400, anyway: 1700 } as const; // TUNE: long enough to read the line
/** With Reduce Motion nothing moves, so each beat is a calm read. */
const STILL_BEAT_MS = { open: 1200, trick: 1800, anyway: 1400 } as const; // TUNE

/**
 * What plays once the server has answered: the door opens on the pail, or, on
 * the rare silly trick, the ghost goes "Boo!" first and the treat comes anyway.
 */
export function beatsFor(trick: boolean, still: boolean): DoorBeat[] {
  const ms = still ? STILL_BEAT_MS : BEAT_MS;
  return trick
    ? [
        { scene: 'trick', ms: ms.trick },
        { scene: 'anyway', ms: ms.anyway },
      ]
    : [{ scene: 'open', ms: ms.open }];
}

/** The words in the speech card for a scene. */
export function sceneLines(scene: DoorScene): { title: string; sub: string } {
  return DOOR_TEXT[scene];
}

/** What the prize card shows: the picture's subject, the words and the buttons. */
export type CardModel =
  | {
      kind: 'heartdust';
      title: string;
      lantern: boolean;
      /** "Save 3 for a Heart Snack!" */
      detail: string;
    }
  | {
      kind: 'keeper-costume' | 'squishy-costume';
      itemId: string;
      title: string;
      rarity: Rarity;
      lantern: boolean;
      detail: string;
    };

/** What a Heart Snack costs, from the care data (so the card never says a stale number). */
export function heartSnackCost(): number {
  return CARE_ACTIONS.find((a) => a.id === 'heart-snack')?.cost?.['heartdust'] ?? 3;
}

/**
 * The card for a treat, or null when this build can't draw it (a costume it
 * doesn't know, from a newer server): the plain toast says it instead.
 * `heartdustAfter` is the bag's Heartdust once this treat landed, when known.
 */
export function cardFor(
  visit: Pick<TrickOrTreatVisit, 'prize' | 'lantern'>,
  heartdustAfter: number | null,
): CardModel | null {
  const { prize, lantern } = visit;
  if (prize.kind === 'heartdust') {
    return {
      kind: 'heartdust',
      title: CARD_TEXT.heartdust(prize.count),
      lantern,
      detail: CARD_TEXT.snack(heartdustAfter ?? prize.count, heartSnackCost()),
    };
  }
  const item: ClothingItem | undefined = CLOTHING_BY_ID.get(prize.itemId);
  if (!item) return null;
  return {
    kind: prize.kind,
    itemId: item.id,
    title: item.name,
    rarity: item.rarity,
    lantern,
    detail: prize.kind === 'keeper-costume' ? CARD_TEXT.keeperBlurb : CARD_TEXT.squishyBlurb,
  };
}
