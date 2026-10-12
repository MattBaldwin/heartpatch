import {
  RequirementGroupSchema,
  type HouseNextLevel,
  type HouseView,
  type RequirementGroup,
  type RequirementProgress,
} from '@heartpatch/shared';
import { needChips, type NeedChip } from '../home/home-view.js';
import { itemName } from '../inventory/bag-view.js';
import { GROW_TEXT } from './house-view.js';

/*
 * What the Grow the house sheet shows (#381 plan §10.4), pure so every case
 * is unit-tested. The server has already worked out every row (`done`,
 * `have`/`need`, the line and the hint), `unlocked` and `affordable`
 * (CLAUDE.md rule 1): this only arranges them. The server checks it all
 * again when the player taps Build it!.
 */

/** The groups in the order the sheet shows them: the Seed cap first. */
export const GROW_GROUP_ORDER: readonly RequirementGroup[] = RequirementGroupSchema.options;

export interface GrowGroup {
  readonly group: RequirementGroup;
  readonly icon: string;
  readonly title: string;
  readonly rows: readonly RequirementProgress[];
}

/** The requirement rows under their group headings, only the groups the level has. */
export function growGroups(next: Pick<HouseNextLevel, 'requirements'>): GrowGroup[] {
  return GROW_GROUP_ORDER.flatMap((group) => {
    const rows = next.requirements.filter((r) => r.group === group);
    if (rows.length === 0) return [];
    const { icon, title } = GROW_TEXT.groups[group];
    return [{ group, icon, title, rows }];
  });
}

/** How full a row's bar is, 0 to 1. */
export function rowFill(row: Pick<RequirementProgress, 'have' | 'need'>): number {
  if (row.need <= 0) return 1;
  return Math.min(1, Math.max(0, row.have / row.need));
}

/** "1/2", the row's count in small type. */
export const rowCount = (row: Pick<RequirementProgress, 'have' | 'need'>): string =>
  `${String(Math.min(row.have, row.need))}/${String(row.need)}`;

/** The cost as have/need chips, my counts from `HouseView.items`. */
export const growNeeds = (view: Pick<HouseView, 'items'>, next: Pick<HouseNextLevel, 'cost'>) =>
  needChips(view.items, next.cost);

/** "60 Timber · 50 Stone · 4 Glimmer". */
export function costLine(cost: Readonly<Record<string, number>>): string {
  return Object.entries(cost)
    .map(([id, n]) => `${String(n)}\u00A0${itemName(id)}`)
    .join(' · ');
}

/** "60 Timber, 50 Stone and 4 Glimmer", for the confirm. */
export function costSentence(cost: Readonly<Record<string, number>>): string {
  const parts = Object.entries(cost).map(([id, n]) => `${String(n)}\u00A0${itemName(id)}`);
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] ?? ''}`;
}

/** A room's name mid-sentence: "The Kitchen" → "the Kitchen". */
export const inSentence = (name: string): string => name.replace(/^The /, 'the ');

/** What the Build button says and does. */
export type GrowState =
  | { readonly kind: 'final' }
  | { readonly kind: 'ready' }
  | {
      readonly kind: 'not-yet';
      /** Unmet rows, plus one when the bag is short. */
      readonly steps: number;
      /** The first thing still to do ("Next up: Build 2 habitats"), named under the button. */
      readonly first: string | null;
    };

/** The rows in the order the sheet shows them. */
const ordered = (next: Pick<HouseNextLevel, 'requirements'>): RequirementProgress[] =>
  growGroups(next).flatMap((g) => g.rows);

/** The first short cost item, as "Gather 12 more Timber". */
function firstShort(needs: readonly NeedChip[]): string | null {
  const short = needs.find((n) => !n.ok);
  return short ? GROW_TEXT.gatherMore(short.need - short.have, short.name) : null;
}

/**
 * Build it! lights only when the server says every row holds and the bag
 * covers the cost; otherwise "Not yet: N things to go!" with the first
 * unmet row (or the short item) named.
 */
export function growState(view: Pick<HouseView, 'next' | 'items'>): GrowState {
  const { next } = view;
  if (!next) return { kind: 'final' };
  if (next.unlocked && next.affordable) return { kind: 'ready' };
  const unmet = ordered(next).filter((r) => !r.done);
  // `unlocked` is the server's word: a row list that reads all done while it
  // says locked still counts one step, so the button never lights wrongly.
  const rows = next.unlocked ? 0 : Math.max(1, unmet.length);
  const steps = rows + (next.affordable ? 0 : 1);
  const first = unmet[0]?.line ?? (next.affordable ? null : firstShort(growNeeds(view, next)));
  return { kind: 'not-yet', steps, first: first === null ? null : GROW_TEXT.nextUp(first) };
}

/** The Build button's words for a state. */
export function buildLabel(state: GrowState): string {
  switch (state.kind) {
    case 'ready':
      return GROW_TEXT.buildIt;
    case 'not-yet':
      return GROW_TEXT.notYet(state.steps);
    case 'final':
      return GROW_TEXT.allGrown;
  }
}

/** The header: "House 2 → 3" big, then "The Kitchen · room for 2" on its own line. */
export const growHeader = (
  view: Pick<HouseView, 'level'>,
  next: Pick<HouseNextLevel, 'level' | 'room'>,
): { readonly levels: string; readonly room: string } => ({
  levels: GROW_TEXT.levels(view.level, next.level),
  room: GROW_TEXT.room(next.room.name, next.room.beds),
});

/** "Build the Kitchen for 60 Timber, 50 Stone and 4 Glimmer?" */
export const confirmLine = (next: Pick<HouseNextLevel, 'room' | 'cost'>): string =>
  GROW_TEXT.confirm(inSentence(next.room.name), costSentence(next.cost));

/**
 * The line after a build, from the house it built: the newest room by name
 * ("Ta-da! The Kitchen is ready. Who moves in?"), or the all-grown line at
 * the top level.
 */
export function builtLine(built: Pick<HouseView, 'rooms' | 'level' | 'final' | 'next'>): string {
  const room = built.rooms.find((r) => r.level === built.level) ?? built.rooms.at(-1);
  const name = room?.name ?? GROW_TEXT.open;
  return built.final || built.next === null ? GROW_TEXT.builtFinal(name) : GROW_TEXT.built(name);
}
