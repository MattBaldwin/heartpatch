import {
  CROOKED_HOUSE,
  type CrookedChestResponse,
  type CrookedHouseView,
  type CrookedRoom,
} from '@heartpatch/shared';
import type { Part } from '../../explore/kit-mesh.js';
import { CELLAR_CHESTS } from '../../hollowed/hollowed-config.js';
import { ball, blk, joyed, ring, tube } from './crooked-kit.js';
import { CROOKED_WALK, type FloorPoint } from './crooked-plan.js';
import { CROOKED_ATTIC_TEXT as A } from './crooked-text.js';

// The Crooked House's attic (#306 6f, owner decision 4), pure so every case
// is unit-tested: where the big chest stands and when it's in reach, how
// many story scraps the page still needs, and the reward card's lines. The
// chest is the cellar's own (`cellar-kit.ts`), opened with its moment
// (`CellarChests`). The server checks every room is right and gives the
// page, the cloak, the title's event and the pile in one transaction (rule
// 1, rule 7); what's in it never ships before it's opened (rule 6).

export const CROOKED_ATTIC = {
  /** The chest stands this share of the attic's depth north of its middle, under the moon window. */
  north: 0.12, // TUNE
  /** The big button names the chest this close, metres (it's big). */
  reach: 2.0, // TUNE
  /** The chest's half-size on the floor, metres (the cellar's big chest), to walk round. */
  half: { x: 1.0, z: 0.63 },
  /** The lectern with the story page, from the attic's middle (x east, z north). */
  lectern: [-2.1, 1.0] as const, // TUNE
} as const;

/** The reward card waits for the cellar chest's wobble and lid, ms. */
export const ATTIC_CARD_MS = CELLAR_CHESTS.big.wobbleMs + CELLAR_CHESTS.big.openMs + 250; // TUNE

/** The house's attic (the data has exactly one). */
export function atticRoom(): CrookedRoom | null {
  return CROOKED_HOUSE.rooms.find((r) => r.kind === 'attic') ?? null;
}

/** Where the attic's big chest stands, floor metres. */
export function atticChestPoint(room: CrookedRoom): FloorPoint {
  return { x: room.box.x, z: room.box.z + room.box.d * CROOKED_ATTIC.north };
}

/** The rooms still to put right before the page can be read (each one a story scrap). */
export function scrapsLeft(view: Pick<CrookedHouseView, 'rooms'>): number {
  return view.rooms.filter((r) => !r.bloomed).length;
}

/** The attic's big chest, unopened and in reach. */
export interface AtticTarget {
  readonly kind: 'attic';
  readonly room: CrookedRoom;
  readonly at: FloorPoint;
}

export function atticTarget(
  room: CrookedRoom,
  view: Pick<CrookedHouseView, 'chestsOpened'>,
  at: FloorPoint,
): AtticTarget | null {
  if (room.kind !== 'attic' || view.chestsOpened.includes(room.id)) return null;
  const p = atticChestPoint(room);
  return Math.hypot(p.x - at.x, p.z - at.z) <= CROOKED_ATTIC.reach
    ? { kind: 'attic', room, at: p }
    : null;
}

/** Walking into the big chest stops beside it, as a wall does. */
export function keepOffAtticChest(room: CrookedRoom, at: FloorPoint): FloorPoint {
  if (room.kind !== 'attic') return at;
  const p = atticChestPoint(room);
  const hx = CROOKED_ATTIC.half.x + CROOKED_WALK.margin;
  const hz = CROOKED_ATTIC.half.z + CROOKED_WALK.margin;
  const dx = at.x - p.x;
  const dz = at.z - p.z;
  if (Math.abs(dx) >= hx || Math.abs(dz) >= hz) return at;
  // Out by the nearer side.
  return hx - Math.abs(dx) < hz - Math.abs(dz)
    ? { x: p.x + Math.sign(dx || 1) * hx, z: at.z }
    : { x: at.x, z: p.z + Math.sign(dz || -1) * hz };
}

/** The big chest's reward card: one line each for the page, the cloak, the title and the pile. */
export function atticLines(
  reply: Pick<CrookedChestResponse, 'find'>,
  names: { item: (id: string) => string; clothing: (id: string) => string },
): string[] {
  const { find } = reply;
  const lines: string[] = [];
  if (find.lore) lines.push(A.page(find.lore.title));
  if (find.clothing) lines.push(A.cloak(names.clothing(find.clothing)));
  lines.push(A.titleLine);
  const pile = Object.entries(find.found)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `${String(n)} ${names.item(id)}`);
  if (pile.length > 0) lines.push(A.pile(pile));
  return lines;
}

/**
 * The attic's own things, room-local (in its room mesh): the round moon
 * window in the far wall, and the lectern whose page glows once every scrap
 * is found. Grey with the attic until it's reached, as every room.
 */
export function atticParts(room: CrookedRoom, joy: number, pageReady: boolean): Part[] {
  const far = room.box.d / 2 - 0.34;
  const [lx, lz] = CROOKED_ATTIC.lectern;
  return [
    // The moon window: a wooden ring round a pale moonlit pane.
    ring(1.1, 0.14, [0, 1.55, far], joyed('#8a6a4a', joy), [Math.PI / 2, 0, 0]),
    ball(1.0, [0, 1.55, far + 0.04], joyed('#dfe8ff', joy), [1, 1, 0.08]),
    ball(0.34, [0.18, 1.66, far - 0.02], joyed('#fff6cf', joy), [1, 1, 0.1]),
    // The lectern, and its page (bright once the house is all put right).
    tube(0.9, 0.08, 0.14, [lx, 0.45, lz], joyed('#8a6a4a', joy)),
    blk(0.7, 0.08, 0.5, [lx, 0.95, lz], joyed('#a67c52', joy), { rot: [-0.45, 0, 0] }),
    blk(0.5, 0.03, 0.36, [lx, 1.01, lz - 0.02], joyed(pageReady ? '#fff8e4' : '#cfc6b8', joy), {
      rot: [-0.45, 0, 0],
    }),
  ];
}
