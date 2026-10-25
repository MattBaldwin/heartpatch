import type { MapView, PublicRoad, RoadsView, RoadTileResponse } from '@heartpatch/shared';

// The roads on a Wild Isle, as the client has them (#621 W1-6). The map view
// doesn't carry roads, so this reads `GET /maps/:id/roads` and reads it again
// whenever the map's live `seq` moves (a road laid, a tile lost, a storm).
// Only one read is ever out; a change that lands meanwhile asks for one more
// when it finishes. My own commands answer with the tile's road, applied at
// once. Pure of the DOM and the GPU, so it is unit-tested.

/** Is this map a Wild Isle? (Cozy Patches have no roads and answer NOT_FOUND.) */
export function isWildIsleView(view: Pick<MapView, 'map'>): boolean {
  return view.map.patchType === 'wild-isle';
}

export interface RoadFeed {
  /** The map redrew from `view`: read the roads again if its seq moved. */
  follow: (view: MapView) => void;
  /** My command's answer for one tile. */
  apply: (answer: RoadTileResponse, me: string) => void;
  /** Forgets everything (another map, another player). */
  reset: () => void;
  readonly roads: readonly PublicRoad[];
  /** Has this map's roads been read at least once? */
  readonly loaded: boolean;
  /** Bumps whenever `roads` changed (for memoising). */
  readonly version: number;
}

export function createRoadFeed(
  fetch: (mapId: string) => Promise<RoadsView>,
  onChange: () => void,
): RoadFeed {
  let mapId: string | null = null;
  let seenSeq: number | null = null;
  let roads: readonly PublicRoad[] = [];
  let version = 0;
  let loaded = false;
  let inFlight = false;
  /** A change landed while a read was out: that read may be stale. */
  const wants = { again: false };
  /** Read through a function: a change can land during the await. */
  const askedAgain = (): boolean => wants.again;
  let latest: { mapId: string; seq: number } | null = null;

  const set = (next: readonly PublicRoad[]): void => {
    roads = next;
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
          set(res.roads);
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
      if (!isWildIsleView(view)) {
        if (mapId !== null || roads.length > 0) {
          mapId = null;
          seenSeq = null;
          loaded = false;
          if (roads.length > 0) set([]);
        }
        return;
      }
      if (view.map.id !== mapId) {
        mapId = view.map.id;
        seenSeq = null;
        loaded = false;
        roads = [];
        version += 1;
      }
      latest = { mapId: view.map.id, seq: view.seq };
      if (seenSeq === view.seq) return;
      void read();
    },
    apply: (answer, me) => {
      const rest = roads.filter((r) => r.q !== answer.q || r.r !== answer.r);
      set(
        answer.road
          ? [...rest, { q: answer.q, r: answer.r, ownerUserId: me, level: answer.road.level }]
          : rest,
      );
      // A read already out may have started before this command.
      if (inFlight) wants.again = true;
    },
    reset: () => {
      mapId = null;
      seenSeq = null;
      latest = null;
      wants.again = false;
      loaded = false;
      if (roads.length > 0) set([]);
    },
    get roads() {
      return roads;
    },
    get loaded() {
      return loaded;
    },
    get version() {
      return version;
    },
  };
}
