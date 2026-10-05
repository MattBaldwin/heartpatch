// The two side trays over the map (owner decision 2026-10-04): "Adventure" on
// the left, "My Heartpatch" on the right. Pure state, so the rules are tested
// without a DOM: at most one tray open, nothing opens while the map is off
// screen, and opening a tray answers the first-time hint.

export type TraySide = 'adventure' | 'heartpatch';

export interface TrayState {
  /** The map's HUD is on screen (the trays and their handles). */
  readonly visible: boolean;
  /** The open tray, or null. */
  readonly open: TraySide | null;
  /** Sprout's first-time "look at the edges" hint is showing. */
  readonly hint: boolean;
}

export type TrayAction =
  | { readonly type: 'show' }
  | { readonly type: 'hide' }
  | { readonly type: 'toggle'; readonly side: TraySide }
  | { readonly type: 'open'; readonly side: TraySide }
  | { readonly type: 'close' }
  | { readonly type: 'hint' }
  | { readonly type: 'dismiss-hint' };

export const INITIAL_TRAYS: TrayState = { visible: false, open: null, hint: false };

export function trayReducer(state: TrayState, action: TrayAction): TrayState {
  switch (action.type) {
    case 'show':
      return state.visible ? state : { ...state, visible: true };
    case 'hide':
      // Leaving the map shuts everything; the hint comes back next time if unanswered.
      return INITIAL_TRAYS;
    case 'toggle':
      if (!state.visible) return state;
      return { ...state, open: state.open === action.side ? null : action.side, hint: false };
    case 'open':
      if (!state.visible) return state;
      return { ...state, open: action.side, hint: false };
    case 'close':
      return state.open === null ? state : { ...state, open: null };
    case 'hint':
      // Only over a map with both trays shut: it points at the handles.
      return state.visible && state.open === null ? { ...state, hint: true } : state;
    case 'dismiss-hint':
      return state.hint ? { ...state, hint: false } : state;
  }
}

/** Something on a tray that wants the player's eye (a new raid report, a friend in the Hollow). */
export interface TrayAlert {
  readonly side: TraySide;
  /** How many (a raid count); 1 for a nudge with no number. */
  readonly count: number;
  /** A few words to peek out beside the handle, or null. */
  readonly peek: string | null;
}

export interface HandleBadge {
  /** What the badge says ("2"), or null for no badge. */
  readonly text: string | null;
  /** The newest alert's peek line, if any. */
  readonly peek: string | null;
}

/** The badge on one side's handle: the sum of that tray's alerts. */
export function handleBadge(alerts: readonly TrayAlert[], side: TraySide): HandleBadge {
  const mine = alerts.filter((a) => a.side === side && a.count > 0);
  if (mine.length === 0) return { text: null, peek: null };
  const total = mine.reduce((sum, a) => sum + a.count, 0);
  const peek = mine.find((a) => a.peek !== null)?.peek ?? null;
  return { text: total > 9 ? '9+' : String(total), peek };
}

/** Peek lines that are new since `before`, so a badge only peeks out when something changed. */
export function newPeeks(before: readonly TrayAlert[], after: readonly TrayAlert[]): TrayAlert[] {
  const seen = new Set(before.map((a) => `${a.side}:${a.peek ?? ''}:${String(a.count)}`));
  return after.filter(
    (a) => a.peek !== null && a.count > 0 && !seen.has(`${a.side}:${a.peek}:${String(a.count)}`),
  );
}
