import type { CrookedHouse, CrookedThing } from '../schemas/data/crooked-house.js';

/**
 * The Crooked House (#306 6b): Halloween 2026's far Hollow, from the
 * owner-approved design (2026-10-23). Rooms and doors are fixed so kids can
 * learn the house (owner decision 8); which thing hides which key, each
 * echo's phase and the bonus chests shuffle per patch and season
 * (`crookedHouseSecrets`, server-only). Ids and list order are stored as
 * bits: never rename or reorder, only append.
 *
 * Boxes are metres on each floor (x east, z north), from the design's
 * prototype. Things' `at` is from the room's centre.
 */

const thing = (
  id: string,
  name: string,
  kind: CrookedThing['kind'],
  at: [number, number],
  prop: string = id,
): CrookedThing => ({ id, name, kind, prop, at });

export const CROOKED_HOUSE: CrookedHouse = {
  name: 'The Crooked House',
  start: 'front-hall',
  rooms: [
    // ── Ground floor ───────────────────────────────────────────────────
    {
      id: 'front-hall',
      name: 'Front Hall',
      floor: 0,
      kind: 'main',
      box: { x: 0, z: 0, w: 4.2, d: 4.6 },
      look: { paper: '#efd9c4' },
      things: [],
      lamp: [1.4, 1.6],
    },
    {
      id: 'parlour',
      name: 'Parlour',
      floor: 0,
      kind: 'main',
      box: { x: -5.6, z: 0.2, w: 6.2, d: 5.2 },
      look: { paper: '#f6dfe6' },
      things: [
        thing('picture', 'the picture', 'straighten', [-1.2, 2.3]),
        thing('armchair', 'the armchair', 'lift', [1.4, 0.6]),
        thing('candelabra', 'the candles', 'tap-rhythm', [-2.2, -1.4]),
        thing('clock', 'the clock', 'rub', [2.4, 2.1]),
      ],
      lamp: [2.4, -1.8],
    },
    {
      id: 'conservatory',
      name: 'Conservatory',
      floor: 0,
      kind: 'main',
      box: { x: 5.6, z: -0.1, w: 6.0, d: 5.0 },
      look: { paper: '#d8eadf', floor: '#9b948c' },
      things: [
        thing('flower-pots', 'the flower pots', 'lift', [-1.6, 1.2]),
        thing('bird-cage', 'the bird cage', 'straighten', [1.8, 1.6]),
        thing('watering-can', 'the watering can', 'lift', [1.2, -1.4]),
      ],
      lamp: [-2.2, -1.6],
    },
    {
      id: 'stair-hall',
      name: 'Stair Hall',
      floor: 0,
      kind: 'main',
      box: { x: 0.1, z: 5.6, w: 4.2, d: 5.8 },
      look: { paper: '#e9cfe2' },
      things: [
        thing('hall-lamp', 'the lamp', 'tap-rhythm', [-1.4, -1.8], 'lamp'),
        thing('runner', 'the runner', 'straighten', [0, -0.6]),
        thing('banister', 'the banister', 'straighten', [1.4, 1.4]),
      ],
      lamp: [-1.4, -1.8],
    },
    {
      id: 'dining-room',
      name: 'Dining Room',
      floor: 0,
      kind: 'main',
      box: { x: -5.7, z: 5.9, w: 6.2, d: 5.6 },
      look: { paper: '#f3dcd0' },
      // TUNE: the design's five toppled chairs, one hold each.
      things: [
        thing('chair-1', 'a chair', 'lift', [-1.6, 1.2], 'chair'),
        thing('chair-2', 'a chair', 'lift', [0, 1.4], 'chair'),
        thing('chair-3', 'a chair', 'lift', [1.6, 1.2], 'chair'),
        thing('chair-4', 'a chair', 'lift', [-0.8, -1.2], 'chair'),
        thing('chair-5', 'a chair', 'lift', [0.8, -1.2], 'chair'),
        thing('tablecloth', 'the tablecloth', 'straighten', [0, 0]),
        thing('soup-bowl', 'the bowl', 'lift', [2.4, -1.9]),
      ],
      lamp: [-2.6, -2.2],
    },
    {
      id: 'library',
      name: 'Library',
      floor: 0,
      kind: 'main',
      box: { x: 5.7, z: 5.7, w: 6.0, d: 5.4 },
      look: { paper: '#d9d2ef' },
      things: [
        thing('books-1', 'the books', 'lift', [-2.2, 1.8], 'book-pile'),
        thing('books-2', 'the books', 'lift', [0.4, 2.0], 'book-pile'),
        thing('books-3', 'the books', 'lift', [2.2, -0.4], 'book-pile'),
        thing('globe', 'the globe', 'straighten', [-1.4, -1.6]),
        {
          // Owner decision 5: the first Relight room, 5×5.
          ...thing('reading-lamps', 'the reading lamps', 'relight', [1.2, -1.8]),
          puzzle: 'inner',
        },
      ],
      lamp: [2.4, 2.1],
    },
    {
      id: 'kitchen',
      name: 'Kitchen',
      floor: 0,
      kind: 'main',
      box: { x: -5.6, z: 11.5, w: 6.2, d: 5.2 },
      look: { paper: '#dfeaf3', floor: '#9b948c' },
      things: [
        thing('stove', 'the stove', 'tap-rhythm', [-2.0, 1.6]),
        thing('tap', 'the tap', 'straighten', [0.4, 2.1]),
        thing('pans', 'the pans', 'lift', [1.8, 0.2]),
        thing('cookie-jar', 'the cookie jar', 'rub', [2.4, 1.9]),
      ],
      lamp: [-2.4, -1.8],
    },
    {
      id: 'scullery',
      name: 'Scullery Passage',
      floor: 0,
      kind: 'main',
      box: { x: 0.1, z: 11.2, w: 4.2, d: 4.6 },
      look: { paper: '#e6d5c4', floor: '#9b948c' },
      things: [
        thing('mop', 'the mop', 'lift', [-1.2, 1.2]),
        thing('bucket', 'the bucket', 'straighten', [1.2, 1.4]),
      ],
      lamp: [0, 1.9],
    },
    {
      id: 'pantry',
      name: 'Pantry',
      floor: 0,
      kind: 'bonus',
      box: { x: 5.6, z: 11.4, w: 5.6, d: 4.8 },
      look: { paper: '#f1e0c0', floor: '#9b948c' },
      things: [],
      lamp: [0, 1.8],
    },
    {
      id: 'inglenook',
      name: 'Inglenook',
      floor: 0,
      kind: 'bonus',
      box: { x: -10.7, z: 0.6, w: 3.2, d: 3.6 },
      look: { paper: '#f7e2c8' },
      things: [],
      lamp: [0, 1.2],
    },
    {
      id: 'hanging-garden',
      name: 'Hanging Garden',
      floor: 0,
      kind: 'bonus',
      box: { x: 10.6, z: -0.1, w: 3.4, d: 3.6 },
      look: { paper: '#dcefd2', floor: '#8fae7e' },
      things: [],
      lamp: [0, 1.2],
    },

    // ── Upstairs ───────────────────────────────────────────────────────
    {
      id: 'landing',
      name: 'Landing',
      floor: 1,
      kind: 'main',
      box: { x: 0, z: 5.6, w: 4.2, d: 5.8 },
      look: { paper: '#e9cfe2' },
      things: [
        thing('landing-lamp', 'the lamp', 'tap-rhythm', [1.4, -1.8], 'lamp'),
        thing('hat-stand', 'the hat stand', 'lift', [-1.2, 0.4]),
      ],
      lamp: [1.4, -1.8],
    },
    {
      id: 'blue-bedroom',
      name: 'Blue Bedroom',
      floor: 1,
      kind: 'main',
      box: { x: -5.6, z: 3.0, w: 6.2, d: 5.4 },
      look: { paper: '#cfe0f5' },
      things: [
        thing('bed', 'the bed', 'straighten', [-1.4, 1.2]),
        thing('mirror', 'the mirror', 'straighten', [2.2, 2.3]),
        thing('bedside-lamp', 'the lamp', 'tap-rhythm', [0.4, 1.9], 'lamp'),
        thing('drawers', 'the drawers', 'lift', [2.0, -1.6]),
      ],
      lamp: [0.4, 1.9],
    },
    {
      id: 'nursery',
      name: 'Nursery',
      floor: 1,
      kind: 'main',
      box: { x: -5.6, z: 8.6, w: 6.2, d: 5.4 },
      look: { paper: '#f9e3ec' },
      things: [
        thing('rocking-horse', 'the rocking horse', 'straighten', [-1.6, 0.8]),
        thing('blocks', 'the blocks', 'tap-rhythm', [0.6, -1.2]),
        thing('mobile', 'the mobile', 'rub', [0, 1.6]),
        thing('toy-chest', 'the toy chest', 'lift', [2.2, 1.8]),
      ],
      lamp: [-2.4, -2.0],
    },
    {
      id: 'music-room',
      name: 'Music Room',
      floor: 1,
      kind: 'main',
      box: { x: 5.6, z: 3.0, w: 6.0, d: 5.4 },
      look: { paper: '#efe3c8' },
      things: [
        thing('piano-lid', 'the piano lid', 'lift', [-1.4, 1.6]),
        thing('music-stands', 'the music stands', 'straighten', [1.6, 1.0]),
        {
          // Owner decision 5: the second Relight room, 6×6.
          ...thing('music-box', 'the music box', 'relight', [0.8, -1.6]),
          puzzle: 'heart',
        },
      ],
      lamp: [-2.4, -2.0],
    },
    {
      id: 'sewing-room',
      name: 'Sewing Room',
      floor: 1,
      kind: 'main',
      box: { x: 5.6, z: 8.6, w: 6.0, d: 5.4 },
      look: { paper: '#e3f1e0' },
      things: [
        thing('yarn', 'the yarn', 'rub', [-1.2, -1.0]),
        thing('dress-form', 'the dress form', 'straighten', [1.8, 1.6]),
        thing('pin-cushion', 'the pin cushion', 'tap-rhythm', [0.4, 1.8]),
        thing('sewing-basket', 'the sewing basket', 'lift', [-2.2, 1.6]),
      ],
      lamp: [2.4, -2.0],
    },
    {
      id: 'lantern-closet',
      name: 'Lantern Closet',
      floor: 1,
      kind: 'bonus',
      box: { x: -10.2, z: 3.3, w: 2.8, d: 3.0 },
      look: { paper: '#3a3550', floor: '#2a2535' },
      things: [],
      lamp: [0, 1.0],
    },

    // ── The attic ──────────────────────────────────────────────────────
    {
      id: 'attic',
      name: 'The Attic',
      floor: 2,
      kind: 'attic',
      box: { x: 0, z: 5.6, w: 6.4, d: 5.0 },
      look: { paper: '#e8dcc8' },
      things: [],
      lamp: null,
    },
  ],
  doors: [
    {
      id: 'parlour-door',
      a: { room: 'front-hall', side: 'w', at: 0.3 },
      b: { room: 'parlour', side: 'e', at: 0.1 },
    },
    {
      id: 'conservatory-door',
      a: { room: 'front-hall', side: 'e', at: -0.2 },
      b: { room: 'conservatory', side: 'w', at: 0 },
    },
    {
      id: 'north-door',
      a: { room: 'front-hall', side: 'n', at: 0.2 },
      b: { room: 'stair-hall', side: 's', at: 0.1 },
      key: 'brass-key',
    },
    {
      // The design drew this door open, which walked round the Brass lock;
      // it shares the north door's key so the chain holds.
      id: 'parlour-back-door',
      a: { room: 'parlour', side: 'n', at: 1.2 },
      b: { room: 'dining-room', side: 's', at: 1.0 },
      key: 'brass-key',
    },
    {
      id: 'dining-door',
      a: { room: 'dining-room', side: 'e', at: -0.9 },
      b: { room: 'stair-hall', side: 'w', at: -0.6 },
    },
    {
      id: 'library-door',
      a: { room: 'stair-hall', side: 'e', at: -0.4 },
      b: { room: 'library', side: 'w', at: -0.5 },
      key: 'copper-key',
    },
    {
      id: 'kitchen-door',
      a: { room: 'dining-room', side: 'n', at: -0.5 },
      b: { room: 'kitchen', side: 's', at: -0.5 },
    },
    {
      id: 'scullery-door',
      a: { room: 'stair-hall', side: 'n', at: -0.3 },
      b: { room: 'scullery', side: 's', at: -0.1 },
    },
    {
      id: 'scullery-side-door',
      a: { room: 'kitchen', side: 'e', at: 0.2 },
      b: { room: 'scullery', side: 'w', at: 0 },
    },
    {
      id: 'pantry-door',
      a: { room: 'scullery', side: 'e', at: 0.1 },
      b: { room: 'pantry', side: 'w', at: 0.1 },
      power: 'water',
      sleeper: 'the flames',
    },
    {
      id: 'inglenook-door',
      a: { room: 'parlour', side: 'w', at: 0 },
      b: { room: 'inglenook', side: 'e', at: 0.4 },
      power: 'fire',
      sleeper: 'the cold fireplace',
    },
    {
      id: 'garden-door',
      a: { room: 'conservatory', side: 'e', at: 0 },
      b: { room: 'hanging-garden', side: 'w', at: 0 },
      power: 'leaf',
      sleeper: 'the cracked window',
    },
    {
      id: 'stairs',
      a: { room: 'stair-hall', side: 'n', at: 1.4 },
      b: { room: 'landing', side: 's', at: 0 },
      key: 'silver-key',
    },
    {
      id: 'blue-bedroom-door',
      a: { room: 'landing', side: 'w', at: -1.5 },
      b: { room: 'blue-bedroom', side: 'e', at: 1.1 },
    },
    {
      id: 'nursery-door',
      a: { room: 'landing', side: 'w', at: 1.3 },
      b: { room: 'nursery', side: 'e', at: -1.7 },
      key: 'iron-key',
    },
    {
      id: 'music-room-door',
      a: { room: 'landing', side: 'e', at: -1.2 },
      b: { room: 'music-room', side: 'w', at: 1.4 },
    },
    {
      id: 'sewing-room-door',
      a: { room: 'landing', side: 'e', at: 1.4 },
      b: { room: 'sewing-room', side: 'w', at: -1.6 },
      key: 'little-key',
    },
    {
      id: 'closet-door',
      a: { room: 'blue-bedroom', side: 'w', at: 0.5 },
      b: { room: 'lantern-closet', side: 'e', at: 0.2 },
      power: 'light',
      sleeper: 'the dark closet',
    },
    {
      id: 'attic-ladder',
      a: { room: 'landing', side: 'n', at: 0 },
      b: { room: 'attic', side: 's', at: 0 },
      key: 'attic-key',
    },
  ],
  // The chain: each key hides in a room the keys before it already open.
  keys: [
    { id: 'brass-key', name: 'Brass Key', hidesIn: ['parlour', 'conservatory'] },
    {
      id: 'copper-key',
      name: 'Copper Key',
      hidesIn: ['conservatory', 'parlour', 'dining-room', 'kitchen'],
    },
    { id: 'silver-key', name: 'Silver Key', hidesIn: ['kitchen', 'dining-room', 'library'] },
    { id: 'iron-key', name: 'Iron Key', hidesIn: ['library', 'blue-bedroom', 'music-room'] },
    { id: 'little-key', name: 'Little Key', hidesIn: ['nursery', 'blue-bedroom', 'music-room'] },
    { id: 'attic-key', name: 'Attic Key', hidesIn: ['sewing-room', 'nursery'] },
  ],
  echoLoops: [
    // TUNE: every period and reach (rooms either side of the echo).
    { id: 'stair-echo', rooms: ['stair-hall', 'dining-room'], periodSeconds: 24, reach: 0.3 },
    { id: 'bedroom-echo', rooms: ['landing', 'blue-bedroom'], periodSeconds: 20, reach: 0.3 },
    { id: 'music-echo', rooms: ['landing', 'music-room'], periodSeconds: 28, reach: 0.3 },
  ],
};
