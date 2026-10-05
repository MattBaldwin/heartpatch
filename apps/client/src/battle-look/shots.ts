import type { FeelingId } from '@heartpatch/shared';

/**
 * The scenes every direction is judged on: the same squishies, terrain, time
 * of day and moment, so only the presentation differs between A, B and C.
 */

export type TimeOfDay = 'day' | 'dusk' | 'night';
export type Sequence = 'idle' | 'attack' | 'charm' | 'ko';
export type SheetMode = 'choose' | 'caption';

export interface Fighter {
  readonly speciesId: string;
  readonly instanceId: string;
  readonly level: number;
  /** 0–1. */
  readonly energy: number;
}

export interface Shot {
  readonly id: string;
  readonly label: string;
  readonly terrain: string;
  readonly timeOfDay: TimeOfDay;
  readonly player: Fighter;
  readonly foe: Fighter;
  readonly sequence: Sequence;
  /** Who acts in an attack / who is tuckered out in a KO. */
  readonly actor: 'player' | 'foe';
  /** The move's element (attacks). */
  readonly element: string | null;
  readonly moveName: string | null;
  /** Milliseconds into the sequence to freeze at. */
  readonly t: number;
  readonly sheet: SheetMode;
  readonly caption: string;
}

const emberbun: Fighter = { speciesId: 'emberbun', instanceId: 'look-ember-1', level: 9, energy: 0.78 };
const puddlepuff: Fighter = {
  speciesId: 'puddlepuff',
  instanceId: 'look-puddle-1',
  level: 7,
  energy: 0.62,
};
const thistlepip: Fighter = {
  speciesId: 'thistlepip',
  instanceId: 'look-thistle-1',
  level: 8,
  energy: 0.9,
};
const pebblesnooze: Fighter = {
  speciesId: 'pebblesnooze',
  instanceId: 'look-pebble-1',
  level: 6,
  energy: 0.55,
};

/** Attack sequence timings, ms (every direction shares them; directions change how far things move). */
export const ATTACK = {
  windup: 450,
  dashEnd: 640,
  /** The impact shot sits here: inside every direction's hit-stop. */
  impactAt: 712,
  reactAt: 920,
  home: 1500,
  length: 1900,
} as const;

export const CHARM = { flight: 560, drawn: 820, pop: 1550, length: 2200 } as const;
export const KO = { stagger: 380, twirl: 820, flop: 1120, length: 2200 } as const;

export const SHOTS: readonly Shot[] = [
  {
    id: 'idle',
    label: 'Idle face-off',
    terrain: 'meadow',
    timeOfDay: 'day',
    player: emberbun,
    foe: puddlepuff,
    sequence: 'idle',
    actor: 'player',
    element: null,
    moveName: null,
    t: 620,
    sheet: 'caption',
    caption: 'A wild Puddlepuff wiggles up!',
  },
  {
    id: 'hud',
    label: 'HUD: choosing a move',
    terrain: 'meadow',
    timeOfDay: 'day',
    player: emberbun,
    foe: puddlepuff,
    sequence: 'idle',
    actor: 'player',
    element: null,
    moveName: null,
    t: 1100,
    sheet: 'choose',
    caption: 'What will Emberbun do?',
  },
  ...attack('fire', 'Ember Boop', 'pumpkin-fields', 'dusk', emberbun, puddlepuff, 'player'),
  ...attack('water', 'Belly Flop', 'lake', 'day', puddlepuff, emberbun, 'player'),
  ...attack('leaf', 'Prickle Roll', 'forest', 'day', thistlepip, pebblesnooze, 'player'),
  {
    id: 'charm',
    label: 'Heart Charm throw',
    terrain: 'hills',
    timeOfDay: 'day',
    player: emberbun,
    foe: thistlepip,
    sequence: 'charm',
    actor: 'player',
    element: null,
    moveName: null,
    t: 1050,
    sheet: 'caption',
    caption: 'You offer a Heart Charm… wobble, wobble…',
  },
  {
    id: 'ko',
    label: 'Tuckered out',
    terrain: 'old-forest',
    timeOfDay: 'night',
    player: emberbun,
    foe: puddlepuff,
    sequence: 'ko',
    actor: 'foe',
    element: 'fire',
    moveName: null,
    t: 1400,
    sheet: 'caption',
    caption: 'Puddlepuff is all tuckered out!',
  },
];

function attack(
  element: string,
  moveName: string,
  terrain: string,
  timeOfDay: TimeOfDay,
  player: Fighter,
  foe: Fighter,
  actor: 'player' | 'foe',
): Shot[] {
  const base = { terrain, timeOfDay, player, foe, sequence: 'attack' as const, actor, element, moveName };
  const who = actor === 'player' ? player : foe;
  const name = who.speciesId[0]!.toUpperCase() + who.speciesId.slice(1);
  return [
    {
      ...base,
      id: `${element}-anticipation`,
      label: `${element}: anticipation`,
      t: 400,
      sheet: 'caption',
      caption: `${name} winds up ${moveName}!`,
    },
    {
      ...base,
      id: `${element}-impact`,
      label: `${element}: impact`,
      t: ATTACK.impactAt,
      sheet: 'caption',
      caption: `${moveName}!`,
    },
    {
      ...base,
      id: `${element}-react`,
      label: `${element}: hit reaction`,
      t: ATTACK.reactAt,
      sheet: 'caption',
      caption: 'Super cozy!',
    },
  ];
}

export function shotOf(id: string | null): Shot {
  return SHOTS.find((s) => s.id === id) ?? SHOTS[0]!;
}

/** How long a sequence runs before it loops (play mode). */
export function sequenceLength(seq: Sequence): number {
  switch (seq) {
    case 'idle':
      return 4000;
    case 'attack':
      return ATTACK.length;
    case 'charm':
      return CHARM.length;
    case 'ko':
      return KO.length;
  }
}

/** Idle personality (style guide §5), used by the choreography. */
export const FEELING_IDLE: Readonly<
  Record<FeelingId, { hop: number; sway: number; nod: number; wiggle: number; puff: number; hover: number }>
> = {
  joy: { hop: 1, sway: 0, nod: 0, wiggle: 0, puff: 0, hover: 0 },
  cozy: { hop: 0, sway: 1, nod: 0.3, wiggle: 0, puff: 0, hover: 0 },
  brave: { hop: 0, sway: 0, nod: 0, wiggle: 0, puff: 1, hover: 0 },
  silly: { hop: 0.3, sway: 0, nod: 0, wiggle: 1, puff: 0, hover: 0 },
  sleepy: { hop: 0, sway: 0.3, nod: 1, wiggle: 0, puff: 0, hover: 0 },
  spooky: { hop: 0, sway: 0.4, nod: 0, wiggle: 0.3, puff: 0, hover: 1 },
};
