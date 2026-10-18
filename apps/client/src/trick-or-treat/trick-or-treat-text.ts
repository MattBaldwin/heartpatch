import {
  CLOTHING_BY_ID,
  type PublicTile,
  type TrickOrTreatHost,
  type TrickOrTreatView,
  type TrickOrTreatVisit,
} from '@heartpatch/shared';

// Trick-or-treat's words (#515, the approved plan's map screens; style guide
// §2, §6): short, cozy and kid-readable. Pure, so the wording and which door
// shows what are unit-tested.

export const TRICK_TEXT = {
  knock: '🎃 Trick or treat!',
  knocking: '🎃 Knock, knock…',
  visited: '✅ Visited today',
  /** Every home gives treats. */
  open: 'This home has treats tonight!',
  /** Their Jack-o'-Lantern Hearthfire is lit: the better table. */
  lit: 'Their lantern is lit. Extra-good treats!',
  gotOne: 'You got a treat here today!',
  comeBack: 'Come back tomorrow for more.',
  /** A rare silly trick played first (owner answer 2); the treat comes anyway. */
  trick: '👻 Boo! Just a silly trick!',
  heartdust: (n: number) => `💗 Treat! ${String(n)} Heartdust for you!`,
  keeperCostume: (name: string) => `🎃 Treat! ${aOrAn(name)} ${name} costume for you!`,
  squishyCostume: (name: string) => `🎃 Treat! ${aOrAn(name)} ${name} for your squishies!`,
  /** A costume whose name this build doesn't know yet (a newer server). */
  someCostume: '🎃 Treat! A new costume! Find it in your Wardrobe.',
} as const;

const aOrAn = (name: string): string => (/^[aeiou]/i.test(name) ? 'An' : 'A');

/** What a patch-mate's home tile says about trick-or-treat. */
export type DoorState =
  /** Not my patch-mate's home, it isn't Halloween, or we haven't heard yet: nothing shows. */
  | { kind: 'none' }
  | { kind: 'open'; host: TrickOrTreatHost }
  | { kind: 'visited'; host: TrickOrTreatHost };

/**
 * The door on `tile`: any tile of a patch-mate's home base (their Heart Seed
 * and the home tiles round it), while trick-or-treat is on today. My own home
 * and everyone else's land show nothing.
 */
export function doorOf(
  tile: Pick<PublicTile, 'ownerUserId' | 'homeSlot'>,
  trick: TrickOrTreatView | null,
  me: string | null,
): DoorState {
  if (!trick?.open || tile.homeSlot === null || tile.ownerUserId === null) return { kind: 'none' };
  if (tile.ownerUserId === me) return { kind: 'none' };
  const host = trick.hosts.find((h) => h.userId === tile.ownerUserId);
  if (!host) return { kind: 'none' };
  return host.visited ? { kind: 'visited', host } : { kind: 'open', host };
}

/** The lines over the button: the lantern's promise, or "come back tomorrow". */
export function doorLines(door: DoorState): { icon: string; text: string }[] {
  switch (door.kind) {
    case 'none':
      return [];
    case 'open':
      return [{ icon: '🎃', text: door.host.lit ? TRICK_TEXT.lit : TRICK_TEXT.open }];
    case 'visited':
      return [
        { icon: '🍬', text: TRICK_TEXT.gotOne },
        { icon: '', text: TRICK_TEXT.comeBack },
      ];
  }
}

/**
 * The plain prize toast after a knock (until the door scene, part C): the
 * silly trick first when one played, then the treat.
 */
export function prizeToast(visit: Pick<TrickOrTreatVisit, 'trick' | 'prize'>): string {
  const { prize } = visit;
  const name = CLOTHING_BY_ID.get(prize.itemId)?.name;
  const treat =
    prize.kind === 'heartdust'
      ? TRICK_TEXT.heartdust(prize.count)
      : !name
        ? TRICK_TEXT.someCostume
        : prize.kind === 'keeper-costume'
          ? TRICK_TEXT.keeperCostume(name)
          : TRICK_TEXT.squishyCostume(name);
  return visit.trick ? `${TRICK_TEXT.trick} ${treat}` : treat;
}

/** Patch-mates whose porch lantern glows tonight, as the map draws them. */
export function litHosts(trick: TrickOrTreatView | null): Set<string> {
  if (!trick?.open) return new Set();
  return new Set(trick.hosts.filter((h) => h.lit).map((h) => h.userId));
}
