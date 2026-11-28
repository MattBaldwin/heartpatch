import type { LinesView, LineTileResponse, MapView, PublicLine } from '@heartpatch/shared';

// The wires and rails on a Clockwork Isle, as the client has them (#874 C4).
// The map view doesn't carry lines, so this reads `GET /maps/:id/lines` and
// reads it again whenever the map's live `seq` moves (a line laid, a tile
// lost, a Windmill built). Only one read is ever out; a change that lands
// meanwhile asks for one more when it finishes. My own commands answer with
// the tile's line, applied at once; which wires carry power is the server's
// to say, so a command also asks for a fresh read. Pure of the DOM and the
// GPU, so it is unit-tested (the road feed's pattern, roads/road-feed.ts).

/** Is this map a Clockwork Isle? (Every other patch answers NOT_FOUND.) */
export function isClockworkView(view: Pick<MapView, 'map'>): boolean {
  return view.map.patchType === 'clockwork-isle';
}

export interface LineFeed {
  /** The map redrew from `view`: read the lines again if its seq moved. */
  follow: (view: MapView) => void;
  /** My command's answer for one tile and kind. */
  apply: (answer: LineTileResponse, me: string) => void;
  /** Forgets everything (another map, another player). */
  reset: () => void;
  readonly lines: readonly PublicLine[];
  /** Have this map's lines been read at least once? */
  readonly loaded: boolean;
  /** Bumps whenever `lines` changed (for memoising). */
  readonly version: number;
}

export function createLineFeed(
  fetch: (mapId: string) => Promise<LinesView>,
  onChange: () => void,
): LineFeed {
  let mapId: string | null = null;
  let seenSeq: number | null = null;
  let lines: readonly PublicLine[] = [];
  let version = 0;
  let loaded = false;
  let inFlight = false;
  /** A change landed while a read was out: that read may be stale. */
  const wants = { again: false };
  /** Read through a function: a change can land during the await. */
  const askedAgain = (): boolean => wants.again;
  let latest: { mapId: string; seq: number } | null = null;

  const set = (next: readonly PublicLine[]): void => {
    lines = next;
    version += 1;
    onChange();
  };

  async function read(): Promise<void> {
    if (inFlight) {
      wants.again = true;
      return;
    }
    const target = latest;
    if (!target) return;
    inFlight = true;
    wants.again = false;
    try {
      const res = await fetch(target.mapId);
      if (mapId === target.mapId) {
        seenSeq = target.seq;
        if (!askedAgain()) {
          loaded = true;
          set(res.lines);
        }
      }
    } catch {
      // Keep what we have; the next change tries again.
    } finally {
      inFlight = false;
    }
    if (askedAgain() && latest && mapId === latest.mapId) await read();
  }

  return {
    follow: (view) => {
      if (!isClockworkView(view)) {
        if (mapId !== null || lines.length > 0) {
          mapId = null;
          seenSeq = null;
          loaded = false;
          if (lines.length > 0) set([]);
        }
        return;
      }
      if (view.map.id !== mapId) {
        mapId = view.map.id;
        seenSeq = null;
        loaded = false;
        lines = [];
        version += 1;
      }
      latest = { mapId: view.map.id, seq: view.seq };
      if (seenSeq === view.seq) return;
      void read();
    },
    apply: (answer, me) => {
      const same = (l: PublicLine) =>
        l.q === answer.q && l.r === answer.r && l.kind === answer.kind && l.ownerUserId === me;
      const old = lines.find(same);
      const rest = lines.filter((l) => !same(l));
      set(
        answer.line
          ? [
              ...rest,
              {
                q: answer.q,
                r: answer.r,
                kind: answer.kind,
                ownerUserId: me,
                level: answer.line.level,
                // A new wire stays as it was until the server says (the read below).
                ...(answer.kind === 'wire' ? { powered: old?.powered ?? false } : {}),
              },
            ]
          : rest,
      );
      // Power may have moved along the wires: read them again. A read
      // already out may have started before this command.
      if (inFlight) wants.again = true;
      else if (latest && mapId === latest.mapId) void read();
    },
    reset: () => {
      mapId = null;
      seenSeq = null;
      latest = null;
      wants.again = false;
      loaded = false;
      if (lines.length > 0) set([]);
    },
    get lines() {
      return lines;
    },
    get loaded() {
      return loaded;
    },
    get version() {
      return version;
    },
  };
}
