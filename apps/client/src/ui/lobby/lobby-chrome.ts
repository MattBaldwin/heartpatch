// What the lobby shows around the world (#212): its panel, the corner "My
// patches" button, and the "← Back to my patches" pill. Pure, so every case
// is unit-tested; lobby-overlay.ts applies it.

/**
 * - `list`: the lobby's panel is up (over the map, or on its own).
 * - `peek`: the player tapped "Look around the world" with no patch open.
 * - `map`: a patch is open; the corner button brings the list back.
 * - `away`: logged out, or a screen owns the whole stage (a battle).
 */
export type LobbyMode = 'list' | 'peek' | 'map' | 'away';

export interface LobbyChrome {
  panel: boolean;
  openButton: boolean;
  /** The big "← Back to my patches" pill: only while peeking, never over a patch. */
  backPill: boolean;
}

export function lobbyChrome(mode: LobbyMode): LobbyChrome {
  return {
    panel: mode === 'list',
    openButton: mode === 'peek' || mode === 'map',
    backPill: mode === 'peek',
  };
}

/** Where "Look around the world" goes: back to the open patch, else the world. */
export function closeListTo(patchOpen: boolean): LobbyMode {
  return patchOpen ? 'map' : 'peek';
}

/** The pill and the link (style guide: short, kid-readable). */
export const LOBBY_PEEK_TEXT = {
  lookAround: 'Look around the world',
  back: '← Back to my patches',
} as const;
